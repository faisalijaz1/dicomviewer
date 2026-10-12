/**
 * Runnable without Jest:
 * node --experimental-strip-types extensions/cornerstone/src/skmWarmerFairnessMath.test.ts
 */
import assert from 'node:assert/strict';
import {
  isNearSkipActuallyCovered,
  pickFairSeriesIndex,
  planFairDrainReconcile,
  shouldApplyNearSkip,
  splitConcurrencyBudget,
} from './skmWarmerFairnessMath.ts';

{
  assert.equal(
    pickFairSeriesIndex({
      keys: [],
      remaining: [],
      preferredKey: null,
      pickTick: 0,
    }),
    -1
  );
}

{
  // Single series with work → always that series
  assert.equal(
    pickFairSeriesIndex({
      keys: ['a'],
      remaining: [10],
      preferredKey: 'a',
      pickTick: 0,
      activeBias: 2,
    }),
    0
  );
}

{
  // Preferred has no work → round-robin among others
  const picks = [0, 1, 2, 3].map(t =>
    pickFairSeriesIndex({
      keys: ['a', 'b', 'c'],
      remaining: [0, 5, 5],
      preferredKey: 'a',
      pickTick: t,
      activeBias: 2,
    })
  );
  assert.deepEqual(picks, [1, 2, 1, 2]);
}

{
  // activeBias=2 → preferred, preferred, other, preferred, preferred, other...
  const keys = ['active', 'other'];
  const remaining = [100, 100];
  const sequence: string[] = [];
  for (let t = 0; t < 6; t++) {
    const idx = pickFairSeriesIndex({
      keys,
      remaining,
      preferredKey: 'active',
      pickTick: t,
      activeBias: 2,
    });
    sequence.push(keys[idx]);
  }
  assert.deepEqual(sequence, ['active', 'active', 'other', 'active', 'active', 'other']);
}

{
  // Never starve: over many picks, other must get ~1/3 of slots
  const keys = ['active', 'other'];
  const remaining = [1000, 1000];
  let active = 0;
  let other = 0;
  for (let t = 0; t < 300; t++) {
    const idx = pickFairSeriesIndex({
      keys,
      remaining,
      preferredKey: 'active',
      pickTick: t,
      activeBias: 2,
    });
    if (idx === 0) {
      active++;
    } else {
      other++;
    }
  }
  assert.equal(active, 200);
  assert.equal(other, 100);
}

{
  assert.deepEqual(splitConcurrencyBudget(4, 2), [2, 2]);
  assert.deepEqual(splitConcurrencyBudget(5, 2), [3, 2]);
  assert.deepEqual(splitConcurrencyBudget(3, 1), [3]);
  assert.deepEqual(splitConcurrencyBudget(2, 3), [1, 1, 0]);
}

{
  // Preferred-only nearSkip: inactive series must NOT skip (fills Ready-bar hole).
  assert.equal(
    shouldApplyNearSkip({
      nearSkipPreferredOnly: true,
      seriesKey: 'active',
      preferredKey: 'active',
    }),
    true
  );
  assert.equal(
    shouldApplyNearSkip({
      nearSkipPreferredOnly: true,
      seriesKey: 'other',
      preferredKey: 'active',
    }),
    false
  );
  assert.equal(
    shouldApplyNearSkip({
      nearSkipPreferredOnly: false,
      seriesKey: 'other',
      preferredKey: 'active',
    }),
    true
  );
}

{
  // activeBias=1 → ~1:1 for equal series
  const keys = ['active', 'other'];
  const remaining = [100, 100];
  let active = 0;
  let other = 0;
  for (let t = 0; t < 200; t++) {
    const idx = pickFairSeriesIndex({
      keys,
      remaining,
      preferredKey: 'active',
      pickTick: t,
      activeBias: 1,
    });
    if (idx === 0) {
      active++;
    } else {
      other++;
    }
  }
  assert.equal(active, 100);
  assert.equal(other, 100);
}

{
  // Warm 2VP failure mode: large nearSkip/uncached hole must NOT be abandoned.
  const big = planFairDrainReconcile({
    missingUncachedCount: 1361, // 3674 - 2313
    chunkSize: 256,
  });
  assert.equal(big.action, 'enqueue-chunk');
  assert.equal(big.enqueueCount, 256);
  assert.equal(big.continueReconcile, true);

  const small = planFairDrainReconcile({
    missingUncachedCount: 3,
    chunkSize: 256,
  });
  assert.equal(small.action, 'enqueue-chunk');
  assert.equal(small.enqueueCount, 3);
  assert.equal(small.continueReconcile, false);

  const done = planFairDrainReconcile({ missingUncachedCount: 0, chunkSize: 256 });
  assert.equal(done.action, 'done');
  assert.equal(done.continueReconcile, false);

  // Legacy abandon threshold (8) must never appear as a stop condition.
  const justOverLegacy = planFairDrainReconcile({
    missingUncachedCount: 9,
    chunkSize: 256,
  });
  assert.equal(justOverLegacy.action, 'enqueue-chunk');
  assert.equal(justOverLegacy.enqueueCount, 9);
}

{
  assert.equal(
    isNearSkipActuallyCovered({ alreadyWarmed: false, inCornerstoneCache: false }),
    false
  );
  assert.equal(
    isNearSkipActuallyCovered({ alreadyWarmed: true, inCornerstoneCache: false }),
    true
  );
  assert.equal(
    isNearSkipActuallyCovered({ alreadyWarmed: false, inCornerstoneCache: true }),
    true
  );
}

console.log('skmWarmerFairnessMath.test.ts: all assertions passed');
