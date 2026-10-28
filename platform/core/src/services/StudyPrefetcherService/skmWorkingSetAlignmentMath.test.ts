/**
 * Runnable without Jest:
 *   node --experimental-strip-types platform/core/src/services/StudyPrefetcherService/skmWorkingSetAlignmentMath.test.ts
 */
import assert from 'node:assert/strict';
import {
  alignedPrefetchWindow,
  perViewportKeepSlices,
} from './skmWorkingSetAlignmentMath.ts';

{
  // Two distinct series, two stack viewports: each series is one pane, but the
  // evictor splits the keep budget across both viewports. Prefetch must use 2.
  const window = alignedPrefetchWindow({
    configuredAhead: 3002,
    configuredBehind: 1616,
    panesShowingThisSeries: 1,
    openStackViewports: 2,
    immediateRadius: 15,
  });
  assert.equal(window.divisor, 2);
  assert.equal(window.ahead, 1501);
  assert.equal(window.behind, 808);
  const keepPerPane = perViewportKeepSlices(3002 + 1616, 2);
  assert.ok(window.ahead + window.behind <= keepPerPane);
}

{
  // Same series in both panes already divided by 2. Do not divide again.
  const window = alignedPrefetchWindow({
    configuredAhead: 3000,
    configuredBehind: 1600,
    panesShowingThisSeries: 2,
    openStackViewports: 2,
    immediateRadius: 15,
  });
  assert.equal(window.divisor, 2);
  assert.equal(window.ahead, 1500);
  assert.equal(window.behind, 800);
}

{
  const window = alignedPrefetchWindow({
    configuredAhead: 1100,
    configuredBehind: 580,
    panesShowingThisSeries: 1,
    openStackViewports: 1,
    immediateRadius: 15,
  });
  assert.equal(window.divisor, 1);
  assert.equal(window.ahead, 1100);
  assert.equal(window.behind, 580);
}

console.log('skmWorkingSetAlignmentMath.test.ts: all assertions passed');
