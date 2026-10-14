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
import { cache, Enums, eventTarget } from '@cornerstonejs/core';
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';
import { subscribeStackNewImage, subscribeViewportElementEvent } from './utils/skmStackNewImage';
import {
  dataSetUrlCandidates,
  imageFromCacheEventDetail,
  stripParsedDataSet,
  planEvictionStep,
  resolveInteractionHoldMs,
  shouldStopRemovalLoop,
} from './skmEvictionInteractionMath';
import {
  evaluateIdleOutsideKeepScanGate,
  isIdleOutsideKeepCleanupActive,
  resolveEvictBatchCap,
  resolveWindowedPathReason,
  shouldCollectWindowedCandidates,
} from './skmIdleOutsideKeepCleanupMath';

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
   * SKM 2026-10-06 (Fix 3 — REACTIVE eviction): only evict when the decoded cache fill
   * (getCacheSize / getMaxCacheSize) is at or above this fraction. Below it, eviction is
   * skipped entirely, so ANY series that fits under (reactiveHighWater × cap) stays 100%
   * decoded-resident with ZERO eviction churn — the measured RadiAnt-smooth state. Eviction
   * only engages under genuine memory pressure (series larger than the cap), where it stays
   * bounded. Must sit below studyPrefetcher.boundedPrefetchHighWater (0.90) so the evictor
   * frees space before the prefetcher's own pause, avoiding oscillation. Default 0.85.
   * Set to 0 to restore the previous always-evict-by-window behaviour.
   */
  reactiveHighWater?: number;
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
   * SKM 2026-10-12: wheel, pressed-pointer, and keyboard slice navigation stamp the same
   * timestamp. The guard stays active for idleTimeoutMs + inputQuietMs, not only 120ms,
   * because a batch woken by the 500ms idle timeout otherwise sees the short window
   * already expired. Deferred batches keep their candidate list and resume after that
   * hold. A segment also stops after maxRemovalsPerPass or maxPassEvictMs.
   */
  inputQuietMs?: number;
  /**
   * SKM 2026-10-05 (Fix 2): if the active centre moved more than this many slices since the
   * pass started, the pass ABORTS its (now stale) candidate list; the next scheduled pass
   * recomputes the keep-set around the new position. Default 100.
   */
  abortMoveThreshold?: number;
  /**
   * SKM 2026-10-06 (Fix 3c): periodic self-tick (ms). The evictor was only triggered by
   * STACK_NEW_IMAGE / grid events, so after a SERIES SWITCH with no scroll, background decode of
   * the new series could climb to the prefetcher's high-water PAUSE while the old series still
   * occupied the budget — and nothing ran the evictor to reclaim it, so download/decode "paused"
   * until the doctor scrolled. A low-cost timer re-checks fill on this cadence so orphan/overflow
   * eviction happens during background decode without any user interaction (it reactive-skips
   * cheaply while under the high-water). Default 750. Set 0 to disable.
   */
  tickMs?: number;
  /**
   * SKM Experiment A (TEST-ONLY): when true AND testKeepBudgetMB > 0, size the protected
   * keep window from testKeepBudgetMB bytes instead of production
   * (budgetFraction × maxCacheSize). Does NOT change reactiveHighWater, workingSetFraction,
   * cache caps, prefetch, or the production budgetFraction value used when this is false.
   * Default false — production path unchanged.
   */
  testKeepWindowEnabled?: boolean;
  /**
   * SKM Experiment A (TEST-ONLY): keep-window byte budget in MiB when testKeepWindowEnabled.
   * Recommended Experiment A value: 700 (within the 500–800 MiB experimental band).
   * Ignored when testKeepWindowEnabled is false.
   */
  testKeepBudgetMB?: number;
  /**
   * SKM Experiment B (TEST-ONLY): when true AND testReactiveHighWater is a finite number in
   * [0, 0.98], use that value as the effective reactive gate instead of production
   * reactiveHighWater (0.85). Independent of Experiment A keep override, prefetch, caps,
   * and workingSetFraction. Default false — production 0.85 path unchanged.
   */
  testReactiveHighWaterEnabled?: boolean;
  /**
   * SKM Experiment B (TEST-ONLY): effective reactive fill threshold when
   * testReactiveHighWaterEnabled is true. Dev experiment value: 0.50. Ignored when the
   * enable flag is false.
   */
  testReactiveHighWater?: number;
  /**
   * Idle outside-keep cleanup: when true, allow the existing windowed (outside-keep)
   * candidate scan below the reactive fill gate IF input has been quiet long enough.
   * Default false — production / disabled behaviour unchanged (reactive-only windowed path).
   */
  idleOutsideKeepCleanupEnabled?: boolean;
  /**
   * Minimum ms since last STACK_NEW_IMAGE before idle outside-keep cleanup may scan.
   * Default 2500. Must be ≫ inputQuietMs so active scrolling never takes this path.
   */
  idleOutsideKeepQuietMs?: number;
  /**
   * Max removals per batch for idle outside-keep cleanup passes (gentler than
   * maxEvictPerTick). Default 10. Reactive-pressure passes still use maxEvictPerTick.
   */
  maxIdleEvictPerTick?: number;
  /**
   * Max removals in one reactive segment before the pass yields the main thread
   * and continues later with the same candidates. Default 100 (two batches of 50).
   */
  maxRemovalsPerPass?: number;
  /**
   * Max main-thread milliseconds spent in removeImageLoadObject during one segment.
   * Default 48, just under a long-task budget. A segment stops when either this or
   * maxRemovalsPerPass is reached.
   */
  maxPassEvictMs?: number;
  /** Gap (ms) after a segment budget before the same candidates continue. Default 50. */
  passYieldGapMs?: number;
};

/**
 * SKM 2026-10-10 (diagnostics-only, additive): a read-only record of what ONE evictor
 * pass attempt computed, published on EVERY pass — including a reactive-skip (nothing
 * evicted because the series fits under the high-water mark) — so a diagnostics
 * consumer never sees a stale center/keep-window left over from a PREVIOUS pass.
 * `keepSet` is a fresh clone (imageId strings only — never pixel data or image objects)
 * of the exact Set the real eviction decision uses this pass (keep-window ∪ in-flight).
 * Pure data; carries no behaviour and cannot be used to change any decision here.
 */
export type SkmEvictorPassRecord = {
  ts: number;
  center: number;
  direction: number;
  keepLo: number;
  keepHi: number;
  keepAhead: number;
  keepBehind: number;
  stackViewports: number;
  protectedCount: number;
  fillPct: number;
  underPressure: boolean;
  windowedCandidates: number;
  orphanCandidates: number;
  reactiveSkip: boolean;
  keepSet: Set<string>;
  /** Experiment A: whether the test-only keep budget override is active this pass. */
  testKeepWindowActive: boolean;
  /** Experiment A: configured test budget MiB (null when override off). */
  testKeepBudgetMB: number | null;
  /** Effective keep budget bytes used for this pass's window sizing. */
  effectiveKeepBudgetBytes: number;
  /** Production budgetFraction (unchanged); used when override is off. */
  productionBudgetFraction: number;
  /** Read-only: decoded cache entry count at pass time. */
  cacheEntriesTotal: number;
  /** Read-only: decoded entries whose imageId is NOT in the keep set. */
  cacheEntriesOutsideKeep: number;
  /** Read-only: accounted bytes of those outside-keep entries. */
  cacheBytesOutsideKeep: number;
  /** Read-only: accounted bytes of entries inside the keep set. */
  cacheBytesInsideKeep: number;
  /** Production reactiveHighWater from config (unchanged by Experiment B). */
  configuredReactiveHighWater: number;
  /** Effective threshold used for underPressure this pass. */
  effectiveReactiveHighWater: number;
  /** Experiment B: whether the test reactive-trigger override is active. */
  testReactiveTriggerActive: boolean;
  /** Why windowed eviction ran or was skipped this pass. */
  reactivePathReason: string;
  /** Decoded cache bytes / cap at pass time (accounting). */
  cacheBytes: number;
  cacheCapBytes: number;
  /** Idle outside-keep cleanup feature enabled in config. */
  idleOutsideKeepCleanupEnabled: boolean;
  /** True when this pass queued windowed work via idle cleanup (not reactive pressure). */
  idleOutsideKeepCleanupActive: boolean;
  /** Idle scan gate reason (diagnostics). */
  idleOutsideKeepGateReason: string;
  /** Per-batch removal cap used for this pass (normal vs idle). */
  passBatchCap: number;
};

/** SKM 2026-10-10 (diagnostics-only): published whenever a batch ACTUALLY removes ≥1
 * decoded image — distinct from SkmEvictorPassRecord so "last real eviction" can be told
 * apart from "most recent pass attempt" (a pass can run and evict nothing). */
export type SkmEvictorEvictRecord = {
  ts: number;
  center: number;
  removedThisBatch: number;
  totalEvicted: number;
  pass: number;
};

/** SKM 2026-10-10 (diagnostics-only): optional hooks a diagnostics module can supply to
 * observe the evictor's own pass/evict data. Both are no-ops when undefined (default) —
 * this file's eviction decisions, thresholds, and scheduling are IDENTICAL whether or not
 * any hook is supplied. */
export type SkmEvictorDiagnosticHooks = {
  onPass?: (record: SkmEvictorPassRecord) => void;
  onEvict?: (record: SkmEvictorEvictRecord) => void;
};

let evictorInitialized = false;
let evictionCount = 0; // total removeImageLoadObject() calls (window.__skmEvictions)
let lastCenter: number | null = null;
let direction = 1;
let reactiveSkips = 0; // passes skipped because decoded fill was below reactiveHighWater (Fix 3)
let orphanSweeps = 0; // passes that queued ≥1 orphan (closed-series) image (Fix 3b, cumulative)
let orphanQueuedTotal = 0; // total orphan images queued for eviction across all passes (Fix 3b)

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

export function initSkmWorkingSetEvictor(
  servicesManager: any,
  config: SkmEvictionConfig,
  // SKM 2026-10-10 (diagnostics-only, additive): optional, defaults to undefined so
  // behaviour is byte-for-byte unchanged for every existing caller. See
  // SkmEvictorDiagnosticHooks above and skmEvictionDiagnostics.ts.
  diagnosticHooks?: SkmEvictorDiagnosticHooks
): void {
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
  // Fix 3: reactive eviction high-water (fraction of cap). 0 disables (always evict by window).
  const reactiveHighWater = Math.min(0.98, Math.max(0, config?.reactiveHighWater ?? 0.85));
  // Fix 3c: periodic self-tick (ms) so eviction runs during background decode without a scroll.
  const tickMs = Math.max(0, config?.tickMs ?? 750);
  const inputQuietMs = Math.max(0, config?.inputQuietMs ?? 120);
  const interactionHoldMs = resolveInteractionHoldMs(inputQuietMs, idleTimeoutMs);
  // Two batches of 50, or ~48ms of removal time, then yield. The 2379-image
  // megapass was ~48 batches and ~1.5s of main-thread removal.
  const maxRemovalsPerPass = Math.max(1, config?.maxRemovalsPerPass ?? 100);
  const maxPassEvictMs = Math.max(1, config?.maxPassEvictMs ?? 48);
  const passYieldGapMs = Math.max(16, config?.passYieldGapMs ?? 50);
  const emergencyBatchCap = 10;
  // Closed-series drops are map deletes, not removeImageLoadObject, so a turn
  // can take the normal batch. The in-loop 48ms check still stops a slow turn.
  const interactionOrphanBatchCap = 50;
  const abortMoveThreshold = Math.max(1, config?.abortMoveThreshold ?? 100);
  // Experiment A (TEST-ONLY): independent keep-budget override. Default OFF.
  const testKeepWindowEnabled = config?.testKeepWindowEnabled === true;
  const testKeepBudgetMBRaw =
    typeof config?.testKeepBudgetMB === 'number' && Number.isFinite(config.testKeepBudgetMB)
      ? config.testKeepBudgetMB
      : 0;
  const testKeepBudgetMB =
    testKeepWindowEnabled && testKeepBudgetMBRaw > 0 ? testKeepBudgetMBRaw : 0;
  const testKeepWindowActive = testKeepBudgetMB > 0;
  // Experiment B (TEST-ONLY): independent reactive-trigger override. Default OFF.
  const testReactiveHighWaterEnabled = config?.testReactiveHighWaterEnabled === true;
  const testReactiveHighWaterRaw =
    typeof config?.testReactiveHighWater === 'number' &&
    Number.isFinite(config.testReactiveHighWater)
      ? Math.min(0.98, Math.max(0, config.testReactiveHighWater))
      : NaN;
  const testReactiveTriggerActive =
    testReactiveHighWaterEnabled && Number.isFinite(testReactiveHighWaterRaw);
  // Production reactiveHighWater is preserved in `reactiveHighWater`; effective gate may
  // temporarily use the test value when Experiment B is on.
  const effectiveReactiveHighWater = testReactiveTriggerActive
    ? (testReactiveHighWaterRaw as number)
    : reactiveHighWater;
  // Idle outside-keep cleanup (default OFF): windowed reclaim below reactive gate only after
  // a long quiet period. Does not change production reactiveHighWater or scroll-time path.
  const idleOutsideKeepCleanupEnabled = config?.idleOutsideKeepCleanupEnabled === true;
  const idleOutsideKeepQuietMs = Math.max(0, config?.idleOutsideKeepQuietMs ?? 2500);
  const maxIdleEvictPerTick = Math.max(1, config?.maxIdleEvictPerTick ?? 10);

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

  // Effective keep-budget bytes for THIS pass. Production: budgetFraction × cap.
  // Experiment A (testKeepWindowActive): testKeepBudgetMB × 1 MiB only — does not mutate
  // budgetFraction, reactiveHighWater, caps, or prefetch.
  const effectiveKeepBudgetBytes = (): number => {
    if (testKeepWindowActive) {
      return testKeepBudgetMB * 1048576;
    }
    const capBytes = (cache as any).getMaxCacheSize?.() || 768 * 1048576;
    return budgetFraction * capBytes;
  };

  // Budget-based per-viewport keep (slices), split ahead/behind by scroll direction. The
  // total across all open stack viewports stays within the effective keep budget, so N panes
  // share the budget instead of each demanding a full window.
  const computeKeep = (dir: number, nStack: number): { ahead: number; behind: number } => {
    if (!budgetBased) {
      return {
        ahead: dir >= 0 ? keepAhead : keepBehind,
        behind: dir >= 0 ? keepBehind : keepAhead,
      };
    }
    const avg = measureAvgSliceBytes();
    const totalSlices = Math.max(1, Math.floor(effectiveKeepBudgetBytes() / avg));
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
  let passBudgetYields = 0;
  let passOutcome:
    | 'running'
    | 'interaction-deferred'
    | 'budget-exhausted'
    | 'completed'
    | 'no-eligible-candidates'
    | 'aborted' = 'running';
  let segmentRemoved = 0;
  let segmentEvictMs = 0;
  let resumeTimer: ReturnType<typeof setTimeout> | null = null;
  let passAborted = 0;
  let passOrphans = 0; // orphan (closed-series) images queued for eviction this pass (Fix 3b)
  let passOrphanRemaining = 0; // suffix of passCandidates that is still the closed series
  let passStackIdentity = '';
  let passStartT = 0;
  let passEvictMs = 0; // cumulative time spent in removeImageLoadObject loops this pass
  let passKeepLo = 0;
  let passKeepHi = 0;
  let passKeepAheadN = 0;
  let passKeepBehindN = 0;
  let passProtected = 0;
  let passStackVps = 0;
  let passBatchCap = maxEvictPerTick; // per-pass: maxEvictPerTick or maxIdleEvictPerTick
  let passIdleOutsideKeepCleanupActive = false;
  let lastBatchMs = 0;
  let lastBatchRemoved = 0;
  let lastBatchStoppedForTime = false;
  let parsedDataSetsReleased = 0;
  // Who released the parsed file. Office 9b057598 could not tell whether the
  // loader hook runs per decode or whether the sweep was doing that work.
  const parsedReleasedBy = { hook: 0, cacheAdd: 0, sweep: 0, drop: 0, onScreen: 0 };
  type ParsedReleaseSource = keyof typeof parsedReleasedBy;

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
      maxBatch: passMaxBatch, // largest single batch this pass (should be ≤ passBatchCap)
      yields: passYields, // interaction-deferred batches (removeCap 0 while the hold is active)
      budgetYields: passBudgetYields, // segments stopped by the removal or time budget
      passOutcome,
      lastInputAt,
      interactionHoldMs,
      msSinceInput: lastInputAt > 0 ? Math.max(0, Math.round(nowMs() - lastInputAt)) : null,
      aborted: passAborted, // 1 if the pass aborted on a far jump
      passMs: Math.round(nowMs() - passStartT), // wall time pass→finish (incl. idle gaps)
      evictMs: Math.round(passEvictMs), // main-thread time actually spent removing
      decodedBeforeMB: passDecodedBeforeMB,
      decodedAfterMB: Math.round(((cache as any).getCacheSize?.() || 0) / 1048576),
      totalEvicted: evictionCount,
      batchCap: passBatchCap,
      reactiveSkip: false, // this snapshot is from a real eviction pass
      reactiveSkips,
      orphans: passOrphans, // orphan (closed-series) images queued this pass (Fix 3b)
      orphanRemaining: passOrphanRemaining,
      orphanSweeps, // cumulative passes that queued ≥1 orphan
      orphanQueuedTotal, // cumulative orphan images queued (Fix 3b)
      lastBatchMs,
      lastBatchRemoved,
      batchStoppedForTime: lastBatchStoppedForTime,
      parsedDataSetsReleased,
      parsedReleasedBy: { ...parsedReleasedBy },
      loaderWrapperCalls: readLoaderWrapperCalls(),
      ...readDataSetCacheStats(),
      idleOutsideKeepCleanupEnabled,
      idleOutsideKeepCleanupActive: passIdleOutsideKeepCleanupActive,
      reactivePathReason: passIdleOutsideKeepCleanupActive
        ? 'idle-outside-keep-cleanup'
        : 'windowed-eviction-queued',
    };
    (globalThis as any).__skmEvictorLast = last;
    return last;
  };

  const clearResume = () => {
    if (resumeTimer) {
      clearTimeout(resumeTimer);
      resumeTimer = null;
    }
  };

  const finishPass = (reason: 'drained' | 'aborted' | 'empty') => {
    clearResume();
    if (reason === 'aborted') {
      passAborted = 1;
      passOutcome = 'aborted';
    } else if (passRemoved > 0) {
      passOutcome = 'completed';
    } else {
      passOutcome = 'no-eligible-candidates';
    }
    const last = publishLast();
    passActive = false;
    passCandidates = [];
    passOrphanRemaining = 0;
    passKeep = new Set();
    passCsvs = null;
    passActiveViewportId = null;
    if (passRemoved > 0 || reason === 'aborted') {
      // eslint-disable-next-line no-console
      console.log(
        `[SKM-EVICTOR] pass#${passSeq} ${passOutcome}: center=${lastCenter} ` +
          `keep=[${last.keepLo}..${last.keepHi}] removed=${passRemoved} in ${passBatches} batch(es) ` +
          `(max ${passMaxBatch}/${maxEvictPerTick}, yields ${passYields}, ` +
          `budgetYields ${passBudgetYields}, orphans ${passOrphans}) ` +
          `decodedMB ${passDecodedBeforeMB}→${last.decodedAfterMB} evictMs ${last.evictMs} ` +
          `(total ${evictionCount})`
      );
    }
  };

  // Prefetch stops new loads at boundedPrefetchHighWater. 1 means it does not pause,
  // in which case interaction must not evict (those images would be reloaded).
  const readPrefetchPauseFill = (): number => {
    try {
      const cfg = servicesManager?.services?.studyPrefetcherService?.config;
      if (cfg && cfg.boundedPrefetch === false) {
        return 1;
      }
      const hw = cfg?.boundedPrefetchHighWater;
      if (typeof hw === 'number' && Number.isFinite(hw) && hw > 0 && hw < 1) {
        return hw;
      }
    } catch (e) {
      /* default */
    }
    return 0.9;
  };

  const readDataSetCacheStats = (): { dataSetsCached: number | null; dataSetCacheMB: number | null } => {
    try {
      const info = (dicomImageLoader as any)?.wadouri?.dataSetCacheManager?.getInfo?.();
      if (!info) {
        return { dataSetsCached: null, dataSetCacheMB: null };
      }
      return {
        dataSetsCached:
          typeof info.numberOfDataSetsCached === 'number' ? info.numberOfDataSetsCached : null,
        dataSetCacheMB:
          typeof info.cacheSizeInBytes === 'number'
            ? Math.round(info.cacheSizeInBytes / 1048576)
            : null,
      };
    } catch (e) {
      return { dataSetsCached: null, dataSetCacheMB: null };
    }
  };

  // skmPurgeableStackImages counts every call into the wrapped loader. If this
  // stays at 0 the per-decode release hook never runs and the sweep is doing it.
  const readLoaderWrapperCalls = (): number | null => {
    const calls = (globalThis as any).__skmPurgeStats?.calls;
    return typeof calls === 'number' ? calls : null;
  };

  // Drop the parsed DICOM byte array once the pixels exist. Office 6d7b5e1: the
  // cache-add listener did not move this counter while a series was on screen
  // (idle stayed at 60; scrolling stayed flat until the series was dropped).
  // The loader hook and the cache sweep below call this for those images.
  const releaseParsedDataSet = (
    image: any,
    loadObject: any,
    imageId: string | null,
    source: ParsedReleaseSource = 'onScreen'
  ): void => {
    const frames = Number(image?.numberOfFrames ?? image?.data?.intString?.('x00280008'));
    if (Number.isFinite(frames) && frames > 1) {
      return;
    }
    const urls: string[] = [];
    const pushUrl = (value: string | null | undefined) => {
      if (typeof value === 'string' && value && urls.indexOf(value) === -1) {
        urls.push(value);
      }
    };
    if (imageId) {
      try {
        const parsed = (dicomImageLoader as any)?.wadouri?.parseImageId?.(imageId);
        pushUrl(parsed?.url);
      } catch (e) {
        /* parseImageId shape differs */
      }
      dataSetUrlCandidates(imageId).forEach(pushUrl);
    }
    const mgr = (dicomImageLoader as any)?.wadouri?.dataSetCacheManager;
    let wasLoaded = false;
    try {
      wasLoaded = urls.some(url => typeof mgr?.isLoaded === 'function' && mgr.isLoaded(url));
    } catch (e) {
      wasLoaded = false;
    }
    // A second call (cache-add, then sweep, then series drop) finds nothing and
    // must not bump the counter again. decache() alone is not evidence: it is
    // still present after the bytes are already gone.
    if (!image?.data && !wasLoaded) {
      return;
    }
    try {
      if (typeof loadObject?.decache === 'function') {
        loadObject.decache();
      }
    } catch (e) {
      /* already released */
    }
    if (urls.length) {
      try {
        urls.forEach(url => {
          let guard = 0;
          while (typeof mgr?.unload === 'function' && mgr.isLoaded?.(url) && guard < 256) {
            mgr.unload(url);
            guard++;
          }
          // cacheCount can stick above the drain. The byte array is the bulk of
          // the dataset; drop it even when the manager entry itself remains.
          if (typeof mgr?.isLoaded === 'function' && mgr.isLoaded(url)) {
            stripParsedDataSet(mgr.get?.(url));
          }
        });
      } catch (e) {
        /* dataset manager shape differs */
      }
    }
    // Same object the loader promise still closes over. Drop the element
    // table before forgetting our own reference.
    stripParsedDataSet(image?.data);
    try {
      if (image?.data) {
        image.data = undefined;
      }
    } catch (e) {
      /* image.data is not writable */
    }
    parsedDataSetsReleased++;
    parsedReleasedBy[source]++;
  };

  // Closed-series images are not on screen. Delete the cache entry without
  // removeImageLoadObject, which was costing 100–600ms per image once the heap
  // was large and so never finished the series inside the 48ms budget.
  const dropClosedSeriesEntry = (imageId: string): boolean => {
    const map = (cache as any)._imageCache;
    if (!map || typeof map.get !== 'function' || typeof map.delete !== 'function') {
      return false;
    }
    const entry = map.get(imageId);
    if (!entry) {
      return false;
    }
    const image = entry.image;
    const loadObject = entry.imageLoadObject;
    releaseParsedDataSet(image, loadObject, imageId, 'drop');
    const size = typeof entry.sizeInBytes === 'number' ? entry.sizeInBytes : 0;
    try {
      if (typeof loadObject?.cancelFn === 'function') {
        loadObject.cancelFn();
      }
    } catch (e) {
      /* already cancelled */
    }
    try {
      const ref = image?.referencedImageId;
      if (ref) {
        (cache as any)._referencedImageIdToImageIdCache?.delete?.(ref);
      }
    } catch (e) {
      /* best-effort */
    }
    map.delete(imageId);
    try {
      if (typeof (cache as any).incrementImageCacheSize === 'function') {
        (cache as any).incrementImageCacheSize(-size);
      }
    } catch (e) {
      /* size accounting is best-effort; the entry is already gone */
    }
    return true;
  };

  const cacheFill = (): number => {
    try {
      const capBytes = (cache as any).getMaxCacheSize?.() || 0;
      const curBytes = (cache as any).getCacheSize?.() || 0;
      return capBytes > 0 ? curBytes / capBytes : 0;
    } catch (e) {
      return 0;
    }
  };

  // One continuation timer. resetSegment lets the next step remove again after a
  // budget or emergency pause; interaction deferrals keep the current segment counts.
  let resetSegmentOnResume = false;
  const scheduleResume = (waitMs: number, resetSegment: boolean) => {
    clearResume();
    resetSegmentOnResume = resetSegment;
    resumeTimer = setTimeout(() => {
      resumeTimer = null;
      if (resetSegmentOnResume) {
        segmentRemoved = 0;
        segmentEvictMs = 0;
        resetSegmentOnResume = false;
      }
      runBatch();
    }, Math.max(16, waitMs));
  };

  // Run ONE small batch, then return the main thread. Rechecks input and the segment
  // budget immediately before any removal. Does not use requestIdleCallback: its
  // timeout forced batches during scroll after the 120ms window had expired.
  const runBatch = () => {
    if (!passActive) {
      return;
    }

    if (Math.abs(currentActiveCenter() - passCenterAtStart) > abortMoveThreshold) {
      finishPass('aborted');
      return;
    }

    const plan = planEvictionStep({
      candidatesRemaining: passCandidates.length,
      removedThisPass: passRemoved,
      segmentRemoved,
      segmentEvictMs,
      now: nowMs(),
      lastInputAt,
      holdMs: interactionHoldMs,
      fill: cacheFill(),
      prefetchPauseFill: readPrefetchPauseFill(),
      normalBatchCap: passBatchCap,
      emergencyBatchCap,
      maxRemovalsPerSegment: maxRemovalsPerPass,
      maxSegmentEvictMs: maxPassEvictMs,
      yieldGapMs: passYieldGapMs,
      orphanCandidatesRemaining: passOrphanRemaining,
      interactionOrphanBatchCap,
    });

    if (plan.outcome === 'completed' || plan.outcome === 'no-eligible-candidates') {
      finishPass('drained');
      return;
    }
    if (plan.outcome === 'interaction-deferred') {
      passYields++;
      passOutcome = 'interaction-deferred';
      publishLast();
      scheduleResume(plan.waitMs, false);
      return;
    }
    if (plan.outcome === 'budget-exhausted') {
      passBudgetYields++;
      passOutcome = 'budget-exhausted';
      publishLast();
      scheduleResume(plan.waitMs, true);
      return;
    }

    const batchT0 = nowMs();
    // Pop from the end. Orphans sit at the end, so they go first. During scroll,
    // stop when the orphan suffix is gone — the series on screen stays in the prefix.
    let removedThisBatch = 0;
    let examinations = 0;
    let stoppedForTime = false;
    while (removedThisBatch < plan.removeCap && passCandidates.length && examinations < 400) {
      if (shouldStopRemovalLoop(removedThisBatch, segmentEvictMs, maxPassEvictMs)) {
        stoppedForTime = true;
        break;
      }
      const fromOrphan = passOrphanRemaining > 0;
      if (plan.orphanOnly && !fromOrphan) {
        break;
      }
      const imageId = passCandidates.pop();
      examinations++;
      if (fromOrphan) {
        passOrphanRemaining--;
      }
      if (!imageId || passKeep.has(imageId)) {
        continue;
      }
      let loadObject: any;
      try {
        loadObject = (cache as any).getImageLoadObject?.(imageId);
      } catch (e) {
        loadObject = undefined;
      }
      if (!loadObject) {
        continue;
      }
      const t1 = nowMs();
      try {
        // A closed series is not on screen. removeImageLoadObject runs every
        // listener and, once the heap is large, one call costs 100–600ms, so
        // the 48ms budget never finishes the series. Drop the cache entry
        // directly. The series on screen still uses removeImageLoadObject.
        const dropped = fromOrphan ? dropClosedSeriesEntry(imageId) : false;
        if (!dropped) {
          const entry = (cache as any)._imageCache?.get?.(imageId);
          releaseParsedDataSet(entry?.image, entry?.imageLoadObject || loadObject, imageId);
          (cache as any).removeImageLoadObject(imageId);
        }
        removedThisBatch++;
      } catch (e) {
        /* image in use / already gone — skip */
      }
      const stepMs = nowMs() - t1;
      passEvictMs += stepMs;
      segmentEvictMs += stepMs;
    }
    lastBatchMs = Math.round(nowMs() - batchT0);
    lastBatchRemoved = removedThisBatch;
    lastBatchStoppedForTime = stoppedForTime;
    segmentRemoved += removedThisBatch;

    if (removedThisBatch > 0) {
      evictionCount += removedThisBatch;
      (globalThis as any).__skmEvictions = evictionCount;
      passRemoved += removedThisBatch;
      passBatches++;
      if (removedThisBatch > passMaxBatch) {
        passMaxBatch = removedThisBatch;
      }
      recentBatches.push({
        t: Date.now(),
        size: removedThisBatch,
        ms: lastBatchMs,
        pass: passSeq,
      });
      if (recentBatches.length > 60) {
        recentBatches.shift();
      }
      (globalThis as any).__skmEvictorBatches = recentBatches;

      if (diagnosticHooks?.onEvict) {
        try {
          diagnosticHooks.onEvict({
            ts: nowMs(),
            center: currentActiveCenter(),
            removedThisBatch,
            totalEvicted: evictionCount,
            pass: passSeq,
          });
        } catch (e) {
          /* diagnostics must never break eviction */
        }
      }
    }

    if (!passCandidates.length) {
      finishPass(passRemoved > 0 ? 'drained' : 'empty');
      return;
    }

    // Emergency: at most one small batch, then the full hold. That cannot walk
    // fill from the emergency line back through the prefetch pause in one step,
    // and the next step rechecks fill before removing anything else.
    if (plan.emergency) {
      segmentRemoved = maxRemovalsPerPass;
      passOutcome = 'budget-exhausted';
      publishLast();
      scheduleResume(interactionHoldMs, true);
      return;
    }

    if (segmentRemoved >= maxRemovalsPerPass || segmentEvictMs >= maxPassEvictMs) {
      passBudgetYields++;
      passOutcome = 'budget-exhausted';
      publishLast();
      scheduleResume(passYieldGapMs, true);
      return;
    }

    passOutcome = 'running';
    publishLast();
    // A cheap closed-series drop should finish during this stay, not 50ms
    // after every handful of images.
    scheduleResume(plan.orphanOnly && !stoppedForTime ? 16 : passYieldGapMs, false);
  };

  // Build the keep-set + candidate list for a new pass (the cheap scan), then start the
  // idle-batched pump. Union of keep-ranges across all open STACK viewports, keyed by
  // imageId, so a slice kept by ANY viewport is never evicted (safe for comparison panes).
  const startPass = () => {
    try {
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
        if (passActive) {
          finishPass('aborted');
        }
        return;
      }

      // Series switch changes the open image list. The in-flight pass still treats the
      // old series as "on screen", so abort it and rebuild: the series just left becomes
      // the orphan suffix and can drain during the next scroll.
      const stackIdentity = stackVps
        .map(s => `${s.viewportId}:${s.imageIds.length}:${s.imageIds[0] || ''}`)
        .join('|');
      if (passActive) {
        if (stackIdentity === passStackIdentity) {
          return;
        }
        finishPass('aborted');
      }
      passStackIdentity = stackIdentity;

      const activeIdx = stackVps[0].idx;
      if (lastCenter !== null && activeIdx !== lastCenter) {
        direction = activeIdx > lastCenter ? 1 : -1;
      }
      lastCenter = activeIdx;

      const { ahead: keepAheadN, behind: keepBehindN } = computeKeep(direction, stackVps.length);

      // Experiment C: publish keep window numbers (no pixel data) for prefetch clamp.
      try {
        (globalThis as any).__skmKeepWindow = {
          ahead: keepAheadN,
          behind: keepBehindN,
          margin,
          nStack: stackVps.length,
          center: activeIdx,
          direction,
          budgetBytes: Math.round(effectiveKeepBudgetBytes()),
          testKeepWindowActive,
          ts: nowMs(),
        };
      } catch (e) {
        /* best-effort */
      }

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

      // Full set of imageIds belonging to ANY open stack viewport — never orphan-evict these.
      const allOpenIds = new Set<string>();
      for (const { imageIds } of stackVps) {
        for (const id of imageIds) {
          if (id) {
            allOpenIds.add(id);
          }
        }
      }

      // SKM 2026-10-09 (Phase 3): protect images currently in the prefetcher's in-flight
      // set — they are being decoded right now and evicting them mid-flight causes purge
      // warnings (the decode completes but the cache no longer holds the object).
      try {
        const studyPrefetcherService = (servicesManager.services as any)?.studyPrefetcherService;
        if (typeof studyPrefetcherService?.getInflightImageIds === 'function') {
          const inflight: Set<string> = studyPrefetcherService.getInflightImageIds();
          inflight.forEach(id => keep.add(id));
        }
      } catch (e) {
        /* best-effort; never break scrolling */
      }

      // ── Fix 3 (REACTIVE gate) — gates ONLY windowed eviction, NOT orphan eviction ─────────
      // Windowed eviction (trimming the CURRENT series' working set) is a RAM-vs-smoothness
      // tradeoff, so it runs only under real memory pressure (fill ≥ effectiveReactiveHighWater):
      // a series that fits stays fully resident with zero churn. ORPHAN eviction (below) is pure
      // waste reclamation and runs REGARDLESS of fill (Fix 3b correction). Experiment B may
      // temporarily lower the effective gate; production reactiveHighWater stays 0.85 in config.
      const capBytes = (cache as any).getMaxCacheSize?.() || 0;
      const curBytes = (cache as any).getCacheSize?.() || 0;
      const fill = capBytes > 0 ? curBytes / capBytes : 0;
      const underPressure =
        effectiveReactiveHighWater <= 0 || fill >= effectiveReactiveHighWater;

      // Idle outside-keep cleanup (default OFF): below reactive gate, may still scan for
      // outside-keep candidates after a long quiet period. Active scrolling fails the quiet
      // gate; runBatch still defers on inputQuietMs and aborts on far moves.
      const msSinceLastInput = lastInputAt > 0 ? Math.max(0, nowMs() - lastInputAt) : 0;
      const idleScan = evaluateIdleOutsideKeepScanGate({
        enabled: idleOutsideKeepCleanupEnabled,
        underPressure,
        msSinceLastInput,
        idleOutsideKeepQuietMs,
      });
      const collectWindowed = shouldCollectWindowedCandidates(underPressure, idleScan);

      // Collect decoded slices OUTSIDE the keep-set (windowed candidates), deduped.
      // Under pressure: always (Fix 3). Below pressure: only when idle cleanup gate allows.
      const candidateSet = new Set<string>();
      const windowed: string[] = [];
      if (collectWindowed) {
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
              windowed.push(imageId);
            }
          }
        }
      }

      const idleOutsideKeepCleanupActive = isIdleOutsideKeepCleanupActive(
        underPressure,
        idleScan,
        windowed.length
      );
      const passCap = resolveEvictBatchCap({
        underPressure,
        idleOutsideKeepCleanupActive,
        maxEvictPerTick,
        maxIdleEvictPerTick,
      });

      // ── Fix 3b (ORPHAN eviction) ───────────────────────────────────────────
      // Decoded images belonging to series NO LONGER displayed in any viewport (e.g. after the
      // doctor switches from the 2001 series to the 4403 series) are never in a current
      // viewport's image list, so the windowed scan above never frees them. They pin the decoded
      // budget, and once the fill sits at the prefetcher's high-water pause the new series can't
      // finish loading → the "switch series → progress pauses → viewer stuck until you scroll"
      // symptom. Evict these FIRST (they are entirely unneeded by any open viewport).
      const orphans: string[] = [];
      try {
        const ic = (cache as any)._imageCache;
        if (ic && typeof ic.forEach === 'function') {
          ic.forEach((ci: any, key: any) => {
            const imageId = typeof key === 'string' && key ? key : ci && ci.imageId;
            if (
              typeof imageId === 'string' &&
              imageId &&
              !allOpenIds.has(imageId) &&
              !candidateSet.has(imageId)
            ) {
              candidateSet.add(imageId);
              orphans.push(imageId);
            }
          });
        }
      } catch (e) {
        /* cache map shape differs → no orphan sweep (windowed eviction still runs) */
      }

      // Experiment A diagnostics (read-only): compare keep set vs actual decoded cache
      // residency — counts/bytes of entries outside keep. Never retains pixel buffers.
      let cacheEntriesTotal = 0;
      let cacheEntriesOutsideKeep = 0;
      let cacheBytesOutsideKeep = 0;
      let cacheBytesInsideKeep = 0;
      try {
        const ic = (cache as any)._imageCache;
        if (ic && typeof ic.forEach === 'function') {
          ic.forEach((ci: any, key: any) => {
            const imageId = typeof key === 'string' && key ? key : ci && ci.imageId;
            if (typeof imageId !== 'string' || !imageId) {
              return;
            }
            const sz = typeof ci?.sizeInBytes === 'number' ? ci.sizeInBytes : 0;
            cacheEntriesTotal++;
            if (keep.has(imageId)) {
              cacheBytesInsideKeep += sz;
            } else {
              cacheEntriesOutsideKeep++;
              cacheBytesOutsideKeep += sz;
            }
          });
        }
      } catch (e) {
        /* best-effort diagnostics */
      }

      // Why the reactive/windowed/idle path ran or skipped (diagnostics only).
      const fillPctRounded = Math.round(fill * 100);
      const reactivePathReason = resolveWindowedPathReason({
        underPressure,
        idleScan,
        windowedCount: windowed.length,
        orphanCount: orphans.length,
        fillPct: fillPctRounded,
        effectiveReactiveHighWater,
      });
      // "Reactive skip" = below pressure and no work queued (idle cleanup may still run).
      const reactiveSkip = !underPressure && !windowed.length && !orphans.length;

      // SKM 2026-10-10 (diagnostics-only, additive): publish a FRESH pass record — center,
      // keep bounds, fill, candidate counts — on EVERY pass attempt, BEFORE the branch
      // below. This is the exact fix for the diagnosed staleness: previously the
      // reactive-skip early-return only patched a few fields onto the PREVIOUS pass's
      // __skmEvictorLast, leaving its center/keepLo/keepHi stale while this pass's own
      // (already-computed, just below) values were discarded. No eviction decision below
      // is changed by this call; diagnosticHooks is undefined unless explicitly wired.
      if (diagnosticHooks?.onPass) {
        try {
          // SKM 2026-10-10: same clock as age math in skmEvictionDiagnostics (nowMs /
          // performance.now) — never Date.now(), which mixed clocks and produced
          // huge negative ages while valid stayed true.
          diagnosticHooks.onPass({
            ts: nowMs(),
            center: activeIdx,
            direction,
            keepLo: keepLo === Infinity ? 0 : keepLo,
            keepHi: keepHi === -Infinity ? 0 : keepHi,
            keepAhead: keepAheadN,
            keepBehind: keepBehindN,
            stackViewports: stackVps.length,
            protectedCount: keep.size,
            fillPct: fillPctRounded,
            underPressure,
            windowedCandidates: windowed.length,
            orphanCandidates: orphans.length,
            reactiveSkip,
            keepSet: new Set(keep),
            testKeepWindowActive,
            testKeepBudgetMB: testKeepWindowActive ? testKeepBudgetMB : null,
            effectiveKeepBudgetBytes: Math.round(effectiveKeepBudgetBytes()),
            productionBudgetFraction: budgetFraction,
            cacheEntriesTotal,
            cacheEntriesOutsideKeep,
            cacheBytesOutsideKeep,
            cacheBytesInsideKeep,
            configuredReactiveHighWater: reactiveHighWater,
            effectiveReactiveHighWater,
            testReactiveTriggerActive,
            reactivePathReason,
            cacheBytes: curBytes,
            cacheCapBytes: capBytes,
            idleOutsideKeepCleanupEnabled,
            idleOutsideKeepCleanupActive,
            idleOutsideKeepGateReason: idleScan.idleGateReason,
            passBatchCap: passCap,
          });
        } catch (e) {
          /* diagnostics must never break eviction */
        }
      }

      // Nothing to reclaim this pass (no orphans, and either not under pressure or the window is
      // intact) → record a reactive-skip and return without starting a drain.
      if (!windowed.length && !orphans.length) {
        if (!underPressure) {
          reactiveSkips++;
        }
        (globalThis as any).__skmEvictorLast = {
          ...((globalThis as any).__skmEvictorLast || {}),
          reactiveSkip: !underPressure,
          fillPct: fillPctRounded,
          reactiveSkips,
          orphanSweeps,
          orphanQueuedTotal,
          decodedBeforeMB: Math.round(curBytes / 1048576),
          decodedAfterMB: Math.round(curBytes / 1048576),
          removed: 0,
          totalEvicted: evictionCount,
          configuredReactiveHighWater: reactiveHighWater,
          effectiveReactiveHighWater,
          testReactiveTriggerActive,
          reactivePathReason,
          cacheEntriesOutsideKeep,
          cacheEntriesTotal,
          idleOutsideKeepCleanupEnabled,
          idleOutsideKeepCleanupActive: false,
          idleOutsideKeepGateReason: idleScan.idleGateReason,
          passBatchCap: passCap,
          windowedCandidates: 0,
          underPressure,
          lastInputAt,
          msSinceInput: lastInputAt > 0 ? Math.max(0, Math.round(nowMs() - lastInputAt)) : null,
        };
        return;
      }

      // Prime pass state. Order: windowed first, orphans last, so runBatch (which pops from the
      // END) evicts ORPHANS FIRST — the fastest way to break the series-switch stall.
      passSeq++;
      passActive = true;
      passOrphans = orphans.length;
      passOrphanRemaining = orphans.length;
      if (orphans.length) {
        orphanSweeps++;
        orphanQueuedTotal += orphans.length;
      }
      passCandidates = windowed.concat(orphans);
      passKeep = keep;
      passCenterAtStart = activeIdx;
      passActiveViewportId = stackVps[0].viewportId;
      passCsvs = csvs;
      passDecodedBeforeMB = Math.round(((cache as any).getCacheSize?.() || 0) / 1048576);
      passRemoved = 0;
      passBatches = 0;
      passMaxBatch = 0;
      passYields = 0;
      passBudgetYields = 0;
      passOutcome = 'running';
      segmentRemoved = 0;
      segmentEvictMs = 0;
      passAborted = 0;
      passStartT = nowMs();
      passEvictMs = 0;
      passKeepLo = keepLo === Infinity ? 0 : keepLo;
      passKeepHi = keepHi === -Infinity ? 0 : keepHi;
      passKeepAheadN = keepAheadN;
      passKeepBehindN = keepBehindN;
      passProtected = keep.size;
      passStackVps = stackVps.length;
      passBatchCap = passCap;
      passIdleOutsideKeepCleanupActive = idleOutsideKeepCleanupActive;

      if (!passCandidates.length) {
        finishPass('empty');
        return;
      }

      scheduleResume(16, false);
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
  const publishInputStamp = () => {
    try {
      const last = (globalThis as any).__skmEvictorLast;
      if (!last) {
        return;
      }
      last.lastInputAt = lastInputAt;
      last.msSinceInput = lastInputAt > 0 ? Math.max(0, Math.round(nowMs() - lastInputAt)) : null;
    } catch (e) {
      /* diagnostics must never break eviction */
    }
  };

  const markInteraction = () => {
    lastInputAt = nowMs();
    // Reactive-skip passes only patch a few fields onto the previous snapshot, so a
    // poll of __skmEvictorLast would otherwise keep the last full pass's input time.
    publishInputStamp();
  };
  const onInput = () => {
    markInteraction();
    schedule();
  };
  subscribeStackNewImage(onInput);
  // Stack scroll starts before the new image is on screen, and a synthetic wheel
  // may never reach window. Stamp interaction from the scroll tool itself.
  try {
    const scrollEvent =
      (Enums as any)?.Events?.STACK_VIEWPORT_SCROLL || 'CORNERSTONE_STACK_VIEWPORT_SCROLL';
    subscribeViewportElementEvent(scrollEvent, markInteraction);
  } catch (e) {
    /* best-effort */
  }
  // Wheel and a pressed pointer (drag, touch, scrollbar) are scrolling even when the
  // displayed index has not changed yet. Hover without a button is not scrolling.
  try {
    const listenOpts = { capture: true, passive: true };
    window.addEventListener('wheel', markInteraction, listenOpts);
    window.addEventListener('pointerdown', markInteraction, listenOpts);
    window.addEventListener(
      'pointermove',
      (evt: PointerEvent) => {
        if (evt.buttons) {
          markInteraction();
        }
      },
      listenOpts
    );
    window.addEventListener(
      'keydown',
      (evt: KeyboardEvent) => {
        switch (evt.key) {
          case 'ArrowUp':
          case 'ArrowDown':
          case 'ArrowLeft':
          case 'ArrowRight':
          case 'PageUp':
          case 'PageDown':
          case 'Home':
          case 'End':
            markInteraction();
            break;
          default:
            break;
        }
      },
      listenOpts
    );
  } catch (e) {
    /* best-effort */
  }
  try {
    const { viewportGridService } = servicesManager.services;
    const E = viewportGridService.EVENTS;
    viewportGridService.subscribe(E.GRID_STATE_CHANGED, schedule);
    viewportGridService.subscribe(E.ACTIVE_VIEWPORT_ID_CHANGED, schedule);
  } catch (e) {
    /* best-effort */
  }

  // Fix 3c: periodic self-tick so eviction can reclaim the previous series (orphans) and any
  // overflow during BACKGROUND decode after a series switch — without waiting for the doctor to
  // scroll. schedule() is throttled and the pass reactive-skips cheaply while under the
  // high-water, so this is near-free when there is nothing to do.
  if (tickMs > 0) {
    setInterval(schedule, tickMs);
  }

  // Pixels stay in the image cache. The parsed file beside them does not.
  // 6d7b5e1 office: this listener did not advance the counter during idle or
  // during a scroll; it only moved when the series was dropped. The loader
  // hook (__skmReleaseParsedDataSet) and the sweep cover those paths.
  (globalThis as any).__skmReleaseParsedDataSet = (
    image: any,
    loadObject: any,
    imageId: string | null
  ) => releaseParsedDataSet(image, loadObject, imageId, 'hook');
  try {
    eventTarget.addEventListener(Enums.Events.IMAGE_CACHE_IMAGE_ADDED, (evt: any) => {
      const parsed = imageFromCacheEventDetail(evt?.detail);
      if (!parsed?.image) {
        return;
      }
      releaseParsedDataSet(parsed.image, parsed.loadObject, parsed.imageId, 'cacheAdd');
    });
  } catch (e) {
    /* event name differs — the sweep still drops datasets */
  }

  const parsedReleaseSweepBatch = 80;
  const volumeOpen = (): boolean => {
    if (!skipWhenVolumePresent) {
      return false;
    }
    try {
      const { viewportGridService, cornerstoneViewportService: csvs } = servicesManager.services;
      const viewports = viewportGridService?.getState?.()?.viewports;
      if (!viewports || !csvs) {
        return false;
      }
      return anyVolumePresent(viewports, csvs);
    } catch (e) {
      return false;
    }
  };
  // Office 9b057598: these fields were only refreshed when the sweep ran, and
  // the sweep was held during a scroll, so every scroll sample showed the
  // previous switch's values. Publish on every tick, before any early return.
  const publishParsedRelease = () => {
    const last = (globalThis as any).__skmEvictorLast || {};
    last.parsedDataSetsReleased = parsedDataSetsReleased;
    last.parsedReleasedBy = { ...parsedReleasedBy };
    last.loaderWrapperCalls = readLoaderWrapperCalls();
    const stats = readDataSetCacheStats();
    last.dataSetsCached = stats.dataSetsCached;
    last.dataSetCacheMB = stats.dataSetCacheMB;
    (globalThis as any).__skmEvictorLast = last;
  };
  // Prefetch fills the cache without a series switch, so nothing else publishes
  // the counter. Walk a small batch of entries that still hold a parsed file.
  // Runs during a scroll too: 5c932257 scrolled at 3.67 s with this sweep
  // unconditional; 9b057598 held it during input and scrolled at 6.07 s. When
  // the loader hook has already released a slice the walk finds nothing.
  const sweepParsedDataSets = () => {
    publishParsedRelease();
    if (volumeOpen()) {
      return;
    }
    const map = (cache as any)._imageCache;
    if (!map || typeof map.values !== 'function') {
      return;
    }
    let released = 0;
    try {
      for (const entry of map.values()) {
        const image = entry?.image;
        if (!image?.data) {
          continue;
        }
        releaseParsedDataSet(
          image,
          entry.imageLoadObject,
          entry.imageId || image.imageId || null,
          'sweep'
        );
        released++;
        if (released >= parsedReleaseSweepBatch) {
          break;
        }
      }
    } catch (e) {
      /* cache shape differs */
    }
    if (released > 0) {
      publishParsedRelease();
    }
  };
  setInterval(sweepParsedDataSets, 400);

  // eslint-disable-next-line no-console
  console.log(
    (budgetBased
      ? `[SKM-EVICTOR] active, BUDGET-BASED: fill ${Math.round(budgetFraction * 100)}% of cap, ` +
        `aheadBias ${aheadBias}, margin ${margin} (keep window sized live from avg slice bytes)`
      : `[SKM-EVICTOR] active, fixed window: keep ${keepBehind}+${keepAhead} (+${margin}) slices`) +
      ` | Fix 2: segment budget ${maxRemovalsPerPass} removals or ${maxPassEvictMs}ms, ` +
      `batchCap ${maxEvictPerTick}, interactionOrphanBatch ${interactionOrphanBatchCap}, ` +
      `parsedDataSetSweep ${parsedReleaseSweepBatch}, parsedShellStrip 1, parsedReleaseSources 1, retiredViewportRelease 1, cancelLoadGuard 1, ` +
      `interactionHold ${interactionHoldMs}ms ` +
      `(quiet ${inputQuietMs} + idle ${idleTimeoutMs}), abortMove ${abortMoveThreshold}` +
      ` | Fix 3: reactive, configured ≥ ${Math.round(reactiveHighWater * 100)}%` +
      `, effective ≥ ${Math.round(effectiveReactiveHighWater * 100)}% of cap` +
      ` | Fix 3c: self-tick ${tickMs}ms (orphan reclaim without scroll)` +
      (testKeepWindowActive
        ? ` | Experiment A TEST keep override ON: ${testKeepBudgetMB} MB (production budgetFraction ${budgetFraction} unused for keep sizing while on)`
        : ' | Experiment A TEST keep override OFF (production keep sizing)') +
      (testReactiveTriggerActive
        ? ` | Experiment B TEST reactive trigger ON: effective ${effectiveReactiveHighWater} (production configured ${reactiveHighWater})`
        : ' | Experiment B TEST reactive trigger OFF (production 0.85 path)') +
      (idleOutsideKeepCleanupEnabled
        ? ` | idleOutsideKeepCleanup ON: quiet≥${idleOutsideKeepQuietMs}ms, idleBatchCap ${maxIdleEvictPerTick}`
        : ' | idleOutsideKeepCleanup OFF (default)')
  );
}
