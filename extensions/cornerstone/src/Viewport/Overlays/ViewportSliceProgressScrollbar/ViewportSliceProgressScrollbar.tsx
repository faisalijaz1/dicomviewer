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
  // SKM 2026-10-03 (W5): monotonic progress — a slice that was ever loaded stays lit
  // even after the LRU evicts it. Required with windowed decode (studyPrefetcher.
  // windowedPrefetch), where only a window is resident so a live-cache bar would
  // regress as the doctor scrolls. Default on. Set
  // viewportScrollbar.monotonicProgress:false to restore live-cache behaviour.
  const monotonicProgress =
    customizationService.getCustomization('viewportScrollbar.monotonicProgress') !== false;
  // SKM 2026-10-04 (Option B): the "download frontier" — a thin marker showing how far
  // AHEAD of the doctor the background moving-window warmer has downloaded, so the bar
  // communicates the background download position (not just the available range + thumb).
  // Default on; set viewportScrollbar.showDownloadFrontier:false to hide.
  const showDownloadFrontier =
    customizationService.getCustomization('viewportScrollbar.showDownloadFrontier') !== false;
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
    monotonic: monotonicProgress,
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

  // SKM 2026-10-04 (Option B): count of slices already available locally (decoded or
  // byte-warmed) — the "Ready N / total" the radiologist sees in the badge, so background
  // study preparation is visible and non-blocking (not a frozen % or a modal).
  const readyCount = useMemo(() => {
    let count = 0;
    for (let i = 0; i < loadedBytes.length; i++) {
      if (loadedBytes[i]) {
        count++;
      }
    }
    return count;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedVersion, numberOfSlices]);

  const showBadge = isFullMode && showPercentBadge && isLoading;

  // SKM 2026-10-04 (Option B): the furthest contiguously-downloaded slice AHEAD of the
  // doctor's current position — the leading edge of the moving download window. Computed
  // from the same loadedBytes source as the fill, so it never disagrees with it. -1 when
  // there is no meaningful reach ahead (current slice not yet downloaded, or none ahead).
  const downloadFrontier = useMemo(() => {
    if (!numberOfSlices || numberOfSlices <= 1) {
      return -1;
    }
    const cur = imageIndex || 0;
    if (!loadedBytes[cur]) {
      return -1;
    }
    // Leading edge of the contiguous downloaded run on each side of the doctor; the
    // frontier is the further edge (the ahead-biased moving-window side).
    let up = cur;
    while (up + 1 < numberOfSlices && loadedBytes[up + 1]) {
      up++;
    }
    let down = cur;
    while (down - 1 >= 0 && loadedBytes[down - 1]) {
      down--;
    }
    return up - cur >= cur - down ? up : down;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadedVersion is the change
    // signal for the mutable loadedBytes array (same reference each render).
  }, [loadedVersion, imageIndex, numberOfSlices]);

  const showFrontier =
    isFullMode &&
    showDownloadFrontier &&
    downloadFrontier >= 0 &&
    downloadFrontier !== (imageIndex || 0) &&
    numberOfSlices > 1;
  const frontierTopPct = showFrontier ? (downloadFrontier / (numberOfSlices - 1)) * 100 : 0;

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
        // SKM 2026-10-09: RadiAnt-style professional loading indicator.
        //  - POSITION: anchored to the LEFT of the scrollbar (right-[20px]) so the pill's
        //    right edge clears the 11px bar + padding instead of overlapping its top, and
        //    sits cleanly aligned with the top of the scrollbar track.
        //  - COLOR: cyan `highlight` accent replaced with a neutral grey (RadiAnt uses a
        //    greyish/silver fill, not a saturated hue), matching the greyed scrollbar fill
        //    below so the badge + bar still read as ONE cohesive loading system.
        // ORIGINAL (2026-09-29): "absolute right-1 top-1 ... border-highlight/30
        // shadow-[0_0_8px_rgba(90,204,230,0.35)]".
        className="bg-black/75 pointer-events-none absolute right-[20px] top-1 z-20 flex items-center gap-1 rounded-full border border-white/15 px-2 py-0.5 shadow-[0_2px_8px_rgba(0,0,0,0.5)] backdrop-blur-sm transition-all duration-300 ease-out"
        style={{
          opacity: showBadge ? 1 : 0,
          transform: showBadge ? 'translateY(0)' : 'translateY(-4px)',
        }}
      >
        <Icons.LoadingSpinner className="h-2.5 w-2.5 shrink-0 text-neutral-300" />
        {/* SKM 2026-10-04 (Option B): show the READY RANGE (available/total) + %, so the
            radiologist sees background preparation advancing. Non-blocking, corner-anchored. */}
        <span className="text-[10px] font-semibold leading-none text-white [font-variant-numeric:tabular-nums]">
          {readyCount}/{numberOfSlices} · {loadedPercent}%
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
              // SKM 2026-09-29: was a flat, low-contrast `bg-neutral/25`/`/50`
              // (a desaturated grey) — barely visible against the near-black
              // viewport and read as "unfinished" rather than "clinically
              // minimal." Replaced with the app's OWN existing accent color
              // (`highlight`, #5ACCE6 — the same cyan already used for the
              // active-tool toolbar icons and this scrollbar's percentage
              // badge spinner), not a new hue, so it stays consistent with the
              // rest of the UI. A soft glow (box-shadow) gives it presence;
              // the actively-downloading edge pulses (`animate-pulse`) to
              // signal live work via MOTION rather than a color change —
              // deliberately NOT a red→yellow→green progression, which would
              // clash with color's clinical meaning elsewhere (alerts,
              // flags, segmentation overlays) and risk a split-second
              // "is that a warning?" read next to grayscale anatomy.
              // ORIGINAL: className="bg-neutral/25" loadingClassName="bg-neutral/50"
              // SKM 2026-10-09: RadiAnt-style greyish/silver fill. The cyan `highlight`
              // (#5ACCE6) read as too saturated against the grayscale anatomy; RadiAnt uses a
              // neutral light-grey loaded indicator. Resident range = soft grey; the actively-
              // downloading edge is a brighter grey that pulses (motion signals live work, not a
              // colour change). ORIGINAL: "bg-highlight/35 shadow-[...90,204,230...]" /
              // "bg-highlight/60 ... animate-pulse".
              <SmartScrollbarFill
                marked={loadedBytes}
                version={loadedVersion}
                className="bg-[rgba(200,200,200,0.40)] shadow-[0_0_4px_rgba(200,200,200,0.20)]"
                loadingClassName="bg-[rgba(224,224,224,0.75)] shadow-[0_0_6px_rgba(224,224,224,0.40)] animate-pulse"
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
        {/*
          SKM 2026-10-04 (Option B): download-frontier marker — a thin bright line at the
          leading edge of the contiguous downloaded run ahead of the doctor, i.e. "the
          background warmer has downloaded up to here." Distinct from the available-range
          fill (cyan block) and the position thumb. pointer-events-none so it never
          intercepts a scrollbar drag. TO REVERT: delete this block + the showFrontier/
          downloadFrontier calc + the showDownloadFrontier customization.
        */}
        {showFrontier && (
          <div
            aria-hidden
            className="pointer-events-none absolute left-0 right-0 z-10"
            style={{
              top: `${frontierTopPct}%`,
              height: '2px',
              transform: 'translateY(-1px)',
              // SKM 2026-10-09: greyed to match the RadiAnt-style grey fill (was cyan
              // rgba(90,204,230)). Brighter than the resident fill so the frontier still stands out.
              background: 'rgba(235,235,235,0.95)',
              boxShadow: '0 0 6px 1px rgba(235,235,235,0.7)',
              borderRadius: '1px',
              transition: 'top 150ms ease-out',
            }}
          />
        )}
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
