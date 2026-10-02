import OHIF, { errorHandler } from '@ohif/core';
import React from 'react';
import { vec3 } from 'gl-matrix';

import * as cornerstone from '@cornerstonejs/core';
import * as cornerstoneTools from '@cornerstonejs/tools';
import {
  init as cs3DInit,
  eventTarget,
  EVENTS,
  metaData,
  volumeLoader,
  imageLoadPoolManager,
  getEnabledElement,
  Settings,
  utilities as csUtilities,
} from '@cornerstonejs/core';
import {
  cornerstoneStreamingImageVolumeLoader,
  cornerstoneStreamingDynamicImageVolumeLoader,
} from '@cornerstonejs/core/loaders';

import RequestTypes from '@cornerstonejs/core/enums/RequestType';

import initWADOImageLoader from './initWADOImageLoader';
import initCornerstoneTools from './initCornerstoneTools';

import { connectToolsToMeasurementService } from './initMeasurementService';
import initCineService from './initCineService';
import initStudyPrefetcherService from './initStudyPrefetcherService';
// SKM-BULK 2026-09-28 (Fix 3): batch pixel retrieval to collapse ~2001 per-slice
// round-trips into ~40 chunk requests. Gated by appConfig.skmBulkLoader.enabled.
import { registerSkmBulkImageLoader, initSkmBulkDriver } from './skmBulkImageLoader';
import interleaveCenterLoader from './utils/interleaveCenterLoader';
import nthLoader from './utils/nthLoader';
import interleaveTopToBottom from './utils/interleaveTopToBottom';
import initContextMenu from './initContextMenu';
import initDoubleClick from './initDoubleClick';
import initViewTiming from './utils/initViewTiming';
import { colormaps } from './utils/colormaps';
import {
  findNearestPlaneIndex,
  computeVolumeFocalPointShift,
  type StackPlaneCandidate,
} from './utils/radiant3DCursorNavigation';
import { SegmentationRepresentations } from '@cornerstonejs/tools/enums';
import { useLutPresentationStore } from './stores/useLutPresentationStore';
import { usePositionPresentationStore } from './stores/usePositionPresentationStore';
import { useSegmentationPresentationStore } from './stores/useSegmentationPresentationStore';
import { imageRetrieveMetadataProvider } from '@cornerstonejs/core/utilities';
import { initializeWebWorkerProgressHandler } from './utils/initWebWorkerProgressHandler';
import computeRobustVOIRange from './utils/computeRobustVOIRange';
import { hasRealSUVData, applyRobustPTVolumeVOI } from './utils/applyRobustPTVolumeVOI';

const { registerColormap } = csUtilities.colormap;

// TODO: Cypress tests are currently grabbing this from the window?
(window as any).cornerstone = cornerstone;
(window as any).cornerstoneTools = cornerstoneTools;
/**
 *
 */
export default async function init({
  servicesManager,
  commandsManager,
  extensionManager,
  appConfig,
}: withAppTypes): Promise<void> {
  // Use a public library path of PUBLIC_URL plus the component name
  // This safely separates components that are loaded as-is.
  window.PUBLIC_LIB_URL ||= './${component}/';

  // Note: this should run first before initializing the cornerstone
  // DO NOT CHANGE THE ORDER

  await cs3DInit({
    peerImport: appConfig.peerImport,
  });

  // For debugging e2e tests that are failing on CI
  cornerstone.setUseCPURendering(Boolean(appConfig.useCPURendering));

  // cornerstone3D's volume/MPR loading path automatically pre-scales PT
  // pixel data (rescale slope/intercept + the SUV scalingModule computed by
  // handleScalingModules in extensions/default/src/init.ts) before it ever
  // reaches the renderer - see BaseStreamingImageVolume.js's
  // getLoaderImageOptions(). Its plain 2D StackViewport counterpart
  // (RenderingEngine/StackViewport.js's own getLoaderImageOptions) does
  // NOT do this - it hardcodes { useRGBA, transferSyntaxUID, priority,
  // requestType } with no preScale field at all, for every modality. A PT
  // series viewed as a plain stack (outside fusion/MPR) therefore displays
  // raw, unscaled pixel counts - window/level in the tens of thousands
  // instead of a sane SUV range, rendering as a flat, low-contrast image.
  // There's no public config hook for this, so patch the one method
  // responsible for building per-image load options, mirroring exactly
  // what the volume path already does. Only PT/RTDOSE are touched; every
  // other modality's options pass through unchanged.
  const originalGetLoaderImageOptions = cornerstone.StackViewport.prototype.getLoaderImageOptions;
  cornerstone.StackViewport.prototype.getLoaderImageOptions = function (imageId: string) {
    const options = originalGetLoaderImageOptions.call(this, imageId);

    const generalSeriesModule = metaData.get('generalSeriesModule', imageId) || {};
    const modality = generalSeriesModule.modality;

    if (modality === 'PT' || modality === 'RTDOSE') {
      const scalingFactor = metaData.get('scalingModule', imageId);
      if (scalingFactor) {
        const modalityLutModule = metaData.get('modalityLutModule', imageId) || {};
        options.preScale = {
          enabled: true,
          scalingParameters: {
            rescaleSlope: modalityLutModule.rescaleSlope,
            rescaleIntercept: modalityLutModule.rescaleIntercept,
            modality,
            ...scalingFactor,
          },
        };
      }
    }

    return options;
  };

  // Even with the preScale patch above, this hospital's real PACS data
  // very commonly has NO usable SUV metadata at all (PatientWeight,
  // RadionuclideTotalDose etc missing - getPTImageIdInstanceMetadata logs
  // "required PET SUV metadata are missing" for these series, seen for
  // essentially every instance of some real studies) - so the pixel data
  // stays raw scanner counts, which can run into the tens of thousands.
  // cornerstone3D's own auto-VOI then windows to the literal min/max of
  // that raw data, and a handful of extreme outlier voxels (noise, dense
  // implants, edge-of-FOV counts) is enough to wash out or invert the
  // entire visible image - exactly the "PT image is a blown-out white
  // blob" / "fusion overlay is scattered red noise" symptom seen live.
  // Once SUV metadata truly isn't available, fall back to a percentile-
  // based window computed from the image/volume's own real pixel data
  // instead - covers both plain PT stack viewing (STACK_NEW_IMAGE) and
  // volume viewports like the PET/CT Fusion viewport (VOLUME_LOADED). A
  // volume viewport can hold multiple actors (CT + PT in fusion) with
  // independent VOIs, so this only ever touches the PT one, by volumeId.
  document.addEventListener(
    EVENTS.STACK_NEW_IMAGE,
    (evt: CustomEvent) => {
      const { image, viewportId, renderingEngineId } = evt.detail || {};
      if (!image?.imageId || !viewportId) {
        return;
      }
      const generalSeriesModule = metaData.get('generalSeriesModule', image.imageId) || {};
      if (generalSeriesModule.modality !== 'PT' || hasRealSUVData(image.imageId)) {
        return;
      }
      const scalarData = image.voxelManager?.getScalarData?.();
      const range = computeRobustVOIRange(scalarData);
      if (!range) {
        return;
      }
      const renderingEngine = cornerstone.getRenderingEngine(renderingEngineId);
      const viewport = renderingEngine?.getViewport(viewportId);
      viewport?.setProperties?.({ voiRange: range });
      viewport?.render?.();
    },
    true // capture phase - this cornerstone event does not bubble
  );

  // hasRealSUVData/applyRobustPTVolumeVOI extracted to
  // ./utils/applyRobustPTVolumeVOI.ts so extensions/cornerstone's
  // toggleFusion command can reuse the exact same raw-count fallback
  // logic instead of blindly applying the SUV-0-5-calibrated default.
  eventTarget.addEventListener(EVENTS.VOLUME_LOADED, (evt: CustomEvent) => {
    const volume = evt.detail?.volume;
    const firstImageId = volume?.imageIds?.[0];
    if (!firstImageId || volume.metadata?.Modality !== 'PT' || hasRealSUVData(firstImageId)) {
      return;
    }
    applyRobustPTVolumeVOI(volume, 15);
  });

  // Pulled out early (rather than in the bigger servicesManager.services
  // destructure further down) because the RadiAnt 3D Cursor gesture
  // handling immediately below needs both at setup time, not just inside
  // deferred callbacks.
  const { cineService, toolGroupService } = servicesManager.services;

  // Tracked for the temporary-vs-permanent 3D Cursor gesture handling
  // below (RadiAnt: Ctrl+Shift+Click is a momentary "where does this
  // correspond to" check that disappears on mouse-up; Q permanently
  // assigns it to the left mouse button, and that placement stays).
  let lastSimpleCrosshairAnnotationUID: string | null = null;

  // RadiAnt 3D Cursor manual: "Reference lines are temporarily hidden when
  // the 3D Cursor is active." Tracks which tool groups had ReferenceLines
  // enabled and got disabled for the duration of the current
  // click-or-drag gesture, so mouseup can restore exactly those (and only
  // those - a tool group that already had reference lines off stays off).
  const referenceLinesDisabledByCrosshair = new Set<string>();

  function hideReferenceLinesForCrosshairGesture() {
    toolGroupService?.getToolGroupIds().forEach(toolGroupId => {
      if (referenceLinesDisabledByCrosshair.has(toolGroupId)) {
        return;
      }
      const toolGroup = toolGroupService.getToolGroup(toolGroupId);
      if (!toolGroup?.hasTool('ReferenceLines')) {
        return;
      }
      if (toolGroup.getToolOptions('ReferenceLines').mode === cornerstoneTools.Enums.ToolModes.Enabled) {
        toolGroup.setToolDisabled('ReferenceLines');
        referenceLinesDisabledByCrosshair.add(toolGroupId);
      }
    });
  }

  function restoreReferenceLinesAfterCrosshairGesture() {
    if (!referenceLinesDisabledByCrosshair.size) {
      return;
    }
    referenceLinesDisabledByCrosshair.forEach(toolGroupId => {
      const toolGroup = toolGroupService.getToolGroup(toolGroupId);
      toolGroup?.setToolEnabled('ReferenceLines');
    });
    referenceLinesDisabledByCrosshair.clear();
    cornerstone.getRenderingEngines().forEach(engine => engine.render());
  }

  // RadiAnt 3D Cursor manual: "When Cine mode is enabled, the 3D Cursor
  // cannot be activated." Disable the SimpleCrosshair tool (both the
  // Ctrl+Shift+Click binding and the Q-toggled Primary binding go through
  // the same tool instance, so disabling it blocks both) whenever cine
  // turns on for any viewport, and restore it - back to whatever mode it
  // was actually in (Enabled if Q had toggled it active, else Disabled) -
  // when cine turns back off.
  let simpleCrosshairDisabledByCine = false;
  cineService?.subscribe(cineService.EVENTS.CINE_STATE_CHANGED, ({ isCineEnabled }) => {
    if (isCineEnabled === undefined) {
      return;
    }
    toolGroupService?.getToolGroupIds().forEach(toolGroupId => {
      const toolGroup = toolGroupService.getToolGroup(toolGroupId);
      if (!toolGroup?.hasTool('SimpleCrosshair')) {
        return;
      }
      if (isCineEnabled) {
        if (toolGroup.getToolOptions('SimpleCrosshair').mode !== cornerstoneTools.Enums.ToolModes.Disabled) {
          toolGroup.setToolDisabled('SimpleCrosshair');
          simpleCrosshairDisabledByCine = true;
        }
      } else if (simpleCrosshairDisabledByCine) {
        // SimpleCrosshair is an Active-mode (mouse-bound) tool, unlike
        // ReferenceLines above - setToolActive() with no explicit bindings
        // reuses whatever bindings were already configured for it
        // (Ctrl+Shift+Primary always, plus plain Primary if Q had
        // toggled it there), it does not reset them.
        toolGroup.setToolActive('SimpleCrosshair');
      }
    });
    if (!isCineEnabled) {
      simpleCrosshairDisabledByCine = false;
    }
  });

  // RadiAnt-style "3D Cursor": placing/dragging the SimpleCrosshair point
  // (Q hotkey or Ctrl+Shift+Click, see modes/basic/src/initToolGroups.ts)
  // used to only draw a marker on the viewport it was placed in, plus a
  // passive dim indicator on any OTHER open viewport that already
  // happened to be sitting on a nearby slice - it never actually MOVED
  // those other viewports. RadiAnt's real 3D cursor drives every other
  // open, spatially-related viewport to re-slice/scroll to that same
  // physical point live as you click or drag - this is what actually
  // makes it useful for cross-referencing a finding across planes/series,
  // and what was missing. Every other viewport sharing the SAME
  // FrameOfReferenceUID as the one the point was placed in gets moved to
  // pass through that exact 3D position: a volume viewport re-slices via
  // its camera focal point; a stack viewport jumps to whichever of its
  // own images has a slice plane closest to that point.
  // ProbeTool (which SimpleCrosshair extends) only fires ANNOTATION_MODIFIED
  // when repositioning an ALREADY-PLACED point in a later interaction - the
  // very first click-drag-place of a brand new point instead fires
  // ANNOTATION_COMPLETED on mouseup (see ProbeTool's addNewAnnotation/
  // _dragCallback/_endCallback: _dragCallback only triggers a render, never
  // triggerAnnotationModified; _endCallback calls triggerAnnotationCompleted
  // for a newAnnotation). Listening only for MODIFIED meant this whole
  // handler - both the cross-viewport re-slicing and the
  // lastSimpleCrosshairAnnotationUID tracking the momentary-removal logic
  // below depends on - silently never ran on someone's first Ctrl+Shift+
  // Click/Q-placement, only on a second, separate drag of that same point.
  const handleSimpleCrosshairMovedOrPlaced = (evt: CustomEvent) => {
    const { annotation, viewportId: sourceViewportId } = evt.detail || {};
    if (annotation?.metadata?.toolName !== 'SimpleCrosshair') {
      return;
    }
    lastSimpleCrosshairAnnotationUID = annotation.annotationUID;
    hideReferenceLinesForCrosshairGesture();
    const worldPos = annotation.data?.handles?.points?.[0];
    const frameOfReferenceUID = annotation.metadata?.FrameOfReferenceUID;
    if (!worldPos || !frameOfReferenceUID) {
      return;
    }

      cornerstone.getRenderingEngines().forEach(renderingEngine => {
        renderingEngine.getViewports().forEach(viewport => {
          if (viewport.id === sourceViewportId) {
            return;
          }
          if (viewport.getFrameOfReferenceUID?.() !== frameOfReferenceUID) {
            return;
          }

          if (viewport instanceof cornerstone.BaseVolumeViewport) {
            // Shift focalPoint/position together by the delta to the
            // clicked point, PROJECTED onto this viewport's own
            // viewPlaneNormal - moves it along its own slice direction
            // only, so it lands on the slice containing the clicked point
            // without panning its in-plane view sideways. Matches
            // cornerstone-tools' own CrosshairsTool
            // (_applyDeltaShiftToViewportCamera) exactly - see
            // computeVolumeFocalPointShift's unit tests for the math.
            const camera = viewport.getCamera();
            if (!camera.focalPoint || !camera.position || !camera.viewPlaneNormal) {
              // Missing camera geometry - nothing sensible to navigate to.
              return;
            }
            const { focalPoint, position } = computeVolumeFocalPointShift(worldPos, {
              focalPoint: camera.focalPoint,
              position: camera.position,
              viewPlaneNormal: camera.viewPlaneNormal,
            });
            viewport.setCamera({ focalPoint, position });
            viewport.render();
            return;
          }

          const imageIds = viewport.getImageIds?.();
          if (!imageIds?.length || typeof viewport.setImageIdIndex !== 'function') {
            return;
          }

          const candidates: StackPlaneCandidate[] = [];
          for (let i = 0; i < imageIds.length; i++) {
            const imagePlaneModule = metaData.get('imagePlaneModule', imageIds[i]);
            const ipp = imagePlaneModule?.imagePositionPatient;
            const rowCosines = imagePlaneModule?.rowCosines;
            const columnCosines = imagePlaneModule?.columnCosines;
            if (!ipp || !rowCosines || !columnCosines) {
              continue;
            }
            const normal = vec3.cross(vec3.create(), rowCosines, columnCosines);
            candidates.push({ index: i, origin: ipp, normal: normal as [number, number, number] });
          }

          const nearest = findNearestPlaneIndex(worldPos, candidates);
          if (nearest && nearest.index !== viewport.getCurrentImageIdIndex?.()) {
            viewport.setImageIdIndex(nearest.index);
          }
        });
      });
  };

  // Cornerstone3D's annotation events (ANNOTATION_COMPLETED/MODIFIED) are
  // dispatched on ITS OWN standalone `eventTarget` (see
  // @cornerstonejs/tools' triggerAnnotationCompleted/triggerAnnotationModified,
  // both call triggerEvent(eventTarget, ...) from @cornerstonejs/core) -
  // NOT on the browser `document`. A `document.addEventListener` for these
  // (as this used to be) silently never fires; confirmed live with the
  // 3D Cursor gesture never completing. `eventTarget` has no DOM tree, so
  // "capture phase" doesn't apply here - listeners just run in registration
  // order when it dispatches. Both event types run the exact same handler
  // (see the comment above it) - COMPLETED covers the initial placement,
  // MODIFIED covers repositioning an already-placed point in a later
  // interaction.
  eventTarget.addEventListener(
    cornerstoneTools.Enums.Events.ANNOTATION_COMPLETED,
    handleSimpleCrosshairMovedOrPlaced
  );
  eventTarget.addEventListener(
    cornerstoneTools.Enums.Events.ANNOTATION_MODIFIED,
    handleSimpleCrosshairMovedOrPlaced
  );

  // RadiAnt 3D Cursor is a TEMPORARY point-correlation gesture, full stop -
  // it disappears on mouse-up regardless of how it was activated. Q assigns
  // the tool to the plain Primary mouse button (so you don't have to hold
  // Ctrl+Shift every time), it does NOT make the rendered marker persist
  // after release - "permanently assigning the tool means permanently
  // assigning the mouse binding, not permanently rendering the crosshair."
  // (An earlier revision of this handler kept the marker on screen for
  // Q-toggled placements, which was wrong - fixed here.)
  document.addEventListener(
    'mouseup',
    () => {
      // This listener is registered on `document` in the CAPTURE phase, so
      // it runs on the way DOWN to the target element - i.e. BEFORE
      // cornerstone3D's own target/bubble-phase mouseup handling for this
      // same native event, which is what finalizes the annotation and
      // fires ANNOTATION_COMPLETED/ANNOTATION_MODIFIED (see
      // handleSimpleCrosshairMovedOrPlaced above). Reading
      // lastSimpleCrosshairAnnotationUID synchronously here would race that
      // finalization and see it still null/stale on a brand new
      // placement's first drag. Deferring the whole read+decision (not
      // just the removal call) to a follow-up macrotask lets that same
      // native mouseup event finish propagating - and cornerstone's own
      // handling with it - first.
      setTimeout(() => {
        if (lastSimpleCrosshairAnnotationUID) {
          cornerstoneTools.annotation.state.removeAnnotation(lastSimpleCrosshairAnnotationUID);
          lastSimpleCrosshairAnnotationUID = null;
          cornerstone.getRenderingEngines().forEach(engine => engine.render());
        }
      }, 0);
      // Restores reference lines whenever a SimpleCrosshair drag ends.
      restoreReferenceLinesAfterCrosshairGesture();
    },
    true
  );

  cornerstone.setConfiguration({
    ...cornerstone.getConfiguration(),
    rendering: {
      ...cornerstone.getConfiguration().rendering,
      strictZSpacingForVolumeViewport: appConfig.strictZSpacingForVolumeViewport,
    },
  });

  // ── SKM 2026-09-28 (OOM guard) ──────────────────────────────────────────
  // Cap the Cornerstone image/volume cache at the SMALLER of the configured
  // value and a fraction of THIS workstation's RAM. A fixed 2 GB cap crashes
  // low-memory clients (e.g. a 16 GB box already at ~97% from other clinical
  // apps, leaving <1 GB free) when a huge CT is opened: decoded pixels + tab +
  // GPU overhead exceed physical RAM → tab OOM. Scaling to the device keeps our
  // footprint safe, and LRU eviction then plateaus memory instead of climbing
  // to a crash. navigator.deviceMemory is coarse (0.25..8, capped at 8 even on
  // bigger machines), so 20% of it is a conservative budget.
  // TO REVERT: replace this whole block with
  //   const { maxCacheSize } = appConfig;
  //   if (maxCacheSize) cornerstone.cache.setMaxCacheSize(maxCacheSize);
  let effectiveCacheSize = appConfig.maxCacheSize;
  try {
    const gb = 1024 * 1024 * 1024;
    // SKM 2026-09-30: scale the cache to THIS machine so weak boxes don't OOM and
    // strong boxes aren't starved — auto-adjusts per system with no per-machine
    // config. navigator.deviceMemory is coarse (0.25..8 on some browsers, actual on
    // others), so we scale PROPORTIONALLY and clamp on both ends:
    //   budget = clamp( 30% of reported RAM , 1 GB floor , configured ceiling )
    //   4 GB → 1.2 GB · 8 GB → 2.4 GB · 16 GB → 4.8 GB · ≥17 GB → 5 GB (ceiling)
    // The 1 GB floor stops large studies from thrashing on a small/under-reported
    // box; the configured maxCacheSize is the hard ceiling for the fleet. Safe to
    // size generously: cornerstone only holds what a study actually needs, so the
    // cap only bites once a study would exceed it (then a bigger cap avoids churn).
    // TO REVERT: `effectiveCacheSize = appConfig.maxCacheSize;` (no scaling).
        const deviceMemGb = (navigator as any).deviceMemory || 4;
    // SKM-FIX: Chrome hard-caps navigator.deviceMemory at 8. 
    // This means a 16GB Resident PC and a 32GB Consultant PC BOTH report "8".
    // If we apply the 30% rule to 8GB, they both get clamped to a tiny 2.4GB cache, 
    // which instantly throws CACHE_SIZE_EXCEEDED when opening multiple series!
    // FIX: If the browser reports 8, it means "8 OR MORE". We must trust the configured
    // maxCacheSize for these powerful machines to allow unlimited viewport stacking!
    if (deviceMemGb >= 8) {
        // SKM-FIX: Algorithmic Ceiling
        // A single tab never needs more than 3.0 GB of VRAM (holds ~6000 uncompressed slices).
        // By strictly capping it at 3.0 GB, a doctor can safely open 4 heavy tabs
        // on a 16GB Resident system without ever triggering a Windows OS RAM freeze!
        const CEILING = 3 * 1024 * 1024 * 1024; // 3.0 GB
        effectiveCacheSize = effectiveCacheSize
          ? Math.min(effectiveCacheSize, CEILING)
          : CEILING;
    } else {
      // Weak machine (<8GB): Apply the 30% safety clamp to prevent OOM crashes.
      const memBudget = Math.max(gb, Math.floor(deviceMemGb * 0.3 * gb));
      effectiveCacheSize = effectiveCacheSize
        ? Math.min(effectiveCacheSize, memBudget)
        : memBudget;
    }
  } catch (e) {
    /* fall back to the configured value */
  }
  if (effectiveCacheSize) {
    cornerstone.cache.setMaxCacheSize(effectiveCacheSize);
    // eslint-disable-next-line no-console
    console.log(
      '[SKM] Cornerstone cache cap =',
      Math.round(effectiveCacheSize / (1024 * 1024)),
      'MB (deviceMemory =',
      (navigator as any).deviceMemory,
      'GB)'
    );
  }
  // ── end SKM ─────────────────────────────────────────────────────────────

  initCornerstoneTools();

  Settings.getRuntimeSettings().set('useCursors', Boolean(appConfig.useCursors));

  const {
    userAuthenticationService,
    customizationService,
    uiModalService,
    uiNotificationService,
    cornerstoneViewportService,
    hangingProtocolService,
    viewportGridService,
    segmentationService,
    measurementService,
    colorbarService,
    displaySetService,
    toolbarService,
  } = servicesManager.services;

  toolbarService.registerEventForToolbarUpdate(colorbarService, [
    colorbarService.EVENTS.STATE_CHANGED,
  ]);

  toolbarService.registerEventForToolbarUpdate(segmentationService, [
    segmentationService.EVENTS.SEGMENTATION_MODIFIED,
    segmentationService.EVENTS.SEGMENTATION_REPRESENTATION_MODIFIED,
    segmentationService.EVENTS.SEGMENTATION_ANNOTATION_CUT_MERGE_PROCESS_COMPLETED,
  ]);

  window.services = servicesManager.services;
  window.extensionManager = extensionManager;
  window.commandsManager = commandsManager;

  if (appConfig.showCPUFallbackMessage && cornerstone.getShouldUseCPURendering()) {
    _showCPURenderingModal(uiModalService, hangingProtocolService);
  }
  const { getPresentationId: getLutPresentationId } = useLutPresentationStore.getState();

  const { getPresentationId: getSegmentationPresentationId } =
    useSegmentationPresentationStore.getState();

  const { getPresentationId: getPositionPresentationId } = usePositionPresentationStore.getState();

  // register presentation id providers
  viewportGridService.addPresentationIdProvider(
    'positionPresentationId',
    getPositionPresentationId
  );
  viewportGridService.addPresentationIdProvider('lutPresentationId', getLutPresentationId);
  viewportGridService.addPresentationIdProvider(
    'segmentationPresentationId',
    getSegmentationPresentationId
  );

  segmentationService.setStyle(
    { type: SegmentationRepresentations.Contour },
    {
      // Declare these alpha values at the Contour type level so that they can be set/changed/inherited for all contour segmentations.
      fillAlpha: 0.5,
      fillAlphaInactive: 0.4,

      // In general do not fill contours so that hydrated RTSTRUCTs are not filled in when active or inactive by default.
      // However, hydrated RTSTRUCTs are filled in when active or inactive if the user chooses to fill ALL contours.
      // Those Contours created in OHIF (i.e. using the Segmentation Panel) will override both fill properties upon creation.
      renderFill: false,
      renderFillInactive: false,
    }
  );

  const metadataProvider = OHIF.classes.MetadataProvider;

  volumeLoader.registerVolumeLoader(
    'cornerstoneStreamingImageVolume',
    cornerstoneStreamingImageVolumeLoader
  );

  volumeLoader.registerVolumeLoader(
    'cornerstoneStreamingDynamicImageVolume',
    cornerstoneStreamingDynamicImageVolumeLoader
  );

  // Register strategies using the wrapper
  const imageLoadStrategies = {
    interleaveCenter: interleaveCenterLoader,
    interleaveTopToBottom: interleaveTopToBottom,
    nth: nthLoader,
  };

  Object.entries(imageLoadStrategies).forEach(([name, strategyFn]) => {
    hangingProtocolService.registerImageLoadStrategy(
      name,
      createMetadataWrappedStrategy(strategyFn)
    );
  });

  // These are set reasonably low to allow for interleaved retrieves and slower
  // connections.
  imageLoadPoolManager.maxNumRequests = {
    [RequestTypes.Interaction]: appConfig?.maxNumRequests?.interaction || 10,
    [RequestTypes.Thumbnail]: appConfig?.maxNumRequests?.thumbnail || 5,
    [RequestTypes.Prefetch]: appConfig?.maxNumRequests?.prefetch || 5,
    [RequestTypes.Compute]: appConfig?.maxNumRequests?.compute || 10,
  };

  initWADOImageLoader(userAuthenticationService, appConfig, extensionManager);

  // Add OHIF metadata providers after dicomImageLoader.init().
  // The linked metadata branch clears providers during loader init.
  metaData.addProvider(csUtilities.genericMetadataProvider.get, 9998);
  metaData.addProvider(
    csUtilities.calibratedPixelSpacingMetadataProvider.get.bind(
      csUtilities.calibratedPixelSpacingMetadataProvider
    )
  ); // this provider is required for Calibration tool
  metaData.addProvider(metadataProvider.get.bind(metadataProvider), 9999);

  /* Measurement Service */
  this.measurementServiceSource = connectToolsToMeasurementService({
    servicesManager,
    commandsManager,
    extensionManager,
  });

  initCineService(servicesManager);
  initStudyPrefetcherService(servicesManager);

  // SKM-BULK 2026-09-28 (Fix 3): register the bulk-capable dicomweb image loader
  // and the chunk driver. Both are no-ops unless appConfig.skmBulkLoader.enabled
  // is true, and the loader always falls back to the normal per-slice network
  // path on any miss/error — so image quality and behaviour are unchanged when
  // off, and never compromised when on. Must run AFTER initWADOImageLoader()
  // (line above) so it overrides the default 'dicomweb' loader.
  if (appConfig?.skmBulkLoader?.enabled) {
    // Only start the chunk driver if the custom loader actually activated;
    // otherwise the driver would bulk-fetch chunks nothing can consume.
    const bulkReady = registerSkmBulkImageLoader();
    if (bulkReady) {
      initSkmBulkDriver(servicesManager, extensionManager, appConfig.skmBulkLoader);
    }
  }

  measurementService.subscribe(measurementService.EVENTS.JUMP_TO_MEASUREMENT, evt => {
    const { measurement } = evt;
    const { uid: annotationUID } = measurement;
    commandsManager.runCommand('jumpToMeasurementViewport', { measurement, annotationUID, evt });
  });

  // When a custom image load is performed, update the relevant viewports
  hangingProtocolService.subscribe(
    hangingProtocolService.EVENTS.CUSTOM_IMAGE_LOAD_PERFORMED,
    volumeInputArrayMap => {
      const { lutPresentationStore } = useLutPresentationStore.getState();
      const { segmentationPresentationStore } = useSegmentationPresentationStore.getState();
      const { positionPresentationStore } = usePositionPresentationStore.getState();

      for (const entry of volumeInputArrayMap.entries()) {
        const [viewportId, volumeInputArray] = entry;
        const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);

        const ohifViewport = cornerstoneViewportService.getViewportInfo(viewportId);

        const { presentationIds } = ohifViewport.getViewportOptions();

        const presentations = {
          positionPresentation: positionPresentationStore[presentationIds?.positionPresentationId],
          lutPresentation: lutPresentationStore[presentationIds?.lutPresentationId],
          segmentationPresentation:
            segmentationPresentationStore[presentationIds?.segmentationPresentationId],
        };

        cornerstoneViewportService.setVolumesForViewport(viewport, volumeInputArray, presentations);
      }
    }
  );

  initContextMenu({
    cornerstoneViewportService,
    customizationService,
    commandsManager,
  });

  initDoubleClick({
    customizationService,
    commandsManager,
  });

  /**
   * Runs error handler for failed requests.
   * @param event
   */
  const imageLoadFailedHandler = ({ detail }) => {
    const handler = errorHandler.getHTTPErrorHandler();
    if (typeof handler === 'function') {
      handler(detail.error);
    }
  };

  eventTarget.addEventListener(EVENTS.IMAGE_LOAD_FAILED, imageLoadFailedHandler);
  eventTarget.addEventListener(EVENTS.IMAGE_LOAD_ERROR, imageLoadFailedHandler);

  const getDisplaySetFromVolumeId = (volumeId: string) => {
    const allDisplaySets = displaySetService.getActiveDisplaySets();
    const volume = cornerstone.cache.getVolume(volumeId);
    const imageIds = volume.imageIds;
    return allDisplaySets.find(ds => ds.imageIds?.some(id => imageIds.includes(id)));
  };

  function elementEnabledHandler(evt) {
    const { element } = evt.detail;
    const { viewport } = getEnabledElement(element);
    initViewTiming({ element });

    element.addEventListener(EVENTS.CAMERA_RESET, evt => {
      const { element } = evt.detail;
      const enabledElement = getEnabledElement(element);
      if (!enabledElement) {
        return;
      }
      const { viewportId } = enabledElement;
      commandsManager.runCommand('resetCrosshairs', { viewportId });
    });

    // limitation: currently supporting only volume viewports with fusion
    if (viewport.type !== cornerstone.Enums.ViewportType.ORTHOGRAPHIC) {
      return;
    }
  }

  eventTarget.addEventListener(EVENTS.ELEMENT_ENABLED, elementEnabledHandler.bind(null));

  colormaps.forEach(registerColormap);

  // Event listener
  eventTarget.addEventListenerDebounced(
    EVENTS.ERROR_EVENT,
    ({ detail }) => {
      // Create a stable ID for deduplication based on error type and message
      const errorId = `cornerstone-error-${detail.type}-${detail.message.substring(0, 50)}`;

      uiNotificationService.show({
        title: detail.type,
        message: detail.message,
        type: 'error',
        id: errorId,
        allowDuplicates: false, // Prevent duplicate error notifications
        deduplicationInterval: 30000, // 30 seconds deduplication window
      });
    },
    100
  );

  // Subscribe to actor events to dynamically update colorbars

  // Call this function when initializing
  initializeWebWorkerProgressHandler(servicesManager.services.uiNotificationService);
}

/**
 * Creates a wrapped image load strategy with metadata handling
 * @param strategyFn - The image loading strategy function to wrap
 * @returns A wrapped strategy function that handles metadata configuration
 */
const createMetadataWrappedStrategy = (strategyFn: (args: any) => any) => {
  return (args: any) => {
    const clonedConfig = imageRetrieveMetadataProvider.clone();
    imageRetrieveMetadataProvider.clear();

    try {
      const result = strategyFn(args);
      return result;
    } finally {
      // Ensure metadata is always restored, even if there's an error
      setTimeout(() => {
        imageRetrieveMetadataProvider.restore(clonedConfig);
      }, 10);
    }
  };
};

function CPUModal() {
  return (
    <div>
      <p>
        Your computer does not have enough GPU power to support the default GPU rendering mode. OHIF
        has switched to CPU rendering mode. Please note that CPU rendering does not support all
        features such as Volume Rendering, Multiplanar Reconstruction, and Segmentation Overlays.
      </p>
    </div>
  );
}

function _showCPURenderingModal(uiModalService, hangingProtocolService) {
  const callback = progress => {
    if (progress === 100) {
      uiModalService.show({
        content: CPUModal,
        title: 'OHIF Fell Back to CPU Rendering',
      });

      return true;
    }
  };

  const { unsubscribe } = hangingProtocolService.subscribe(
    hangingProtocolService.EVENTS.PROTOCOL_CHANGED,
    () => {
      const done = callback(100);

      if (done) {
        unsubscribe();
      }
    }
  );
}


