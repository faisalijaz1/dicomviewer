import { Enums } from '@cornerstonejs/core';
import { SynchronizerManager } from '@cornerstonejs/tools';
import imageIndexSyncCallback from './imageIndexSyncCallback';

const { STACK_NEW_IMAGE, VOLUME_NEW_IMAGE } = Enums.Events;

/**
 * "Manual" (index-based) counterpart to cornerstone3d's own
 * createImageSliceSynchronizer, which is always position-based. See
 * imageIndexSyncCallback for the behavioral difference.
 */
export default function createImageIndexSynchronizer(synchronizerName: string) {
  return SynchronizerManager.createSynchronizer(synchronizerName, STACK_NEW_IMAGE, imageIndexSyncCallback, {
    auxiliaryEvents: [{ name: VOLUME_NEW_IMAGE }],
  });
}
