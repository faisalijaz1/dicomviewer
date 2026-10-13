/**
 * Runnable without Jest:
 *   node --experimental-strip-types extensions/cornerstone/src/skmEvictionInteractionMath.test.ts
 */
import assert from 'node:assert/strict';
import {
  emergencyFillThreshold,
  isInteractionHeld,
  planEvictionStep,
  planInteractionEvictionBatch,
  resolveInteractionHoldMs,
  selectRemovals,
  volumeBlocksStackEviction,
} from './skmEvictionInteractionMath.ts';

const holdMs = resolveInteractionHoldMs(120, 500);
assert.equal(holdMs, 620);

const limits = {
  holdMs,
  prefetchPauseFill: 0.9,
  normalBatchCap: 50,
  emergencyBatchCap: 10,
  maxRemovalsPerSegment: 100,
  maxSegmentEvictMs: 48,
  yieldGapMs: 50,
};

// 1. A segment stops on removal count and on elapsed removal time.
{
  const byCount = planEvictionStep({
    ...limits,
    candidatesRemaining: 500,
    removedThisPass: 100,
    segmentRemoved: 100,
    segmentEvictMs: 10,
    now: 1000,
    lastInputAt: 0,
    fill: 0.9,
  });
  assert.equal(byCount.outcome, 'budget-exhausted');
  assert.equal(byCount.removeCap, 0);
  assert.ok(byCount.waitMs >= 16);

  const byTime = planEvictionStep({
    ...limits,
    candidatesRemaining: 500,
    removedThisPass: 50,
    segmentRemoved: 50,
    segmentEvictMs: 48,
    now: 1000,
    lastInputAt: 0,
    fill: 0.9,
  });
  assert.equal(byTime.outcome, 'budget-exhausted');
  assert.equal(byTime.removeCap, 0);
}

// 2. Input between batches defers non-emergency work. The 120ms window is not enough
// when the previous batch was scheduled across the 500ms idle timeout.
{
  assert.equal(isInteractionHeld({ now: 500, lastInputAt: 0, holdMs }), false);
  assert.equal(isInteractionHeld({ now: 500, lastInputAt: 100, holdMs }), true);
  const deferred = planEvictionStep({
    ...limits,
    candidatesRemaining: 400,
    removedThisPass: 0,
    segmentRemoved: 0,
    segmentEvictMs: 0,
    now: 500,
    lastInputAt: 100,
    fill: 0.9,
  });
  assert.equal(deferred.outcome, 'interaction-deferred');
  assert.equal(deferred.removeCap, 0);
  assert.equal(deferred.emergency, false);
  assert.equal(deferred.orphanOnly, false);
  const candidates = ['a', 'b', 'c'];
  const before = candidates.slice();
  assert.equal(deferred.removeCap, 0);
  assert.deepEqual(candidates, before);
}

// 3. Deferred work resumes and finishes without dropping candidates.
{
  const candidates = Array.from({ length: 30 }, (_, i) => 'id-' + i);
  const present = new Set(candidates);
  const removed: string[] = [];
  let segmentRemoved = 0;
  let now = 0;
  let lastInputAt = 50;
  let guard = true;
  for (let step = 0; step < 20 && candidates.length; step++) {
    const plan = planEvictionStep({
      ...limits,
      candidatesRemaining: candidates.length,
      removedThisPass: removed.length,
      segmentRemoved,
      segmentEvictMs: 0,
      now,
      lastInputAt: guard ? lastInputAt : 0,
      fill: 0.8,
    });
    if (plan.outcome === 'interaction-deferred') {
      assert.equal(candidates.length, 30);
      guard = false;
      now = lastInputAt + holdMs;
      continue;
    }
    if (plan.outcome === 'budget-exhausted') {
      segmentRemoved = 0;
      now += plan.waitMs;
      continue;
    }
    assert.equal(plan.outcome, 'run-batch');
    const batch = selectRemovals({
      candidates,
      isProtected: () => false,
      isPresent: id => present.has(id),
      removeCap: plan.removeCap,
      maxExaminations: 400,
    });
    removed.push(...batch.removed);
    segmentRemoved += batch.removed.length;
    now += 16;
  }
  assert.equal(candidates.length, 0);
  assert.equal(removed.length, 30);
  const done = planEvictionStep({
    ...limits,
    candidatesRemaining: 0,
    removedThisPass: removed.length,
    segmentRemoved: 0,
    segmentEvictMs: 0,
    now,
    lastInputAt: 0,
    fill: 0.8,
  });
  assert.equal(done.outcome, 'completed');
}

// 4. Visible keep-set, in-flight, and absent IDs are not removed. Volume skips the pass.
{
  const candidates = ['visible', 'inflight', 'orphan', 'missing'];
  const protectedIds = new Set(['visible', 'inflight']);
  const present = new Set(['visible', 'inflight', 'orphan']);
  const batch = selectRemovals({
    candidates,
    isProtected: id => protectedIds.has(id),
    isPresent: id => present.has(id),
    removeCap: 50,
    maxExaminations: 400,
  });
  assert.deepEqual(batch.removed, ['orphan']);
  assert.equal(candidates.length, 0);
  assert.equal(volumeBlocksStackEviction(true, true), true);
  assert.equal(volumeBlocksStackEviction(false, true), false);
  assert.equal(volumeBlocksStackEviction(true, false), false);
}

// 5. Critical pressure stays bounded and cannot run a normal 50-image batch.
{
  assert.equal(emergencyFillThreshold(0.9, 0.05), 0.95);
  const emergency = planEvictionStep({
    ...limits,
    candidatesRemaining: 2000,
    removedThisPass: 0,
    segmentRemoved: 0,
    segmentEvictMs: 0,
    now: 200,
    lastInputAt: 100,
    fill: 0.96,
  });
  assert.equal(emergency.outcome, 'run-batch');
  assert.equal(emergency.emergency, true);
  assert.equal(emergency.removeCap, 10);
  assert.ok(emergency.removeCap * 8 < 0.05 * 2816);

  const underLine = planEvictionStep({
    ...limits,
    candidatesRemaining: 2000,
    removedThisPass: 0,
    segmentRemoved: 0,
    segmentEvictMs: 0,
    now: 200,
    lastInputAt: 100,
    fill: 0.94,
  });
  assert.equal(underLine.outcome, 'interaction-deferred');
  assert.equal(underLine.orphanOnly, false);
}

// A closed series still drains during the hold, and only up to the orphan suffix.
{
  const orphans = planEvictionStep({
    ...limits,
    candidatesRemaining: 2400,
    orphanCandidatesRemaining: 2000,
    removedThisPass: 0,
    segmentRemoved: 0,
    segmentEvictMs: 0,
    now: 500,
    lastInputAt: 100,
    fill: 0.5,
  });
  assert.equal(orphans.outcome, 'run-batch');
  assert.equal(orphans.orphanOnly, true);
  assert.equal(orphans.emergency, false);
  assert.equal(orphans.removeCap, 50);

  const few = planEvictionStep({
    ...limits,
    candidatesRemaining: 30,
    orphanCandidatesRemaining: 10,
    removedThisPass: 0,
    segmentRemoved: 0,
    segmentEvictMs: 0,
    now: 500,
    lastInputAt: 100,
    fill: 0.99,
  });
  assert.equal(few.orphanOnly, true);
  assert.equal(few.removeCap, 10);
  assert.equal(few.emergency, false);
}

{
  const noPause = planInteractionEvictionBatch({
    interacting: true,
    fill: 0.99,
    prefetchPauseFill: 1,
    normalBatchCap: 50,
    emergencyBatchCap: 10,
  });
  assert.equal(noPause.removeCap, 0);

  const capped = planEvictionStep({
    ...limits,
    candidatesRemaining: 2000,
    removedThisPass: 90,
    segmentRemoved: 95,
    segmentEvictMs: 0,
    now: 1000,
    lastInputAt: 0,
    fill: 0.99,
  });
  assert.equal(capped.outcome, 'run-batch');
  assert.equal(capped.removeCap, 5);
}

{
  const none = planEvictionStep({
    ...limits,
    candidatesRemaining: 0,
    removedThisPass: 0,
    segmentRemoved: 0,
    segmentEvictMs: 0,
    now: 0,
    lastInputAt: 0,
    fill: 0.5,
  });
  assert.equal(none.outcome, 'no-eligible-candidates');
}

console.log('skmEvictionInteractionMath.test.ts: all assertions passed');
