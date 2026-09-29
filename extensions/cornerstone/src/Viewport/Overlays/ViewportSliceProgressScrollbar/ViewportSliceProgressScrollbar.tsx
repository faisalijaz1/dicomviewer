import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import { VolumeViewport3D, utilities as csUtils } from '@cornerstonejs/core';
import {
  SmartScrollbar,
  SmartScrollbarTrack,
  SmartScrollbarFill,
  SmartScrollbarIndicator,
  SmartScrollbarEndpoints,
  Icons,
} from '@ohif/ui-next';
import { getViewportImageIds } from './helpers';
import {
  useLoadedSliceBytes,
  useProgressScrollbarMode,
  useViewedSliceBytes,
  useViewportSliceSync,
} from './hooks';
import { ViewportSliceProgressScrollbarProps } from './types';

function ViewportSliceProgressScrollbar({
  viewportData,
  viewportId,
  element,
  imageSliceData,
  setImageSliceData,
  servicesManager,
}: ViewportSliceProgressScrollbarProps) {
  const { cineService, cornerstoneViewportService, customizationService, viewedDataService } =
    servicesManager.services;

  const showLoadedEndpoints =
    customizationService.getCustomization('viewportScrollbar.showLoadedEndpoints') !== false;
  const showLoadedFill =
    customizationService.getCustomization('viewportScrollbar.showLoadedFill') !== false;
  const showViewedFill =
    customizationService.getCustomization('viewportScrollbar.showViewedFill') !== false;
  const showLoadingPattern =
    customizationService.getCustomization('viewportScrollbar.showLoadingPattern') !== false;
  const viewedDwellMsRaw = customizationService.getCustomization('viewportScrollbar.viewedDwellMs');
  const loadedBatchIntervalMsRaw = customizationService.getCustomization(
    'viewportScrollbar.loadedBatchIntervalMs'
  );
  // SKM 2026-09-29: percentage badge on this (the ACCURATE, per-slice-bytes)
  // scrollbar, replacing the removed horizontal footer bar's percentage — see
  // ViewerLayout/index.tsx. Same on/off convention as the other
  // viewportScrollbar.* toggles above/below. Default on.
  const showPercentBadge =
    customizationService.getCustomization('viewportScrollbar.showPercentBadge') !== false;
  const viewedDwellMs =
    typeof viewedDwellMsRaw === 'number' && viewedDwellMsRaw >= 0 ? viewedDwellMsRaw : 0;
  const loadedBatchIntervalMs =
    typeof loadedBatchIntervalMsRaw === 'number' && loadedBatchIntervalMsRaw >= 0
      ? loadedBatchIntervalMsRaw
      : 200;

  const { numberOfSlices, imageIndex } = imageSliceData;

  const imageIds = useMemo(() => getViewportImageIds(viewportData), [viewportData]);
  const imageIdToIndex = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < imageIds.length; i++) {
      const imageId = imageIds[i];
      if (imageId) {
        map.set(imageId, i);
      }
    }
    return map;
  }, [imageIds]);

  const isFullMode = useProgressScrollbarMode({
    viewportData,
    viewportId,
    element,
    cornerstoneViewportService,
  });

  useViewportSliceSync({
    viewportData,
    viewportId,
    element,
    cornerstoneViewportService,
    setImageSliceData,
  });

  const {
    bytes: loadedBytes,
    version: loadedVersion,
    isFull: isFullyLoaded,
  } = useLoadedSliceBytes({
    isFullMode,
    numberOfSlices,
    viewportData,
    imageIds,
    imageIdToIndex,
    loadedBatchIntervalMs,
  });

  const { bytes: viewedBytes, version: viewedVersion } = useViewedSliceBytes({
    isFullMode,
    numberOfSlices,
    imageIndex,
    imageIds,
    imageIdToIndex,
    viewedDwellMs,
    viewedDataService,
  });

  const onScrollbarValueChange = targetImageIndex => {
    const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);

    if (!viewport || viewport instanceof VolumeViewport3D) {
      return;
    }

    const { isCineEnabled } = cineService.getState();

    if (isCineEnabled) {
      cineService.stopClip(element, { viewportId });
      cineService.setCine({ id: viewportId, frameRate: undefined, isPlaying: false });
    }

    csUtils.jumpToSlice(viewport.element, {
      imageIndex: targetImageIndex,
      debounceLoading: true,
    });
  };

  const isLoading = isFullMode && showLoadingPattern ? !isFullyLoaded : false;

  // SKM 2026-09-29: real loaded-slice percentage, summed from the same
  // per-slice loadedBytes byte-array this scrollbar's fill already tracks
  // (see useLoadedSliceBytes) — not an estimate, the identical source of
  // truth as the fill/endpoints. O(numberOfSlices), trivial at DICOM series
  // sizes; only recomputed when the underlying bytes actually change
  // (loadedVersion bumps on write, batched by loadedBatchIntervalMs).
  const loadedPercent = useMemo(() => {
    if (!numberOfSlices) {
      return 0;
    }
    let count = 0;
    for (let i = 0; i < loadedBytes.length; i++) {
      if (loadedBytes[i]) {
        count++;
      }
    }
    return Math.round((count / numberOfSlices) * 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadedVersion is the
    // change signal for the mutable loadedBytes array; including loadedBytes
    // itself would be a no-op dependency (same array reference every render).
  }, [loadedVersion, numberOfSlices]);

  const showBadge = isFullMode && showPercentBadge && isLoading;

  if (!numberOfSlices || numberOfSlices <= 1) {
    return null;
  }

  return (
    <div
      style={{
        position: 'absolute',
        right: 0,
        top: 0,
        height: '100%',
        padding: '8px 5px',
        zIndex: 10,
      }}
    >
      {/*
        SKM 2026-09-29: real-time loaded-percentage badge, anchored to the
        scrollbar's own top corner — deliberately corner-positioned, not
        centred or overlaid on the image, so it never competes with the slice
        the doctor is reading. It is the ONE progress indicator in the app now
        (the horizontal footer bar was removed — see ViewerLayout/index.tsx)
        and reads from the exact same loadedBytes source as the fill below it,
        so what it says and what the bar shows can never disagree.

        Always mounted (visibility via opacity + a slight upward slide, not
        conditional render) so it fades in/out smoothly instead of popping —
        this is most of the "polish" difference between a functional indicator
        and one that feels considered. pointer-events-none keeps it fully
        inert so it can never intercept a click/drag on the viewport under it.

        TO REVERT: delete this block and the showBadge/loadedPercent
        calculations above, and the `viewportScrollbar.showPercentBadge`
        customization key.
      */}
      <div
        aria-hidden={!showBadge}
        className="bg-black/75 shadow-black/60 pointer-events-none absolute right-1 top-1 z-20 flex items-center gap-1 rounded-full border border-white/10 px-2 py-0.5 shadow-lg backdrop-blur-sm transition-all duration-300 ease-out"
        style={{
          opacity: showBadge ? 1 : 0,
          transform: showBadge ? 'translateY(0)' : 'translateY(-4px)',
        }}
      >
        <Icons.LoadingSpinner className="text-highlight h-2.5 w-2.5 shrink-0" />
        <span className="text-[10px] font-semibold leading-none text-white [font-variant-numeric:tabular-nums]">
          {loadedPercent}%
        </span>
      </div>
      <div
        style={{
          position: 'relative',
          height: '100%',
          width: '11px',
        }}
      >
        <SmartScrollbar
          className="absolute inset-0"
          value={imageIndex || 0}
          total={numberOfSlices}
          onValueChange={onScrollbarValueChange}
          isLoading={isLoading}
          enableKeyboardNavigation={false}
          aria-label="Image navigation scrollbar"
          indicator={
            customizationService.getCustomization('viewportScrollbar.indicator') as
              | Record<string, unknown>
              | undefined
          }
        >
          <SmartScrollbarTrack>
            {isFullMode && showLoadedFill && (
              <SmartScrollbarFill
                marked={loadedBytes}
                version={loadedVersion}
                className="bg-neutral/25"
                loadingClassName="bg-neutral/50"
              />
            )}
            {isFullMode && showViewedFill && (
              <SmartScrollbarFill
                marked={viewedBytes}
                version={viewedVersion}
                className="bg-primary/35"
                loadingClassName="bg-primary/35"
              />
            )}
          </SmartScrollbarTrack>
          <SmartScrollbarIndicator />
          {isFullMode && showLoadedEndpoints && (
            <SmartScrollbarEndpoints
              marked={loadedBytes}
              version={loadedVersion}
            />
          )}
        </SmartScrollbar>
      </div>
    </div>
  );
}

ViewportSliceProgressScrollbar.propTypes = {
  viewportData: PropTypes.object,
  viewportId: PropTypes.string.isRequired,
  element: PropTypes.instanceOf(Element),
  imageSliceData: PropTypes.object.isRequired,
  setImageSliceData: PropTypes.func.isRequired,
  servicesManager: PropTypes.object.isRequired,
};

export default ViewportSliceProgressScrollbar;
