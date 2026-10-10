/**
 * ────────────────────────────────────────────────────────────────────────────
 *  SKM-EVICTION-DIAGNOSTICS 2026-10-10 — READ-ONLY instrumentation
 *  (DIAGNOSTIC-ONLY. No eviction decisions, thresholds, scheduling, decoding,
 *  rendering, or memory budgets are changed by this file, at any flag setting.)
 *
 *  WHY
 *  Playwright investigation found window.__skmEvictorLast.center/keepLo/keepHi can be
 *  STALE: the reactive-skip early-return in skmWorkingSetEvictor.ts only patched a few
 *  fields onto the PREVIOUS pass's snapshot, leaving center/keep bounds from an older
 *  pass. Separately, an isolated cache-removal test proved only a 512 KiB *accounting*
 *  decrease (cache.getCacheSize()) — NOT JS heap, process RAM, or GPU reclamation. This
 *  module adds the missing read-only visibility without touching eviction logic:
 *    1. A FRESH, timestamped, validity-flagged snapshot on every evictor pass attempt,
 *       including reactive-skip passes (see skmWorkingSetEvictor.ts's `onPass` hook —
 *       the fix is there; this module only consumes and publishes it).
 *    2. skmProbeCacheEntry(imageId) / skmListCacheEntries(maxCount) — read-only cache
 *       membership + accounting probes that REUSE the real production keep-set
 *       (the evictor's own Set, cloned at hook time) and the real production in-flight
 *       set (StudyPrefetcherService.getInflightImageIds()) — never a re-derived
 *       approximation of either.
 *    3. An OPTIONAL, double-gated skmTestEvictImageId(imageId) that refuses eviction
 *       using the SAME real checks (stale snapshot, in-flight, keep-set, currently
 *       displayed, volume-present) before calling the one production removal API
 *       (cache.removeImageLoadObject) — restricted to explicit test builds via
 *       appConfig.skmEvictionDiagnostics.allowTestEviction (separate from `enabled`,
 *       both default false).
 *    4. A bounded, identifiers-only history of IMAGE_CACHE_IMAGE_REMOVED events, using
 *       the EXACT event + payload shape already verified in THIS pinned Cornerstone
 *       build by two other production files (see getImageIdFromCacheEvent below).
 *
 *  WHAT THIS DOES NOT DO
 *  Does not implement OPFS or any persistent decoded-pixel storage. Does not prove
 *  JS heap / process RAM / GPU reclamation — cache.getCacheSize() is an ACCOUNTING
 *  number only; the eviction test helper reports that number before/after and nothing
 *  more. Never retains a pixel buffer, decoded Image object, or ImageLoadObject in any
 *  history/snapshot — only imageId strings, byte counts, timestamps, and booleans.
 *
 *  REVERSIBILITY
 *  Gated by appConfig.skmEvictionDiagnostics.enabled (default false). When false, this
 *  module performs ZERO work: no listeners are attached, no globals are published, and
 *  initSkmWorkingSetEvictor() receives `undefined` hooks (see init.tsx), so
 *  skmWorkingSetEvictor.ts runs byte-for-byte as before this change. To remove entirely:
 *  delete the init call in init.tsx and this file (skmWorkingSetEvictor.ts's hook
 *  parameters are optional and harmless to leave in place).
 * ────────────────────────────────────────────────────────────────────────────
 */

// eslint-disable-next-line
import { cache, eventTarget, Enums } from '@cornerstonejs/core';
import type { SkmEvictorDiagnosticHooks, SkmEvictorPassRecord, SkmEvictorEvictRecord } from './skmWorkingSetEvictor';

export type SkmEvictionDiagnosticsConfig = {
  /** Master gate. Default false — fully inert (no listeners, no globals, zero overhead). */
  enabled?: boolean;
  /**
   * Additional, EXPLICIT opt-in required (on top of `enabled`) for the guarded test-only
   * eviction helper (skmTestEvictImageId). Keep false in any production app-config.js.
   * Default false.
   */
  allowTestEviction?: boolean;
  /** Snapshot older than this is reported invalid for safety decisions. Default 5000. */
  maxSnapshotAgeMs?: number;
  /** Bounded ring buffer size for the cache-removal history (identifiers only). Default 200. */
  maxRemovalHistory?: number;
  /** Default result cap for skmListCacheEntries() when no count is passed. Default 50. */
  maxProbeListCount?: number;
};

const HARD_MAX_LIST_COUNT = 500;

let initialized = false;

function nowMs(): number {
  try {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  } catch (e) {
    return Date.now();
  }
}

function readCacheSizeMB(): number {
  try {
    return Math.round(((cache as any).getCacheSize?.() || 0) / 1048576);
  } catch (e) {
    return 0;
  }
}

export function initSkmEvictionDiagnostics(
  servicesManager: any,
  appConfig: any,
  config: SkmEvictionDiagnosticsConfig = {}
): SkmEvictorDiagnosticHooks | undefined {
  if (!config?.enabled) {
    // Fully inert: no listeners, no globals, no hooks threaded into the evictor.
    return undefined;
  }
  if (initialized) {
    return (globalThis as any).__skmEvictionDiagnosticsHooks;
  }
  initialized = true;

  const MAX_SNAPSHOT_AGE_MS = Math.max(500, config.maxSnapshotAgeMs ?? 5000);
  const MAX_REMOVAL_HISTORY = Math.min(2000, Math.max(10, config.maxRemovalHistory ?? 200));
  const DEFAULT_LIST_COUNT = Math.min(HARD_MAX_LIST_COUNT, Math.max(1, config.maxProbeListCount ?? 50));
  const allowTestEviction = config.allowTestEviction === true;

  // ── snapshot state (identifiers + numbers + a Set<string> of imageIds only — never a
  // pixel buffer or decoded Image/ImageLoadObject reference) ────────────────────────────
  let currentPass: SkmEvictorPassRecord | null = null;
  let lastEviction: SkmEvictorEvictRecord | null = null;
  let lastKeepSet: Set<string> = new Set();

  const snapshotAgeMs = (): number => (currentPass ? nowMs() - currentPass.ts : Infinity);
  const snapshotValid = (): boolean => currentPass != null && snapshotAgeMs() <= MAX_SNAPSHOT_AGE_MS;

  const publish = () => {
    (globalThis as any).__skmEvictionDiagnostics = {
      current: currentPass
        ? {
            ts: currentPass.ts,
            ageMs: Math.round(snapshotAgeMs()),
            valid: snapshotValid(),
            center: currentPass.center,
            direction: currentPass.direction,
            keepLo: currentPass.keepLo,
            keepHi: currentPass.keepHi,
            keepAhead: currentPass.keepAhead,
            keepBehind: currentPass.keepBehind,
            stackViewports: currentPass.stackViewports,
            protectedCount: currentPass.protectedCount,
            fillPct: currentPass.fillPct,
            underPressure: currentPass.underPressure,
            windowedCandidates: currentPass.windowedCandidates,
            orphanCandidates: currentPass.orphanCandidates,
            reactiveSkip: currentPass.reactiveSkip,
          }
        : null,
      // Distinct from `current`: the last pass that ACTUALLY removed ≥1 decoded image.
      lastEviction: lastEviction
        ? {
            ts: lastEviction.ts,
            ageMs: Math.round(nowMs() - lastEviction.ts),
            center: lastEviction.center,
            removedThisBatch: lastEviction.removedThisBatch,
            totalEvicted: lastEviction.totalEvicted,
            pass: lastEviction.pass,
          }
        : null,
      maxSnapshotAgeMs: MAX_SNAPSHOT_AGE_MS,
    };
  };
  publish();

  const onPass = (record: SkmEvictorPassRecord) => {
    currentPass = record;
    lastKeepSet = record.keepSet; // already a fresh clone (imageId strings only)
    publish();
  };
  const onEvict = (record: SkmEvictorEvictRecord) => {
    lastEviction = record;
    publish();
  };

  // ── read-only helpers — REUSE real production state, never a competing approximation ──
  const getInflightSet = (): Set<string> => {
    try {
      const sp = servicesManager?.services?.studyPrefetcherService;
      return typeof sp?.getInflightImageIds === 'function' ? sp.getInflightImageIds() : new Set<string>();
    } catch (e) {
      return new Set<string>();
    }
  };

  const getOpenStackViewports = (): Array<{
    viewportId: string;
    imageIds: string[];
    currentImageId: string | null;
  }> => {
    const out: Array<{ viewportId: string; imageIds: string[]; currentImageId: string | null }> = [];
    try {
      const { viewportGridService, cornerstoneViewportService: csvs } = servicesManager?.services || {};
      const viewports: Map<string, any> = viewportGridService?.getState?.()?.viewports;
      if (!viewports || typeof viewports.forEach !== 'function') {
        return out;
      }
      viewports.forEach((_vpState: any, viewportId: string) => {
        const vp = csvs?.getCornerstoneViewport?.(viewportId);
        if (!vp || typeof vp.getCurrentImageIdIndex !== 'function' || typeof vp.getImageIds !== 'function') {
          return; // not a stack viewport (same check the evictor itself uses)
        }
        const imageIds: string[] = vp.getImageIds() || [];
        const idx = vp.getCurrentImageIdIndex?.() ?? -1;
        out.push({ viewportId, imageIds, currentImageId: idx >= 0 ? imageIds[idx] ?? null : null });
      });
    } catch (e) {
      /* best-effort; diagnostics never breaks the viewer */
    }
    return out;
  };

  // Mirrors the evictor's own skipWhenVolumePresent check (same viewport-type read, not a
  // different policy) so the test-only helper never evicts during an MPR/3D session either.
  const anyVolumePresent = (): boolean => {
    try {
      const { viewportGridService, cornerstoneViewportService: csvs } = servicesManager?.services || {};
      const viewports: Map<string, any> = viewportGridService?.getState?.()?.viewports;
      if (!viewports || typeof viewports.forEach !== 'function') {
        return false;
      }
      let found = false;
      viewports.forEach((_vpState: any, viewportId: string) => {
        const vp = csvs?.getCornerstoneViewport?.(viewportId);
        if (vp && (vp.type === Enums.ViewportType.ORTHOGRAPHIC || vp.type === Enums.ViewportType.VOLUME_3D)) {
          found = true;
        }
      });
      return found;
    } catch (e) {
      return false;
    }
  };

  // Reads ONLY metadata fields (sizeInBytes / sharedCacheKey) from the cache's own map
  // entry — the SAME fields skmTelemetry.ts's cacheKeyStats() and the evictor already
  // read. Never touches/returns the decoded pixel data or the ImageLoadObject itself.
  const getCacheEntryMeta = (
    imageId: string
  ): { present: boolean; sizeInBytes: number | null; sharedCacheKey: string | null } => {
    try {
      const ic = (cache as any)._imageCache;
      if (ic && typeof ic.get === 'function') {
        const ci = ic.get(imageId);
        if (ci) {
          return {
            present: true,
            sizeInBytes: typeof ci.sizeInBytes === 'number' ? ci.sizeInBytes : null,
            sharedCacheKey: ci.sharedCacheKey || null,
          };
        }
      } else if (ic && typeof ic.forEach === 'function') {
        let found: any = null;
        ic.forEach((ci: any, key: any) => {
          const id = typeof key === 'string' && key ? key : ci?.imageId;
          if (id === imageId) {
            found = ci;
          }
        });
        if (found) {
          return {
            present: true,
            sizeInBytes: typeof found.sizeInBytes === 'number' ? found.sizeInBytes : null,
            sharedCacheKey: found.sharedCacheKey || null,
          };
        }
      }
    } catch (e) {
      /* fall through to the public-API presence check below */
    }
    let present = false;
    try {
      present = !!(cache as any).getImageLoadObject?.(imageId);
    } catch (e) {
      present = false;
    }
    return { present, sizeInBytes: null, sharedCacheKey: null };
  };

  // ── window.skmProbeCacheEntry(imageId) — read-only (task 2) ───────────────────────────
  (window as any).skmProbeCacheEntry = (imageId: string) => {
    if (typeof imageId !== 'string' || !imageId) {
      // eslint-disable-next-line no-console
      console.warn('[SKM-EVICT-DIAG] skmProbeCacheEntry(imageId) requires a non-empty string imageId');
      return null;
    }
    const meta = getCacheEntryMeta(imageId);
    const stackVps = getOpenStackViewports();
    const result = {
      imageId,
      present: meta.present,
      accountedBytes: meta.sizeInBytes,
      sharedCacheKey: meta.sharedCacheKey,
      inFlight: getInflightSet().has(imageId),
      // null = no evictor pass observed yet in this session; otherwise exact membership
      // in the REAL production keep-set (keep-window ∪ in-flight) from the last pass.
      inKeepSet: currentPass ? lastKeepSet.has(imageId) : null,
      keepSetSnapshotValid: snapshotValid(),
      keepSetSnapshotAgeMs: Number.isFinite(snapshotAgeMs()) ? Math.round(snapshotAgeMs()) : null,
      inAnyOpenViewportStack: stackVps.some(v => v.imageIds.includes(imageId)),
      isCurrentDisplayedImage: stackVps.some(v => v.currentImageId === imageId),
    };
    // eslint-disable-next-line no-console
    console.log('[SKM-EVICT-DIAG] probe', result);
    return result;
  };

  // ── window.skmListCacheEntries(maxCount) — bounded listing (task 2) ──────────────────
  (window as any).skmListCacheEntries = (maxCount?: number) => {
    const requested = typeof maxCount === 'number' && maxCount > 0 ? maxCount : DEFAULT_LIST_COUNT;
    const limit = Math.max(1, Math.min(HARD_MAX_LIST_COUNT, requested));
    const entries: Array<{
      imageId: string;
      sizeInBytes: number | null;
      sharedCacheKey: string | null;
      inFlight: boolean;
      inKeepSet: boolean | null;
    }> = [];
    try {
      const ic = (cache as any)._imageCache;
      if (ic && typeof ic.forEach === 'function') {
        const inflightSet = getInflightSet();
        ic.forEach((ci: any, key: any) => {
          if (entries.length >= limit) {
            return;
          }
          const imageId = typeof key === 'string' && key ? key : ci?.imageId;
          if (!imageId) {
            return;
          }
          entries.push({
            imageId,
            sizeInBytes: typeof ci?.sizeInBytes === 'number' ? ci.sizeInBytes : null,
            sharedCacheKey: ci?.sharedCacheKey || null,
            inFlight: inflightSet.has(imageId),
            inKeepSet: currentPass ? lastKeepSet.has(imageId) : null,
          });
        });
      }
    } catch (e) {
      /* best-effort; diagnostics never breaks the viewer */
    }
    const result = {
      entries,
      count: entries.length,
      requested,
      hardMaxCount: HARD_MAX_LIST_COUNT,
      truncated: entries.length >= limit,
    };
    // eslint-disable-next-line no-console
    console.log(`[SKM-EVICT-DIAG] listed ${entries.length} cache entries (limit ${limit})`);
    return result;
  };

  // ── window.skmGetEvictionDiagnostics() — the current/last-eviction snapshot ──────────
  (window as any).skmGetEvictionDiagnostics = () => {
    const snap = (globalThis as any).__skmEvictionDiagnostics;
    // eslint-disable-next-line no-console
    console.log('[SKM-EVICT-DIAG]', snap);
    return snap;
  };

  // ── bounded, identifiers-only cache-removal history (task 4) ─────────────────────────
  // SKM 2026-10-10: verified event + payload for pinned Cornerstone 4.22.10 BEFORE
  // subscribing — IMAGE_CACHE_IMAGE_REMOVED already fires reliably in THIS exact build and
  // is consumed in two other production files with this exact payload shape:
  //   extensions/cornerstone/src/skmTelemetry.ts (onRemove counter)
  //   extensions/cornerstone/src/Viewport/.../ViewportSliceProgressScrollbar/helpers.ts
  //     (getImageIdFromCacheEvent: detail.imageId || detail.image?.imageId ||
  //      detail.cachedImage?.imageId)
  // Reusing that exact, already-verified shape rather than assuming a new one.
  const getImageIdFromCacheEvent = (event: any): string | undefined => {
    const detail = event?.detail;
    return detail?.imageId || detail?.image?.imageId || detail?.cachedImage?.imageId;
  };
  const removalHistory: Array<{ imageId: string; ts: number; cacheSizeMBAfter: number }> = [];
  let removalTotal = 0;
  try {
    eventTarget.addEventListener(Enums.Events.IMAGE_CACHE_IMAGE_REMOVED, (evt: any) => {
      const imageId = getImageIdFromCacheEvent(evt);
      if (!imageId) {
        return;
      }
      removalTotal++;
      // Identifiers + accounting metadata only — never the decoded pixel data.
      removalHistory.push({ imageId, ts: Date.now(), cacheSizeMBAfter: readCacheSizeMB() });
      if (removalHistory.length > MAX_REMOVAL_HISTORY) {
        removalHistory.shift();
      }
    });
  } catch (e) {
    /* best-effort; event name/shape differs → history stays empty, nothing else breaks */
  }
  (window as any).skmGetCacheRemovalHistory = () => {
    const result = { total: removalTotal, maxRetained: MAX_REMOVAL_HISTORY, entries: [...removalHistory] };
    // eslint-disable-next-line no-console
    console.log(`[SKM-EVICT-DIAG] cache-removal history: ${result.entries.length}/${result.total} retained`);
    return result;
  };

  // ── OPTIONAL guarded test-only eviction helper (task 3) ───────────────────────────────
  // Double-gated: appConfig.skmEvictionDiagnostics.enabled AND .allowTestEviction must
  // BOTH be true. Refuses using the SAME real production state this module already reuses
  // above (snapshot validity, in-flight set, keep-set, currently-displayed, volume-present)
  // before calling the one real removal API (cache.removeImageLoadObject) — never a
  // separate/duplicated eviction policy.
  if (allowTestEviction) {
    (window as any).skmTestEvictImageId = (imageId: string) => {
      const before = readCacheSizeMB() * 1048576; // bytes, for a precise delta
      const refuse = (reason: string) => ({
        action: 'refused' as const,
        reason,
        imageId,
        cacheBytesBefore: before,
        cacheBytesAfter: before,
        deltaBytes: 0,
      });
      if (typeof imageId !== 'string' || !imageId) {
        return refuse('invalid-image-id');
      }
      if (!snapshotValid()) {
        return refuse('stale-or-missing-evictor-snapshot');
      }
      if (anyVolumePresent()) {
        return refuse('volume-present-skip'); // mirrors skmActiveEviction.skipWhenVolumePresent
      }
      if (getInflightSet().has(imageId)) {
        return refuse('in-flight');
      }
      if (lastKeepSet.has(imageId)) {
        return refuse('in-keep-set'); // real production keep-set (keep-window ∪ in-flight)
      }
      const stackVps = getOpenStackViewports();
      if (stackVps.some(v => v.currentImageId === imageId)) {
        return refuse('currently-displayed');
      }
      if (stackVps.length === 0) {
        return refuse('no-open-stack-viewport');
      }
      const meta = getCacheEntryMeta(imageId);
      if (!meta.present) {
        return refuse('not-in-cache');
      }
      try {
        (cache as any).removeImageLoadObject(imageId); // the SAME production removal call
      } catch (e) {
        return {
          action: 'error' as const,
          reason: 'remove-threw',
          imageId,
          error: String(e),
          cacheBytesBefore: before,
          cacheBytesAfter: before,
          deltaBytes: 0,
        };
      }
      const after = readCacheSizeMB() * 1048576;
      const result = {
        action: 'evicted' as const,
        imageId,
        cacheBytesBefore: before,
        cacheBytesAfter: after,
        deltaBytes: after - before,
        note:
          'cacheBytes* is Cornerstone cache ACCOUNTING only — this does NOT by itself prove ' +
          'JS heap, process RAM, or GPU reclamation.',
      };
      // eslint-disable-next-line no-console
      console.log('[SKM-EVICT-DIAG][TEST] evict result', result);
      return result;
    };
    // eslint-disable-next-line no-console
    console.warn(
      '[SKM-EVICT-DIAG] TEST-ONLY skmTestEvictImageId(imageId) is ACTIVE ' +
        '(skmEvictionDiagnostics.allowTestEviction:true). Never set this true in a production app-config.js.'
    );
  }

  // eslint-disable-next-line no-console
  console.log(
    '[SKM-EVICT-DIAG] active (diagnostic-only; no eviction/threshold/scheduling change) — ' +
      'skmProbeCacheEntry(imageId), skmListCacheEntries(maxCount), skmGetEvictionDiagnostics(), ' +
      'skmGetCacheRemovalHistory()' +
      (allowTestEviction ? ', skmTestEvictImageId(imageId) [TEST-ONLY]' : '')
  );

  const hooks: SkmEvictorDiagnosticHooks = { onPass, onEvict };
  (globalThis as any).__skmEvictionDiagnosticsHooks = hooks;
  return hooks;
}

export default initSkmEvictionDiagnostics;
