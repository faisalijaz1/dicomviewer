/**
 * SKM 2026-10-10 — pure clock + snapshot-validity helpers for eviction diagnostics.
 *
 * WHY: Playwright found Date.now() timestamps mixed with performance.now() age math,
 * producing huge negative ages while `valid` stayed true. Snapshot timestamps and
 * elapsed-age calculations MUST share one clock. Negative / non-finite / missing /
 * stale ages are NEVER treated as fresh.
 *
 * Pure functions only — no Cornerstone imports — so unit tests can run without the
 * viewer runtime. Production eviction thresholds are untouched.
 */

export type SnapshotAgeReason =
  | 'ok'
  | 'missing'
  | 'non-finite-ts'
  | 'non-finite-now'
  | 'negative-age'
  | 'stale';

export type SnapshotAgeResult = {
  ageMs: number;
  valid: boolean;
  reason: SnapshotAgeReason;
};

/**
 * Monotonic (preferred) clock for diagnostic snapshot timestamps and age math.
 * Falls back to Date.now() only when performance.now is unavailable — both stamp
 * and age MUST still use THIS same function in that environment.
 */
export function skmDiagNowMs(): number {
  try {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
  } catch (e) {
    /* fall through */
  }
  return Date.now();
}

/**
 * Evaluate snapshot freshness. A negative age is ALWAYS invalid — never evidence of freshness.
 */
export function evaluateSnapshotAge(
  ts: number | null | undefined,
  now: number,
  maxAgeMs: number
): SnapshotAgeResult {
  if (ts == null) {
    return { ageMs: Number.POSITIVE_INFINITY, valid: false, reason: 'missing' };
  }
  if (typeof ts !== 'number' || !Number.isFinite(ts)) {
    return { ageMs: Number.POSITIVE_INFINITY, valid: false, reason: 'non-finite-ts' };
  }
  if (typeof now !== 'number' || !Number.isFinite(now)) {
    return { ageMs: Number.POSITIVE_INFINITY, valid: false, reason: 'non-finite-now' };
  }
  const ageMs = now - ts;
  if (!Number.isFinite(ageMs) || ageMs < 0) {
    return { ageMs, valid: false, reason: 'negative-age' };
  }
  if (ageMs > maxAgeMs) {
    return { ageMs, valid: false, reason: 'stale' };
  }
  return { ageMs, valid: true, reason: 'ok' };
}

export type TestEvictSafetyInput = {
  imageId: unknown;
  snapshot: SnapshotAgeResult;
  /** null = volume check could not be established reliably → refuse */
  volumePresent: boolean | null;
  /** false = in-flight set could not be read → refuse (never assume empty) */
  inflightKnown: boolean;
  inFlight: boolean;
  /** false = no keep-set from a valid pass → refuse */
  keepSetKnown: boolean;
  inKeepSet: boolean;
  stackViewportCount: number;
  isCurrentDisplayed: boolean;
  /** false = cache membership could not be established → refuse */
  cachePresentKnown: boolean;
  cachePresent: boolean;
};

export type TestEvictSafetyResult =
  | { action: 'ok' }
  | { action: 'refused'; reason: string };

/**
 * Pure safety gate for skmTestEvictImageId. Mirrors production protections
 * (keep-set, in-flight, volume-present, currently displayed) and refuses when
 * required state cannot be established reliably.
 */
export function evaluateTestEvictSafety(input: TestEvictSafetyInput): TestEvictSafetyResult {
  if (typeof input.imageId !== 'string' || !input.imageId) {
    return { action: 'refused', reason: 'invalid-image-id' };
  }
  if (!input.snapshot.valid) {
    return {
      action: 'refused',
      reason:
        input.snapshot.reason === 'missing'
          ? 'stale-or-missing-evictor-snapshot'
          : `stale-or-missing-evictor-snapshot:${input.snapshot.reason}`,
    };
  }
  if (input.volumePresent === null) {
    return { action: 'refused', reason: 'volume-check-unreliable' };
  }
  if (input.volumePresent) {
    return { action: 'refused', reason: 'volume-present-skip' };
  }
  if (!input.inflightKnown) {
    return { action: 'refused', reason: 'inflight-check-unreliable' };
  }
  if (input.inFlight) {
    return { action: 'refused', reason: 'in-flight' };
  }
  if (!input.keepSetKnown) {
    return { action: 'refused', reason: 'keep-set-unavailable' };
  }
  if (input.inKeepSet) {
    return { action: 'refused', reason: 'in-keep-set' };
  }
  if (input.stackViewportCount <= 0) {
    return { action: 'refused', reason: 'no-open-stack-viewport' };
  }
  if (input.isCurrentDisplayed) {
    return { action: 'refused', reason: 'currently-displayed' };
  }
  if (!input.cachePresentKnown) {
    return { action: 'refused', reason: 'cache-check-unreliable' };
  }
  if (!input.cachePresent) {
    return { action: 'refused', reason: 'not-in-cache' };
  }
  return { action: 'ok' };
}
