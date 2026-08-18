import { getRenderingEngine, utilities } from '@cornerstonejs/core';

/**
 * "Manual" sync mode: keeps viewports locked to the same plain image index
 * (1st image scrolls together with 1st image, 2nd with 2nd, etc.) regardless
 * of 3D position - unlike the position-based imageSliceSyncCallback (RadiAnt's
 * "auto" sync), this ignores ImagePositionPatient entirely. Useful when
 * series have different slice counts/spacing but the user just wants simple
 * parallel scrolling.
 */
export default async function imageIndexSyncCallback(synchronizerInstance, sourceViewport, targetViewport) {
  const renderingEngine = getRenderingEngine(targetViewport.renderingEngineId);
  if (!renderingEngine) {
    throw new Error(`No RenderingEngine for Id: ${targetViewport.renderingEngineId}`);
  }

  const options = synchronizerInstance.getOptions(targetViewport.viewportId);
  if (options?.disabled) {
    return;
  }

  const sViewport = renderingEngine.getViewport(sourceViewport.viewportId);
  const tViewport = renderingEngine.getViewport(targetViewport.viewportId);

  if (!sViewport?.getCurrentImageIdIndex || !tViewport?.getImageIds) {
    return;
  }

  const sourceIndex = sViewport.getCurrentImageIdIndex();
  const targetImageIds = tViewport.getImageIds();

  if (!targetImageIds?.length) {
    return;
  }

  const clampedIndex = Math.min(sourceIndex, targetImageIds.length - 1);

  if (clampedIndex >= 0 && tViewport.getCurrentImageIdIndex() !== clampedIndex) {
    await utilities.jumpToSlice(tViewport.element, { imageIndex: clampedIndex });
  }
}
