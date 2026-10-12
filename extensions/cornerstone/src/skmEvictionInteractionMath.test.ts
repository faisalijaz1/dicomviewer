/**
 * Runnable without Jest:
 *   node --experimental-strip-types extensions/cornerstone/src/skmEvictionInteractionMath.test.ts
 */
import assert from 'node:assert/strict';
import { planInteractionEvictionBatch } from './skmEvictionInteractionMath.ts';

const base = {
  fill: 0.86,
  prefetchPauseFill: 0.9,
  normalBatchCap: 50,
  emergencyBatchCap: 10,
};

{
  const plan = planInteractionEvictionBatch({ ...base, interacting: false });
  assert.equal(plan.removeCap, 50);
  assert.equal(plan.next, 'idle');
}

{
  // Scroll, fill under the emergency line (0.95): no removal, no idle-callback wake.
  const plan = planInteractionEvictionBatch({ ...base, interacting: true, fill: 0.93 });
  assert.equal(plan.removeCap, 0);
  assert.equal(plan.next, 'quiet-wait');
}

{
  // Just above the prefetch pause is still not enough. Stay above the reload band.
  const plan = planInteractionEvictionBatch({ ...base, interacting: true, fill: 0.91 });
  assert.equal(plan.removeCap, 0);
  assert.equal(plan.next, 'quiet-wait');
}

{
  const plan = planInteractionEvictionBatch({ ...base, interacting: true, fill: 0.96 });
  assert.equal(plan.removeCap, 10);
  assert.equal(plan.next, 'quiet-wait');
}

{
  // 10 images even at 8 MB each (80 MB) stay inside the 0.05 gap above a 2816 MB pause
  // (0.05 * 2816 = 140.8 MB), so one emergency batch cannot restart prefetch.
  const plan = planInteractionEvictionBatch({ ...base, interacting: true, fill: 0.95 });
  assert.equal(plan.removeCap, 10);
  assert.ok(plan.removeCap * 8 < 0.05 * 2816);
}

{
  // Prefetch does not pause → never evict during interaction (would reload).
  const plan = planInteractionEvictionBatch({
    ...base,
    interacting: true,
    fill: 0.99,
    prefetchPauseFill: 1,
  });
  assert.equal(plan.removeCap, 0);
  assert.equal(plan.next, 'quiet-wait');
}

console.log('skmEvictionInteractionMath.test.ts: all assertions passed');
