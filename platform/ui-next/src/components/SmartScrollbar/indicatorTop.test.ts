/**
 * Runnable without Jest:
 *   node --experimental-strip-types platform/ui-next/src/components/SmartScrollbar/indicatorTop.test.ts
 */
import assert from 'node:assert/strict';
import { computeIndicatorTopLinear } from './utils.ts';

const total = 3674;
const pixelCount = 700;
const indicatorHeight = 12;
const maxTop = pixelCount - indicatorHeight;

assert.equal(computeIndicatorTopLinear(0, total, pixelCount, indicatorHeight), 0);
assert.equal(
  computeIndicatorTopLinear(total - 1, total, pixelCount, indicatorHeight),
  maxTop
);

let previous = -1;
for (let index = 0; index < total; index += 1) {
  const top = computeIndicatorTopLinear(index, total, pixelCount, indicatorHeight);
  assert.ok(top >= previous, 'thumb moves forward with the slice index');
  assert.ok(top <= maxTop);
  previous = top;
}

const step = computeIndicatorTopLinear(1, total, pixelCount, indicatorHeight);
assert.ok(step > 0, 'the second slice is not stuck on the first pixel bucket');

console.log('indicatorTop.test.ts: all assertions passed');
