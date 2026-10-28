import {
  evaluateSnapshotAge,
  evaluateTestEvictSafety,
  skmDiagNowMs,
} from './skmEvictionDiagnosticsClock';

describe('skmEvictionDiagnosticsClock — snapshot age / validity', () => {
  const MAX = 5000;

  it('marks a fresh valid snapshot with finite non-negative age', () => {
    const now = 100_000;
    const r = evaluateSnapshotAge(now - 250, now, MAX);
    expect(r.valid).toBe(true);
    expect(r.reason).toBe('ok');
    expect(r.ageMs).toBe(250);
    expect(r.ageMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(r.ageMs)).toBe(true);
  });

  it('marks an expired snapshot invalid (stale)', () => {
    const now = 100_000;
    const r = evaluateSnapshotAge(now - (MAX + 1), now, MAX);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('stale');
    expect(r.ageMs).toBe(MAX + 1);
  });

  it('marks a missing snapshot invalid', () => {
    expect(evaluateSnapshotAge(null, 1000, MAX)).toEqual({
      ageMs: Number.POSITIVE_INFINITY,
      valid: false,
      reason: 'missing',
    });
    expect(evaluateSnapshotAge(undefined, 1000, MAX).reason).toBe('missing');
    expect(evaluateSnapshotAge(undefined, 1000, MAX).valid).toBe(false);
  });

  it('marks a non-finite timestamp invalid', () => {
    expect(evaluateSnapshotAge(NaN, 1000, MAX).reason).toBe('non-finite-ts');
    expect(evaluateSnapshotAge(Number.POSITIVE_INFINITY, 1000, MAX).valid).toBe(false);
    expect(evaluateSnapshotAge(Number.NEGATIVE_INFINITY, 1000, MAX).valid).toBe(false);
  });

  it('marks a non-finite now invalid', () => {
    expect(evaluateSnapshotAge(500, NaN, MAX).reason).toBe('non-finite-now');
    expect(evaluateSnapshotAge(500, Number.POSITIVE_INFINITY, MAX).valid).toBe(false);
  });

  it('never treats a negative age as evidence of freshness', () => {
    // Classic Date.now() stamp vs performance.now() age mix: ts >> now → negative age.
    const r = evaluateSnapshotAge(1_700_000_000_000, 12_345.6, MAX);
    expect(r.ageMs).toBeLessThan(0);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('negative-age');
  });

  it('uses one consistent clock for stamp + age (skmDiagNowMs)', () => {
    const ts = skmDiagNowMs();
    const now = skmDiagNowMs();
    const r = evaluateSnapshotAge(ts, now, MAX);
    expect(r.valid).toBe(true);
    expect(r.ageMs).toBeGreaterThanOrEqual(0);
    expect(r.ageMs).toBeLessThan(MAX);
    // Wall-clock jumps must not create a Date.now()-vs-performance.now() mismatch when
    // both sides use skmDiagNowMs (which prefers performance.now).
    expect(Number.isFinite(r.ageMs)).toBe(true);
  });
});

describe('skmEvictionDiagnosticsClock — test-evict safety gate', () => {
  const okSnapshot = { ageMs: 10, valid: true, reason: 'ok' as const };
  const base = {
    imageId: 'wadouri:safe-candidate',
    snapshot: okSnapshot,
    volumePresent: false as boolean | null,
    inflightKnown: true,
    inFlight: false,
    keepSetKnown: true,
    inKeepSet: false,
    stackViewportCount: 1,
    isCurrentDisplayed: false,
    cachePresentKnown: true,
    cachePresent: true,
  };

  it('allows only when every safety condition is satisfied', () => {
    expect(evaluateTestEvictSafety(base)).toEqual({ action: 'ok' });
  });

  it('refuses invalid image id', () => {
    expect(evaluateTestEvictSafety({ ...base, imageId: '' }).action).toBe('refused');
    expect(evaluateTestEvictSafety({ ...base, imageId: null }).reason).toBe('invalid-image-id');
  });

  it('refuses missing / invalid / stale snapshots', () => {
    expect(
      evaluateTestEvictSafety({
        ...base,
        snapshot: { ageMs: Infinity, valid: false, reason: 'missing' },
      }).reason
    ).toBe('stale-or-missing-evictor-snapshot');
    expect(
      evaluateTestEvictSafety({
        ...base,
        snapshot: { ageMs: -1e12, valid: false, reason: 'negative-age' },
      }).reason
    ).toBe('stale-or-missing-evictor-snapshot:negative-age');
    expect(
      evaluateTestEvictSafety({
        ...base,
        snapshot: { ageMs: 9000, valid: false, reason: 'stale' },
      }).reason
    ).toBe('stale-or-missing-evictor-snapshot:stale');
  });

  it('refuses every unsafe candidate class', () => {
    expect(evaluateTestEvictSafety({ ...base, volumePresent: true }).reason).toBe(
      'volume-present-skip'
    );
    expect(evaluateTestEvictSafety({ ...base, volumePresent: null }).reason).toBe(
      'volume-check-unreliable'
    );
    expect(evaluateTestEvictSafety({ ...base, inflightKnown: false }).reason).toBe(
      'inflight-check-unreliable'
    );
    expect(evaluateTestEvictSafety({ ...base, inFlight: true }).reason).toBe('in-flight');
    expect(evaluateTestEvictSafety({ ...base, keepSetKnown: false }).reason).toBe(
      'keep-set-unavailable'
    );
    expect(evaluateTestEvictSafety({ ...base, inKeepSet: true }).reason).toBe('in-keep-set');
    expect(evaluateTestEvictSafety({ ...base, stackViewportCount: 0 }).reason).toBe(
      'no-open-stack-viewport'
    );
    expect(evaluateTestEvictSafety({ ...base, isCurrentDisplayed: true }).reason).toBe(
      'currently-displayed'
    );
    expect(evaluateTestEvictSafety({ ...base, cachePresentKnown: false }).reason).toBe(
      'cache-check-unreliable'
    );
    expect(evaluateTestEvictSafety({ ...base, cachePresent: false }).reason).toBe('not-in-cache');
  });

  it('documents that a refused gate implies no cache mutation (accounting unchanged)', () => {
    // Pure gate: callers must not call removeImageLoadObject when action==='refused'.
    // This test locks that contract so refused attempts leave cache/accounting unchanged.
    const refused = evaluateTestEvictSafety({ ...base, inKeepSet: true });
    expect(refused.action).toBe('refused');
    // Simulated accounting: only mutate when action==='ok'.
    let cacheBytes = 512 * 1024;
    const before = cacheBytes;
    if (refused.action === 'ok') {
      cacheBytes -= 512 * 1024;
    }
    expect(cacheBytes).toBe(before);
    expect(cacheBytes - before).toBe(0);
  });
});
