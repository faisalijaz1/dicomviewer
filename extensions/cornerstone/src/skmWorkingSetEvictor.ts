/**
 * ────────────────────────────────────────────────────────────────────────────
 *  SKM-WORKING-SET-EVICTOR 2026-10-04 — Option B correction (Phase 1 failure fix)
 *  SKM 2026-10-05 (Fix 2) — NON-BLOCKING, IDLE-BATCHED EVICTION
 *
 *  WHY
 *  @cornerstonejs/core 4.22.10 does NOT LRU-evict decoded images that belong to the
 *  ACTIVE stack — when a decode would exceed maxCacheSize it THROWS CACHE_SIZE_EXCEEDED
 *  instead of evicting (observed: decode pinned at the cap, evictionsPerMin 0, then the
 *  modal). So a small cap is a hard wall, not a soft bound. This module does the eviction
 *  Cornerstone won't: it keeps only a WORKING WINDOW of decoded slices around the doctor
 *  and purges the rest, so decoded RAM stays ≈ the window (well under the cap → no throw),
 *  and evicted slices re-decode from the browser HTTP cache (trusted cert → transferSize 0)
 *  when the doctor returns.
 *
 *  FIX 2 (2026-10-05): the earlier build purged a whole pass in ONE synchronous task —
 *  up to maxEvictPerTick (400) removeImageLoadObject() calls back-to-back, each
 *  synchronously dispatching IMAGE_CACHE_IMAGE_REMOVED to every listener, and when it hit
 *  the per-tick cap it immediately re-scheduled another pass. Measured bursts of
 *  removed=300/328/347 lined up with the long tasks (8 tasks / 1135 ms) that are felt as
 *  fast-scroll freezes. This version keeps the SAME working-set semantics and RAM bound but
 *  drains the eviction candidates in SMALL idle-scheduled batches (maxEvictPerTick now 50),
 *  yielding the main thread to the viewport between batches:
 *    - batches run in requestIdleCallback (fallback setTimeout) — never a tight self-loop,
 *    - if the doctor is actively scrolling (input within inputQuietMs) the pump DEFERS the
 *      batch rather than competing with the current image request/render,
 *    - if the doctor jumps far (centre moved > abortMoveThreshold since the pass started)
 *      the pass ABORTS its stale candidate list and the next scheduled pass recomputes,
 *    - the keep-set / budget / direction / volume-skip logic is unchanged.
 *
 *  SAFETY
 *  - STACK viewports only. If ANY MPR / volume (3D / orthographic) viewport is present it
 *    SKIPS entirely (volumes manage their own memory; we never touch them) → MPR,
 *    crosshairs, measurements, synchronisation and hanging protocols are unaffected.
 *  - Never evicts the current slice or its immediate neighbourhood (generous margin).
 *  - Bounded work per batch (maxEvictPerTick) so a batch can't cause a long task.
 *  - Pure cache.removeImageLoadObject() calls — no stack/imageId/core changes. No force:true.
 *
 *  REVERSIBILITY
 *  Gated by appConfig.skmActiveEviction.enabled (default on). Off → behaviour is exactly
 *  the pre-fix build (Cornerstone's own non-evicting cap). To remove: delete the
 *  initSkmWorkingSetEvictor() call in init.tsx and this file.
 *
 *  Exposes window.__skmEvictions (count) and window.__skmEvictorLast (per-pass telemetry).
 * ────────────────────────────────────────────────────────────────────────────
 */

// eslint-disable-next-line
import { cache, Enums } from '@cornerstonejs/core';
import { subscribeStackNewImage } from './utils/skmStackNewImage';

export type SkmEvictionConfig = {
  enabled?: boolean;
  /**
   * SKM 2026-10-04 (Phase B item 1): BUDGET-BASED working set. When true (default), the
   * number of decoded slices kept around the doctor is computed from the decoded-cache
   * budget (budgetFraction × maxCacheSize ÷ measured avg slice bytes), NOT a fixed window —
   * so the decoded set fills the committed 768 MB budget (adapting to real slice size)
   * without exceeding it, instead of under-using it (~350 MB) and forcing re-decode on fast
   * scroll. Set false to use the fixed keepAhead/keepBehind window.
   */
  budgetBased?: boolean;
  /** Fraction of maxCacheSize the decoded working set may fill. Default 0.9 (headroom below cap). */
  budgetFraction?: number;
  /** Of the budget, fraction allocated AHEAD (scroll direction). Default 0.65. */
  aheadBias?: number;
  /** Fallback avg decoded bytes/slice when the cache can't be measured yet. Default 524288 (~0.5 MB). */
  avgSliceBytesEstimate?: number;
  /** Fixed-window fallback (used when budgetBased is false): slices to KEEP ahead. Default 400. */
  keepAhead?: number;
  /** Fixed-window fallback: slices to KEEP behind. Default 250. */
  keepBehind?: number;
  /** Extra safety margin added on both sides of the keep-window. Default 50. */
  margin?: number;
  /**
   * SKM 2026-10-05 (Fix 2): max slices to evict PER BATCH (not per pass). Small so a single
   * batch is a short task; the idle pump drains the full overflow across batches. Default 50.
   */
  maxEvictPerTick?: number;
  /** Throttle (ms) between eviction PASSES (entry debounce). Default 250. */
  throttleMs?: number;
  /** Skip all eviction when a volume/MPR viewport is present. Default true. */
  skipWhenVolumePresent?: boolean;
  /**
   * SKM 2026-10-05 (Fix 2): requestIdleCallback timeout (ms) — guarantees a batch still runs
   * even when the browser never reports idle (busy tab), so eviction can't stall forever.
   * Default 500.
   */
  idleTimeoutMs?: number;
  /**
   * SKM 2026-10-05 (Fix 2): if the last displayed-slice change (STACK_NEW_IMAGE) was within
   * this many ms, the doctor is "actively scrolling" and the pump DEFERS the batch instead of
   * competing with the current image request/render. Default 120.
   */
  inputQuietMs?: number;
  /**
   * SKM 2026-10-05 (Fix 2): if the active centre moved more than this many slices since the
   * pass started, the pass ABORTS its (now stale) candidate list; the next scheduled pass
   * recomputes the keep-set around the new position. Default 100.
   */
  abortMoveThreshold?: number;
};

let evictorInitialized = false;
let evictionCount = 0; // total removeImageLoadObject() calls (window.__skmEvictions)
let lastCenter: number | null = null;
let direction = 1;

// SKM 2026-10-05 (Fix 2): small ring buffer of recent batch records for inspection
// (window.__skmEvictorBatches). No console output per batch — telemetry only.
const recentBatches: Array<{ t: number; size: number; ms: number; pass: number }> = [];
let passSeq = 0;

function nowMs(): number {
  try {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  } catch (e) {
    return Date.now();
  }
}

// Idle scheduler: requestIdleCallback when present (with a timeout so a busy tab still
// drains), else a short setTimeout. Never a tight 0ms self-loop.
function scheduleIdle(fn: () => void, timeoutMs: number): void {
  try {
    const ric = (globalThis as any).requestIdleCallback;
    if (typeof ric === 'function') {
      ric(fn, { timeout: timeoutMs });
      return;
    }
  } catch (e) {
    /* fall through */
  }
  setTimeout(fn, 16);
}

export function initSkmWorkingSetEvictor(servicesManager: any, config: SkmEvictionConfig): void {
  if (evictorInitialized) {
    return;
  }
  evictorInitialized = true;

  const budgetBased = config?.budgetBased !== false;
  const budgetFraction = Math.min(0.98, Math.max(0.1, config?.budgetFraction ?? 0.9));
  const aheadBias = Math.min(0.9, Math.max(0.1, config?.aheadBias ?? 0.65));
  const avgSliceBytesEstimate = Math.max(1, config?.avgSliceBytesEstimate ?? 524288);
  const keepAhead = Math.max(1, config?.keepAhead ?? 400);
  const keepBehind = Math.max(1, config?.keepBehind ?? 250);
  const margin = Math.max(0, config?.margin ?? 50);
  // SKM 2026-10-05 (Fix 2): default 300 → 50; this is now a PER-BATCH cap.
  const maxEvictPerTick = Math.max(1, config?.maxEvictPerTick ?? 50);
  const throttleMs = Math.max(50, config?.throttleMs ?? 250);
  const skipWhenVolumePresent = config?.skipWhenVolumePresent !== false;
  const idleTimeoutMs = Math.max(50, config?.idleTimeoutMs ?? 500);
  const inputQuietMs = Math.max(0, config?.inputQuietMs ?? 120);
  const abortMoveThreshold = Math.max(1, config?.abortMoveThreshold ?? 100);

  // Measure average decoded bytes/slice from the live cache (adapts to real slice size);
  // fall back to the estimate before anything is decoded.
  const measureAvgSliceBytes = (): number => {
    try {
      const ic = (cache as any)._imageCache;
      const total = (cache as any).getCacheSize?.() || 0;
      if (ic && typeof ic.forEach === 'function' && total > 0) {
        let n = 0;
        ic.forEach((ci: any) => {
          if (ci && ci.sizeInBytes > 0) {
            n++;
          }
        });
        if (n > 0) {
          return total / n;
        }
      }
    } catch (e) {
      /* fall through */
    }
    return avgSliceBytesEstimate;
  };

  // Budget-based per-viewport keep (slices), split ahead/behind by scroll direction. The
  // total across all open stack viewports stays within budgetFraction × cap, so N panes share
  // the budget instead of each demanding a full window.
  const computeKeep = (dir: number, nStack: number): { ahead: number; behind: number } => {
    if (!budgetBased) {
      return {
        ahead: dir >= 0 ? keepAhead : keepBehind,
        behind: dir >= 0 ? keepBehind : keepAhead,
      };
    }
    const capBytes = (cache as any).getMaxCacheSize?.() || 768 * 1048576;
    const avg = measureAvgSliceBytes();
    const totalSlices = Math.max(1, Math.floor((budgetFraction * capBytes) / avg));
    const perViewport = Math.max(1, Math.floor(totalSlices / Math.max(1, nStack)));
    const ahead = Math.max(1, Math.floor(perViewport * aheadBias));
    const behind = Math.max(1, perViewport - ahead);
    // Direction flips the ahead/behind allocation (keep more in the scroll direction).
    return dir >= 0 ? { ahead, behind } : { ahead: behind, behind: ahead };
  };

  const isStackViewport = (vp: any): boolean =>
    !!vp &&
    typeof vp.getCurrentImageIdIndex === 'function' &&
    typeof vp.getImageIds === 'function' &&
    vp.type !== Enums.ViewportType.ORTHOGRAPHIC &&
    vp.type !== Enums.ViewportType.VOLUME_3D;

  const anyVolumePresent = (viewports: Map<string, any>, csvs: any): boolean => {
    for (const [viewportId] of viewports) {
      try {
        const vp = csvs.getCornerstoneViewport?.(viewportId);
        if (
          vp &&
          (vp.type === Enums.ViewportType.ORTHOGRAPHIC || vp.type === Enums.ViewportType.VOLUME_3D)
        ) {
          return true;
        }
      } catch (e) {
        /* ignore */
      }
    }
    return false;
  };

  // ── Non-blocking pass state (Fix 2) ───────────────────────────────────────
  let timer: ReturnType<typeof setTimeout> | null = null;
  let passActive = false; // a batched pass is draining
  let lastInputAt = 0; // last STACK_NEW_IMAGE (scroll) time, for the "actively scrolling" check

  // Per-pass working state.
  let passCandidates: string[] = [];
  let passKeep: Set<string> = new Set();
  let passCenterAtStart = 0;
  let passActiveViewportId: string | null = null;
  let passCsvs: any = null;
  let passDecodedBeforeMB = 0;
  let passRemoved = 0;
  let passBatches = 0;
  let passMaxBatch = 0;
  let passYields = 0;
  let passAborted = 0;
  let passStartT = 0;
  let passEvictMs = 0; // cumulative time spent in removeImageLoadObject loops this pass
  let passKeepLo = 0;
  let passKeepHi = 0;
  let passKeepAheadN = 0;
  let passKeepBehindN = 0;
  let passProtected = 0;
  let passStackVps = 0;

  // Current centre of the active viewport (best-effort; 0 if unknown).
  const currentActiveCenter = (): number => {
    try {
      if (passActiveViewportId && passCsvs) {
        const vp = passCsvs.getCornerstoneViewport?.(passActiveViewportId);
        const idx = vp?.getCurrentImageIdIndex?.();
        if (typeof idx === 'number' && idx >= 0) {
          return idx;
        }
      }
    } catch (e) {
      /* ignore */
    }
    return passCenterAtStart;
  };

  const publishLast = () => {
    const last = {
      center: lastCenter,
      direction,
      keepAhead: passKeepAheadN,
      keepBehind: passKeepBehindN,
      keepLo: passKeepLo,
      keepHi: passKeepHi,
      stackViewports: passStackVps,
      protectedCount: passProtected,
      // last-pass batch telemetry (Fix 2)
      removed: passRemoved, // removed this pass (across all batches)
      lastRemoved: passRemoved,
      batches: passBatches,
      maxBatch: passMaxBatch, // largest single batch this pass (should be ≤ maxEvictPerTick)
      yields: passYields, // times a batch was deferred due to active scrolling
      aborted: passAborted, // 1 if the pass aborted on a far jump
      passMs: Math.round(nowMs() - passStartT), // wall time pass→finish (incl. idle gaps)
      evictMs: Math.round(passEvictMs), // main-thread time actually spent removing
      decodedBeforeMB: passDecodedBeforeMB,
      decodedAfterMB: Math.round(((cache as any).getCacheSize?.() || 0) / 1048576),
      totalEvicted: evictionCount,
      batchCap: maxEvictPerTick,
    };
    (globalThis as any).__skmEvictorLast = last;
    return last;
  };

  const finishPass = (reason: 'drained' | 'aborted' | 'empty') => {
    if (reason === 'aborted') {
      passAborted = 1;
    }
    const last = publishLast();
    passActive = false;
    passCandidates = [];
    passKeep = new Set();
    passCsvs = null;
    passActiveViewportId = null;
    if (passRemoved > 0 || reason === 'aborted') {
      // eslint-disable-next-line no-console
      console.log(
        `[SKM-EVICTOR] pass#${passSeq} ${reason}: center=${lastCenter} ` +
          `keep=[${last.keepLo}..${last.keepHi}] removed=${passRemoved} in ${passBatches} batch(es) ` +
          `(max ${passMaxBatch}/${maxEvictPerTick}, yields ${passYields}) ` +
          `decodedMB ${passDecodedBeforeMB}→${last.decodedAfterMB} evictMs ${last.evictMs} ` +
          `(total ${evictionCount})`
      );
    }
  };

  // Run ONE small batch of removals from passCandidates, then either schedule the next
  // batch (idle) or finish the pass. Defers if the doctor is actively scrolling; aborts if
  // the centre jumped far since the pass started.
  const runBatch = () => {
    if (!passActive) {
      return;
    }
    if (!passCandidates.length) {
      finishPass('drained');
      return;
    }

    // Yield to the viewport while the doctor is actively scrolling: the current image
    // request/render path must win the main thread over background eviction.
    if (inputQuietMs > 0 && nowMs() - lastInputAt < inputQuietMs) {
      passYields++;
      scheduleIdle(runBatch, idleTimeoutMs);
      return;
    }

    // Abort a pass whose keep-set is now stale because the doctor jumped far. The next
    // STACK_NEW_IMAGE already (re)scheduled a pass that will recompute around the new centre.
    if (Math.abs(currentActiveCenter() - passCenterAtStart) > abortMoveThreshold) {
      finishPass('aborted');
      return;
    }

    const t0 = nowMs();
    let removedThisBatch = 0;
    while (removedThisBatch < maxEvictPerTick && passCandidates.length) {
      const imageId = passCandidates.pop() as string;
      if (!imageId || passKeep.has(imageId)) {
        continue; // protected (keep-set from pass start) — never evict
      }
      // Only purge things actually taking decoded memory right now.
      let present = false;
      try {
        present = !!(cache as any).getImageLoadObject?.(imageId);
      } catch (e) {
        present = false;
      }
      if (!present) {
        continue;
      }
      try {
        (cache as any).removeImageLoadObject(imageId);
        removedThisBatch++;
      } catch (e) {
        /* image in use / already gone — skip */
      }
    }
    const dt = nowMs() - t0;
    passEvictMs += dt;

    if (removedThisBatch > 0) {
      evictionCount += removedThisBatch;
      (globalThis as any).__skmEvictions = evictionCount;
      passRemoved += removedThisBatch;
      passBatches++;
      if (removedThisBatch > passMaxBatch) {
        passMaxBatch = removedThisBatch;
      }
      recentBatches.push({ t: Date.now(), size: removedThisBatch, ms: Math.round(dt), pass: passSeq });
      if (recentBatches.length > 60) {
        recentBatches.shift();
      }
      (globalThis as any).__skmEvictorBatches = recentBatches;
    }

    // Publish incrementally so telemetry can read progress mid-pass.
    publishLast();

    if (passCandidates.length) {
      scheduleIdle(runBatch, idleTimeoutMs);
    } else {
      finishPass('drained');
    }
  };

  // Build the keep-set + candidate list for a new pass (the cheap scan), then start the
  // idle-batched pump. Union of keep-ranges across all open STACK viewports, keyed by
  // imageId, so a slice kept by ANY viewport is never evicted (safe for comparison panes).
  const startPass = () => {
    try {
      if (passActive) {
        return; // a pass is already draining; a new STACK_NEW_IMAGE will re-schedule after it
      }
      const { viewportGridService, cornerstoneViewportService: csvs } = servicesManager.services;
      if (!viewportGridService || !csvs) {
        return;
      }
      const state = viewportGridService.getState();
      const viewports: Map<string, any> = state?.viewports;
      if (!viewports || typeof viewports.forEach !== 'function') {
        return;
      }
      if (skipWhenVolumePresent && anyVolumePresent(viewports, csvs)) {
        return; // MPR/3D session → leave memory to Cornerstone's volume management
      }

      // Collect open STACK viewports (and update scroll direction) so the budget can be split.
      const stackVps: { imageIds: string[]; idx: number; viewportId: string }[] = [];
      viewports.forEach((_vpState: any, viewportId: string) => {
        const vp = csvs.getCornerstoneViewport?.(viewportId);
        if (!isStackViewport(vp)) {
          return;
        }
        const imageIds: string[] = vp.getImageIds() || [];
        if (!imageIds.length) {
          return;
        }
        const idx = vp.getCurrentImageIdIndex?.() ?? 0;
        stackVps.push({ imageIds, idx, viewportId });
      });

      if (!stackVps.length) {
        return;
      }

      const activeIdx = stackVps[0].idx;
      if (lastCenter !== null && activeIdx !== lastCenter) {
        direction = activeIdx > lastCenter ? 1 : -1;
      }
      lastCenter = activeIdx;

      const { ahead: keepAheadN, behind: keepBehindN } = computeKeep(direction, stackVps.length);

      const keep = new Set<string>();
      let keepLo = Infinity;
      let keepHi = -Infinity;
      for (const { imageIds, idx } of stackVps) {
        const lo = Math.max(0, idx - keepBehindN - margin);
        const hi = Math.min(imageIds.length - 1, idx + keepAheadN + margin);
        keepLo = Math.min(keepLo, lo);
        keepHi = Math.max(keepHi, hi);
        for (let i = lo; i <= hi; i++) {
          if (imageIds[i]) {
            keep.add(imageIds[i]);
          }
        }
      }

      // Collect decoded slices OUTSIDE the keep-set (the eviction candidates), deduped.
      const candidateSet = new Set<string>();
      for (const { imageIds } of stackVps) {
        for (let i = 0; i < imageIds.length; i++) {
          const imageId = imageIds[i];
          if (!imageId || keep.has(imageId) || candidateSet.has(imageId)) {
            continue;
          }
          let present = false;
          try {
            present = !!(cache as any).getImageLoadObject?.(imageId);
          } catch (e) {
            present = false;
          }
          if (present) {
            candidateSet.add(imageId);
          }
        }
      }

      // Prime pass state.
      passSeq++;
      passActive = true;
      passCandidates = Array.from(candidateSet);
      passKeep = keep;
      passCenterAtStart = activeIdx;
      passActiveViewportId = stackVps[0].viewportId;
      passCsvs = csvs;
      passDecodedBeforeMB = Math.round(((cache as any).getCacheSize?.() || 0) / 1048576);
      passRemoved = 0;
      passBatches = 0;
      passMaxBatch = 0;
      passYields = 0;
      passAborted = 0;
      passStartT = nowMs();
      passEvictMs = 0;
      passKeepLo = keepLo === Infinity ? 0 : keepLo;
      passKeepHi = keepHi === -Infinity ? 0 : keepHi;
      passKeepAheadN = keepAheadN;
      passKeepBehindN = keepBehindN;
      passProtected = keep.size;
      passStackVps = stackVps.length;

      if (!passCandidates.length) {
        finishPass('empty');
        return;
      }

      scheduleIdle(runBatch, idleTimeoutMs);
    } catch (e) {
      // best-effort; never break scrolling
      passActive = false;
    }
  };

  // Entry debounce: coalesce bursts of STACK_NEW_IMAGE / grid events into one pass start.
  const schedule = () => {
    if (timer) {
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      startPass();
    }, throttleMs);
  };

  // STACK_NEW_IMAGE is a NON-bubbling element CustomEvent; wire it PER ELEMENT via
  // ELEMENT_ENABLED (the pattern skmTelemetry uses). Each displayed-slice change both
  // records input time (for the actively-scrolling yield) and (re)schedules a pass.
  const onInput = () => {
    lastInputAt = nowMs();
    schedule();
  };
  subscribeStackNewImage(onInput);
  try {
    const { viewportGridService } = servicesManager.services;
    const E = viewportGridService.EVENTS;
    viewportGridService.subscribe(E.GRID_STATE_CHANGED, schedule);
    viewportGridService.subscribe(E.ACTIVE_VIEWPORT_ID_CHANGED, schedule);
  } catch (e) {
    /* best-effort */
  }

  // eslint-disable-next-line no-console
  console.log(
    (budgetBased
      ? `[SKM-EVICTOR] active, BUDGET-BASED: fill ${Math.round(budgetFraction * 100)}% of cap, ` +
        `aheadBias ${aheadBias}, margin ${margin} (keep window sized live from avg slice bytes)`
      : `[SKM-EVICTOR] active, fixed window: keep ${keepBehind}+${keepAhead} (+${margin}) slices`) +
      ` | Fix 2: idle-batched, batchCap ${maxEvictPerTick}, inputQuiet ${inputQuietMs}ms, ` +
      `abortMove ${abortMoveThreshold}, idleTimeout ${idleTimeoutMs}ms`
  );
}
