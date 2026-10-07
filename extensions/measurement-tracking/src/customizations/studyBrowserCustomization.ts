import { measurementTrackingMode } from '../contexts/TrackedMeasurementsContext/promptBeginTracking';

type CheckHasDirtyAndSimplifiedModeProps = {
  servicesManager: AppTypes.ServicesManager;
  appConfig: AppTypes.Config;
  displaySetInstanceUID: string;
};

const onDoubleClickHandler = {
  callbacks: [
    ({ activeViewportId, servicesManager, isHangingProtocolLayout, appConfig }) =>
      async displaySetInstanceUID => {
        const { hangingProtocolService, viewportGridService, uiNotificationService, studyPrefetcherService } =
          servicesManager.services;
        let updatedViewports = [];
        const viewportId = activeViewportId;
        const haveDirtyMeasurementsInSimplifiedMode = checkHasDirtyAndSimplifiedMode({
          servicesManager,
          appConfig,
          displaySetInstanceUID,
        });

        try {
          if (!haveDirtyMeasurementsInSimplifiedMode) {
            updatedViewports = hangingProtocolService.getViewportsRequireUpdate(
              viewportId,
              displaySetInstanceUID,
              isHangingProtocolLayout
            );
            // SKM 2026-10-09 (QA fix — Priority 2 round 9): synchronous switch
            // signal, in the SAME call stack as the user's thumbnail click. This is
            // the ACTUAL production thumbnail-selection handler for this deployment
            // (measurement-tracking's $set override of
            // 'studyBrowser.thumbnailDoubleClickCallback', a dependency of the
            // longitudinal mode) — round 8 placed this same call in
            // commandsModule.ts's setDisplaySetsForViewports command handler, which
            // round 8 QA proved the real UI never reaches, since this handler calls
            // viewportGridService.setDisplaySetsForViewports() directly without
            // going through commandsManager.run() at all. Reuses the exact existing
            // Round 7/8 API — no new restart mechanism, no new dedup logic.
            // Best-effort/non-blocking: a dedicated try/catch (not the outer one)
            // so a signal failure can never surface as the "could not be added to
            // the viewport" user notification below, which is reserved for a
            // genuine viewport-grid update failure.
            updatedViewports.forEach((viewport: any) => {
              try {
                studyPrefetcherService?.onViewportDisplaySetWillChange?.(
                  viewport.viewportId,
                  viewport.displaySetInstanceUIDs,
                  'measurementTracking'
                );
              } catch (e) {
                /* never let this block the actual viewport/display-set switch */
              }
            });
            viewportGridService.setDisplaySetsForViewports(updatedViewports);
          }
        } catch (error) {
          console.warn(error);
          uiNotificationService.show({
            title: 'Thumbnail Double Click',
            message: 'The selected display sets could not be added to the viewport.',
            type: 'error',
            duration: 3000,
          });
        }
      },
  ],
};

const customOnDropHandlerCallback = async props => {
  const handled = checkHasDirtyAndSimplifiedMode(props);
  return Promise.resolve({ handled });
};

const checkHasDirtyAndSimplifiedMode = (props: CheckHasDirtyAndSimplifiedModeProps) => {
  const { servicesManager, appConfig, displaySetInstanceUID } = props;
  const simplifiedMode = appConfig.measurementTrackingMode === measurementTrackingMode.SIMPLIFIED;
  const { measurementService, displaySetService } = servicesManager.services;
  const measurements = measurementService.getMeasurements();
  const haveDirtyMeasurements =
    measurements.some(m => m.isDirty) ||
    (measurements.length && measurementService.getIsMeasurementDeletedIndividually());
  const displaySet = displaySetService.getDisplaySetByUID(displaySetInstanceUID);
  const hasDirtyAndSimplifiedMode =
    displaySet.Modality === 'SR' && simplifiedMode && haveDirtyMeasurements;
  return hasDirtyAndSimplifiedMode;
};

export { onDoubleClickHandler, customOnDropHandlerCallback };
