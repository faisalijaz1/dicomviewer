/**
 * Runnable without Jest:
 *   node --experimental-strip-types extensions/cornerstone/src/utils/skmViewportReuse.test.ts
 */
import assert from 'node:assert/strict';
import {
  imageIdsSafeToCancel,
  releaseRetiredViewport,
  shouldReuseStackViewport,
} from './skmViewportReuse.ts';

const element = { id: 'viewport-div' };
const otherElement = { id: 'other' };

assert.equal(
  shouldReuseStackViewport({ element, type: 'stack', isDisabled: false }, element, 'stack'),
  true
);
assert.equal(shouldReuseStackViewport(null, element, 'stack'), false);
assert.equal(
  shouldReuseStackViewport({ element: otherElement, type: 'stack' }, element, 'stack'),
  false
);
assert.equal(
  shouldReuseStackViewport({ element, type: 'orthographic' }, element, 'stack'),
  false
);
assert.equal(
  shouldReuseStackViewport({ element, type: 'orthographic' }, element, 'orthographic'),
  false
);
assert.equal(
  shouldReuseStackViewport({ element, type: 'stack', isDisabled: true }, element, 'stack'),
  false
);
assert.equal(shouldReuseStackViewport({ element, type: 'stack' }, element, undefined), false);

const imageIds = ['a', 'b'];
const keyMap = new Map([
  ['a', 0],
  ['b', 1],
]);
const defaults = new Map([['a', { invert: true }]]);
const retired: any = {
  csImage: { pixelData: new Int16Array(8) },
  _imageData: { pixels: true },
  cpuImagePixelData: new Int16Array(4),
  imagesLoader: { loadImages() {} },
  imageIds,
  imageKeyToIndexMap: keyMap,
  perImageIdDefaultProperties: defaults,
  _actors: new Map([['actor', {}]]),
  _cpuFallbackEnabledElement: { image: { pixelData: new Int16Array(2) } },
};
releaseRetiredViewport(retired);
assert.equal(retired.csImage, undefined);
assert.equal(retired._imageData, undefined);
assert.equal(retired.cpuImagePixelData, undefined);
assert.equal(retired.imagesLoader, undefined);
assert.deepEqual(retired.imageIds, []);
assert.equal(keyMap.size, 0);
assert.equal(defaults.size, 0);
assert.equal(retired._actors.size, 0);
assert.equal(retired._cpuFallbackEnabledElement.image, undefined);
releaseRetiredViewport(null);

const loads: Record<string, { cancelFn?: unknown } | null> = {
  queued: null,
  inflight: { cancelFn() {} },
  loaded: {},
  bad: { cancelFn: 'nope' },
};
const safe = imageIdsSafeToCancel(['queued', 'inflight', 'loaded', 'missing', 'bad'], id => {
  if (id === 'missing') {
    throw new Error('not in cache');
  }
  return loads[id];
});
assert.deepEqual(safe, ['queued', 'inflight', 'missing']);

console.log('skmViewportReuse.test.ts: all assertions passed');
