/**
 * Runnable without Jest:
 * node --experimental-strip-types extensions/cornerstone/src/skmPrefetchConcurrencyMath.test.ts
 */
import assert from 'node:assert/strict';
import {
  decidePrefetchConcurrencyEvalWithPin,
  decidePrefetchConcurrencyTarget,
  rampPrefetchConcurrency,
  resolveConfiguredDecodeWorkerCount,
  resolveDecodeAheadCap,
  resolveFixedPrefetchPin,
} from './skmPrefetchConcurrencyMath.ts';

const base = {
  activeTab: true,
  liveTabs: 1,
  stackViewports: 1,
  fill: 0.7,
  minRequests: 4,
  baseRequests: 8,
  maxRequests: 10,
  multiTabRequests: 6,
  raiseFill: 0.55,
  backoffFill: 0.88,
};

const pinCaps = {
  poolOrControllerMax: 10,
  decodeAheadCap: 6 as number | null,
  minAllowed: 4,
};

{
  // Idle overrides multi-viewport (explains 6→4 while 2VP still open).
  const d = decidePrefetchConcurrencyTarget({
    ...base,
    activeTab: false,
    stackViewports: 2,
    fill: 0.3,
  });
  assert.equal(d.reason, 'idle');
  assert.equal(d.target, 4);
}

{
  const d = decidePrefetchConcurrencyTarget({
    ...base,
    stackViewports: 2,
    fill: 0.3,
  });
  assert.equal(d.reason, 'multi_viewport');
  assert.equal(d.target, 6);
}

{
  const d = decidePrefetchConcurrencyTarget({
    ...base,
    liveTabs: 2,
    stackViewports: 2,
  });
  assert.equal(d.reason, 'multi_tab');
  assert.equal(d.target, 6);
}

{
  assert.equal(decidePrefetchConcurrencyTarget({ ...base, fill: 0.4 }).reason, 'raise_fill');
  assert.equal(decidePrefetchConcurrencyTarget({ ...base, fill: 0.4 }).target, 10);
  assert.equal(decidePrefetchConcurrencyTarget({ ...base, fill: 0.9 }).reason, 'backoff_fill');
  assert.equal(decidePrefetchConcurrencyTarget({ ...base, fill: 0.9 }).target, 4);
  assert.equal(decidePrefetchConcurrencyTarget({ ...base, fill: 0.7 }).reason, 'base_policy');
  assert.equal(decidePrefetchConcurrencyTarget({ ...base, fill: 0.7 }).target, 8);
}

{
  // Ramp from multi_viewport target 6 toward idle target 4 takes one step of 2.
  assert.equal(
    rampPrefetchConcurrency({
      current: 6,
      target: 4,
      step: 2,
      minRequests: 4,
      maxRequests: 10,
    }),
    4
  );
  assert.equal(
    rampPrefetchConcurrency({
      current: 6,
      target: 10,
      step: 2,
      minRequests: 4,
      maxRequests: 10,
    }),
    8
  );
}

{
  // Pin clear
  const cleared = resolveFixedPrefetchPin(null, {
    poolOrControllerMax: 10,
    decodeAheadCap: 6,
    minAllowed: 4,
  });
  assert.equal(cleared.ok, true);
  assert.equal(cleared.requested, null);
  assert.equal(cleared.configured, null);
  assert.equal(cleared.effectiveMax, null);
}

{
  // Pin 4 and 6 within caps
  const p4 = resolveFixedPrefetchPin(4, {
    poolOrControllerMax: 10,
    decodeAheadCap: 6,
    minAllowed: 4,
  });
  assert.equal(p4.ok, true);
  assert.equal(p4.requested, 4);
  assert.equal(p4.configured, 4);
  assert.equal(p4.effectiveMax, 4);
  assert.equal(p4.cappedBelowRequest, false);

  const p6 = resolveFixedPrefetchPin(6, {
    poolOrControllerMax: 10,
    decodeAheadCap: 6,
    minAllowed: 4,
  });
  assert.equal(p6.ok, true);
  assert.equal(p6.requested, 6);
  assert.equal(p6.configured, 6);
  assert.equal(p6.effectiveMax, 6);
  assert.equal(p6.cappedBelowRequest, false);
}

{
  // Request 8/10 with decodeAheadCap 6 → configured may be 8/10 but effectiveMax 6
  const p8 = resolveFixedPrefetchPin(8, {
    poolOrControllerMax: 10,
    decodeAheadCap: 6,
    minAllowed: 4,
  });
  assert.equal(p8.ok, true);
  assert.equal(p8.requested, 8);
  assert.equal(p8.configured, 8);
  assert.equal(p8.effectiveMax, 6);
  assert.equal(p8.cappedBelowRequest, true);

  const p10 = resolveFixedPrefetchPin(10, {
    poolOrControllerMax: 10,
    decodeAheadCap: 6,
    minAllowed: 4,
  });
  assert.equal(p10.ok, true);
  assert.equal(p10.requested, 10);
  assert.equal(p10.configured, 10);
  assert.equal(p10.effectiveMax, 6);
  assert.equal(p10.cappedBelowRequest, true);
}

{
  // Pool max clamps configured below request
  const p = resolveFixedPrefetchPin(10, {
    poolOrControllerMax: 8,
    decodeAheadCap: null,
    minAllowed: 4,
  });
  assert.equal(p.ok, true);
  assert.equal(p.configured, 8);
  assert.equal(p.effectiveMax, 8);
  assert.equal(p.cappedBelowRequest, true);
}

{
  // Invalid values rejected
  assert.equal(resolveFixedPrefetchPin(3.5, { poolOrControllerMax: 10, decodeAheadCap: 6 }).ok, false);
  assert.equal(resolveFixedPrefetchPin(NaN, { poolOrControllerMax: 10, decodeAheadCap: 6 }).ok, false);
  assert.equal(
    resolveFixedPrefetchPin(2, {
      poolOrControllerMax: 10,
      decodeAheadCap: 6,
      minAllowed: 4,
    }).ok,
    false
  );
}

{
  // Active pin held across eval ticks — adaptive multi_viewport must not overwrite.
  const adaptiveWouldBe = decidePrefetchConcurrencyTarget({
    ...base,
    stackViewports: 2,
    fill: 0.3,
  });
  assert.equal(adaptiveWouldBe.reason, 'multi_viewport');
  assert.equal(adaptiveWouldBe.target, 6);

  const tick1 = decidePrefetchConcurrencyEvalWithPin({
    pinRequested: 4,
    pinCaps,
    current: 6,
    step: 2,
    adaptive: { ...base, stackViewports: 2, fill: 0.3 },
  });
  assert.equal(tick1.reason, 'test_pin');
  assert.equal(tick1.configured, 4);
  assert.equal(tick1.requested, 4);
  assert.equal(tick1.effective, 4);
  assert.equal(tick1.pinActive, true);

  const tick2 = decidePrefetchConcurrencyEvalWithPin({
    pinRequested: 4,
    pinCaps,
    current: tick1.configured,
    step: 2,
    adaptive: { ...base, stackViewports: 2, fill: 0.3 },
  });
  assert.equal(tick2.reason, 'test_pin');
  assert.equal(tick2.configured, 4);
  assert.notEqual(tick2.configured, adaptiveWouldBe.target);
}

{
  // Pin 6 held when supported by decodeAheadCap
  const d = decidePrefetchConcurrencyEvalWithPin({
    pinRequested: 6,
    pinCaps,
    current: 8,
    step: 2,
    adaptive: { ...base, fill: 0.4 },
  });
  assert.equal(d.reason, 'test_pin');
  assert.equal(d.configured, 6);
  assert.equal(d.effective, 6);
  assert.equal(d.cappedBelowRequest, false);
}

{
  // Request 8/10: configured may be 8/10 but effective capped at decodeAheadCap 6
  const d8 = decidePrefetchConcurrencyEvalWithPin({
    pinRequested: 8,
    pinCaps,
    current: 8,
    step: 2,
    adaptive: base,
  });
  assert.equal(d8.reason, 'test_pin');
  assert.equal(d8.requested, 8);
  assert.equal(d8.configured, 8);
  assert.equal(d8.effective, 6);
  assert.equal(d8.cappedBelowRequest, true);

  const d10 = decidePrefetchConcurrencyEvalWithPin({
    pinRequested: 10,
    pinCaps,
    current: 8,
    step: 2,
    adaptive: base,
  });
  assert.equal(d10.requested, 10);
  assert.equal(d10.configured, 10);
  assert.equal(d10.effective, 6);
  assert.equal(d10.cappedBelowRequest, true);
}

{
  // Reset pin (null) → adaptive resume with normal reasons
  const d = decidePrefetchConcurrencyEvalWithPin({
    pinRequested: null,
    pinCaps,
    current: 4,
    step: 2,
    adaptive: { ...base, stackViewports: 2, fill: 0.3 },
  });
  assert.equal(d.reason, 'multi_viewport');
  assert.equal(d.target, 6);
  assert.equal(d.configured, 6); // ramp 4→6 step 2
  assert.equal(d.requested, null);
  assert.equal(d.pinActive, false);
}

{
  // Production decode-ahead stays workers−1 when the canary override is absent.
  assert.deepEqual(resolveDecodeAheadCap({ maxNumberOfWebWorkers: 7 }), {
    cap: 6,
    source: 'workers-minus-one',
  });
  assert.deepEqual(resolveDecodeAheadCap({ maxNumberOfWebWorkers: 16, canaryDecodeAheadCap: 0 }), {
    cap: 15,
    source: 'workers-minus-one',
  });
  assert.deepEqual(resolveDecodeAheadCap({ maxNumberOfWebWorkers: 7, canaryDecodeAheadCap: 20 }), {
    cap: 20,
    source: 'canary-override',
  });
  assert.equal(resolveConfiguredDecodeWorkerCount({ hardwareConcurrency: 8, maxNumberOfWebWorkers: 16 }), 7);
  assert.equal(resolveConfiguredDecodeWorkerCount({ hardwareConcurrency: 32, maxNumberOfWebWorkers: 16 }), 16);
}

{
  // Two viewports use multiTabRequests. With canary min 15, a leftover multiTab of 6
  // is clamped up to 15 and never reaches max 20.
  const clamped = decidePrefetchConcurrencyTarget({
    ...base,
    minRequests: 15,
    baseRequests: 15,
    maxRequests: 20,
    multiTabRequests: 6,
    stackViewports: 2,
    fill: 0.2,
  });
  assert.equal(clamped.reason, 'multi_viewport');
  assert.equal(clamped.target, 15);

  const canary = decidePrefetchConcurrencyTarget({
    ...base,
    minRequests: 15,
    baseRequests: 15,
    maxRequests: 20,
    multiTabRequests: 20,
    stackViewports: 2,
    fill: 0.2,
  });
  assert.equal(canary.reason, 'multi_viewport');
  assert.equal(canary.target, 20);

  const seeded = rampPrefetchConcurrency({
    current: 15,
    target: 20,
    step: 2,
    minRequests: 15,
    maxRequests: 20,
  });
  assert.equal(seeded, 17);
}

console.log('skmPrefetchConcurrencyMath.test.ts: all assertions passed');
