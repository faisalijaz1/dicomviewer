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
 *  CLOCK (2026-10-10 fix)
 *  Snapshot timestamps and age math MUST share one clock (skmDiagNowMs / performance.now).
 *  Mixing Date.now() stamps with performance.now() ages produced huge negative ages while
 *  `valid` stayed true — never interpret a negative age as freshness.
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
import type {
  SkmEvictorDiagnosticHooks,
  SkmEvictorPassRecord,
  SkmEvictorEvictRecord,
} from './skmWorkingSetEvictor';
import {
  evaluateSnapshotAge,
  evaluateTestEvictSafety,
  skmDiagNowMs,
} from './skmEvictionDiagnosticsClock';

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

function readCacheSizeBytes(): number {
  try {
    return (cache as any).getCacheSize?.() || 0;
  } catch (e) {
    return 0;
  }
}

function readCacheSizeMB(): number {
  return Math.round(readCacheSizeBytes() / 1048576);
}

function roundAge(ageMs: number): number | null {
  if (!Number.isFinite(ageMs)) {
    return null;
  }
  return Math.round(ageMs);
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
  const DEFAULT_LIST_COUNT = Math.min(
    HARD_MAX_LIST_COUNT,
    Math.max(1, config.maxProbeListCount ?? 50)
  );
  const allowTestEviction = config.allowTestEviction === true;

  // ── snapshot state (identifiers + numbers + a Set<string> of imageIds only — never a
  // pixel buffer or decoded Image/ImageLoadObject reference) ────────────────────────────
  let currentPass: SkmEvictorPassRecord | null = null;
  let lastEviction: SkmEvictorEvictRecord | null = null;
  let lastKeepSet: Set<string> = new Set();

  const currentSnapshotAge = () =>
    evaluateSnapshotAge(currentPass?.ts, skmDiagNowMs(), MAX_SNAPSHOT_AGE_MS);

  const publish = () => {
    const currentAge = currentSnapshotAge();
    const lastEvictAge = lastEviction
      ? evaluateSnapshotAge(lastEviction.ts, skmDiagNowMs(), Number.POSITIVE_INFINITY)
      : null;
    (globalThis as any).__skmEvictionDiagnostics = {
      current: currentPass
        ? {
            ts: currentPass.ts,
            ageMs: roundAge(currentAge.ageMs),
            valid: currentAge.valid,
            validityReason: currentAge.reason,
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
            // Experiment A — keep vs residency (identifiers/bytes only)
            testKeepWindowActive: currentPass.testKeepWindowActive,
            testKeepBudgetMB: currentPass.testKeepBudgetMB,
            effectiveKeepBudgetBytes: currentPass.effectiveKeepBudgetBytes,
            productionBudgetFraction: currentPass.productionBudgetFraction,
            cacheEntriesTotal: currentPass.cacheEntriesTotal,
            cacheEntriesOutsideKeep: currentPass.cacheEntriesOutsideKeep,
            cacheBytesOutsideKeep: currentPass.cacheBytesOutsideKeep,
            cacheBytesInsideKeep: currentPass.cacheBytesInsideKeep,
            configuredReactiveHighWater: currentPass.configuredReactiveHighWater,
            effectiveReactiveHighWater: currentPass.effectiveReactiveHighWater,
            testReactiveTriggerActive: currentPass.testReactiveTriggerActive,
            reactivePathReason: currentPass.reactivePathReason,
            cacheBytes: currentPass.cacheBytes,
            cacheCapBytes: currentPass.cacheCapBytes,
          }
        : null,
      // Distinct from `current`: the last pass that ACTUALLY removed ≥1 decoded image.
      lastEviction: lastEviction
        ? {
            ts: lastEviction.ts,
            ageMs: roundAge(lastEvictAge!.ageMs),
            center: lastEviction.center,
            removedThisBatch: lastEviction.removedThisBatch,
            totalEvicted: lastEviction.totalEvicted,
            pass: lastEviction.pass,
          }
        : null,
      maxSnapshotAgeMs: MAX_SNAPSHOT_AGE_MS,
      clock: 'performance.now',
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
  const getInflightSet = (): { known: boolean; set: Set<string> } => {
    try {
      const sp = servicesManager?.services?.studyPrefetcherService;
      if (typeof sp?.getInflightImageIds !== 'function') {
        return { known: false, set: new Set() };
      }
      return { known: true, set: sp.getInflightImageIds() };
    } catch (e) {
      return { known: false, set: new Set() };
    }
  };

  const getOpenStackViewports = (): Array<{
    viewportId: string;
    imageIds: string[];
    currentImageId: string | null;
  }> => {
    const out: Array<{ viewportId: string; imageIds: string[]; currentImageId: string | null }> =
      [];
    try {
      const { viewportGridService, cornerstoneViewportService: csvs } =
        servicesManager?.services || {};
      const viewports: Map<string, any> = viewportGridService?.getState?.()?.viewports;
      if (!viewports || typeof viewports.forEach !== 'function') {
        return out;
      }
      viewports.forEach((_vpState: any, viewportId: string) => {
        const vp = csvs?.getCornerstoneViewport?.(viewportId);
        if (
          !vp ||
          typeof vp.getCurrentImageIdIndex !== 'function' ||
          typeof vp.getImageIds !== 'function'
        ) {
          return; // not a stack viewport (same check the evictor itself uses)
        }
        const imageIds: string[] = vp.getImageIds() || [];
        const idx = vp.getCurrentImageIdIndex?.() ?? -1;
        out.push({
          viewportId,
          imageIds,
          currentImageId: idx >= 0 ? imageIds[idx] ?? null : null,
        });
      });
    } catch (e) {
      /* best-effort; diagnostics never breaks the viewer */
    }
    return out;
  };

  // Mirrors the evictor's own skipWhenVolumePresent check. Returns null when the check
  // cannot be established reliably (test helper must refuse — never assume "safe").
  const anyVolumePresent = (): boolean | null => {
    try {
      const { viewportGridService, cornerstoneViewportService: csvs } =
        servicesManager?.services || {};
      const viewports: Map<string, any> = viewportGridService?.getState?.()?.viewports;
      if (!viewports || typeof viewports.forEach !== 'function') {
        return null;
      }
      let found = false;
      viewports.forEach((_vpState: any, viewportId: string) => {
        const vp = csvs?.getCornerstoneViewport?.(viewportId);
        if (
          vp &&
          (vp.type === Enums.ViewportType.ORTHOGRAPHIC ||
            vp.type === Enums.ViewportType.VOLUME_3D)
        ) {
          found = true;
        }
      });
      return found;
    } catch (e) {
      return null;
    }
  };

  // Reads ONLY metadata fields (sizeInBytes / sharedCacheKey) from the cache's own map
  // entry — the SAME fields skmTelemetry.ts's cacheKeyStats() and the evictor already
  // read. Never touches/returns the decoded pixel data or the ImageLoadObject itself.
  const getCacheEntryMeta = (
    imageId: string
  ): {
    known: boolean;
    present: boolean;
    sizeInBytes: number | null;
    sharedCacheKey: string | null;
  } => {
    try {
      const ic = (cache as any)._imageCache;
      if (ic && typeof ic.get === 'function') {
        const ci = ic.get(imageId);
        if (ci) {
          return {
            known: true,
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
            known: true,
            present: true,
            sizeInBytes: typeof found.sizeInBytes === 'number' ? found.sizeInBytes : null,
            sharedCacheKey: found.sharedCacheKey || null,
          };
        }
      }
      let present = false;
      try {
        present = !!(cache as any).getImageLoadObject?.(imageId);
      } catch (e) {
        return { known: false, present: false, sizeInBytes: null, sharedCacheKey: null };
      }
      return { known: true, present, sizeInBytes: null, sharedCacheKey: null };
    } catch (e) {
      return { known: false, present: false, sizeInBytes: null, sharedCacheKey: null };
    }
  };

  const buildSafetyInput = (imageId: string) => {
    const snapshot = currentSnapshotAge();
    const inflight = getInflightSet();
    const stackVps = getOpenStackViewports();
    const meta = getCacheEntryMeta(imageId);
    return {
      imageId,
      snapshot,
      volumePresent: anyVolumePresent(),
      inflightKnown: inflight.known,
      inFlight: inflight.set.has(imageId),
      keepSetKnown: currentPass != null && snapshot.valid,
      inKeepSet: lastKeepSet.has(imageId),
      stackViewportCount: stackVps.length,
      isCurrentDisplayed: stackVps.some(v => v.currentImageId === imageId),
      cachePresentKnown: meta.known,
      cachePresent: meta.present,
      meta,
      stackVps,
    };
  };

  // ── window.skmProbeCacheEntry(imageId) — read-only ───────────────────────────────────
  (window as any).skmProbeCacheEntry = (imageId: string) => {
    if (typeof imageId !== 'string' || !imageId) {
      // eslint-disable-next-line no-console
      console.warn(
        '[SKM-EVICT-DIAG] skmProbeCacheEntry(imageId) requires a non-empty string imageId'
      );
      return null;
    }
    const meta = getCacheEntryMeta(imageId);
    const stackVps = getOpenStackViewports();
    const age = currentSnapshotAge();
    const result = {
      imageId,
      present: meta.present,
      accountedBytes: meta.sizeInBytes,
      sharedCacheKey: meta.sharedCacheKey,
      inFlight: getInflightSet().set.has(imageId),
      // null = no evictor pass observed yet in this session; otherwise exact membership
      // in the REAL production keep-set (keep-window ∪ in-flight) from the last pass.
      inKeepSet: currentPass ? lastKeepSet.has(imageId) : null,
      keepSetSnapshotValid: age.valid,
      keepSetSnapshotAgeMs: roundAge(age.ageMs),
      keepSetSnapshotValidityReason: age.reason,
      inAnyOpenViewportStack: stackVps.some(v => v.imageIds.includes(imageId)),
      isCurrentDisplayedImage: stackVps.some(v => v.currentImageId === imageId),
    };
    // eslint-disable-next-line no-console
    console.log('[SKM-EVICT-DIAG] probe', result);
    return result;
  };

  // ── window.skmListCacheEntries(maxCount) — bounded listing ───────────────────────────
  (window as any).skmListCacheEntries = (maxCount?: number) => {
    const requested =
      typeof maxCount === 'number' && maxCount > 0 ? maxCount : DEFAULT_LIST_COUNT;
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
        const inflightSet = getInflightSet().set;
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
    publish(); // refresh age/valid from the shared clock before return
    const snap = (globalThis as any).__skmEvictionDiagnostics;
    // eslint-disable-next-line no-console
    console.log('[SKM-EVICT-DIAG]', snap);
    return snap;
  };

  // ── window.skmReportKeepVsCache(fullStudyBaselineBytes?) — Experiment A residency report ─
  // Compares effective keep window with live decoded-cache residency. Success for
  // bounded-window optimization requires BOTH stability (≥3 traversals — measured by the
  // Testing Agent) AND material reduction vs Stage 0 full-study baseline (~1.926 GB).
  // A stable full-study plateau is "stable residency only", not bounded-window success.
  (window as any).skmReportKeepVsCache = (fullStudyBaselineBytes?: number) => {
    publish();
    const cur = (globalThis as any).__skmEvictionDiagnostics?.current;
    let cacheBytesNow = 0;
    try {
      cacheBytesNow = (cache as any).getCacheSize?.() || 0;
    } catch (e) {
      cacheBytesNow = 0;
    }
    const baseline =
      typeof fullStudyBaselineBytes === 'number' && fullStudyBaselineBytes > 0
        ? fullStudyBaselineBytes
        : 1.926 * 1024 * 1024 * 1024; // Stage 0 accepted ~1.926 GB full-study plateau
    const plateauBytes = cacheBytesNow;
    const pctOfFullStudy = baseline > 0 ? (100 * plateauBytes) / baseline : null;
    const pctReduction = baseline > 0 ? 100 - (pctOfFullStudy as number) : null;
    // Heuristic cycle signal (document only — Experiment A does not retune prefetch):
    // many decoded entries outside keep while reactiveSkip and underPressure false suggests
    // prefetch is filling beyond the test keep; if later A+B causes high reDecodes + removals,
    // that is prefetch–evict–reload evidence → stop, do not silently retune.
    const outside = cur?.cacheEntriesOutsideKeep ?? null;
    const total = cur?.cacheEntriesTotal ?? null;
    const likelyPrefetchBeyondKeep =
      !!cur?.testKeepWindowActive &&
      typeof outside === 'number' &&
      typeof total === 'number' &&
      total > 0 &&
      outside / total > 0.15 &&
      cur?.reactiveSkip === true;
    const removedTotal = (globalThis as any).__skmEvictions || 0;
    const lastEvict = (globalThis as any).__skmEvictionDiagnostics?.lastEviction;
    const result = {
      testKeepWindowActive: cur?.testKeepWindowActive ?? false,
      testKeepBudgetMB: cur?.testKeepBudgetMB ?? null,
      effectiveKeepBudgetBytes: cur?.effectiveKeepBudgetBytes ?? null,
      productionBudgetFraction: cur?.productionBudgetFraction ?? null,
      configuredReactiveHighWater: cur?.configuredReactiveHighWater ?? null,
      effectiveReactiveHighWater: cur?.effectiveReactiveHighWater ?? null,
      testReactiveTriggerActive: cur?.testReactiveTriggerActive ?? false,
      reactivePathReason: cur?.reactivePathReason ?? null,
      underPressure: cur?.underPressure ?? null,
      reactiveSkip: cur?.reactiveSkip ?? null,
      fillPct: cur?.fillPct ?? null,
      keepLo: cur?.keepLo ?? null,
      keepHi: cur?.keepHi ?? null,
      protectedCount: cur?.protectedCount ?? null,
      cacheEntriesTotal: total,
      cacheEntriesOutsideKeep: outside,
      cacheBytesOutsideKeep: cur?.cacheBytesOutsideKeep ?? null,
      cacheBytesInsideKeep: cur?.cacheBytesInsideKeep ?? null,
      cacheBytesNow,
      cacheCapBytes: cur?.cacheCapBytes ?? null,
      windowedCandidates: cur?.windowedCandidates ?? null,
      orphanCandidates: cur?.orphanCandidates ?? null,
      totalEvictions: removedTotal,
      lastEviction: lastEvict,
      fullStudyBaselineBytes: baseline,
      pctOfFullStudy: pctOfFullStudy != null ? Math.round(pctOfFullStudy * 10) / 10 : null,
      pctReduction: pctReduction != null ? Math.round(pctReduction * 10) / 10 : null,
      classificationNote:
        'Bounded-window SUCCESS requires stable residency over ≥3 full forward/back traversals ' +
        'AND material reduction vs fullStudyBaselineBytes. Stable ≈ full-study plateau = ' +
        '"stable residency only", not bounded-window success.',
      likelyPrefetchBeyondKeep,
      prefetchKeepClamp: (globalThis as any).__skmPrefetchKeepClamp || null,
      prefetchCycleNote: likelyPrefetchBeyondKeep
        ? 'Many cache entries lie outside the test keep — prefetch may still decode beyond keep. ' +
          'If Experiment C clamp is ON this should fall; if high reDecodes accompany windowed ' +
          'removals, treat as prefetch–evict–reload: document and STOP (no silent retune).'
        : null,
    };
    // eslint-disable-next-line no-console
    console.log('[SKM-EVICT-DIAG] keep vs cache', result);
    return result;
  };

  // ── bounded, identifiers-only cache-removal history ─────────────────────────────────
  // SKM 2026-10-10: verified event + payload for pinned Cornerstone 4.22.10 BEFORE
  // subscribing — IMAGE_CACHE_IMAGE_REMOVED already fires reliably in THIS exact build and
  // is consumed in two other production files with this exact payload shape:
  //   extensions/cornerstone/src/skmTelemetry.ts (onRemove counter)
  //   extensions/cornerstone/src/Viewport/.../ViewportSliceProgressScrollbar/helpers.ts
  //     (getImageIdFromCacheEvent: detail.imageId || detail.image?.imageId ||
  //      detail.cachedImage?.imageId)
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
      // Same clock as snapshot stamps (skmDiagNowMs), not Date.now().
      removalHistory.push({
        imageId,
        ts: skmDiagNowMs(),
        cacheSizeMBAfter: readCacheSizeMB(),
      });
      if (removalHistory.length > MAX_REMOVAL_HISTORY) {
        removalHistory.shift();
      }
    });
  } catch (e) {
    /* best-effort; event name/shape differs → history stays empty, nothing else breaks */
  }
  (window as any).skmGetCacheRemovalHistory = () => {
    const result = {
      total: removalTotal,
      maxRetained: MAX_REMOVAL_HISTORY,
      entries: [...removalHistory],
    };
    // eslint-disable-next-line no-console
    console.log(
      `[SKM-EVICT-DIAG] cache-removal history: ${result.entries.length}/${result.total} retained`
    );
    return result;
  };

  // ── OPTIONAL guarded test-only eviction helper ───────────────────────────────────────
  // Double-gated: appConfig.skmEvictionDiagnostics.enabled AND .allowTestEviction must
  // BOTH be true. Refuses using production keep-set / in-flight / volume / display checks.
  // Revalidates snapshot freshness AND candidate safety immediately before removal.
  if (allowTestEviction) {
    (window as any).skmTestEvictImageId = (imageId: string) => {
      const before = readCacheSizeBytes();
      const refuse = (reason: string) => ({
        action: 'refused' as const,
        reason,
        imageId,
        cacheBytesBefore: before,
        cacheBytesAfter: before,
        deltaBytes: 0,
      });

      // First safety pass (also covers missing/invalid id).
      const first = buildSafetyInput(imageId);
      const firstGate = evaluateTestEvictSafety(first);
      if (firstGate.action === 'refused') {
        return refuse(firstGate.reason);
      }

      // Revalidate IMMEDIATELY before removal — snapshot may have gone stale, or the
      // doctor may have scrolled the candidate into the keep-set / display / in-flight.
      const second = buildSafetyInput(imageId);
      const secondGate = evaluateTestEvictSafety(second);
      if (secondGate.action === 'refused') {
        return refuse(secondGate.reason);
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
      const after = readCacheSizeBytes();
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
      'skmGetCacheRemovalHistory(), skmReportKeepVsCache(fullStudyBaselineBytes?)' +
      (allowTestEviction ? ', skmTestEvictImageId(imageId) [TEST-ONLY]' : '')
  );

  const hooks: SkmEvictorDiagnosticHooks = { onPass, onEvict };
  (globalThis as any).__skmEvictionDiagnosticsHooks = hooks;
  return hooks;
}

export default initSkmEvictionDiagnostics;
