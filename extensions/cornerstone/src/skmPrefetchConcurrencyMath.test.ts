/**
 * Runnable without Jest:
 * node --experimental-strip-types extensions/cornerstone/src/skmPrefetchConcurrencyMath.test.ts
 */
import assert from 'node:assert/strict';
import {
  decidePrefetchConcurrencyTarget,
  rampPrefetchConcurrency,
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

console.log('skmPrefetchConcurrencyMath.test.ts: all assertions passed');
