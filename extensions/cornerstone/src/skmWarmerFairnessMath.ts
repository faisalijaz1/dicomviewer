/**
 * SKM warmer multi-viewport fairness — pure helpers (no Cornerstone imports).
 *
 * When two (or more) large series are open, a single active-series-only warmer
 * starves inactive viewports. These helpers pick the next series to serve so
 * the preferred (active) series stays ahead without monopolizing every slot.
 */

export type FairPickInput = {
  /** Series keys that still have remaining work (stable order). */
  keys: string[];
  /** Remaining slice counts aligned with keys. */
  remaining: number[];
  /** Active / preferred series key, or null. */
  preferredKey: string | null;
  /**
   * Monotonic pick counter. Active bias uses modulo:
   * activeBias=2 → preferred, other, preferred, other... when both have work.
   */
  pickTick: number;
  /** Preferred:other ratio numerator. 2 → roughly 2:1. Minimum 1. */
  activeBias?: number;
};

/**
 * Index into keys[] for the next series to serve, or -1 if none have remaining.
 */
export function pickFairSeriesIndex(input: FairPickInput): number {
  const n = input.keys.length;
  if (n === 0 || input.remaining.length !== n) {
    return -1;
  }
  const withWork: number[] = [];
  for (let i = 0; i < n; i++) {
    if ((input.remaining[i] || 0) > 0) {
      withWork.push(i);
    }
  }
  if (withWork.length === 0) {
    return -1;
  }
  if (withWork.length === 1) {
    return withWork[0];
  }

  const bias = Math.max(1, Math.floor(input.activeBias ?? 2));
  const prefIdx = input.preferredKey
    ? input.keys.findIndex(k => k === input.preferredKey)
    : -1;
  const prefHasWork = prefIdx >= 0 && (input.remaining[prefIdx] || 0) > 0;
  const others = withWork.filter(i => i !== prefIdx);

  if (!prefHasWork) {
    // Round-robin among remaining
    return withWork[Math.abs(input.pickTick) % withWork.length];
  }
  if (others.length === 0) {
    return prefIdx;
  }

  // Cycle length = bias + 1 (bias preferred slots, 1 other slot)
  const cycle = bias + 1;
  const slot = Math.abs(input.pickTick) % cycle;
  if (slot < bias) {
    return prefIdx;
  }
  return others[Math.abs(input.pickTick) % others.length];
}

/**
 * Whether the warmer should skip the prefetch near-band for this series.
 * Prefetch is focused-first/sequential, so only the preferred series' near band is owned.
 */
export function shouldApplyNearSkip(input: {
  nearSkipPreferredOnly: boolean;
  seriesKey: string;
  preferredKey: string | null;
}): boolean {
  if (!input.nearSkipPreferredOnly) {
    return true; // legacy: skip near band on every job
  }
  if (!input.preferredKey) {
    return false;
  }
  return input.seriesKey === input.preferredKey;
}

/**
 * Drain-reconcile after fair queues empty.
 *
 * Legacy bug (warm 2VP incomplete): when missingUncached ≫ 8 the pump logged
 * "likely preferred nearSkip" and **stopped forever** (`fairNeedsReconcile=false`),
 * leaving Ready bars stuck (e.g. 2313/3674) even though series were still open.
 *
 * Correct behaviour: never abandon large holes — enqueue a bounded chunk and
 * continue reconcile until uncached+unwarmed is empty. Cache hits are emitted
 * separately and do not count toward enqueueCount.
 */
export function planFairDrainReconcile(input: {
  missingUncachedCount: number;
  chunkSize?: number;
}): {
  action: 'done' | 'enqueue-chunk';
  enqueueCount: number;
  continueReconcile: boolean;
} {
  const missing = Math.max(0, Math.floor(input.missingUncachedCount || 0));
  const chunk = Math.max(1, Math.floor(input.chunkSize ?? 256));
  if (missing === 0) {
    return { action: 'done', enqueueCount: 0, continueReconcile: false };
  }
  const enqueueCount = Math.min(missing, chunk);
  return {
    action: 'enqueue-chunk',
    enqueueCount,
    continueReconcile: missing > chunk,
  };
}

/**
 * nearSkip may omit a slice from the warmer queue only when prefetch/warm already
 * covers it. "Assumed prefetch owns near band" without cache/warm proof is what
 * left permanent Ready holes after drain.
 */
export function isNearSkipActuallyCovered(input: {
  alreadyWarmed: boolean;
  inCornerstoneCache: boolean;
}): boolean {
  return !!(input.alreadyWarmed || input.inCornerstoneCache);
}

/**
 * Split a shared concurrency budget across N open series (at least 1 each when possible).
 */
export function splitConcurrencyBudget(totalSlots: number, seriesCount: number): number[] {
  const slots = Math.max(1, Math.floor(totalSlots));
  const n = Math.max(0, Math.floor(seriesCount));
  if (n <= 0) {
    return [];
  }
  if (n === 1) {
    return [slots];
  }
  const base = Math.max(1, Math.floor(slots / n));
  const out = new Array(n).fill(base);
  let used = base * n;
  let i = 0;
  while (used < slots) {
    out[i % n]++;
    used++;
    i++;
  }
  // If slots < n, some get 1 and others 0 — ensure we never assign 0 when slots >= 1
  // by giving the first `slots` series 1 each.
  if (slots < n) {
    return out.map((_, idx) => (idx < slots ? 1 : 0));
  }
  return out;
}
