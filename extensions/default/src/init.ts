import { DicomMetadataStore, classes } from '@ohif/core';
import { calculateSUVScalingFactors } from '@cornerstonejs/calculate-suv';

import getPTImageIdInstanceMetadata from './getPTImageIdInstanceMetadata';
import { registerHangingProtocolAttributes } from './hangingprotocols';
import { HotkeysManager } from '@ohif/core';

const metadataProvider = classes.MetadataProvider;

/**
 *
 * @param {Object} servicesManager
 * @param {Object} configuration
 */
export default function init({
  servicesManager,
  commandsManager,
  hotkeysManager,
}: withAppTypes): void {
  const { toolbarService, cineService, viewportGridService, uiNotificationService } =
    servicesManager.services;

  // cornerstone3D/VTK.js has no handling at all for the browser forcibly
  // losing a WebGL context (a hard GPU/browser resource limit - Chrome
  // allows roughly 16 total contexts across every open window combined,
  // and each viewport pane is its own context) - without this, a lost
  // context cascades into a wall of confusing "object does not belong to
  // this context" render errors and a silently frozen/black viewport, with
  // nothing telling the user what actually happened. This won't prevent
  // the underlying resource exhaustion (that's a browser/OS/GPU limit, not
  // something fixable from application code), but it turns it into a
  // clear, actionable message instead of a silent-looking crash.
  let contextLossNotified = false;
  document.addEventListener(
    'webglcontextlost',
    event => {
      // Required for the browser to even attempt restoring the context
      // later (webglcontextrestored) instead of leaving it permanently dead.
      event.preventDefault();

      if (contextLossNotified) {
        return;
      }
      contextLossNotified = true;

      console.error(
        '[OHIF] WebGL context lost - a GPU/browser resource limit (too many rendering contexts open at once, often from several pop-out viewer windows or a very large grid layout), not an application bug. Reloading this window, after closing other open viewer windows, resolves it.'
      );

      uiNotificationService?.show({
        title: 'Display ran out of graphics resources',
        message:
          'This window lost its graphics display and can\'t keep rendering - this happens when too many viewer windows are open at once. Close other open viewer windows, then reload this one to restore the image.',
        type: 'error',
        duration: Infinity,
      });
    },
    true // capture phase - webglcontextlost does not bubble
  );

  // Defensive self-heal for a real cornerstone3D/VTK.js bug: occasionally,
  // when a new stack/series is loaded into a viewport, the camera's
  // focalPoint gets computed from a transient/incomplete image-geometry
  // state (seen in practice as the focal point landing tens of thousands of
  // mm away from the image, off by roughly a factor of the image's own
  // pixel dimensions) and never gets recomputed once the correct geometry
  // is in place. This breaks anything that relies on accurate viewport
  // world-position (Simple Crosshair, Reference Lines, real MPR Crosshairs,
  // sync groups) even though the image itself displays fine. Rather than
  // patch cornerstone3D's internal caching/geometry logic blind, this
  // sanity-checks the focal point shortly after each new stack loads and
  // forces a real resetCamera() if it's obviously wrong (far outside the
  // image's own physical extent) - a normal, safe operation that recomputes
  // the camera from whatever the CURRENT (correct) image geometry is.
  document.addEventListener(
    'CORNERSTONE_VIEWPORT_NEW_IMAGE_SET',
    (evt: CustomEvent) => {
      const { viewportId } = evt.detail || {};
      if (!viewportId) {
        return;
      }

      setTimeout(() => {
        const { cornerstoneViewportService } = servicesManager.services as any;
        const viewport = cornerstoneViewportService?.getCornerstoneViewport?.(viewportId);
        const imageData = viewport?.getImageData?.();
        const camera = viewport?.getCamera?.();

        if (!imageData?.origin || !imageData?.spacing || !imageData?.dimensions || !camera?.focalPoint) {
          return;
        }

        const { origin, spacing, dimensions } = imageData;
        const diagonal = Math.sqrt(
          dimensions.reduce((sum, dim, i) => sum + (dim * spacing[i]) ** 2, 0)
        );
        const distanceFromOrigin = Math.sqrt(
          origin.reduce((sum, o, i) => sum + (camera.focalPoint[i] - o) ** 2, 0)
        );

        // The focal point should be roughly at the image's center - at most
        // half its diagonal away from the origin corner. Anything past a
        // couple of diagonals away is not a legitimate pan, it's this bug.
        if (diagonal > 0 && distanceFromOrigin > diagonal * 3) {
          console.warn(
            "[OHIF] Detected an out-of-bounds camera focal point after loading a new stack - resetting the camera to recompute it from the image's actual geometry.",
            { viewportId, focalPoint: camera.focalPoint, origin, distanceFromOrigin, diagonal }
          );
          viewport.resetCamera();
          viewport.render();
        }
      }, 500);
    },
    true // capture phase - this cornerstone event does not bubble
  );

  toolbarService.registerEventForToolbarUpdate(cineService, [
    cineService.EVENTS.CINE_STATE_CHANGED,
  ]);

  toolbarService.registerEventForToolbarUpdate(hotkeysManager, [
    HotkeysManager.EVENTS.HOTKEY_PRESSED,
  ]);

  // Without this, every toolbar button's visual "active" state (Stack
  // Scroll shown selected by default, Auto Sync shown on, etc.) stays
  // stale at whatever it evaluated to on the very first render - which is
  // usually wrong, since the actual tool/sync state a moment later (once
  // viewports finish loading, or the active viewport changes) is often
  // different. Nothing was re-evaluating button state on its own; it only
  // ever got refreshed as a side effect of the user clicking some other
  // button first, which is exactly the "works after I switch tools once,
  // but not by default" pattern this fixes.
  //
  // Not using toolbarService.registerEventForToolbarUpdate() here (its
  // generic helper) because it refreshes synchronously off
  // viewportGridService.getActiveViewportId() the instant the event fires -
  // but toolGroupService's viewportId<->toolGroup association isn't
  // guaranteed to be wired up yet at that exact synchronous moment (it's
  // set up by the viewport component's own mount effect, which can still
  // be in flight), so evaluate.cornerstoneTool's
  // toolGroupService.getToolGroupForViewport(viewportId) lookup can come
  // back empty and silently skip updating isActive. A microtask-delayed
  // refresh gives that association a chance to finish first.
  const refreshToolbarSoon = () => {
    const viewportId = viewportGridService.getActiveViewportId();
    setTimeout(() => toolbarService.refreshToolbarState({ viewportId }), 0);
  };
  viewportGridService.subscribe(viewportGridService.EVENTS.VIEWPORTS_READY, refreshToolbarSoon);
  viewportGridService.subscribe(
    viewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED,
    refreshToolbarSoon
  );

  // Add
  DicomMetadataStore.subscribe(DicomMetadataStore.EVENTS.INSTANCES_ADDED, handleScalingModules);

  // If the metadata for PET has changed by the user (e.g. manually changing the PatientWeight)
  // we need to recalculate the SUV Scaling Factors
  DicomMetadataStore.subscribe(DicomMetadataStore.EVENTS.SERIES_UPDATED, handleScalingModules);

  // Adds extra custom attributes for use by hanging protocols
  registerHangingProtocolAttributes({ servicesManager });

  // Function to process and subscribe to events for a given set of commands and listeners
  const eventSubscriptions = [];
  const subscribeToEvents = listeners => {
    Object.entries(listeners).forEach(([event, commands]) => {
      const supportedEvents = [
        viewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED,
        viewportGridService.EVENTS.VIEWPORTS_READY,
      ];

      if (supportedEvents.includes(event)) {
        const subscriptionKey = `${event}_${JSON.stringify(commands)}`;

        if (eventSubscriptions.includes(subscriptionKey)) {
          return;
        }

        viewportGridService.subscribe(event, eventData => {
          const viewportId = eventData?.viewportId ?? viewportGridService.getActiveViewportId();

          commandsManager.run(commands, { viewportId });
        });

        eventSubscriptions.push(subscriptionKey);
      }
    });
  };

  toolbarService.subscribe(toolbarService.EVENTS.TOOL_BAR_MODIFIED, state => {
    const { buttons } = state;
    for (const [id, button] of Object.entries(buttons)) {
      const { buttonSection, items, listeners } = button.props || {};

      // Handle group items' listeners
      if (buttonSection && items) {
        items.forEach(item => {
          if (item.listeners) {
            subscribeToEvents(item.listeners);
          }
        });
      }

      // Handle button listeners
      if (listeners) {
        subscribeToEvents(listeners);
      }
    }
  });
}

const handleScalingModules = ({ SeriesInstanceUID, StudyInstanceUID }) => {
  const { instances } = DicomMetadataStore.getSeries(StudyInstanceUID, SeriesInstanceUID);

  if (!instances?.length) {
    return;
  }

  const modality = instances[0].Modality;

  const allowedModality = ['PT', 'RTDOSE'];

  if (!allowedModality.includes(modality)) {
    return;
  }

  const imageIds = instances.map(instance => instance.imageId);
  const instanceMetadataArray = [];

  if (modality === 'RTDOSE') {
    const DoseGridScaling = instances[0].DoseGridScaling;
    const DoseSummation = instances[0].DoseSummation;
    const DoseType = instances[0].DoseType;
    const DoseUnit = instances[0].DoseUnit;
    const NumberOfFrames = instances[0].NumberOfFrames;
    const imageId = imageIds[0];

    // add scaling module to the metadata
    // since RTDOSE is always a multiframe we should add the scaling module to each frame
    for (let i = 0; i < NumberOfFrames; i++) {
      const frameIndex = i + 1;

      // Todo: we should support other things like wadouri, local etc
      const newImageId = `${imageId.replace(/\/frames\/\d+$/, '')}/frames/${frameIndex}`;
      metadataProvider.addCustomMetadata(newImageId, 'scalingModule', {
        DoseGridScaling,
        DoseSummation,
        DoseType,
        DoseUnit,
      });
    }

    return;
  }

  // try except block to prevent errors when the metadata is not correct
  try {
    imageIds.forEach(imageId => {
      const instanceMetadata = getPTImageIdInstanceMetadata(imageId);
      if (instanceMetadata) {
        instanceMetadataArray.push(instanceMetadata);
      }
    });

    if (!instanceMetadataArray.length) {
      return;
    }

    const suvScalingFactors = calculateSUVScalingFactors(instanceMetadataArray);
    instanceMetadataArray.forEach((instanceMetadata, index) => {
      metadataProvider.addCustomMetadata(
        imageIds[index],
        'scalingModule',
        suvScalingFactors[index]
      );
    });
  } catch (error) {
    console.log(error);
  }
};
