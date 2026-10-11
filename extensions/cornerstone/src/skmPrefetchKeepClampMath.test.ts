/**
 * Runnable without Jest: node --experimental-strip-types extensions/cornerstone/src/skmPrefetchKeepClampMath.test.ts
 */
import assert from 'node:assert/strict';
import { computePrefetchKeepClamp } from './skmPrefetchKeepClampMath.ts';

{
  const r = computePrefetchKeepClamp({
    keepAhead: 100,
    keepBehind: 50,
    governorAhead: 5000,
    governorBehind: 3000,
    navigationLeadSlices: 40,
    direction: 1,
    velocitySlicesPerSec: 0,
    velocityLookAheadMs: 500,
    maxVelocityLeadSlices: 200,
  });
  assert.ok(r.clampedAhead <= 100);
  assert.ok(r.clampedBehind <= 50);
  assert.equal(r.clampedAhead, 100);
}

{
  const r = computePrefetchKeepClamp({
    keepAhead: 200,
    keepBehind: 100,
    governorAhead: 10,
    governorBehind: 10,
    navigationLeadSlices: 40,
    direction: 1,
    velocitySlicesPerSec: 0,
    velocityLookAheadMs: 500,
    maxVelocityLeadSlices: 200,
  });
  assert.ok(r.clampedAhead >= 40);
  assert.ok(r.clampedBehind >= 40);
}

{
  const r = computePrefetchKeepClamp({
    keepAhead: 80,
    keepBehind: 80,
    governorAhead: 5000,
    governorBehind: 5000,
    navigationLeadSlices: 40,
    direction: 1,
    velocitySlicesPerSec: 200,
    velocityLookAheadMs: 500,
    maxVelocityLeadSlices: 200,
  });
  assert.equal(r.leadCappedToKeep, true);
  assert.equal(r.grantedLeadForward, 80);
  assert.equal(r.clampedAhead, 80);
}

{
  const r = computePrefetchKeepClamp({
    keepAhead: 200,
    keepBehind: 200,
    governorAhead: 20,
    governorBehind: 20,
    navigationLeadSlices: 40,
    direction: -1,
    velocitySlicesPerSec: 100,
    velocityLookAheadMs: 500,
    maxVelocityLeadSlices: 200,
  });
  assert.ok(r.clampedBehind >= r.clampedAhead);
  assert.ok(r.grantedLeadBehind >= 40);
}

console.log('skmPrefetchKeepClampMath.test.ts: OK');
