/**
 * Runnable without Jest:
 *   node --experimental-strip-types extensions/cornerstone/src/skmIdleOutsideKeepCleanupMath.test.ts
 */
import assert from 'node:assert/strict';
import {
  evaluateIdleOutsideKeepScanGate,
  isIdleOutsideKeepCleanupActive,
  resolveEvictBatchCap,
  resolveWindowedPathReason,
  shouldCollectWindowedCandidates,
} from './skmIdleOutsideKeepCleanupMath.ts';

// Default-off: disabled below pressure → no scan; classic reactive-skip reason preserved
{
  const g = evaluateIdleOutsideKeepScanGate({
    enabled: false,
    underPressure: false,
    msSinceLastInput: 10_000,
    idleOutsideKeepQuietMs: 2500,
  });
  assert.equal(g.mayScanIdleWindowed, false);
  assert.equal(g.idleGateReason, 'idle-outside-keep-cleanup-disabled');
  assert.equal(shouldCollectWindowedCandidates(false, g), false);
  assert.equal(
    resolveWindowedPathReason({
      underPressure: false,
      idleScan: g,
      windowedCount: 0,
      orphanCount: 0,
      fillPct: 40,
      effectiveReactiveHighWater: 0.5,
    }),
    'skipped-below-effective-reactive-high-water(fill=40%<50%)'
  );
}

// Quiet-period gating: enabled but not quiet long enough
{
  const g = evaluateIdleOutsideKeepScanGate({
    enabled: true,
    underPressure: false,
    msSinceLastInput: 500,
    idleOutsideKeepQuietMs: 2500,
  });
  assert.equal(g.mayScanIdleWindowed, false);
  assert.match(g.idleGateReason, /quiet-not-met/);
  assert.equal(shouldCollectWindowedCandidates(false, g), false);
}

// Eligibility path: enabled + quiet → may scan; empty candidates → stop reason
{
  const g = evaluateIdleOutsideKeepScanGate({
    enabled: true,
    underPressure: false,
    msSinceLastInput: 3000,
    idleOutsideKeepQuietMs: 2500,
  });
  assert.equal(g.mayScanIdleWindowed, true);
  assert.equal(shouldCollectWindowedCandidates(false, g), true);
  assert.equal(isIdleOutsideKeepCleanupActive(false, g, 0), false);
  assert.equal(
    resolveWindowedPathReason({
      underPressure: false,
      idleScan: g,
      windowedCount: 0,
      orphanCount: 0,
      fillPct: 40,
      effectiveReactiveHighWater: 0.5,
    }),
    'idle-outside-keep-no-eligible-candidates'
  );
}

// Idle cleanup active when candidates exist below pressure
{
  const g = evaluateIdleOutsideKeepScanGate({
    enabled: true,
    underPressure: false,
    msSinceLastInput: 5000,
    idleOutsideKeepQuietMs: 2500,
  });
  assert.equal(isIdleOutsideKeepCleanupActive(false, g, 42), true);
  assert.equal(
    resolveWindowedPathReason({
      underPressure: false,
      idleScan: g,
      windowedCount: 42,
      orphanCount: 0,
      fillPct: 40,
      effectiveReactiveHighWater: 0.5,
    }),
    'idle-outside-keep-cleanup'
  );
  assert.equal(
    resolveEvictBatchCap({
      underPressure: false,
      idleOutsideKeepCleanupActive: true,
      maxEvictPerTick: 50,
      maxIdleEvictPerTick: 10,
    }),
    10
  );
}

// Under pressure: idle gate N/A; normal batch cap; reactive path reason
{
  const g = evaluateIdleOutsideKeepScanGate({
    enabled: true,
    underPressure: true,
    msSinceLastInput: 10_000,
    idleOutsideKeepQuietMs: 2500,
  });
  assert.equal(g.mayScanIdleWindowed, false);
  assert.equal(shouldCollectWindowedCandidates(true, g), true);
  assert.equal(isIdleOutsideKeepCleanupActive(true, g, 100), false);
  assert.equal(
    resolveWindowedPathReason({
      underPressure: true,
      idleScan: g,
      windowedCount: 100,
      orphanCount: 0,
      fillPct: 60,
      effectiveReactiveHighWater: 0.5,
    }),
    'windowed-eviction-queued'
  );
  assert.equal(
    resolveEvictBatchCap({
      underPressure: true,
      idleOutsideKeepCleanupActive: false,
      maxEvictPerTick: 50,
      maxIdleEvictPerTick: 10,
    }),
    50
  );
}

// Movement-resume / not-quiet: after scroll, msSince small → defer (no idle scan)
{
  const g = evaluateIdleOutsideKeepScanGate({
    enabled: true,
    underPressure: false,
    msSinceLastInput: 0,
    idleOutsideKeepQuietMs: 2500,
  });
  assert.equal(g.mayScanIdleWindowed, false);
  assert.equal(shouldCollectWindowedCandidates(false, g), false);
}

// No last input yet (msSince 0 with enabled): must not scan
{
  const g = evaluateIdleOutsideKeepScanGate({
    enabled: true,
    underPressure: false,
    msSinceLastInput: 0,
    idleOutsideKeepQuietMs: 2500,
  });
  assert.equal(g.mayScanIdleWindowed, false);
}

console.log('skmIdleOutsideKeepCleanupMath.test.ts: OK');
