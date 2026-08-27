import {
  getEnabledElement,
  StackViewport,
  VolumeViewport,
  utilities as csUtils,
  Enums as CoreEnums,
  Types as CoreTypes,
  BaseVolumeViewport,
  getRenderingEngines,
  cache,
} from '@cornerstonejs/core';
import {
  ToolGroupManager,
  Enums,
  utilities as cstUtils,
  annotation,
  Types as ToolTypes,
  SplineContourSegmentationTool,
} from '@cornerstonejs/tools';
import {
  SegmentInfo,
  LogicalOperation,
  OperatorOptions,
} from '@cornerstonejs/tools/utilities/contourSegmentation/logicalOperators';
import * as cornerstoneTools from '@cornerstonejs/tools';
import * as labelmapInterpolation from '@cornerstonejs/labelmap-interpolation';
import { ONNXSegmentationController } from '@cornerstonejs/ai';

import { Types as OhifTypes, utils, DicomMetadataStore } from '@ohif/core';
import {
  callInputDialogAutoComplete,
  createReportAsync,
  colorPickerDialog,
  callInputDialog,
} from '@ohif/extension-default';
import { vec3, mat4 } from 'gl-matrix';
import toggleImageSliceSync from './utils/imageSliceSync/toggleImageSliceSync';
import toggleImageIndexSync from './utils/imageSliceSync/toggleImageIndexSync';
import { getFirstAnnotationSelected } from './utils/measurementServiceMappings/utils/selection';
import { getViewportEnabledElement } from './utils/getViewportEnabledElement';
import getActiveViewportEnabledElement from './utils/getActiveViewportEnabledElement';
import resolveWindowLevelPreset from './utils/resolveWindowLevelPreset';
import { togglePatientInfoVisible } from './utils/patientInfoVisibility';
import generateTimeIntensityCurve, {
  findDynamicSiblingSeries,
} from './utils/generateTimeIntensityCurve';
import { findCompatiblePTOverlay, findActiveCTDisplaySet } from './utils/findCompatibleFusionOverlay';
import { PT_COLORMAP, PT_WINDOW_LOWER, PT_WINDOW_UPPER } from './hps/fusion';
import { hasRealSUVData, applyRobustPTVolumeVOI } from './utils/applyRobustPTVolumeVOI';
import TimeIntensityCurveModal from './components/TimeIntensityCurve/TimeIntensityCurveModal';
import TimeIntensityCurveConfirmModal from './components/TimeIntensityCurve/TimeIntensityCurveConfirmModal';
import toggleVOISliceSync from './utils/toggleVOISliceSync';
import {
  usePositionPresentationStore,
  useSegmentationPresentationStore,
  useSelectedSegmentationsForViewportStore,
} from './stores';
import { toolNames } from './initCornerstoneTools';
import CornerstoneViewportDownloadForm from './utils/CornerstoneViewportDownloadForm';
import { updateSegmentBidirectionalStats } from './utils/updateSegmentationStats';
import { generateSegmentationCSVReport } from './utils/generateSegmentationCSVReport';
import { getUpdatedViewportsForSegmentation } from './utils/hydrationUtils';
import { SegmentationRepresentations } from '@cornerstonejs/tools/enums';
import { isMeasurementWithinViewport } from './utils/isMeasurementWithinViewport';
import { getCenterExtent } from './utils/getCenterExtent';
import { EasingFunctionEnum } from './utils/transitions';
import { createSegmentationForViewport } from './utils/createSegmentationForViewport';
import { utilities as segmentationUtilities } from '@cornerstonejs/tools/segmentation';
import i18n from '@ohif/i18n';

const { add, intersect, subtract, copy } = cstUtils.contourSegmentation;

const { DefaultHistoryMemo } = csUtils.HistoryMemo;
const toggleSyncFunctions = {
  imageSlice: toggleImageSliceSync,
  imageIndex: toggleImageIndexSync,
  voi: toggleVOISliceSync,
};

const { segmentation: segmentationUtils } = cstUtils;

const getLabelmapTools = ({ toolGroupService }) => {
  const labelmapTools = [];
  const toolGroupIds = toolGroupService.getToolGroupIds();
  toolGroupIds.forEach(toolGroupId => {
    const toolGroup = cornerstoneTools.ToolGroupManager.getToolGroup(toolGroupId);
    const tools = toolGroup.getToolInstances();
    // tools is an object with toolName as the key and tool as the value
    Object.keys(tools).forEach(toolName => {
      const tool = tools[toolName];
      if (tool instanceof cornerstoneTools.LabelmapBaseTool) {
        labelmapTools.push(tool);
      }
    });
  });
  return labelmapTools;
};

const getPreviewTools = ({ toolGroupService }) => {
  const labelmapTools = getLabelmapTools({ toolGroupService });

  const previewTools = labelmapTools.filter(tool => tool.acceptPreview || tool.rejectPreview);

  return previewTools;
};

const segmentAI = new ONNXSegmentationController({
  autoSegmentMode: true,
  models: {
    sam_b: [
      {
        name: 'sam-b-encoder',
        url: 'https://huggingface.co/schmuell/sam-b-fp16/resolve/main/sam_vit_b_01ec64.encoder-fp16.onnx',
        size: 180,
        key: 'encoder',
      },
      {
        name: 'sam-b-decoder',
        url: 'https://huggingface.co/schmuell/sam-b-fp16/resolve/main/sam_vit_b_01ec64.decoder.onnx',
        size: 17,
        key: 'decoder',
      },
    ],
  },
  modelName: 'sam_b',
});
let segmentAIEnabled = false;

/**
 * Auto-hydrating an SR/SEG/RTSTRUCT right as its display set loads can race
 * the underlying Cornerstone viewport, which is still being torn down and
 * recreated for the new display set at that exact moment — the OHIF SR
 * viewport component swaps from its report-only render to one showing the
 * referenced image, and TrackedMeasurementsContext's auto-hydrate flow can
 * fire before that swap finishes. cornerstoneViewportService.getCornerstoneViewport()
 * returning undefined mid-swap made hydrateSecondaryDisplaySet bail out
 * silently — no annotations added, no error — which is why opening an SR
 * would sometimes show 0 tracked measurements: it depended entirely on
 * whether that swap happened to finish before this ran. Polling briefly
 * instead of failing on the first check waits out that window instead of
 * leaving the user stuck until they happened to trigger a retry.
 */
async function waitForCornerstoneViewport(cornerstoneViewportService, viewportId, timeoutMs = 2000, intervalMs = 100) {
  let viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
  const start = Date.now();
  while (!viewport && Date.now() - start < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, intervalMs));
    viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
  }
  return viewport;
}

function commandsModule({
  servicesManager,
  commandsManager,
  extensionManager,
}: OhifTypes.Extensions.ExtensionParams): OhifTypes.Extensions.CommandsModule {
  const {
    viewportGridService,
    toolbarService,
    toolGroupService,
    cineService,
    uiDialogService,
    cornerstoneViewportService,
    uiNotificationService,
    measurementService,
    customizationService,
    colorbarService,
    hangingProtocolService,
    syncGroupService,
    segmentationService,
    displaySetService,
    uiModalService,
  } = servicesManager.services as AppTypes.Services;

  // Tracks whether the user has ever explicitly clicked the Auto/Manual
  // sync toolbar buttons this session - used by ensureDefaultSyncOnViewportsReady
  // below to apply an "Auto Sync on by default" default without ever
  // fighting a choice the user already made (e.g. turning sync off, or
  // switching to Manual Sync, shouldn't get silently reverted the next
  // time the grid changes and re-fires VIEWPORTS_READY).
  let userHasManuallyToggledSync = false;

  // Same pattern, independent flag - zoom/pan sync is unrelated to the
  // scroll (imageSlice/imageIndex) sync above, so a doctor turning one off
  // must not affect the other.
  let userHasManuallyToggledZoomPanSync = false;

  function _getActiveViewportEnabledElement() {
    return getActiveViewportEnabledElement(viewportGridService);
  }

  // Private SOPClassUid for chart data - matches the one
  // extensions/default's chartSOPClassHandler.ts and cornerstone-dynamic-
  // volume's updateSegmentationsChartDisplaySet.ts already use, so this
  // synthetic instance is picked up by the exact same existing SOP class
  // handler / LineChartViewport pipeline rather than inventing a second one.
  const TIC_CHART_SOP_CLASS_UID = '1.9.451.13215.7.3.2.7.6.1';
  const TIC_CHART_MODALITY = 'CHT';

  /**
   * Places the generated Time-Intensity Curve as a real chart panel in the
   * viewport grid (RadiAnt shows the TIC as its own panel, not a dialog),
   * reusing the same synthetic-"CHT"-instance mechanism the dynamic-volume
   * extension's segmentation-over-time chart already relies on: register a
   * fake DICOM instance with Modality 'CHT' and a `chartData` payload via
   * DicomMetadataStore, which the existing chartSOPClassHandler picks up
   * and turns into a real display set rendered by LineChartViewport - no
   * new viewport-module registration needed.
   *
   * Only does this when the grid already has more than one pane open
   * (returns false otherwise, so the caller falls back to the modal) -
   * with a single pane open there's no "spare" cell to put a chart into
   * without displacing the one image the radiologist is actively viewing,
   * and this command has no layout-changing authority of its own.
   */
  function _placeTimeIntensityCurveInGrid(result: {
    points: Array<{ time: number; value: number }>;
    seriesDescription: string;
    usesRealTime: boolean;
  }): boolean {
    const gridState = viewportGridService.getState();
    const viewportEntries = Array.from(gridState.viewports.entries());
    if (viewportEntries.length < 2) {
      return false;
    }

    // Map order approximates layout order (row-major) for every grid this
    // app actually builds (see modes/basic's layout presets) - the last
    // entry is the bottom-right pane, matching RadiAnt's own placement.
    const [targetViewportId] = viewportEntries[viewportEntries.length - 1];

    const { date: seriesDate, time: seriesTime } = (() => {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      return {
        date: `${now.getFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`,
        time: `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`,
      };
    })();

    const seriesInstanceUID = utils.guid();
    const instance = {
      SOPClassUID: TIC_CHART_SOP_CLASS_UID,
      Modality: TIC_CHART_MODALITY,
      SOPInstanceUID: utils.guid(),
      SeriesDate: seriesDate,
      SeriesTime: seriesTime,
      SeriesInstanceUID: seriesInstanceUID,
      StudyInstanceUID: utils.guid(),
      SeriesNumber: 9001,
      SeriesDescription: 'Time-Intensity Curve',
      // RadiAnt reference style: black background (handled by LineChart's
      // own dark theme), thin yellow axes, green curve line.
      chartData: {
        series: [
          {
            label: result.seriesDescription,
            points: result.points.map(p => [p.time, p.value]),
            color: '#39ff14',
          },
        ],
        axis: {
          x: { label: result.usesRealTime ? 'Time (s)' : 'Time phase' },
          y: { label: 'Mean signal intensity' },
        },
      },
    };

    const seriesMetadata = {
      StudyInstanceUID: instance.StudyInstanceUID,
      SeriesInstanceUID: instance.SeriesInstanceUID,
      SeriesDescription: instance.SeriesDescription,
      SeriesNumber: instance.SeriesNumber,
      SeriesTime: instance.SeriesTime,
      SOPClassUID: instance.SOPClassUID,
      Modality: instance.Modality,
    };

    DicomMetadataStore.addSeriesMetadata([seriesMetadata], true);
    DicomMetadataStore.addInstances([instance], true);

    // The SOP class handler above creates the display set synchronously in
    // response to addInstances (event-driven, no promise to await), so it's
    // already registered with displaySetService by the time this runs.
    const chartDisplaySet = displaySetService
      .getActiveDisplaySets()
      .find(ds => ds.SeriesInstanceUID === seriesInstanceUID);

    if (!chartDisplaySet) {
      return false;
    }

    viewportGridService.setDisplaySetsForViewport({
      viewportId: targetViewportId,
      displaySetInstanceUIDs: [chartDisplaySet.displaySetInstanceUID],
    });

    return true;
  }

  function _getViewportEnabledElement(viewportId: string) {
    return getViewportEnabledElement(viewportId);
  }

  function _getActiveViewportToolGroupId() {
    const viewport = _getActiveViewportEnabledElement();
    const toolGroup = viewport && toolGroupService.getToolGroupForViewport(viewport.id);
    return toolGroup?.id;
  }

  function _usesPrimaryActivation(bindings) {
    if (!bindings?.length) {
      return true;
    }

    return bindings.some(
      binding =>
        binding.mouseButton === Enums.MouseBindings.Primary &&
        binding.modifierKey == null &&
        binding.numTouchPoints == null
    );
  }

  function _getActiveSegmentationInfo() {
    const viewportId = viewportGridService.getActiveViewportId();
    const activeSegmentation = segmentationService.getActiveSegmentation(viewportId);
    const segmentationId = activeSegmentation?.segmentationId;
    const activeSegmentIndex = segmentationService.getActiveSegment(viewportId).segmentIndex;

    return {
      segmentationId,
      segmentIndex: activeSegmentIndex,
    };
  }

  function _handleBrushSizeAction(action: 'increase' | 'decrease') {
    const toolGroupIds = toolGroupService.getToolGroupIds();
    if (!toolGroupIds?.length) {
      return;
    }

    for (const toolGroupId of toolGroupIds) {
      const brushSize = segmentationUtils.getBrushSizeForToolGroup(toolGroupId);

      const newBrushSize = action === 'increase' ? brushSize + 3 : brushSize - 3;

      if (brushSize) {
        segmentationUtils.setBrushSizeForToolGroup(toolGroupId, newBrushSize);

        toolbarService.refreshToolbarState({ toolGroupId });
      }
    }
  }

  /**
   * Creates a command function that sets a style property for segmentation types.
   * If type is provided, sets the property for that type only.
   * If type is not provided, sets the property for both Labelmap and Contour types.
   * @param propertyName - The name of the style property to set
   * @returns A command function that takes { type, value }
   */
  const createSetStyleCommand = (propertyName: string) => {
    return ({ type, value }) => {
      const { segmentationService } = servicesManager.services;
      if (type) {
        segmentationService.setStyle({ type }, { [propertyName]: value });
      } else {
        segmentationService.setStyle(
          { type: SegmentationRepresentations.Labelmap },
          { [propertyName]: value }
        );
        segmentationService.setStyle(
          { type: SegmentationRepresentations.Contour },
          { [propertyName]: value }
        );
      }
    };
  };

  const actions = {
    jumpToMeasurementViewport: ({ annotationUID, measurement }) => {
      cornerstoneTools.annotation.selection.setAnnotationSelected(annotationUID, true);
      const { metadata } = measurement;

      const activeViewportId = viewportGridService.getActiveViewportId();
      // Finds the best viewport to jump to for showing the annotation view reference
      // This may be different from active if there is a viewport already showing the display set.
      const viewportId = cornerstoneViewportService.findNavigationCompatibleViewportId(
        activeViewportId,
        metadata
      );
      if (viewportId) {
        const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
        viewport.setViewReference(metadata);
        viewport.render();

        /**
         * If the measurement is not visible inside the current viewport,
         * we need to move the camera to the measurement.
         */
        if (!isMeasurementWithinViewport(viewport, measurement)) {
          const camera = viewport.getCamera();
          const { focalPoint: cameraFocalPoint, position: cameraPosition } = camera;
          const { center, extent } = getCenterExtent(measurement);
          const position = vec3.sub(vec3.create(), cameraPosition, cameraFocalPoint);
          vec3.add(position, position, center);
          viewport.setCamera({ focalPoint: center, position: position as any });
          /** Zoom out if the measurement is too large */
          const measurementSize = vec3.dist(extent.min, extent.max);
          if (measurementSize > camera.parallelScale) {
            const scaleFactor = measurementSize / camera.parallelScale;
            viewport.setZoom(viewport.getZoom() / scaleFactor);
          }
          viewport.render();
        }

        return;
      }

      const { displaySetInstanceUID: referencedDisplaySetInstanceUID } = measurement;
      if (!referencedDisplaySetInstanceUID) {
        console.warn('ViewportGrid::No display set found in', measurement);
        return;
      }

      // Finds the viewport to update to show the given displayset/orientation.
      // This will choose a view already containing the measurement display set
      // if possible, otherwise will fallback to the active.
      const viewportToUpdate = cornerstoneViewportService.findUpdateableViewportConfiguration(
        activeViewportId,
        measurement
      );

      if (!viewportToUpdate) {
        console.warn('Unable to find a viewport to show this in');
        return;
      }
      const updatedViewports = hangingProtocolService.getViewportsRequireUpdate(
        viewportToUpdate.viewportId,
        referencedDisplaySetInstanceUID
      );

      if (!updatedViewports?.[0]) {
        console.warn(
          'ViewportGrid::Unable to navigate to viewport containing',
          referencedDisplaySetInstanceUID
        );
        return;
      }

      updatedViewports[0].viewportOptions = viewportToUpdate.viewportOptions;

      // Update stored position presentation
      commandsManager.run('updateStoredPositionPresentation', {
        viewportId: viewportToUpdate.viewportId,
        displaySetInstanceUIDs: [referencedDisplaySetInstanceUID],
        referencedImageId: measurement.referencedImageId,
        options: {
          ...measurement.metadata,
        },
      });

      commandsManager.run('setDisplaySetsForViewports', { viewportsToUpdate: updatedViewports });
    },

    hydrateSecondaryDisplaySet: async ({ displaySet, viewportId }) => {
      if (!displaySet) {
        return;
      }

      const viewport = await waitForCornerstoneViewport(cornerstoneViewportService, viewportId);

      if (!viewport) {
        return;
      }

      if (displaySet.isOverlayDisplaySet) {
        // update the previously stored segmentationPresentation with the new viewportId
        // presentation so that when we put the referencedDisplaySet back in the viewport
        // it will have the correct segmentation representation hydrated

        const segmentationType =
          // Todo: check if PMAP modality should be handled such as SEG
          displaySet.Modality !== 'SEG'
            ? SegmentationRepresentations.Contour
            : viewport.type === CoreEnums.ViewportType.VOLUME_3D
              ? SegmentationRepresentations.Surface
              : SegmentationRepresentations.Labelmap;

        commandsManager.runCommand('updateStoredSegmentationPresentation', {
          displaySet,
          type: segmentationType,
        });
      }

      const referencedDisplaySetInstanceUID = displaySet.referencedDisplaySetInstanceUID;

      const storePositionPresentation = refDisplaySet => {
        // update the previously stored positionPresentation with the new viewportId
        // presentation so that when we put the referencedDisplaySet back in the viewport
        // it will be in the correct position zoom and pan
        commandsManager.runCommand('updateStoredPositionPresentation', {
          viewportId,
          displaySetInstanceUIDs: [refDisplaySet.displaySetInstanceUID],
        });
      };

      if (displaySet.Modality === 'SEG' || displaySet.Modality === 'RTSTRUCT') {
        const referencedDisplaySet = displaySetService.getDisplaySetByUID(
          referencedDisplaySetInstanceUID
        );
        storePositionPresentation(referencedDisplaySet);

        const results = commandsManager.runCommand('loadSegmentationDisplaySetsForViewport', {
          viewportId,
          displaySetInstanceUIDs: [referencedDisplaySet.displaySetInstanceUID],
        });

        const disableEditing = customizationService.getCustomization(
          'panelSegmentation.disableEditing'
        );
        if (disableEditing) {
          const segmentationRepresentations = segmentationService.getSegmentationRepresentations(
            viewportId,
            {
              segmentationId: displaySet.displaySetInstanceUID,
            }
          );

          segmentationRepresentations.forEach(representation => {
            const segmentIndices = Object.keys(representation.segments);
            segmentIndices.forEach(segmentIndex => {
              segmentationService.setSegmentLocked(
                representation.segmentationId,
                parseInt(segmentIndex),
                true
              );
            });
          });
        }
        return results;
      } else if (displaySet.Modality === 'SR') {
        const results = commandsManager.runCommand('hydrateStructuredReport', {
          displaySetInstanceUID: displaySet.displaySetInstanceUID,
        });
        const { SeriesInstanceUIDs } = results;
        const referencedDisplaySets = displaySetService.getDisplaySetsForSeries(
          SeriesInstanceUIDs[0]
        );
        referencedDisplaySets.forEach(storePositionPresentation);

        if (referencedDisplaySets.length) {
          actions.setDisplaySetsForViewports({
            viewportsToUpdate: [
              {
                viewportId: viewportGridService.getActiveViewportId(),
                displaySetInstanceUIDs: [referencedDisplaySets[0].displaySetInstanceUID],
              },
            ],
          });
        }
        return results;
      }
    },
    runSegmentBidirectional: async ({ segmentationId, segmentIndex } = {}) => {
      // Get active segmentation if not specified
      const targetSegmentation =
        segmentationId && segmentIndex
          ? { segmentationId, segmentIndex }
          : _getActiveSegmentationInfo();

      const { segmentationId: targetId, segmentIndex: targetIndex } = targetSegmentation;

      // Check if the segment has voxels before computing bidirectional measurement
      const uniqueSegmentIndices = cstUtils.segmentation.getUniqueSegmentIndices(targetId);
      const hasVoxels = uniqueSegmentIndices.includes(targetIndex);

      if (!hasVoxels) {
        uiNotificationService.show({
          title: i18n.t('SegmentationPanel:Segment Bidirectional'),
          message: i18n.t(
            'SegmentationPanel:Draw a segment before using bidirectional measurement'
          ),
          type: 'warning',
        });
        return;
      }

      // Get bidirectional measurement data
      const bidirectionalData = await cstUtils.segmentation.getSegmentLargestBidirectional({
        segmentationId: targetId,
        segmentIndices: [targetIndex],
      });

      if (!bidirectionalData.length) {
        return;
      }

      const activeViewportId = viewportGridService.getActiveViewportId();

      // Process each bidirectional measurement
      bidirectionalData.forEach(measurement => {
        const { segmentIndex, majorAxis, minorAxis } = measurement;

        // Create annotation
        const annotation = cornerstoneTools.SegmentBidirectionalTool.hydrate(
          activeViewportId,
          [majorAxis, minorAxis],
          {
            segmentIndex,
            segmentationId: targetId,
          }
        );

        measurement.annotationUID = annotation.annotationUID;

        // Update segmentation stats
        const updatedSegmentation = updateSegmentBidirectionalStats({
          segmentationId: targetId,
          segmentIndex: targetIndex,
          bidirectionalData: measurement,
          segmentationService,
          annotation,
        });

        // Save changes if needed
        if (updatedSegmentation) {
          segmentationService.addOrUpdateSegmentation({
            segmentationId: targetId,
            segments: updatedSegmentation.segments,
          });
        }
      });

      // get the active segmentIndex bidirectional annotation and jump to it
      const activeBidirectional = bidirectionalData.find(
        measurement => measurement.segmentIndex === targetIndex
      );
      commandsManager.run('jumpToMeasurement', {
        uid: activeBidirectional?.annotationUID,
      });
    },
    interpolateLabelmap: () => {
      const { segmentationId, segmentIndex } = _getActiveSegmentationInfo();
      labelmapInterpolation.interpolate({
        segmentationId,
        segmentIndex,
      });
    },
    /**
     * Generates the selector props for the context menu, specific to
     * the cornerstone viewport, and then runs the context menu.
     */
    showCornerstoneContextMenu: options => {
      const element = _getActiveViewportEnabledElement()?.viewport?.element;

      const optionsToUse = { ...options, element };
      const { useSelectedAnnotation, nearbyToolData, event } = optionsToUse;

      // This code is used to invoke the context menu via keyboard shortcuts
      if (useSelectedAnnotation && !nearbyToolData) {
        const firstAnnotationSelected = getFirstAnnotationSelected(element);
        // filter by allowed selected tools from config property (if there is any)
        const isToolAllowed =
          !optionsToUse.allowedSelectedTools ||
          optionsToUse.allowedSelectedTools.includes(firstAnnotationSelected?.metadata?.toolName);
        if (isToolAllowed) {
          optionsToUse.nearbyToolData = firstAnnotationSelected;
        } else {
          return;
        }
      }

      optionsToUse.defaultPointsPosition = [];
      // if (optionsToUse.nearbyToolData) {
      //   optionsToUse.defaultPointsPosition = commandsManager.runCommand(
      //     'getToolDataActiveCanvasPoints',
      //     { toolData: optionsToUse.nearbyToolData }
      //   );
      // }

      // TODO - make the selectorProps richer by including the study metadata and display set.
      optionsToUse.selectorProps = {
        toolName: optionsToUse.nearbyToolData?.metadata?.toolName,
        value: optionsToUse.nearbyToolData,
        uid: optionsToUse.nearbyToolData?.annotationUID,
        nearbyToolData: optionsToUse.nearbyToolData,
        event,
        ...optionsToUse.selectorProps,
      };

      commandsManager.run(options, optionsToUse);
    },
    updateStoredSegmentationPresentation: ({ displaySet, type }) => {
      const { addSegmentationPresentationItem } = useSegmentationPresentationStore.getState();

      const referencedDisplaySetInstanceUID = displaySet.referencedDisplaySetInstanceUID;
      addSegmentationPresentationItem(referencedDisplaySetInstanceUID, {
        segmentationId: displaySet.displaySetInstanceUID,
        hydrated: true,
        type,
      });
    },

    /** Stores the changed position presentation */
    updateStoredPositionPresentation: ({
      viewportId,
      displaySetInstanceUIDs,
      referencedImageId,
      options,
    }) => {
      const presentations = cornerstoneViewportService.getPresentations(viewportId);
      const { positionPresentationStore, setPositionPresentation, getPositionPresentationId } =
        usePositionPresentationStore.getState();

      // Look inside positionPresentationStore and find the key that includes ALL the displaySetInstanceUIDs
      // and the value has viewportId as activeViewportId.
      let previousReferencedDisplaySetStoreKey;

      if (
        displaySetInstanceUIDs &&
        Array.isArray(displaySetInstanceUIDs) &&
        displaySetInstanceUIDs.length > 0
      ) {
        previousReferencedDisplaySetStoreKey = Object.entries(positionPresentationStore).find(
          ([key, value]) => {
            return (
              displaySetInstanceUIDs.every(uid => key.includes(uid)) &&
              value?.viewportId === viewportId
            );
          }
        )?.[0];
      }

      // Create presentation data with referencedImageId and options if provided
      const presentationData =
        referencedImageId || options?.FrameOfReferenceUID
          ? {
              ...presentations.positionPresentation,
              viewReference: {
                referencedImageId,
                ...options,
              },
            }
          : presentations.positionPresentation;

      if (previousReferencedDisplaySetStoreKey) {
        setPositionPresentation(previousReferencedDisplaySetStoreKey, presentationData);
        return;
      }

      // if not found means we have not visited that referencedDisplaySetInstanceUID before
      // so we need to grab the positionPresentationId directly from the store,
      // Todo: this is really hacky, we should have a better way for this
      const positionPresentationId = getPositionPresentationId({
        displaySetInstanceUIDs,
        viewportId,
      });

      setPositionPresentation(positionPresentationId, presentationData);
    },
    getNearbyToolData({ nearbyToolData, element, canvasCoordinates }) {
      return nearbyToolData ?? cstUtils.getAnnotationNearPoint(element, canvasCoordinates);
    },
    getNearbyAnnotation({ element, canvasCoordinates }) {
      const nearbyToolData = actions.getNearbyToolData({
        nearbyToolData: null,
        element,
        canvasCoordinates,
      });

      const isAnnotation = toolName => {
        const enabledElement = getEnabledElement(element);

        if (!enabledElement) {
          return;
        }

        const { renderingEngineId, viewportId } = enabledElement;
        const toolGroup = ToolGroupManager.getToolGroupForViewport(viewportId, renderingEngineId);

        const toolInstance = toolGroup.getToolInstance(toolName);

        return toolInstance?.constructor?.isAnnotation ?? true;
      };

      return nearbyToolData?.metadata?.toolName && isAnnotation(nearbyToolData.metadata.toolName)
        ? nearbyToolData
        : null;
    },
    /**
     * Common logic for handling measurement label updates through dialog
     * @param uid - measurement uid
     * @returns Promise that resolves when the label is updated
     */
    _handleMeasurementLabelDialog: async uid => {
      const labelConfig = customizationService.getCustomization('measurementLabels');
      const renderContent = customizationService.getCustomization('ui.labellingComponent');
      const measurement = measurementService.getMeasurement(uid);

      if (!measurement) {
        console.debug('No measurement found for label editing');
        return;
      }

      if (!labelConfig) {
        const label = await callInputDialog({
          uiDialogService,
          title: i18n.t('Tools:Edit Measurement Label'),
          placeholder: measurement.label || i18n.t('Tools:Enter new label'),
          defaultValue: measurement.label,
        });

        if (label !== undefined && label !== null) {
          measurementService.update(uid, { ...measurement, label }, true);
        }
        return;
      }

      const val = await callInputDialogAutoComplete({
        measurement,
        uiDialogService,
        labelConfig,
        renderContent,
      });

      if (val !== undefined && val !== null) {
        measurementService.update(uid, { ...measurement, label: val }, true);
      }
    },
    /**
     * Show the measurement labelling input dialog and update the label
     * on the measurement with a response if not cancelled.
     */
    setMeasurementLabel: async ({ uid }) => {
      await actions._handleMeasurementLabelDialog(uid);
    },
    renameMeasurement: async ({ uid }) => {
      await actions._handleMeasurementLabelDialog(uid);
    },
    /**
     *
     * @param props - containing the updates to apply
     * @param props.measurementKey - chooses the measurement key to apply the
     *        code to.  This will typically be finding or site to apply a
     *        finding code or a findingSites code.
     * @param props.code - A coding scheme value from DICOM, including:
     *       * CodeValue - the language independent code, for example '1234'
     *       * CodingSchemeDesignator - the issue of the code value
     *       * CodeMeaning - the text value shown to the user
     *       * ref - a string reference in the form `<designator>:<codeValue>`
     *       * type - defaulting to 'finding'.  Will replace other codes of same type
     *       * style - a styling object to use
     *       * Other fields
     *     Note it is a valid option to remove the finding or site values by
     *     supplying null for the code.
     * @param props.uid - the measurement UID to find it with
     * @param props.label - the text value for the code.  Has NOTHING to do with
     *        the measurement label, which can be set with textLabel
     * @param props.textLabel is the measurement label to apply.  Set to null to
     *            delete.
     *
     * If the measurementKey is `site`, then the code will also be added/replace
     * the 0 element of findingSites.  This behaviour is expected to be enhanced
     * in the future with ability to set other site information.
     */
    updateMeasurement: props => {
      const { code, uid, textLabel, label } = props;
      let { style } = props;
      const measurement = measurementService.getMeasurement(uid);
      if (!measurement) {
        console.warn('No measurement found to update', uid);
        return;
      }
      const updatedMeasurement = {
        ...measurement,
      };
      // Call it textLabel as the label value
      // TODO - remove the label setting when direct rendering of findingSites is enabled
      if (textLabel !== undefined) {
        updatedMeasurement.label = textLabel;
      }
      if (code !== undefined) {
        const measurementKey = code.type || 'finding';

        if (code.ref && !code.CodeValue) {
          const split = code.ref.indexOf(':');
          code.CodeValue = code.ref.substring(split + 1);
          code.CodeMeaning = code.text || label;
          code.CodingSchemeDesignator = code.ref.substring(0, split);
        }
        updatedMeasurement[measurementKey] = code;
        if (measurementKey !== 'finding') {
          if (updatedMeasurement.findingSites) {
            updatedMeasurement.findingSites = updatedMeasurement.findingSites.filter(
              it => it.type !== measurementKey
            );
            updatedMeasurement.findingSites.push(code);
          } else {
            updatedMeasurement.findingSites = [code];
          }
        }
      }

      style ||= updatedMeasurement.finding?.style;
      style ||= updatedMeasurement.findingSites?.find(site => site?.style)?.style;

      if (style) {
        // Reset the selected values to preserve appearance on selection
        style.lineDashSelected ||= style.lineDash;
        annotation.config.style.setAnnotationStyles(measurement.uid, style);

        // this is a bit ugly, but given the underlying behavior, this is how it needs to work.
        switch (measurement.toolName) {
          case toolNames.PlanarFreehandROI: {
            const targetAnnotation = annotation.state.getAnnotation(measurement.uid);
            targetAnnotation.data.isOpenUShapeContour = !!style.isOpenUShapeContour;
            break;
          }
          default:
            break;
        }
      }
      measurementService.update(updatedMeasurement.uid, updatedMeasurement, true);
    },

    /**
     * Jumps to the specified (by uid) measurement in the active viewport.
     * Also marks any provided display measurements isActive value
     */
    jumpToMeasurement: ({ uid, displayMeasurements = [] }) => {
      if (!uid) {
        return;
      }
      measurementService.jumpToMeasurement(viewportGridService.getActiveViewportId(), uid);
      for (const measurement of displayMeasurements) {
        measurement.isActive = measurement.uid === uid;
      }
    },

    removeMeasurement: ({ uid }) => {
      if (Array.isArray(uid)) {
        measurementService.removeMany(uid);
      } else {
        measurementService.remove(uid);
      }
    },

    /**
     * RadiAnt-parity manual calibration (User Manual v2021.2 sec. 2.7.1):
     * right-click an existing 2-point measurement (Length or CalibrationLine),
     * enter the object's known real-world distance, and the whole image's
     * pixel spacing is recalibrated from it - same underlying mechanism as
     * the CalibrationLine tool's own draw-a-new-line flow
     * (see tools/CalibrationLineTool.ts:onCompletedCalibrationLine), just
     * triggered from the context menu on a measurement the user already drew
     * instead of requiring a fresh CalibrationLine annotation.
     */
    calibrateMeasurement: ({ nearbyToolData }) => {
      const points = nearbyToolData?.data?.handles?.points;
      const imageId = nearbyToolData?.metadata?.referencedImageId;

      if (!points || points.length !== 2 || !imageId) {
        return;
      }

      const enabledElement = _getActiveViewportEnabledElement();
      if (!enabledElement) {
        return;
      }
      const { viewport } = enabledElement;

      const currentLength = Math.round(vec3.distance(points[0], points[1]) * 100) / 100;

      callInputDialog({
        uiDialogService,
        title: 'Calibration',
        placeholder: 'Actual Physical distance (mm)',
        defaultValue: `${currentLength}`,
      }).then(newValue => {
        const newLength = Number.parseFloat(newValue);
        if (!Number.isFinite(newLength) || newLength <= 0) {
          return;
        }

        const spacingScale = newLength / currentLength;
        cornerstoneTools.utilities.calibrateImageSpacing(imageId, viewport.getRenderingEngine(), {
          type: 'User',
          scale: 1 / spacingScale,
        });
      });
    },

    toggleLockMeasurement: ({ uid }) => {
      measurementService.toggleLockMeasurement(uid);
    },

    toggleVisibilityMeasurement: ({ uid, items, visibility }) => {
      if (visibility === undefined && items?.length) {
        visibility = !items[0].isVisible;
      }
      if (Array.isArray(uid)) {
        measurementService.toggleVisibilityMeasurementMany(uid, visibility);
      } else {
        measurementService.toggleVisibilityMeasurement(uid, visibility);
      }
    },

    /**
     * Download the CSV report for the measurements.
     */
    downloadCSVMeasurementsReport: ({ measurementFilter }) => {
      utils.downloadCSVReport(measurementService.getMeasurements(measurementFilter));
    },

    downloadCSVSegmentationReport: ({ segmentationId }) => {
      const segmentation = segmentationService.getSegmentation(segmentationId);

      const { representationData } = segmentation;
      const { Labelmap } = representationData;
      const { referencedImageIds } = Labelmap;

      const firstImageId = referencedImageIds[0];

      // find displaySet for firstImageId
      const displaySet = displaySetService
        .getActiveDisplaySets()
        .find(ds => ds.imageIds?.some(i => i === firstImageId));

      const {
        SeriesNumber,
        SeriesInstanceUID,
        StudyInstanceUID,
        SeriesDate,
        SeriesTime,
        SeriesDescription,
      } = displaySet;

      const additionalInfo = {
        reference: {
          SeriesNumber,
          SeriesInstanceUID,
          StudyInstanceUID,
          SeriesDate,
          SeriesTime,
          SeriesDescription,
        },
      };

      generateSegmentationCSVReport(segmentation, additionalInfo);
    },

    // Retrieve value commands
    getActiveViewportEnabledElement: _getActiveViewportEnabledElement,

    setViewportActive: ({ viewportId }) => {
      const viewportInfo = cornerstoneViewportService.getViewportInfo(viewportId);
      if (!viewportInfo) {
        console.warn('No viewport found for viewportId:', viewportId);
        return;
      }

      viewportGridService.setActiveViewportId(viewportId);
    },
    arrowTextCallback: async ({ callback, data }) => {
      const labelConfig = customizationService.getCustomization('measurementLabels');
      const renderContent = customizationService.getCustomization('ui.labellingComponent');

      if (!labelConfig) {
        const label = await callInputDialog({
          uiDialogService,
          title: i18n.t('Tools:Edit Arrow Text'),
          placeholder: data?.data?.label || i18n.t('Tools:Enter new text'),
          defaultValue: data?.data?.label || '',
        });

        callback?.(label);
        return;
      }

      const value = await callInputDialogAutoComplete({
        uiDialogService,
        labelConfig,
        renderContent,
      });
      callback?.(value);
    },

    toggleCine: () => {
      const { viewports } = viewportGridService.getState();
      const { isCineEnabled } = cineService.getState();
      cineService.setIsCineEnabled(!isCineEnabled);
      viewports.forEach((_, index) => cineService.setCine({ id: index, isPlaying: false }));
    },

    setViewportWindowLevel({
      viewportId,
      windowWidth,
      windowCenter,
      displaySetInstanceUID,
    }: {
      viewportId: string;
      windowWidth: number;
      windowCenter: number;
      displaySetInstanceUID?: string;
    }) {
      // convert to numbers
      const windowWidthNum = Number(windowWidth);
      const windowCenterNum = Number(windowCenter);

      // get actor from the viewport
      const renderingEngine = cornerstoneViewportService.getRenderingEngine();
      const viewport = renderingEngine.getViewport(viewportId);

      const { lower, upper } = csUtils.windowLevel.toLowHighRange(windowWidthNum, windowCenterNum);

      if (viewport instanceof BaseVolumeViewport) {
        const volumeId = actions.getVolumeIdForDisplaySet({
          viewportId,
          displaySetInstanceUID,
        });
        viewport.setProperties(
          {
            voiRange: {
              upper,
              lower,
            },
          },
          volumeId
        );
      } else {
        viewport.setProperties({
          voiRange: {
            upper,
            lower,
          },
        });
      }
      viewport.render();
    },
    toggleViewportColorbar: ({ viewportId, displaySetInstanceUIDs, options = {} }) => {
      const hasColorbar = colorbarService.hasColorbar(viewportId);
      if (hasColorbar) {
        colorbarService.removeColorbar(viewportId);
        return;
      }
      colorbarService.addColorbar(viewportId, displaySetInstanceUIDs, options);
    },
    setWindowLevel(props) {
      const { toolGroupId } = props;
      const { viewportId } = _getActiveViewportEnabledElement();
      const viewportToolGroupId = toolGroupService.getToolGroupForViewport(viewportId);

      if (toolGroupId && toolGroupId !== viewportToolGroupId) {
        return;
      }

      actions.setViewportWindowLevel({ ...props, viewportId });
    },
    setWindowLevelPreset: ({ presetName, presetIndex }) => {
      const windowLevelPresets = customizationService.getCustomization(
        'cornerstone.windowLevelPresets'
      );

      const activeViewport = viewportGridService.getActiveViewportId();
      const viewport = cornerstoneViewportService.getCornerstoneViewport(activeViewport);
      const imageData = viewport?.getImageData?.();
      const metadata = imageData?.metadata;

      const modality = metadata?.Modality;

      if (!modality) {
        return;
      }

      const windowLevelPresetForModality = windowLevelPresets[modality];

      if (!windowLevelPresetForModality) {
        return;
      }

      // windowLevelPresetForModality is an array of preset objects. Hotkeys
      // (1-7) pass presetIndex - "the Nth preset for whichever modality is
      // currently active" - so the same keys work across CT/MR/US/etc.
      // without needing modality-specific ids baked into the hotkey config
      // (each modality has a different, differently-sized preset list).
      // presetName (an explicit id lookup) is kept for any caller that wants
      // a specific named preset regardless of index.
      const windowLevelPreset =
        presetIndex != null
          ? windowLevelPresetForModality[presetIndex]
          : windowLevelPresetForModality.find(preset => preset.id === presetName);

      if (!windowLevelPreset) {
        return;
      }

      const resolved = resolveWindowLevelPreset(windowLevelPreset, viewport);

      if (!resolved) {
        return;
      }

      actions.setViewportWindowLevel({
        viewportId: activeViewport,
        windowWidth: resolved.windowWidth,
        windowCenter: resolved.windowCenter,
      });
    },
    getVolumeIdForDisplaySet: ({ viewportId, displaySetInstanceUID }) => {
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      if (viewport instanceof BaseVolumeViewport) {
        const volumeIds = viewport.getAllVolumeIds();
        const volumeId = volumeIds.find(id => id.includes(displaySetInstanceUID));
        return volumeId;
      }
      return null;
    },
    setToolEnabled: ({ toolName, toggle, toolGroupId }) => {
      const { viewports } = viewportGridService.getState();

      if (!viewports.size) {
        return;
      }

      const toolGroup = toolGroupService.getToolGroup(toolGroupId ?? null);

      if (!toolGroup || !toolGroup.hasTool(toolName)) {
        return;
      }

      const toolIsEnabled = toolGroup.getToolOptions(toolName).mode === Enums.ToolModes.Enabled;

      // Toggle the tool's state only if the toggle is true
      if (toggle) {
        toolIsEnabled ? toolGroup.setToolDisabled(toolName) : toolGroup.setToolEnabled(toolName);
      } else {
        toolGroup.setToolEnabled(toolName);
      }

      const renderingEngine = cornerstoneViewportService.getRenderingEngine();
      renderingEngine.render();
    },
    toggleEnabledDisabledToolbar({ value, itemId, toolGroupId }) {
      const toolName = itemId || value;
      toolGroupId = toolGroupId ?? _getActiveViewportToolGroupId();

      const toolGroup = toolGroupService.getToolGroup(toolGroupId);
      if (!toolGroup || !toolGroup.hasTool(toolName)) {
        return;
      }

      const toolIsEnabled = toolGroup.getToolOptions(toolName).mode === Enums.ToolModes.Enabled;

      toolIsEnabled ? toolGroup.setToolDisabled(toolName) : toolGroup.setToolEnabled(toolName);
    },
    toggleActiveDisabledToolbar({ value, itemId, toolGroupId, toolGroupIds }) {
      const toolName = itemId || value;
      const resolvedToolGroupIds = toolGroupIds?.length
        ? toolGroupIds
        : [toolGroupId ?? _getActiveViewportToolGroupId()];

      resolvedToolGroupIds.forEach(toolGroupId => {
        const toolGroup = toolGroupService.getToolGroup(toolGroupId);
        if (!toolGroup || !toolGroup.hasTool(toolName)) {
          return;
        }

        const toolIsActive = [
          Enums.ToolModes.Active,
          Enums.ToolModes.Enabled,
          Enums.ToolModes.Passive,
        ].includes(toolGroup.getToolOptions(toolName).mode);

        if (toolIsActive) {
          toolGroup.setToolDisabled(toolName);

          const bindings = toolGroupService.getToolBindings(toolGroupId, toolName);

          if (_usesPrimaryActivation(bindings)) {
            // we should set the previously active tool to active after we set the
            // current tool disabled
            const prevToolName = toolGroup.getPrevActivePrimaryToolName();
            if (prevToolName !== toolName) {
              actions.setToolActive({ toolName: prevToolName, toolGroupId });
            }
          }

          return;
        }

        const bindings = toolGroupService.getToolBindings(toolGroupId, toolName);
        if (_usesPrimaryActivation(bindings)) {
          actions.setToolActive({ toolName, toolGroupId, bindings });
        } else {
          toolGroup.setToolActive(toolName, { bindings });
        }
      });
    },
    /**
     * Crosshairs is only registered on the 'mpr' tool group. If the active
     * viewport is already part of that group (any MPR-family layout, e.g.
     * MPR, 3D four up, Axial Primary all share it), this just toggles
     * Crosshairs there as usual. Otherwise - a plain stack viewport - switch
     * to the MPR layout for the current study first (only meaningful if the
     * series is actually reconstructable; the toolbar button itself is
     * disabled otherwise), then activate Crosshairs once the new MPR
     * viewports are ready.
     */
    activateCrosshairsAnywhere: () => {
      const enabledElement = _getActiveViewportEnabledElement();
      if (!enabledElement) {
        return;
      }

      const currentToolGroup = toolGroupService.getToolGroupForViewport(enabledElement.viewportId);
      if (currentToolGroup?.id === 'mpr') {
        actions.toggleActiveDisabledToolbar({ itemId: 'Crosshairs', toolGroupIds: ['mpr'] });
        return;
      }

      commandsManager.run({
        commandName: 'setHangingProtocol',
        commandOptions: { protocolId: 'mpr' },
      });

      // The MPR layout's volumes load asynchronously; give them a moment to
      // register with the 'mpr' tool group before activating Crosshairs on it
      // (same delay pattern already used elsewhere in this module for a
      // similar cross-layout activation race, e.g. the multimonitor action).
      setTimeout(() => {
        actions.toggleActiveDisabledToolbar({ itemId: 'Crosshairs', toolGroupIds: ['mpr'] });
      }, 1000);
    },
    setToolActiveToolbar: ({ value, itemId, toolName, toolGroupIds = [], bindings }) => {
      // Sometimes it is passed as value (tools with options), sometimes as itemId (toolbar buttons)
      toolName = toolName || itemId || value;

      toolGroupIds = toolGroupIds.length ? toolGroupIds : toolGroupService.getToolGroupIds();

      toolGroupIds.forEach(toolGroupId => {
        actions.setToolActive({ toolName, toolGroupId, bindings });
      });
    },
    /**
     * Same as setToolActiveToolbar, except clicking the button again while its
     * tool is already the Active primary tool deactivates it (reverting to
     * whichever tool was active before), instead of just re-selecting it.
     *
     * Unlike toggleActiveDisabledToolbar, this only treats the Active mode as
     * "on" - Passive is left alone as the tool's normal resting state (most
     * measurement tools start Passive by default, per initToolGroups, so
     * lumping Passive in with Active would make the first click deactivate an
     * already-inactive tool instead of activating it).
     *
     * `fallbackToolName` (optional) is for tools that own a mouse button with
     * no natural "off" state (StackScroll/WindowLevel/Zoom/Pan/TrackballRotate) -
     * toolGroup.getPrevActivePrimaryToolName() is only populated after the user
     * has switched tools at least once through this command, so the very first
     * toggle-off has nothing to revert to. When that happens, activate
     * fallbackToolName instead of falling back to Passive (which would leave
     * the mouse button bound to nothing).
     */
    toggleToolActiveToolbar: ({
      value,
      itemId,
      toolName,
      toolGroupIds = [],
      bindings,
      fallbackToolName,
    }) => {
      toolName = toolName || itemId || value;

      const resolvedToolGroupIds = toolGroupIds.length
        ? toolGroupIds
        : toolGroupService.getToolGroupIds();

      resolvedToolGroupIds.forEach(toolGroupId => {
        const toolGroup = toolGroupService.getToolGroup(toolGroupId);
        if (!toolGroup || !toolGroup.hasTool(toolName)) {
          return;
        }

        // Tools that own a dedicated mouse button (StackScroll/Zoom/Pan/
        // TrackballRotate) stay in ToolModes.Active permanently - that mode
        // reflects "this tool responds on its own button", not "this is the
        // current left-click tool". So "currently active" for toggle purposes
        // must match the same definition the toolbar's visual highlight uses:
        // whichever tool currently owns the Primary (left) button.
        const isCurrentlyActive = toolGroup.getActivePrimaryMouseButtonTool() === toolName;

        if (isCurrentlyActive) {
          const prevToolName = toolGroup.getPrevActivePrimaryToolName();
          if (prevToolName && prevToolName !== toolName) {
            actions.setToolActive({ toolName: prevToolName, toolGroupId });
          } else if (
            fallbackToolName &&
            fallbackToolName !== toolName &&
            toolGroup.hasTool(fallbackToolName)
          ) {
            actions.setToolActive({ toolName: fallbackToolName, toolGroupId });
          } else {
            toolGroup.setToolPassive(toolName);
          }
          return;
        }

        actions.setToolActive({ toolName, toolGroupId, bindings });
      });
    },
    setToolActive: ({
      toolName,
      toolGroupId = null,
      bindings = [{ mouseButton: Enums.MouseBindings.Primary }],
    }) => {
      const { viewports } = viewportGridService.getState();

      if (!viewports.size) {
        return;
      }

      const toolGroup = toolGroupService.getToolGroup(toolGroupId);

      if (!toolGroup) {
        return;
      }

      if (!toolGroup?.hasTool(toolName)) {
        return;
      }

      const activeToolName = toolGroup.getActivePrimaryMouseButtonTool();

      if (activeToolName) {
        const activeToolOptions = toolGroup.getToolConfiguration(activeToolName);
        activeToolOptions?.disableOnPassive
          ? toolGroup.setToolDisabled(activeToolName)
          : toolGroup.setToolPassive(activeToolName);
      }

      // Set the new toolName to be active
      toolGroup.setToolActive(toolName, {
        bindings,
      });
    },
    // capture viewport
    showDownloadViewportModal: () => {
      const { activeViewportId } = viewportGridService.getState();

      if (!cornerstoneViewportService.getCornerstoneViewport(activeViewportId)) {
        // Cannot download a non-cornerstone viewport (image).
        uiNotificationService.show({
          title: i18n.t('Tools:Download Image'),
          message: i18n.t('Tools:Image cannot be downloaded'),
          type: 'error',
        });
        return;
      }

      const { uiModalService } = servicesManager.services;

      if (uiModalService) {
        uiModalService.show({
          content: CornerstoneViewportDownloadForm,
          title: i18n.t('Tools:Download High Quality Image'),
          contentProps: {
            activeViewportId,
            cornerstoneViewportService,
          },
          containerClassName: 'max-w-4xl p-4',
        });
      }
    },
    /**
     * Rotates the viewport by `rotation` relative to its current rotation.
     */
    rotateViewportBy: ({ rotation, viewportId }: { rotation: number; viewportId?: string }) => {
      actions._rotateViewport({ rotation, viewportId, rotationMode: 'apply' });
    },
    /**
     * Sets the viewport rotation to an absolute value `rotation`.
     */
    setViewportRotation: ({ rotation, viewportId }: { rotation: number; viewportId?: string }) => {
      actions._rotateViewport({ rotation, viewportId, rotationMode: 'set' });
    },
    flipViewportHorizontal: ({
      viewportId,
      newValue = 'toggle',
    }: {
      viewportId?: string;
      newValue?: 'toggle' | boolean;
    }) => {
      const enabledElement = viewportId
        ? _getViewportEnabledElement(viewportId)
        : _getActiveViewportEnabledElement();

      if (!enabledElement) {
        return;
      }

      const { viewport } = enabledElement;

      let flipHorizontal: boolean;
      if (newValue === 'toggle') {
        const { flipHorizontal: currentHorizontalFlip } = viewport.getCamera();
        flipHorizontal = !currentHorizontalFlip;
      } else {
        flipHorizontal = newValue;
      }

      viewport.setCamera({ flipHorizontal });
      viewport.render();
    },
    flipViewportVertical: ({
      viewportId,
      newValue = 'toggle',
    }: {
      viewportId?: string;
      newValue?: 'toggle' | boolean;
    }) => {
      const enabledElement = viewportId
        ? _getViewportEnabledElement(viewportId)
        : _getActiveViewportEnabledElement();

      if (!enabledElement) {
        return;
      }

      const { viewport } = enabledElement;

      let flipVertical: boolean;
      if (newValue === 'toggle') {
        const { flipVertical: currentVerticalFlip } = viewport.getCamera();
        flipVertical = !currentVerticalFlip;
      } else {
        flipVertical = newValue;
      }
      viewport.setCamera({ flipVertical });
      viewport.render();
    },
    togglePatientInfoVisibility: () => {
      togglePatientInfoVisible();
    },
    generateTimeIntensityCurve: async () => {
      const enabledElement = _getActiveViewportEnabledElement();
      if (!enabledElement) {
        uiNotificationService?.show({
          title: 'Time-Intensity Curve',
          message: 'Activate a viewport first.',
          type: 'warning',
        });
        return;
      }

      const { viewport, viewportId } = enabledElement;
      const gridState = viewportGridService.getState();
      const gridViewport = gridState.viewports.get(viewportId);
      const displaySetInstanceUID = gridViewport?.displaySetInstanceUIDs?.[0];
      const currentDisplaySet = displaySetInstanceUID
        ? displaySetService.getDisplaySetByUID(displaySetInstanceUID)
        : null;

      if (!currentDisplaySet) {
        uiNotificationService?.show({
          title: 'Time-Intensity Curve',
          message: 'No series loaded in the active viewport.',
          type: 'warning',
        });
        return;
      }

      // RadiAnt's own TIC documentation restricts it to studies "where
      // spatial position is clearly defined, such as CT and MR" - the
      // toolbar button is already gated to CT/MR via evaluate.modality.
      // supported, but the Ctrl+Shift+E hotkey calls this command directly
      // and bypasses that button-disabled state, so the same check is
      // needed here too.
      if (!['CT', 'MR'].includes(currentDisplaySet.Modality)) {
        uiNotificationService?.show({
          title: 'Time-Intensity Curve',
          message: 'Time-Intensity Curve is only available for CT and MR series.',
          type: 'warning',
        });
        return;
      }

      // RadiAnt-style: prefer a drawn Elliptical ROI as the region to
      // sample - averaging every pixel inside it per time-phase is far
      // more clinically accurate than a single probed pixel, since one
      // noisy voxel can otherwise swing the whole curve. Falls back to the
      // 3D Cursor (Simple Crosshair)'s placed point, then the viewport's
      // current focal point, if no ellipse has been drawn on this viewport.
      const ellipticalAnnotations = cornerstoneTools.annotation.state.getAnnotations(
        'EllipticalROI',
        viewport.element
      );
      const ellipseAnnotation = ellipticalAnnotations?.[ellipticalAnnotations.length - 1];
      const ellipsePoints = ellipseAnnotation?.data?.handles?.points;

      let roi;
      let worldPoint: [number, number, number];

      if (ellipsePoints?.length === 4) {
        // Points are [bottom, top, left, right] in world coordinates
        // (EllipticalROITool.js) - center is their average, radii are half
        // the distance between each opposing pair.
        const [bottom, top, left, right] = ellipsePoints;
        const center: [number, number, number] = [
          (bottom[0] + top[0] + left[0] + right[0]) / 4,
          (bottom[1] + top[1] + left[1] + right[1]) / 4,
          (bottom[2] + top[2] + left[2] + right[2]) / 4,
        ];
        const radiusAlongColumn =
          Math.hypot(top[0] - bottom[0], top[1] - bottom[1], top[2] - bottom[2]) / 2;
        const radiusAlongRow =
          Math.hypot(right[0] - left[0], right[1] - left[1], right[2] - left[2]) / 2;
        roi = { center, radiusAlongRow, radiusAlongColumn };
        worldPoint = center;
      } else {
        const simpleCrosshairAnnotations = cornerstoneTools.annotation.state.getAnnotations(
          'SimpleCrosshair',
          viewport.element
        );
        worldPoint =
          simpleCrosshairAnnotations?.[0]?.data?.handles?.points?.[0] ??
          viewport.getCamera().focalPoint;
      }

      // RadiAnt: "Review the automatically selected series in the dialog
      // box, click OK" - detect the dynamic-phase series up front (cheap,
      // metadata-only) so the radiologist can confirm the right phases were
      // picked up before the (comparatively slow, reads every phase image)
      // curve generation runs.
      const siblingSeries = findDynamicSiblingSeries(displaySetService, currentDisplaySet);

      if (siblingSeries.length < 2) {
        uiNotificationService?.show({
          title: 'Time-Intensity Curve',
          message:
            "This series doesn't look like a multi-phase perfusion/DCE acquisition (need at least 2 series sharing this series description) - nothing to plot.",
          type: 'warning',
          duration: 6000,
        });
        return;
      }

      const runGenerateTimeIntensityCurve = async (
        selectedSeries: any[],
        baselineDisplaySetInstanceUID: string
      ) => {
        uiNotificationService?.show({
          title: 'Time-Intensity Curve',
          message: 'Generating curve - this reads every time-phase image and can take a moment...',
          type: 'info',
        });

        const result = await generateTimeIntensityCurve({
          displaySetService,
          currentDisplaySet,
          worldPoint,
          roi,
          series: selectedSeries,
          baselineDisplaySetInstanceUID,
        });

        if (!result) {
          uiNotificationService?.show({
            title: 'Time-Intensity Curve',
            message: "Couldn't read pixel data for the detected series - nothing to plot.",
            type: 'warning',
            duration: 6000,
          });
          return;
        }

        // Prefer a real viewport-grid panel (RadiAnt shows the TIC as its
        // own panel, not a temporary dialog) when the grid already has more
        // than one pane open - the realistic case for this workflow, since
        // generating a TIC requires viewing at least 2 dynamic-phase series
        // in the first place. With only a single pane open there's nowhere
        // to put a chart without displacing the one image the radiologist
        // is looking at, so fall back to the modal instead of forcing a
        // layout change they didn't ask for.
        const placedInGrid = _placeTimeIntensityCurveInGrid(result);
        if (!placedInGrid) {
          uiModalService?.show({
            title: 'Time-Intensity Curve',
            content: TimeIntensityCurveModal,
            contentProps: {
              points: result.points,
              seriesDescription: result.seriesDescription,
              sampleCount: result.sampleCount,
              usesRealTime: result.usesRealTime,
            },
            containerClassName: 'max-w-3xl p-4',
          });
        }
      };

      uiModalService?.show({
        title: 'Time-Intensity Curve',
        content: TimeIntensityCurveConfirmModal,
        contentProps: {
          series: siblingSeries,
          onConfirm: runGenerateTimeIntensityCurve,
        },
        containerClassName: 'max-w-2xl p-4',
      });
    },

    /**
     * RadiAnt-style PET/CT Fusion toggle: overlays a compatible PT volume
     * onto the ACTIVE CT viewport in place - unlike the pre-existing
     * 'setHangingProtocol' fusion.ts protocol (still available separately
     * for the optional PET | CT | Fusion 3-up comparison layout), this
     * does NOT switch layouts or recreate the viewport, so the current
     * anatomical position, zoom, pan, rotation and flip state are
     * untouched. Calling it again on an already-fused viewport removes
     * just the PET actor and returns to CT-only, at the same camera state.
     */
    toggleFusion: async () => {
      const enabledElement = _getActiveViewportEnabledElement();
      if (!enabledElement) {
        uiNotificationService?.show({
          title: 'PET/CT Fusion',
          message: 'Activate a viewport first.',
          type: 'warning',
        });
        return;
      }

      const { viewport, viewportId } = enabledElement;

      if (!(viewport instanceof VolumeViewport)) {
        uiNotificationService?.show({
          title: 'PET/CT Fusion',
          message: 'Fusion requires a reconstructable (MPR/volume) viewport.',
          type: 'warning',
        });
        return;
      }

      // Toggle OFF: a PT volume actor is already present on this viewport -
      // remove just that actor and leave the CT actor/camera exactly as-is.
      // Actor lookup is by the actor entry's referencedId (the volumeId it
      // was created from), not viewport.getActor(volumeId) - that method
      // actually keys by actorUID, which only coincidentally equals the
      // volumeId in some call paths.
      const existingPtVolumeId = viewport
        .getAllVolumeIds()
        .find(id => cache.getVolume(id)?.metadata?.Modality === 'PT');

      if (existingPtVolumeId) {
        const actorEntry = viewport
          .getActors()
          .find(entry => entry.referencedId === existingPtVolumeId);
        if (actorEntry) {
          viewport.removeVolumeActors([actorEntry.uid], true);
        }
        return;
      }

      // Toggle ON: find the CT display set currently shown in this viewport.
      const gridState = viewportGridService.getState();
      const gridViewport = gridState.viewports.get(viewportId);
      const loadedDisplaySets = (gridViewport?.displaySetInstanceUIDs || []).map(uid =>
        displaySetService.getDisplaySetByUID(uid)
      );
      const ctDisplaySet = findActiveCTDisplaySet(loadedDisplaySets);

      if (!ctDisplaySet) {
        uiNotificationService?.show({
          title: 'PET/CT Fusion',
          message: 'The active viewport must show a CT series before fusion can be enabled.',
          type: 'warning',
        });
        return;
      }

      const ptDisplaySet = findCompatiblePTOverlay(
        ctDisplaySet,
        displaySetService.getActiveDisplaySets()
      );

      if (!ptDisplaySet) {
        uiNotificationService?.show({
          title: 'PET/CT Fusion',
          message:
            'No volumetric PET series suitable for fusion was found - a compatible series must share this CT’s patient coordinate system and cannot be a MIP, scout, localizer, or secondary-capture series.',
          type: 'warning',
          duration: 6000,
        });
        return;
      }

      // Preserve the exact camera state - addVolumes() itself doesn't
      // reset it, but this guards against any downstream render triggering
      // a recenter, and matches the explicit "do not reset position, zoom,
      // pan, rotation, or flip state" requirement.
      const capturedCamera = viewport.getCamera();

      try {
        const ptVolume = cstUtils.getOrCreateImageVolume(
          (ptDisplaySet as any).images.map((image: any) => image.imageId)
        );
        if (!ptVolume.loadStatus?.loaded && typeof ptVolume.load === 'function') {
          ptVolume.load();
        }

        await viewport.addVolumes([{ volumeId: ptVolume.volumeId }], true);

        // Scoped to just the PT volumeId - setProperties({colormap}) WITHOUT
        // a volumeId on a multi-actor viewport has been observed elsewhere
        // in this codebase (see applyRobustPTVolumeVOI's comment) to also
        // blank out the other actor sharing the viewport.
        //
        // The static PT_VOI (SUV 0-5) range only means anything for a
        // series with real SUV metadata - this hospital's PACS commonly
        // has raw-count PT data with no usable SUV metadata at all, and
        // applying the SUV-calibrated range/opacity ramp to that pushes
        // essentially every real pixel past the ramp's last point,
        // rendering at uniformly high opacity: the "solid blue/color wash
        // across the whole image, no anatomy visible" symptom. Check for
        // real SUV data first and use the same percentile-based fallback
        // the rest of the app already relies on when it's absent, instead
        // of assuming every PET series is SUV-scaled.
        const firstPtImageId = ptVolume.imageIds?.[0];
        if (firstPtImageId && hasRealSUVData(firstPtImageId)) {
          viewport.setProperties(
            { colormap: PT_COLORMAP, voiRange: { lower: PT_WINDOW_LOWER, upper: PT_WINDOW_UPPER } },
            ptVolume.volumeId
          );
        } else {
          // Colormap only here - applyRobustPTVolumeVOI computes and
          // applies the correct voiRange + opacity ramp for this
          // viewport (and any other viewport already sharing this same
          // cached volume) once enough of the volume's images are
          // decoded to sample from.
          viewport.setProperties({ colormap: PT_COLORMAP }, ptVolume.volumeId);
          applyRobustPTVolumeVOI(ptVolume, 15);
        }

        viewport.setCamera(capturedCamera);
        viewport.render();
      } catch (error) {
        console.error('[PET/CT Fusion] toggleFusion failed', error);
        uiNotificationService?.show({
          title: 'PET/CT Fusion',
          message: "Couldn't fuse this PET series with the active CT view.",
          type: 'error',
          duration: 6000,
        });
      }
    },

    invertViewport: ({ element }) => {
      let enabledElement;

      if (element === undefined) {
        enabledElement = _getActiveViewportEnabledElement();
      } else {
        enabledElement = element;
      }

      if (!enabledElement) {
        return;
      }

      const { viewport } = enabledElement;

      const { invert } = viewport.getProperties();
      viewport.setProperties({ invert: !invert });
      viewport.render();
    },
    resetViewport: () => {
      const enabledElement = _getActiveViewportEnabledElement();

      if (!enabledElement) {
        return;
      }

      const { viewport } = enabledElement;

      viewport.resetProperties?.();
      viewport.resetCamera();

      viewport.render();
    },
    /**
     * RadiAnt: "Clear transformation" (Ctrl+Shift+\) - resets ONLY rotation
     * and flip state to identity, leaving zoom/pan/window-level untouched.
     * Distinct from resetViewport above, which resets everything (camera
     * zoom/pan via resetCamera(), plus VOI/invert/interpolation via
     * resetProperties()).
     */
    clearViewportTransformations: () => {
      actions.setViewportRotation({ rotation: 0 });
      actions.setViewportHorizontalFlip({ flipped: false });
      actions.setViewportVerticalFlip({ flipped: false });
    },
    scaleViewport: ({ direction }) => {
      const enabledElement = _getActiveViewportEnabledElement();
      const scaleFactor = direction > 0 ? 0.9 : 1.1;

      if (!enabledElement) {
        return;
      }
      const { viewport } = enabledElement;

      // Previously gated on `viewport instanceof StackViewport` - Fit to
      // Window (direction: 0) silently did nothing for any MPR/volume/3D
      // viewport as a result, since those aren't StackViewport instances.
      // getCamera/setCamera/resetCamera/render are standard methods on
      // every cornerstone3D viewport type, not stack-viewport-specific, so
      // this now works the same way regardless of viewport type.
      if (direction) {
        const { parallelScale } = viewport.getCamera();
        viewport.setCamera({ parallelScale: parallelScale * scaleFactor });
        viewport.render();
      } else {
        viewport.resetCamera();
        viewport.render();
      }
    },

    /** Jumps the active viewport or the specified one to the given slice index */
    jumpToImage: ({ imageIndex, viewport: gridViewport }): void => {
      // Get current active viewport (return if none active)
      let viewport;
      if (!gridViewport) {
        const enabledElement = _getActiveViewportEnabledElement();
        if (!enabledElement) {
          return;
        }
        viewport = enabledElement.viewport;
      } else {
        viewport = cornerstoneViewportService.getCornerstoneViewport(gridViewport.id);
      }

      // Get number of slices
      // -> Copied from cornerstone3D jumpToSlice\_getImageSliceData()
      let numberOfSlices = 0;

      if (viewport instanceof StackViewport) {
        numberOfSlices = viewport.getImageIds().length;
      } else if (viewport instanceof VolumeViewport) {
        numberOfSlices = csUtils.getImageSliceDataForVolumeViewport(viewport).numberOfSlices;
      } else {
        throw new Error('Unsupported viewport type');
      }

      const jumpIndex = imageIndex < 0 ? numberOfSlices + imageIndex : imageIndex;
      if (jumpIndex >= numberOfSlices || jumpIndex < 0) {
        throw new Error(`Can't jump to ${imageIndex}`);
      }

      // Set slice to last slice
      const options = { imageIndex: jumpIndex };
      csUtils.jumpToSlice(viewport.element, options);
    },
    scroll: (options: ToolTypes.ScrollOptions) => {
      const enabledElement = _getActiveViewportEnabledElement();
      // Allow either or direction for consistency in scroll implementation
      options.delta ??= options.direction || 1;
      options.direction ??= options.delta;

      if (!enabledElement) {
        return;
      }

      const { viewport } = enabledElement;

      csUtils.scroll(viewport, options);
    },
    setViewportColormap: ({
      viewportId,
      displaySetInstanceUID,
      colormap,
      opacity = 1,
      immediate = false,
    }) => {
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);

      let hpOpacity;
      // Retrieve active protocol's viewport match details
      const { viewportMatchDetails } = hangingProtocolService.getActiveProtocol();
      // Get display set options for the specified viewport ID
      const displaySetsInfo = viewportMatchDetails.get(viewportId)?.displaySetsInfo;

      if (displaySetsInfo) {
        // Find the display set that matches the given UID
        const matchingDisplaySet = displaySetsInfo.find(
          displaySet => displaySet.displaySetInstanceUID === displaySetInstanceUID
        );
        // If a matching display set is found, update the opacity with its value
        hpOpacity = matchingDisplaySet?.displaySetOptions?.options?.colormap?.opacity;
      }

      // HP takes priority over the default opacity
      colormap = { ...colormap, opacity: hpOpacity || opacity };

      if (viewport instanceof StackViewport) {
        viewport.setProperties({ colormap });
      }

      if (viewport instanceof VolumeViewport) {
        if (!displaySetInstanceUID) {
          const { viewports } = viewportGridService.getState();
          displaySetInstanceUID = viewports.get(viewportId)?.displaySetInstanceUIDs[0];
        }

        // ToDo: Find a better way of obtaining the volumeId that corresponds to the displaySetInstanceUID
        const volumeId =
          viewport
            .getAllVolumeIds()
            .find((_volumeId: string) => _volumeId.includes(displaySetInstanceUID)) ??
          viewport.getVolumeId();
        viewport.setProperties({ colormap }, volumeId);
      }

      if (immediate) {
        viewport.render();
      }
    },
    changeActiveViewport: ({ direction = 1 }) => {
      const { activeViewportId, viewports } = viewportGridService.getState();
      const viewportIds = Array.from(viewports.keys());
      const currentIndex = viewportIds.indexOf(activeViewportId);
      const nextViewportIndex =
        (currentIndex + direction + viewportIds.length) % viewportIds.length;
      viewportGridService.setActiveViewportId(viewportIds[nextViewportIndex] as string);
    },
    /**
     * If the syncId is given and a synchronizer with that ID already exists, it will
     * toggle it on/off for the provided viewports. If not, it will attempt to create
     * a new synchronizer using the given syncId and type for the specified viewports.
     * If no viewports are provided, you may notice some default behavior.
     * - 'voi' type, we will aim to synchronize all viewports with the same modality
     * -'imageSlice' type, we will aim to synchronize all viewports with the same orientation.
     *
     * @param options
     * @param options.viewports - The viewports to synchronize
     * @param options.syncId - The synchronization group ID
     * @param options.type - The type of synchronization to perform
     */
    toggleSynchronizer: ({ type, viewports, syncId }) => {
      const synchronizer = syncGroupService.getSynchronizer(syncId);

      if (synchronizer) {
        synchronizer.isDisabled() ? synchronizer.setEnabled(true) : synchronizer.setEnabled(false);
        return;
      }

      const fn = toggleSyncFunctions[type];

      if (fn) {
        fn({
          servicesManager,
          viewports,
          syncId,
        });
      }
    },
    /**
     * RadiAnt-style Auto (position) vs Manual (index) scroll sync - only one
     * can be on at a time. Activating one turns the other off first, so the
     * two toolbar buttons behave like a 3-state control (Off / Auto / Manual)
     * built from two ordinary toggle buttons.
     */
    toggleSynchronizerExclusive: ({ type, syncId, otherType, otherSyncId, viewports }) => {
      userHasManuallyToggledSync = true;

      const isDisabled = syncGroup => !syncGroup || syncGroup.isDisabled();

      const thisSynchronizer = syncGroupService.getSynchronizer(syncId);
      const otherSynchronizer = syncGroupService.getSynchronizer(otherSyncId);

      const activating = isDisabled(thisSynchronizer);

      if (activating && !isDisabled(otherSynchronizer)) {
        actions.toggleSynchronizer({ type: otherType, syncId: otherSyncId, viewports });
      }

      actions.toggleSynchronizer({ type, syncId, viewports });
    },
    /**
     * Makes Auto Sync (image-slice, position-based) the default whenever the
     * viewport grid changes and settles (new study, a pane added via
     * ctrl+click, layout switch, etc.) - without ever fighting a sync choice
     * the user already made explicitly (including turning sync off, or
     * picking Manual Sync instead). Idempotent and safe to call on every
     * VIEWPORTS_READY firing: it only adds viewports that aren't already in
     * the sync group rather than toggling, so it can't flip an
     * already-on sync group off by being called more than once.
     */
    ensureDefaultSyncOnViewportsReady: () => {
      let refreshNeeded = false;

      const manualSync = syncGroupService.getSynchronizer('IMAGE_INDEX_SYNC');
      const manualSyncActive = manualSync && !manualSync.isDisabled();

      if (!userHasManuallyToggledSync && !manualSyncActive) {
        const { viewports } = viewportGridService.getState();
        const reconstructableViewports = [...viewports.values()].filter(viewport => {
          if (!viewport.displaySetInstanceUIDs?.length) {
            return false;
          }
          return viewport.displaySetInstanceUIDs.some(uid => {
            const displaySet = displaySetService.getDisplaySetByUID(uid);
            return displaySet?.isReconstructable;
          });
        });

        reconstructableViewports.forEach(gridViewport => {
          const { viewportId } = gridViewport.viewportOptions;
          const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
          if (!viewport) {
            return;
          }
          syncGroupService.addViewportToSyncGroup(viewportId, viewport.getRenderingEngine().id, {
            type: 'imageSlice',
            id: 'IMAGE_SLICE_SYNC',
            source: true,
            target: true,
          });
          refreshNeeded = true;
        });

        const autoSync = syncGroupService.getSynchronizer('IMAGE_SLICE_SYNC');
        if (autoSync?.isDisabled()) {
          autoSync.setEnabled(true);
          refreshNeeded = true;
        }
      }

      // RadiAnt-style default: with more than one viewport open, zoom/pan
      // stays in sync across all of them unless the doctor has explicitly
      // turned it off via the Zoom/Pan Sync toolbar toggle. Independent of
      // the scroll-sync block above - every 2D viewport type can
      // meaningfully share zoom/pan (unlike imageSlice sync, which only
      // makes sense between reconstructable/volume viewports), so no
      // reconstructable filtering here - just excluding volume3d, whose
      // rotate/perspective camera doesn't map onto a 2D pan/zoom sync the
      // same way (matches the toolbar button's own evaluate.viewport.supported
      // exclusion, so the sync group's real membership doesn't silently
      // diverge from what the toggle button visually implies).
      if (!userHasManuallyToggledZoomPanSync) {
        const { viewports } = viewportGridService.getState();
        [...viewports.values()].forEach(gridViewport => {
          if (gridViewport.viewportOptions?.viewportType === 'volume3d') {
            return;
          }
          const { viewportId } = gridViewport.viewportOptions;
          const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
          if (!viewport) {
            return;
          }
          syncGroupService.addViewportToSyncGroup(viewportId, viewport.getRenderingEngine().id, {
            type: 'zoompan',
            id: 'ZOOMPAN_SYNC',
            source: true,
            target: true,
          });
          refreshNeeded = true;
        });

        const zoomPanSync = syncGroupService.getSynchronizer('ZOOMPAN_SYNC');
        if (zoomPanSync?.isDisabled()) {
          zoomPanSync.setEnabled(true);
          refreshNeeded = true;
        }
      }

      if (refreshNeeded) {
        // Enabling sync groups here is a direct syncGroupService call, not
        // a toolbar button click - nothing else tells the sync toggle
        // buttons to re-evaluate their (otherwise stale) visual "on"
        // state. evaluate.cornerstone.synchronizer needs a real viewportId
        // to check (an empty refresh silently reads as "off" - it can't
        // tell which viewport's synchronizers to look up).
        toolbarService.refreshToolbarState({
          viewportId: viewportGridService.getActiveViewportId(),
        });
      }
    },
    /**
     * Toolbar-facing toggle for zoom/pan sync - separate from
     * toggleSynchronizer/toggleSynchronizerExclusive only in that it also
     * records the doctor's explicit choice so ensureDefaultSyncOnViewportsReady
     * (above) stops re-applying the default the next time the grid changes.
     */
    toggleZoomPanSync: ({ viewports }: { viewports?: unknown[] } = {}) => {
      userHasManuallyToggledZoomPanSync = true;
      actions.toggleSynchronizer({ type: 'zoompan', syncId: 'ZOOMPAN_SYNC', viewports });
    },
    setViewportForToolConfiguration: ({ viewportId, toolName }) => {
      if (!viewportId) {
        const { activeViewportId } = viewportGridService.getState();
        viewportId = activeViewportId ?? 'default';
      }

      const toolGroup = toolGroupService.getToolGroupForViewport(viewportId);

      if (!toolGroup?.hasTool(toolName)) {
        return;
      }

      const prevConfig = toolGroup?.getToolConfiguration(toolName);
      toolGroup?.setToolConfiguration(
        toolName,
        {
          ...prevConfig,
          sourceViewportId: viewportId,
        },
        true // overwrite
      );

      const renderingEngine = cornerstoneViewportService.getRenderingEngine();
      renderingEngine.render();
    },
    storePresentation: ({ viewportId }) => {
      cornerstoneViewportService.storePresentation({ viewportId });
    },
    updateVolumeData: ({ volume }) => {
      // update vtkOpenGLTexture and imageData of computed volume
      const { imageData, vtkOpenGLTexture } = volume;
      const numSlices = imageData.getDimensions()[2];
      const slicesToUpdate = [...Array(numSlices).keys()];
      slicesToUpdate.forEach(i => {
        vtkOpenGLTexture.setUpdatedFrame(i);
      });
      imageData.modified();
    },

    attachProtocolViewportDataListener: ({ protocol, stageIndex }) => {
      const EVENT = cornerstoneViewportService.EVENTS.VIEWPORT_DATA_CHANGED;
      const command = protocol.callbacks.onViewportDataInitialized;
      const numPanes = protocol.stages?.[stageIndex]?.viewports.length ?? 1;
      let numPanesWithData = 0;
      const { unsubscribe } = cornerstoneViewportService.subscribe(EVENT, evt => {
        numPanesWithData++;

        if (numPanesWithData === numPanes) {
          commandsManager.run(...command);

          // Unsubscribe from the event
          unsubscribe(EVENT);
        }
      });
    },

    setViewportPreset: ({ viewportId, preset }) => {
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      if (!viewport) {
        return;
      }
      viewport.setProperties({
        preset,
      });
      viewport.render();
    },

    /**
     * Sets the volume quality for a given viewport.
     * @param {string} viewportId - The ID of the viewport to set the volume quality.
     * @param {number} volumeQuality - The desired quality level of the volume rendering.
     */

    setVolumeRenderingQulaity: ({ viewportId, volumeQuality }) => {
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      const { actor } = viewport.getActors()[0];
      const mapper = actor.getMapper();
      const image = mapper.getInputData();
      const dims = image.getDimensions();
      const spacing = image.getSpacing();
      const spatialDiagonal = vec3.length(
        vec3.fromValues(dims[0] * spacing[0], dims[1] * spacing[1], dims[2] * spacing[2])
      );

      let sampleDistance = spacing.reduce((a, b) => a + b) / 3.0;
      sampleDistance /= volumeQuality > 1 ? 0.5 * volumeQuality ** 2 : 1.0;
      const samplesPerRay = spatialDiagonal / sampleDistance + 1;
      mapper.setMaximumSamplesPerRay(samplesPerRay);
      mapper.setSampleDistance(sampleDistance);
      viewport.render();
    },

    /**
     * Shifts opacity points for a given viewport id.
     * @param {string} viewportId - The ID of the viewport to set the mapping range.
     * @param {number} shift - The shift value to shift the points by.
     */
    shiftVolumeOpacityPoints: ({ viewportId, shift }) => {
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      const { actor } = viewport.getActors()[0];
      const ofun = actor.getProperty().getScalarOpacity(0);

      const opacityPointValues = []; // Array to hold values
      // Gather Existing Values
      const size = ofun.getSize();
      for (let pointIdx = 0; pointIdx < size; pointIdx++) {
        const opacityPointValue = [0, 0, 0, 0];
        ofun.getNodeValue(pointIdx, opacityPointValue);
        // opacityPointValue now holds [xLocation, opacity, midpoint, sharpness]
        opacityPointValues.push(opacityPointValue);
      }
      // Add offset
      opacityPointValues.forEach(opacityPointValue => {
        opacityPointValue[0] += shift; // Change the location value
      });
      // Set new values
      ofun.removeAllPoints();
      opacityPointValues.forEach(opacityPointValue => {
        ofun.addPoint(...opacityPointValue);
      });
      viewport.render();
    },

    /**
     * Sets the volume lighting settings for a given viewport.
     * @param {string} viewportId - The ID of the viewport to set the lighting settings.
     * @param {Object} options - The lighting settings to be set.
     * @param {boolean} options.shade - The shade setting for the lighting.
     * @param {number} options.ambient - The ambient setting for the lighting.
     * @param {number} options.diffuse - The diffuse setting for the lighting.
     * @param {number} options.specular - The specular setting for the lighting.
     **/

    setVolumeLighting: ({ viewportId, options }) => {
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      const { actor } = viewport.getActors()[0];
      const property = actor.getProperty();

      if (options.shade !== undefined) {
        property.setShade(options.shade);
      }

      if (options.ambient !== undefined) {
        property.setAmbient(options.ambient);
      }

      if (options.diffuse !== undefined) {
        property.setDiffuse(options.diffuse);
      }

      if (options.specular !== undefined) {
        property.setSpecular(options.specular);
      }

      viewport.render();
    },
    resetCrosshairs: ({ viewportId }) => {
      const crosshairInstances = [];

      const getCrosshairInstances = toolGroupId => {
        const toolGroup = toolGroupService.getToolGroup(toolGroupId);
        crosshairInstances.push(toolGroup.getToolInstance('Crosshairs'));
      };

      if (!viewportId) {
        const toolGroupIds = toolGroupService.getToolGroupIds();
        toolGroupIds.forEach(getCrosshairInstances);
      } else {
        const toolGroup = toolGroupService.getToolGroupForViewport(viewportId);
        getCrosshairInstances(toolGroup.id);
      }

      crosshairInstances.forEach(ins => {
        ins?.computeToolCenter();
      });
    },
    /**
     * Creates a labelmap for the active viewport
     *
     * The created labelmap will be registered as a display set and also added
     * as a segmentation representation to the viewport.
     */
    createLabelmapForViewport: async ({ viewportId, options = {} }) => {
      return createSegmentationForViewport(servicesManager, {
        viewportId,
        options,
        segmentationType: SegmentationRepresentations.Labelmap,
      });
    },
    /**
     * Creates a contour for the active viewport
     *
     * The created contour will be registered as a display set and also added
     * as a segmentation representation to the viewport.
     */
    createContourForViewport: async ({ viewportId, options = {} }) => {
      return createSegmentationForViewport(servicesManager, {
        viewportId,
        options,
        segmentationType: SegmentationRepresentations.Contour,
      });
    },

    /**
     * Sets the active segmentation for a viewport
     * @param props.segmentationId - The ID of the segmentation to set as active
     */
    setActiveSegmentation: ({ segmentationId }) => {
      const { viewportGridService, segmentationService } = servicesManager.services;
      segmentationService.setActiveSegmentation(
        viewportGridService.getActiveViewportId(),
        segmentationId
      );
    },

    /**
     * Adds a new segment to a segmentation
     * @param props.segmentationId - The ID of the segmentation to add the segment to
     */
    addSegmentCommand: ({ segmentationId, config }) => {
      const { segmentationService } = servicesManager.services;
      segmentationService.addSegment(segmentationId, config);
    },

    /**
     * Sets the active segment and jumps to its center
     * @param props.segmentationId - The ID of the segmentation
     * @param props.segmentIndex - The index of the segment to activate
     */
    setActiveSegmentAndCenterCommand: ({ segmentationId, segmentIndex }) => {
      const { segmentationService, viewportGridService } = servicesManager.services;
      // set both active segmentation and active segment
      segmentationService.setActiveSegmentation(
        viewportGridService.getActiveViewportId(),
        segmentationId
      );
      segmentationService.setActiveSegment(segmentationId, segmentIndex);

      const { highlightAlpha, highlightSegment, animationLength, animationFunctionType } =
        (customizationService.getCustomization(
          'panelSegmentation.jumpToSegmentHighlightAnimationConfig'
        ) as Object as {
          highlightAlpha?: number;
          highlightSegment?: boolean;
          animationLength?: number;
          animationFunctionType?: EasingFunctionEnum;
        }) ?? {};

      const validAnimationFunctionType = Object.values(EasingFunctionEnum).includes(
        animationFunctionType
      )
        ? animationFunctionType
        : undefined;

      segmentationService.jumpToSegmentNext(
        segmentationId,
        segmentIndex,
        undefined,
        highlightAlpha,
        highlightSegment,
        animationLength,
        undefined,
        validAnimationFunctionType
      );
    },

    /**
     * Toggles the visibility of a segment
     * @param props.segmentationId - The ID of the segmentation
     * @param props.segmentIndex - The index of the segment
     * @param props.type - The type of visibility to toggle
     */
    toggleSegmentVisibilityCommand: ({ segmentationId, segmentIndex, type }) => {
      const { segmentationService, viewportGridService } = servicesManager.services;
      segmentationService.toggleSegmentVisibility(
        viewportGridService.getActiveViewportId(),
        segmentationId,
        segmentIndex,
        type
      );
    },

    /**
     * Toggles the lock state of a segment
     * @param props.segmentationId - The ID of the segmentation
     * @param props.segmentIndex - The index of the segment
     */
    toggleSegmentLockCommand: ({ segmentationId, segmentIndex }) => {
      const { segmentationService } = servicesManager.services;
      segmentationService.toggleSegmentLocked(segmentationId, segmentIndex);
    },

    /**
     * Toggles the visibility of a segmentation representation
     * @param props.segmentationId - The ID of the segmentation
     * @param props.type - The type of representation
     */
    toggleSegmentationVisibilityCommand: ({ segmentationId, type }) => {
      const { segmentationService, viewportGridService } = servicesManager.services;
      segmentationService.toggleSegmentationRepresentationVisibility(
        viewportGridService.getActiveViewportId(),
        { segmentationId, type }
      );
    },

    /**
     * Downloads a segmentation
     * @param props.segmentationId - The ID of the segmentation to download
     */
    downloadSegmentationCommand: ({ segmentationId }) => {
      const { segmentationService } = servicesManager.services;
      segmentationService.downloadSegmentation(segmentationId);
    },

    /**
     * Stores a segmentation and shows it in the viewport
     * @param props.segmentationId - The ID of the segmentation to store
     */
    storeSegmentationCommand: async args => {
      const { segmentationId } = args;
      const { segmentationService, viewportGridService } = servicesManager.services;

      const displaySetInstanceUIDs = await createReportAsync({
        servicesManager,
        getReport: () => commandsManager.runCommand('storeSegmentation', args),
        reportType: 'Segmentation',
      });

      if (displaySetInstanceUIDs) {
        segmentationService.remove(segmentationId);
        viewportGridService.setDisplaySetsForViewport({
          viewportId: viewportGridService.getActiveViewportId(),
          displaySetInstanceUIDs,
        });
      }
    },

    /**
     * Downloads a segmentation as RTSS
     * @param props.segmentationId - The ID of the segmentation
     */
    downloadRTSSCommand: ({ segmentationId }) => {
      const { segmentationService } = servicesManager.services;
      segmentationService.downloadRTSS(segmentationId);
    },

    /**
     * Sets the style for a segmentation
     * @param props.segmentationId - The ID of the segmentation
     * @param props.type - The type of style
     * @param props.key - The style key to set
     * @param props.value - The style value
     */
    setSegmentationStyleCommand: ({ type, key, value }) => {
      const { segmentationService } = servicesManager.services;
      segmentationService.setStyle({ type }, { [key]: value });
    },

    /**
     * Deletes a segment from a segmentation
     * @param props.segmentationId - The ID of the segmentation
     * @param props.segmentIndex - The index of the segment to delete
     */
    deleteSegmentCommand: ({ segmentationId, segmentIndex }) => {
      const { segmentationService } = servicesManager.services;
      segmentationService.removeSegment(segmentationId, segmentIndex);
    },

    /**
     * Deletes an entire segmentation
     * @param props.segmentationId - The ID of the segmentation to delete
     */
    deleteSegmentationCommand: ({ segmentationId }) => {
      const { segmentationService } = servicesManager.services;
      segmentationService.remove(segmentationId);
    },

    /**
     * Removes a segmentation from the viewport
     * @param props.segmentationId - The ID of the segmentation to remove
     */
    removeSegmentationFromViewportCommand: ({ segmentationId: displaySetInstanceUID }) => {
      const { viewportGridService } = servicesManager.services;
      const viewportId = viewportGridService.getActiveViewportId();

      commandsManager.runCommand('removeDisplaySetLayer', {
        viewportId,
        displaySetInstanceUID,
      });
    },

    /**
     * Toggles rendering of inactive segmentations
     */
    toggleRenderInactiveSegmentationsCommand: () => {
      const { segmentationService, viewportGridService } = servicesManager.services;
      const viewportId = viewportGridService.getActiveViewportId();
      const renderInactive = segmentationService.getRenderInactiveSegmentations(viewportId);
      segmentationService.setRenderInactiveSegmentations(viewportId, !renderInactive);
    },

    editSegmentLabel: async ({ segmentationId, segmentIndex }) => {
      const { segmentationService, uiDialogService } = servicesManager.services;
      const segmentation = segmentationService.getSegmentation(segmentationId);

      if (!segmentation) {
        return;
      }

      const segment = segmentation.segments[segmentIndex];

      callInputDialog({
        uiDialogService,
        title: i18n.t('Tools:Edit Segment Label'),
        placeholder: i18n.t('Tools:Enter new label'),
        defaultValue: segment.label,
      }).then(label => {
        segmentationService.setSegmentLabel(segmentationId, segmentIndex, label);
      });
    },

    editSegmentationLabel: ({ segmentationId }) => {
      const { segmentationService, uiDialogService } = servicesManager.services;
      const segmentation = segmentationService.getSegmentation(segmentationId);

      if (!segmentation) {
        return;
      }

      const { label } = segmentation;

      callInputDialog({
        uiDialogService,
        title: i18n.t('Tools:Edit Segmentation Label'),
        placeholder: i18n.t('Tools:Enter new label'),
        defaultValue: label,
      }).then(label => {
        segmentationService.addOrUpdateSegmentation({ segmentationId, label });
      });
    },

    editSegmentColor: ({ segmentationId, segmentIndex }) => {
      const { segmentationService, uiDialogService, viewportGridService } =
        servicesManager.services;
      const viewportId = viewportGridService.getActiveViewportId();
      const color = segmentationService.getSegmentColor(viewportId, segmentationId, segmentIndex);

      const rgbaColor = {
        r: color[0],
        g: color[1],
        b: color[2],
        a: color[3] / 255.0,
      };

      uiDialogService.show({
        content: colorPickerDialog,
        title: i18n.t('Tools:Segment Color'),
        contentProps: {
          value: rgbaColor,
          onSave: newRgbaColor => {
            const color = [newRgbaColor.r, newRgbaColor.g, newRgbaColor.b, newRgbaColor.a * 255.0];
            segmentationService.setSegmentColor(viewportId, segmentationId, segmentIndex, color);
          },
        },
      });
    },

    getRenderInactiveSegmentations: () => {
      const { segmentationService, viewportGridService } = servicesManager.services;
      return segmentationService.getRenderInactiveSegmentations(
        viewportGridService.getActiveViewportId()
      );
    },

    deleteActiveAnnotation: () => {
      const activeAnnotationsUID = cornerstoneTools.annotation.selection.getAnnotationsSelected();
      activeAnnotationsUID.forEach(activeAnnotationUID => {
        measurementService.remove(activeAnnotationUID);
      });
    },
    /**
     * Aborts an in-progress annotation draw (e.g. a Length/Bidirectional
     * measurement that's mid-drag) on the active viewport, discarding the
     * unfinished annotation. Complements deleteActiveAnnotation, which
     * removes an already-completed, selected annotation instead.
     */
    cancelMeasurement: () => {
      const enabledElement = _getActiveViewportEnabledElement();
      if (!enabledElement) {
        return;
      }
      const { viewportId, viewport } = enabledElement;
      const toolGroup = toolGroupService.getToolGroupForViewport(viewportId);
      const toolName = toolGroup?.getActivePrimaryMouseButtonTool();
      if (!toolName) {
        return;
      }
      const toolInstance = toolGroup.getToolInstance(toolName);
      if (typeof toolInstance?.cancel !== 'function') {
        return;
      }
      // A brand-new (not-yet-finished) annotation's cancel() only stops the
      // draw interaction and *completes* it in place - it does not discard
      // it. Capture that before calling cancel() so we can remove the
      // half-drawn annotation afterwards instead of leaving it behind.
      const isNewAnnotation = !!toolInstance.editData?.newAnnotation;
      const annotationUID = toolInstance.cancel(viewport.element);
      if (isNewAnnotation && annotationUID) {
        cornerstoneTools.annotation.state.removeAnnotation(annotationUID);
      }
    },
    /**
     * Closes a single viewport pane, reflowing the remaining panes to fill
     * the grid (see ViewportGridService.closeViewport for the reflow rules).
     */
    closeViewport: ({ viewportId }: { viewportId?: string } = {}) => {
      const targetViewportId = viewportId || viewportGridService.getActiveViewportId();
      if (!targetViewportId) {
        return;
      }
      viewportGridService.closeViewport(targetViewportId);
    },
    setDisplaySetsForViewports: ({ viewportsToUpdate }) => {
      const { cineService, viewportGridService } = servicesManager.services;
      // Stopping the cine of modified viewports before changing the viewports to
      // avoid inconsistent state and lost references
      viewportsToUpdate.forEach(viewport => {
        const state = cineService.getState();
        const currentCineState = state.cines?.[viewport.viewportId];
        cineService.setCine({
          id: viewport.viewportId,
          frameRate: currentCineState?.frameRate ?? state.default?.frameRate ?? 24,
          isPlaying: false,
        });
      });

      viewportGridService.setDisplaySetsForViewports(viewportsToUpdate);
    },
    undo: () => {
      DefaultHistoryMemo.undo();
    },
    redo: () => {
      DefaultHistoryMemo.redo();
    },
    toggleSegmentPreviewEdit: ({ toggle }) => {
      let labelmapTools = getLabelmapTools({ toolGroupService });
      labelmapTools = labelmapTools.filter(tool => !tool.toolName.includes('Eraser'));
      labelmapTools.forEach(tool => {
        tool.configuration = {
          ...tool.configuration,
          preview: {
            ...tool.configuration.preview,
            enabled: toggle,
          },
        };
      });
    },
    toggleSegmentSelect: ({ toggle }) => {
      const toolGroupIds = toolGroupService.getToolGroupIds();
      toolGroupIds.forEach(toolGroupId => {
        const toolGroup = cornerstoneTools.ToolGroupManager.getToolGroup(toolGroupId);
        if (toggle) {
          toolGroup.setToolActive(cornerstoneTools.SegmentSelectTool.toolName);
        } else {
          toolGroup.setToolDisabled(cornerstoneTools.SegmentSelectTool.toolName);
        }
      });
    },
    toggleSegmentLabel: ({ enabled }: { enabled?: boolean }) => {
      const toolName = cornerstoneTools.SegmentLabelTool.toolName;
      const toolGroupIds = toolGroupService.getToolGroupIds();

      const isToolOn = toolGroupIds.some(toolGroupId => {
        const toolGroup = cornerstoneTools.ToolGroupManager.getToolGroup(toolGroupId);
        const mode = toolGroup.getToolInstance(toolName)?.mode;
        return mode === 'Active';
      });

      const enableTool = enabled !== undefined ? enabled : !isToolOn;

      toolGroupIds.forEach(toolGroupId => {
        const toolGroup = cornerstoneTools.ToolGroupManager.getToolGroup(toolGroupId);
        if (enableTool) {
          toolGroup.setToolActive(toolName);
        } else {
          toolGroup.setToolDisabled(toolName);
        }
      });
    },
    /**
     * Used to sync the apps initial state with the config file settings.
     *
     * Will mutate the tools object of the given tool group and add the segmentLabelTool to the proper place.
     *
     * Use it before initializing the toolGroup with the tools.
     */
    initializeSegmentLabelTool: ({ tools }) => {
      const appConfig = extensionManager.appConfig;
      const segmentLabelConfig = appConfig.segmentation?.segmentLabel;

      if (segmentLabelConfig?.enabledByDefault) {
        const activeTools = tools?.active ?? [];
        activeTools.push({
          toolName: toolNames.SegmentLabel,
          configuration: {
            hoverTimeout: segmentLabelConfig?.hoverTimeout ?? 1,
            color: segmentLabelConfig?.labelColor,
            background: segmentLabelConfig?.background,
          },
        });

        tools.active = activeTools;
        return tools;
      }

      const disabledTools = tools?.disabled ?? [];
      disabledTools.push({
        toolName: toolNames.SegmentLabel,
        configuration: {
          hoverTimeout: segmentLabelConfig?.hoverTimeout ?? 1,
          color: segmentLabelConfig?.labelColor,
        },
      });
      tools.disabled = disabledTools;
      return tools;
    },
    toggleUseCenterSegmentIndex: ({ toggle }) => {
      let labelmapTools = getLabelmapTools({ toolGroupService });
      labelmapTools = labelmapTools.filter(tool => !tool.toolName.includes('Eraser'));
      labelmapTools.forEach(tool => {
        tool.configuration = {
          ...tool.configuration,
          useCenterSegmentIndex: toggle,
        };
      });
    },
    _handlePreviewAction: action => {
      const { viewport } = _getActiveViewportEnabledElement();
      const previewTools = getPreviewTools({ toolGroupService });

      previewTools.forEach(tool => {
        try {
          tool[`${action}Preview`]();
        } catch (error) {
          console.debug('Error accepting preview for tool', tool.toolName);
        }
      });

      if (segmentAI.enabled) {
        segmentAI[`${action}Preview`](viewport.element);
      }
    },
    acceptPreview: () => {
      actions._handlePreviewAction('accept');
    },
    rejectPreview: () => {
      actions._handlePreviewAction('reject');
    },
    /**
     * Esc's actual behavior: whichever applies. Aborts a mid-draw annotation
     * if one is in progress, and/or rejects an active segmentation preview
     * (AI/interpolation) if one is pending - both are safe no-ops when not
     * applicable, so a single Esc press correctly handles either situation.
     */
    cancelMeasurementOrRejectPreview: () => {
      actions.cancelMeasurement();
      actions._handlePreviewAction('reject');
    },
    clearMarkersForMarkerLabelmap: () => {
      const { viewport } = _getActiveViewportEnabledElement();
      const toolGroup = cornerstoneTools.ToolGroupManager.getToolGroupForViewport(viewport.id);
      const toolInstance = toolGroup.getToolInstance('MarkerLabelmap');

      if (!toolInstance) {
        return;
      }

      toolInstance.clearMarkers(viewport);
    },
    interpolateScrollForMarkerLabelmap: () => {
      const { viewport } = _getActiveViewportEnabledElement();
      const toolGroup = cornerstoneTools.ToolGroupManager.getToolGroupForViewport(viewport.id);
      const toolInstance = toolGroup.getToolInstance('MarkerLabelmap');

      if (!toolInstance) {
        return;
      }

      toolInstance.interpolateScroll(viewport, 1);
    },
    toggleLabelmapAssist: async () => {
      const { viewport } = _getActiveViewportEnabledElement();
      const newState = !segmentAI.enabled;
      segmentAI.enabled = newState;

      if (!segmentAIEnabled) {
        await segmentAI.initModel();
        segmentAIEnabled = true;
      }

      // set the brush tool to active
      const toolGroupIds = toolGroupService.getToolGroupIds();
      if (newState) {
        actions.setToolActiveToolbar({
          toolName: 'CircularBrushForAutoSegmentAI',
          toolGroupIds: toolGroupIds,
        });
      } else {
        toolGroupIds.forEach(toolGroupId => {
          const toolGroup = cornerstoneTools.ToolGroupManager.getToolGroup(toolGroupId);
          toolGroup.setToolPassive('CircularBrushForAutoSegmentAI');
        });
      }

      if (segmentAI.enabled) {
        segmentAI.initViewport(viewport);
      }
    },
    setBrushSize: ({ value }) => {
      const brushSize = Number(value);

      toolGroupService.getToolGroupIds()?.forEach(toolGroupId => {
        segmentationUtils.setBrushSizeForToolGroup(toolGroupId, brushSize);
      });
    },
    setThresholdRange: ({
      value,
      toolNames = [
        'ThresholdCircularBrush',
        'ThresholdSphereBrush',
        'ThresholdCircularBrushDynamic',
        'ThresholdSphereBrushDynamic',
      ],
    }) => {
      const toolGroupIds = toolGroupService.getToolGroupIds();
      if (!toolGroupIds?.length) {
        return;
      }

      for (const toolGroupId of toolGroupIds) {
        const toolGroup = toolGroupService.getToolGroup(toolGroupId);
        toolNames?.forEach(toolName => {
          toolGroup.setToolConfiguration(toolName, {
            threshold: {
              range: value,
            },
          });
        });
      }
    },
    increaseBrushSize: () => {
      _handleBrushSizeAction('increase');
    },
    decreaseBrushSize: () => {
      _handleBrushSizeAction('decrease');
    },
    addNewSegment: () => {
      const { segmentationService } = servicesManager.services;
      const { activeViewportId } = viewportGridService.getState();
      const activeSegmentation = segmentationService.getActiveSegmentation(activeViewportId);
      if (!activeSegmentation) {
        return;
      }
      segmentationService.addSegment(activeSegmentation.segmentationId);
    },
    loadSegmentationDisplaySetsForViewport: ({ viewportId, displaySetInstanceUIDs }) => {
      const updatedViewports = getUpdatedViewportsForSegmentation({
        viewportId,
        servicesManager,
        displaySetInstanceUIDs,
      });

      if (!updatedViewports?.length) {
        return;
      }

      updatedViewports.forEach(({ viewportId: csViewportId }) => {
        const csViewport = cornerstoneViewportService.getCornerstoneViewport(csViewportId);
        csViewport?.setNeedsRender?.();
      });

      actions.setDisplaySetsForViewports({
        viewportsToUpdate: updatedViewports.map(viewport => ({
          viewportId: viewport.viewportId,
          displaySetInstanceUIDs: viewport.displaySetInstanceUIDs,
        })),
      });
    },
    setViewportOrientation: ({ viewportId, orientation }) => {
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);

      if (!viewport || viewport.type !== CoreEnums.ViewportType.ORTHOGRAPHIC) {
        console.warn('Orientation can only be set on volume viewports');
        return;
      }

      // Get display sets for this viewport to verify at least one is reconstructable
      const displaySetUIDs = viewportGridService.getDisplaySetsUIDsForViewport(viewportId);
      const displaySets = displaySetUIDs.map(uid => displaySetService.getDisplaySetByUID(uid));

      if (!displaySets.some(ds => ds.isReconstructable)) {
        console.warn('Cannot change orientation: No reconstructable display sets in viewport');
        return;
      }

      viewport.setOrientation(orientation);
      viewport.render();

      // update the orientation in the viewport info
      const viewportInfo = cornerstoneViewportService.getViewportInfo(viewportId);
      viewportInfo.setOrientation(orientation);
    },
    /**
     * Toggles the horizontal flip state of the viewport.
     */
    toggleViewportHorizontalFlip: ({ viewportId }: { viewportId?: string } = {}) => {
      actions.flipViewportHorizontal({ viewportId, newValue: 'toggle' });
    },

    /**
     * Explicitly sets the horizontal flip state of the viewport.
     */
    setViewportHorizontalFlip: ({
      flipped,
      viewportId,
    }: {
      flipped: boolean;
      viewportId?: string;
    }) => {
      actions.flipViewportHorizontal({ viewportId, newValue: flipped });
    },

    /**
     * Toggles the vertical flip state of the viewport.
     */
    toggleViewportVerticalFlip: ({ viewportId }: { viewportId?: string } = {}) => {
      actions.flipViewportVertical({ viewportId, newValue: 'toggle' });
    },

    /**
     * Explicitly sets the vertical flip state of the viewport.
     */
    setViewportVerticalFlip: ({
      flipped,
      viewportId,
    }: {
      flipped: boolean;
      viewportId?: string;
    }) => {
      actions.flipViewportVertical({ viewportId, newValue: flipped });
    },
    /**
     * Internal helper to rotate or set absolute rotation for a viewport.
     */
    _rotateViewport: ({
      rotation,
      viewportId,
      rotationMode = 'apply',
    }: {
      rotation: number;
      viewportId?: string;
      rotationMode?: 'apply' | 'set';
    }) => {
      const enabledElement = viewportId
        ? _getViewportEnabledElement(viewportId)
        : _getActiveViewportEnabledElement();

      if (!enabledElement) {
        return;
      }

      const { viewport } = enabledElement;

      if (viewport instanceof BaseVolumeViewport) {
        const camera = viewport.getCamera();
        const rotAngle = (rotation * Math.PI) / 180;
        const rotMat = mat4.identity(new Float32Array(16));
        mat4.rotate(rotMat, rotMat, rotAngle, camera.viewPlaneNormal);
        const rotatedViewUp = vec3.transformMat4(vec3.create(), camera.viewUp, rotMat);
        viewport.setCamera({ viewUp: rotatedViewUp as CoreTypes.Point3 });
        viewport.render();
        return;
      }

      if (viewport.getRotation !== undefined) {
        const { rotation: currentRotation } = viewport.getViewPresentation();
        const newRotation =
          rotationMode === 'apply'
            ? (currentRotation + rotation + 360) % 360
            : (() => {
                // In 'set' mode, account for the effect horizontal/vertical flips
                // have on the perceived rotation direction. A single flip mirrors
                // the image and inverses rotation direction, while two flips
                // restore the original parity. We therefore invert the rotation
                // angle when an odd number of flips are applied so that the
                // requested absolute rotation matches the user expectation.
                const { flipHorizontal = false, flipVertical = false } =
                  viewport.getViewPresentation();

                const flipsParity = (flipHorizontal ? 1 : 0) + (flipVertical ? 1 : 0);
                const effectiveRotation = flipsParity % 2 === 1 ? -rotation : rotation;

                return (effectiveRotation + 360) % 360;
              })();
        viewport.setViewPresentation({ rotation: newRotation });
        viewport.render();
      }
    },
    startRecordingForAnnotationGroup: () => {
      cornerstoneTools.AnnotationTool.startGroupRecording();
    },
    endRecordingForAnnotationGroup: () => {
      cornerstoneTools.AnnotationTool.endGroupRecording();
    },
    triggerCreateAnnotationMemo: ({
      annotation,
      FrameOfReferenceUID,
      options,
    }: {
      annotation: ToolTypes.Annotation;
      FrameOfReferenceUID: string;
      options: { newAnnotation?: boolean; deleting?: boolean };
    }): void => {
      const { newAnnotation, deleting } = options;
      const renderingEngines = getRenderingEngines();
      const viewports = renderingEngines.flatMap(re => re.getViewports());
      const validViewport = viewports.find(
        vp => vp.getFrameOfReferenceUID() === FrameOfReferenceUID
      );

      if (!validViewport) {
        return;
      }

      cornerstoneTools.AnnotationTool.createAnnotationMemo(validViewport.element, annotation, {
        newAnnotation,
        deleting,
      });
    },
    activateSelectedSegmentationOfType: ({ segmentationRepresentationType }) => {
      const { segmentationService, viewportGridService } = servicesManager.services;
      const activeViewportId = viewportGridService.getActiveViewportId();
      const { selectedSegmentationsForViewport } =
        useSelectedSegmentationsForViewportStore.getState();
      const segmentationId = selectedSegmentationsForViewport[activeViewportId]?.get(
        segmentationRepresentationType
      );

      if (!segmentationId) {
        return;
      }

      segmentationService.setActiveSegmentation(activeViewportId, segmentationId);
    },
    setDynamicCursorSizeForSculptorTool: ({ value: isDynamicCursorSize }) => {
      const viewportId = viewportGridService.getActiveViewportId();
      const toolGroup = toolGroupService.getToolGroupForViewport(viewportId);
      const sculptorToolInstance = toolGroup.getToolInstance(toolNames.SculptorTool);
      const oldConfiguration = sculptorToolInstance.configuration;

      sculptorToolInstance.configuration = {
        ...oldConfiguration,
        updateCursorSize: isDynamicCursorSize ? 'dynamic' : '',
      };
    },
    setInterpolationToolConfiguration: ({ value: interpolateContours, toolNames }) => {
      const viewportId = viewportGridService.getActiveViewportId();
      const toolGroup = toolGroupService.getToolGroupForViewport(viewportId);

      // Set the interpolation configuration for the active tool.
      const activeTool = toolGroupService.getActiveToolForViewport(viewportId);
      const interpolationConfig = {
        interpolation: {
          enabled: interpolateContours,
        },
      };
      toolGroup.setToolConfiguration(activeTool, interpolationConfig);

      // Now set the interpolation configuration for the other tools specified.
      if (toolNames) {
        Object.values(toolGroup.getToolInstances()).forEach(toolInstance => {
          if (toolNames?.includes(toolInstance.toolName)) {
            toolGroup.setToolConfiguration(toolInstance.toolName, interpolationConfig);
          }
        });
      }
    },
    setSimplifiedSplineForSplineContourSegmentationTool: ({ value: simplifiedSpline }) => {
      const viewportId = viewportGridService.getActiveViewportId();
      const toolGroup = toolGroupService.getToolGroupForViewport(viewportId);
      Object.values(toolGroup.getToolInstances()).forEach(toolInstance => {
        if (toolInstance instanceof SplineContourSegmentationTool) {
          const oldConfiguration = toolInstance.configuration;
          toolInstance.configuration = {
            ...oldConfiguration,
            simplifiedSpline,
          };
        }
      });
    },
    removeSmallContours: ({ areaThreshold: threshold }) => {
      const viewportId = viewportGridService.getActiveViewportId();
      const activeSegmentation = segmentationService.getActiveSegmentation(viewportId);
      const activeSegment = segmentationService.getActiveSegment(viewportId);

      if (!activeSegmentation || !activeSegment) {
        return;
      }

      const { removeContourIslands } = segmentationUtilities;
      removeContourIslands(activeSegmentation.segmentationId, activeSegment.segmentIndex, {
        threshold,
      });
      const renderingEngine = cornerstoneViewportService.getRenderingEngine();
      renderingEngine.render();
    },
    applyLogicalContourOperation: ({
      segmentAInfo,
      segmentBInfo,
      resultSegmentInfo,
      logicalOperation,
    }: {
      segmentAInfo: SegmentInfo;
      segmentBInfo: SegmentInfo;
      resultSegmentInfo: OperatorOptions;
      logicalOperation: LogicalOperation;
    }) => {
      switch (logicalOperation) {
        case LogicalOperation.Union:
          add(segmentAInfo, segmentBInfo, resultSegmentInfo);
          break;
        case LogicalOperation.Intersect:
          intersect(segmentAInfo, segmentBInfo, resultSegmentInfo);
          break;
        case LogicalOperation.Subtract:
          subtract(segmentAInfo, segmentBInfo, resultSegmentInfo);
          break;
        default:
          throw new Error('Unsupported logical operation');
      }
    },
    copyContourSegment: ({
      sourceSegmentInfo,
      targetSegmentInfo,
    }: {
      sourceSegmentInfo: SegmentInfo;
      targetSegmentInfo?: SegmentInfo;
    }) => {
      if (!targetSegmentInfo) {
        targetSegmentInfo = {
          segmentationId: sourceSegmentInfo.segmentationId,
          segmentIndex: segmentationService.getNextAvailableSegmentIndex(
            sourceSegmentInfo.segmentationId
          ),
        };
        segmentationService.addSegment(targetSegmentInfo.segmentationId, {
          segmentIndex: targetSegmentInfo.segmentIndex,
        });
      }

      copy(sourceSegmentInfo, targetSegmentInfo);
    },
    smoothContours: () => {
      const viewportId = viewportGridService.getActiveViewportId();
      const activeSegmentation = segmentationService.getActiveSegmentation(viewportId);
      const activeSegment = segmentationService.getActiveSegment(viewportId);

      if (!activeSegmentation || !activeSegment) {
        return;
      }

      const { smoothContours } = segmentationUtilities;
      smoothContours(activeSegmentation.segmentationId, activeSegment.segmentIndex);

      const renderingEngine = cornerstoneViewportService.getRenderingEngine();
      renderingEngine.render();
    },
    removeContourHoles: () => {
      const viewportId = viewportGridService.getActiveViewportId();
      const activeSegmentation = segmentationService.getActiveSegmentation(viewportId);
      const activeSegment = segmentationService.getActiveSegment(viewportId);

      if (!activeSegmentation || !activeSegment) {
        return;
      }

      const { removeContourHoles } = segmentationUtilities;
      removeContourHoles(activeSegmentation.segmentationId, activeSegment.segmentIndex);

      const renderingEngine = cornerstoneViewportService.getRenderingEngine();
      renderingEngine.render();
    },
    decimateContours: () => {
      const viewportId = viewportGridService.getActiveViewportId();
      const activeSegmentation = segmentationService.getActiveSegmentation(viewportId);
      const activeSegment = segmentationService.getActiveSegment(viewportId);

      if (!activeSegmentation || !activeSegment) {
        return;
      }

      const { decimateContours } = segmentationUtilities;
      decimateContours(activeSegmentation.segmentationId, activeSegment.segmentIndex);

      const renderingEngine = cornerstoneViewportService.getRenderingEngine();
      renderingEngine.render();
    },
    convertContourHoles: () => {
      const viewportId = viewportGridService.getActiveViewportId();
      const activeSegmentation = segmentationService.getActiveSegmentation(viewportId);
      const activeSegment = segmentationService.getActiveSegment(viewportId);

      if (!activeSegmentation || !activeSegment) {
        return;
      }

      const targetSegmentInfo = {
        segmentationId: activeSegmentation.segmentationId,
        segmentIndex: segmentationService.getNextAvailableSegmentIndex(
          activeSegmentation.segmentationId
        ),
      };

      segmentationService.addSegment(targetSegmentInfo.segmentationId, {
        segmentIndex: targetSegmentInfo.segmentIndex,
      });

      const { convertContourHoles } = segmentationUtilities;
      convertContourHoles(
        activeSegmentation.segmentationId,
        activeSegment.segmentIndex,
        targetSegmentInfo.segmentationId,
        targetSegmentInfo.segmentIndex
      );

      const renderingEngine = cornerstoneViewportService.getRenderingEngine();
      renderingEngine.render();
    },
  };

  const definitions = {
    // The command here is to show the viewer context menu, as being the
    // context menu
    showCornerstoneContextMenu: {
      commandFn: actions.showCornerstoneContextMenu,
      options: {
        menuCustomizationId: 'measurementsContextMenu',
        commands: [
          {
            commandName: 'showContextMenu',
          },
        ],
      },
    },

    getNearbyToolData: {
      commandFn: actions.getNearbyToolData,
    },
    getNearbyAnnotation: {
      commandFn: actions.getNearbyAnnotation,
      storeContexts: [],
      options: {},
    },
    toggleViewportColorbar: {
      commandFn: actions.toggleViewportColorbar,
    },
    setMeasurementLabel: {
      commandFn: actions.setMeasurementLabel,
    },
    renameMeasurement: {
      commandFn: actions.renameMeasurement,
    },
    updateMeasurement: {
      commandFn: actions.updateMeasurement,
    },
    jumpToMeasurement: actions.jumpToMeasurement,
    removeMeasurement: {
      commandFn: actions.removeMeasurement,
    },
    calibrateMeasurement: {
      commandFn: actions.calibrateMeasurement,
    },
    toggleLockMeasurement: {
      commandFn: actions.toggleLockMeasurement,
    },
    toggleVisibilityMeasurement: {
      commandFn: actions.toggleVisibilityMeasurement,
    },
    downloadCSVMeasurementsReport: {
      commandFn: actions.downloadCSVMeasurementsReport,
    },
    setViewportWindowLevel: {
      commandFn: actions.setViewportWindowLevel,
    },
    setWindowLevel: {
      commandFn: actions.setWindowLevel,
    },
    setWindowLevelPreset: {
      commandFn: actions.setWindowLevelPreset,
    },
    setToolActive: {
      commandFn: actions.setToolActive,
    },
    setToolActiveToolbar: {
      commandFn: actions.setToolActiveToolbar,
    },
    toggleToolActiveToolbar: {
      commandFn: actions.toggleToolActiveToolbar,
    },
    setToolEnabled: {
      commandFn: actions.setToolEnabled,
    },
    rotateViewportCW: {
      commandFn: actions.rotateViewportBy,
      options: { rotation: 90 },
    },
    rotateViewportCCW: {
      commandFn: actions.rotateViewportBy,
      options: { rotation: -90 },
    },
    rotateViewportCWSet: {
      commandFn: actions.setViewportRotation,
      options: { rotation: 90 },
    },
    // RadiAnt Features list: "Rotate (90 CW, 90 CCW, 180)". No RadiAnt
    // keyboard shortcut is documented for this one (only CW/CCW have
    // dedicated keys), so it's toolbar-only - see hotkeyBindings.ts comment.
    rotateViewport180: {
      commandFn: actions.rotateViewportBy,
      options: { rotation: 180 },
    },
    incrementActiveViewport: {
      commandFn: actions.changeActiveViewport,
    },
    decrementActiveViewport: {
      commandFn: actions.changeActiveViewport,
      options: { direction: -1 },
    },
    flipViewportHorizontal: {
      commandFn: actions.toggleViewportHorizontalFlip,
    },
    flipViewportVertical: {
      commandFn: actions.toggleViewportVerticalFlip,
    },
    setViewportHorizontalFlip: {
      commandFn: actions.setViewportHorizontalFlip,
      options: { flipped: true },
    },
    setViewportVerticalFlip: {
      commandFn: actions.setViewportVerticalFlip,
      options: { flipped: true },
    },
    invertViewport: {
      commandFn: actions.invertViewport,
    },
    togglePatientInfoVisibility: {
      commandFn: actions.togglePatientInfoVisibility,
    },
    generateTimeIntensityCurve: {
      commandFn: actions.generateTimeIntensityCurve,
    },
    toggleFusion: {
      commandFn: actions.toggleFusion,
    },
    resetViewport: {
      commandFn: actions.resetViewport,
    },
    clearViewportTransformations: {
      commandFn: actions.clearViewportTransformations,
    },
    scaleUpViewport: {
      commandFn: actions.scaleViewport,
      options: { direction: 1 },
    },
    scaleDownViewport: {
      commandFn: actions.scaleViewport,
      options: { direction: -1 },
    },
    fitViewportToWindow: {
      commandFn: actions.scaleViewport,
      options: { direction: 0 },
    },
    nextImage: {
      commandFn: actions.scroll,
      options: { direction: 1 },
    },
    previousImage: {
      commandFn: actions.scroll,
      options: { direction: -1 },
    },
    firstImage: {
      commandFn: actions.jumpToImage,
      options: { imageIndex: 0 },
    },
    lastImage: {
      commandFn: actions.jumpToImage,
      options: { imageIndex: -1 },
    },
    jumpToImage: {
      commandFn: actions.jumpToImage,
    },
    showDownloadViewportModal: {
      commandFn: actions.showDownloadViewportModal,
    },
    toggleCine: {
      commandFn: actions.toggleCine,
    },
    arrowTextCallback: {
      commandFn: actions.arrowTextCallback,
    },
    setViewportActive: {
      commandFn: actions.setViewportActive,
    },
    setViewportColormap: {
      commandFn: actions.setViewportColormap,
    },
    setViewportForToolConfiguration: {
      commandFn: actions.setViewportForToolConfiguration,
    },
    storePresentation: {
      commandFn: actions.storePresentation,
    },
    attachProtocolViewportDataListener: {
      commandFn: actions.attachProtocolViewportDataListener,
    },
    setViewportPreset: {
      commandFn: actions.setViewportPreset,
    },
    setVolumeRenderingQulaity: {
      commandFn: actions.setVolumeRenderingQulaity,
    },
    shiftVolumeOpacityPoints: {
      commandFn: actions.shiftVolumeOpacityPoints,
    },
    setVolumeLighting: {
      commandFn: actions.setVolumeLighting,
    },
    resetCrosshairs: {
      commandFn: actions.resetCrosshairs,
    },
    toggleSynchronizer: {
      commandFn: actions.toggleSynchronizer,
    },
    toggleSynchronizerExclusive: {
      commandFn: actions.toggleSynchronizerExclusive,
    },
    ensureDefaultSyncOnViewportsReady: {
      commandFn: actions.ensureDefaultSyncOnViewportsReady,
    },
    toggleZoomPanSync: {
      commandFn: actions.toggleZoomPanSync,
    },
    updateVolumeData: {
      commandFn: actions.updateVolumeData,
    },
    toggleEnabledDisabledToolbar: {
      commandFn: actions.toggleEnabledDisabledToolbar,
    },
    toggleActiveDisabledToolbar: {
      commandFn: actions.toggleActiveDisabledToolbar,
    },
    activateCrosshairsAnywhere: {
      commandFn: actions.activateCrosshairsAnywhere,
    },
    updateStoredPositionPresentation: {
      commandFn: actions.updateStoredPositionPresentation,
    },
    updateStoredSegmentationPresentation: {
      commandFn: actions.updateStoredSegmentationPresentation,
    },
    createLabelmapForViewport: {
      commandFn: actions.createLabelmapForViewport,
    },
    createContourForViewport: {
      commandFn: actions.createContourForViewport,
    },
    setActiveSegmentation: {
      commandFn: actions.setActiveSegmentation,
    },
    addSegment: {
      commandFn: actions.addSegmentCommand,
    },
    setActiveSegmentAndCenter: {
      commandFn: actions.setActiveSegmentAndCenterCommand,
    },
    toggleSegmentVisibility: {
      commandFn: actions.toggleSegmentVisibilityCommand,
    },
    toggleSegmentLock: {
      commandFn: actions.toggleSegmentLockCommand,
    },
    toggleSegmentationVisibility: {
      commandFn: actions.toggleSegmentationVisibilityCommand,
    },
    downloadSegmentation: {
      commandFn: actions.downloadSegmentationCommand,
    },
    storeSegmentation: {
      commandFn: actions.storeSegmentationCommand,
    },
    downloadRTSS: {
      commandFn: actions.downloadRTSSCommand,
    },
    setSegmentationStyle: {
      commandFn: actions.setSegmentationStyleCommand,
    },
    deleteSegment: {
      commandFn: actions.deleteSegmentCommand,
    },
    deleteSegmentation: {
      commandFn: actions.deleteSegmentationCommand,
    },
    removeSegmentationFromViewport: {
      commandFn: actions.removeSegmentationFromViewportCommand,
    },
    toggleRenderInactiveSegmentations: {
      commandFn: actions.toggleRenderInactiveSegmentationsCommand,
    },
    setFillAlpha: {
      commandFn: createSetStyleCommand('fillAlpha'),
    },
    setOutlineWidth: {
      commandFn: createSetStyleCommand('outlineWidth'),
    },
    setRenderFill: {
      commandFn: createSetStyleCommand('renderFill'),
    },
    setRenderFillInactive: {
      commandFn: createSetStyleCommand('renderFillInactive'),
    },
    setRenderOutline: {
      commandFn: createSetStyleCommand('renderOutline'),
    },
    setRenderOutlineInactive: {
      commandFn: createSetStyleCommand('renderOutlineInactive'),
    },
    setFillAlphaInactive: {
      commandFn: createSetStyleCommand('fillAlphaInactive'),
    },
    editSegmentLabel: {
      commandFn: actions.editSegmentLabel,
    },
    editSegmentationLabel: {
      commandFn: actions.editSegmentationLabel,
    },
    editSegmentColor: {
      commandFn: actions.editSegmentColor,
    },
    getRenderInactiveSegmentations: {
      commandFn: actions.getRenderInactiveSegmentations,
    },
    deleteActiveAnnotation: {
      commandFn: actions.deleteActiveAnnotation,
    },
    cancelMeasurement: {
      commandFn: actions.cancelMeasurement,
    },
    closeViewport: {
      commandFn: actions.closeViewport,
    },
    setDisplaySetsForViewports: actions.setDisplaySetsForViewports,
    undo: actions.undo,
    redo: actions.redo,
    interpolateLabelmap: actions.interpolateLabelmap,
    runSegmentBidirectional: actions.runSegmentBidirectional,
    downloadCSVSegmentationReport: actions.downloadCSVSegmentationReport,
    toggleSegmentPreviewEdit: actions.toggleSegmentPreviewEdit,
    toggleSegmentSelect: actions.toggleSegmentSelect,
    acceptPreview: actions.acceptPreview,
    rejectPreview: actions.rejectPreview,
    cancelMeasurementOrRejectPreview: actions.cancelMeasurementOrRejectPreview,
    toggleUseCenterSegmentIndex: actions.toggleUseCenterSegmentIndex,
    toggleLabelmapAssist: actions.toggleLabelmapAssist,
    interpolateScrollForMarkerLabelmap: actions.interpolateScrollForMarkerLabelmap,
    clearMarkersForMarkerLabelmap: actions.clearMarkersForMarkerLabelmap,
    setBrushSize: actions.setBrushSize,
    setThresholdRange: actions.setThresholdRange,
    increaseBrushSize: actions.increaseBrushSize,
    decreaseBrushSize: actions.decreaseBrushSize,
    addNewSegment: actions.addNewSegment,
    loadSegmentationDisplaySetsForViewport: actions.loadSegmentationDisplaySetsForViewport,
    setViewportOrientation: actions.setViewportOrientation,
    hydrateSecondaryDisplaySet: actions.hydrateSecondaryDisplaySet,
    getVolumeIdForDisplaySet: actions.getVolumeIdForDisplaySet,
    triggerCreateAnnotationMemo: actions.triggerCreateAnnotationMemo,
    startRecordingForAnnotationGroup: actions.startRecordingForAnnotationGroup,
    endRecordingForAnnotationGroup: actions.endRecordingForAnnotationGroup,
    toggleSegmentLabel: actions.toggleSegmentLabel,
    jumpToMeasurementViewport: actions.jumpToMeasurementViewport,
    initializeSegmentLabelTool: actions.initializeSegmentLabelTool,
    activateSelectedSegmentationOfType: actions.activateSelectedSegmentationOfType,
    setDynamicCursorSizeForSculptorTool: actions.setDynamicCursorSizeForSculptorTool,
    setSimplifiedSplineForSplineContourSegmentationTool:
      actions.setSimplifiedSplineForSplineContourSegmentationTool,
    removeSmallContours: actions.removeSmallContours,
    applyLogicalContourOperation: actions.applyLogicalContourOperation,
    copyContourSegment: actions.copyContourSegment,
    smoothContours: actions.smoothContours,
    removeContourHoles: actions.removeContourHoles,
    decimateContours: actions.decimateContours,
    convertContourHoles: actions.convertContourHoles,
    setInterpolationToolConfiguration: actions.setInterpolationToolConfiguration,
  };

  return {
    actions,
    definitions,
    defaultContext: 'CORNERSTONE',
  };
}

export default commandsModule;
