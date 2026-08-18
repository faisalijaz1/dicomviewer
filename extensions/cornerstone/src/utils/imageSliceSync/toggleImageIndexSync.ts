import { DisplaySetService, ViewportGridService } from '@ohif/core';

const IMAGE_INDEX_SYNC_NAME = 'IMAGE_INDEX_SYNC';

/**
 * "Manual" (index-based) counterpart to toggleImageSliceSync ("Auto",
 * position-based). Mirrors its logic exactly, only the sync `type` differs.
 */
export default function toggleImageIndexSync({
  servicesManager,
  viewports: providedViewports,
  syncId,
}: withAppTypes) {
  const { syncGroupService, viewportGridService, displaySetService, cornerstoneViewportService } =
    servicesManager.services;

  syncId ||= IMAGE_INDEX_SYNC_NAME;

  const viewports =
    providedViewports || getReconstructableStackViewports(viewportGridService, displaySetService);

  const someViewportHasSync = viewports.some(viewport => {
    const syncStates = syncGroupService.getSynchronizersForViewport(
      viewport.viewportOptions.viewportId
    );

    const imageSync = syncStates.find(syncState => syncState.id === syncId);

    return !!imageSync;
  });

  if (someViewportHasSync) {
    return disableSync(syncId, servicesManager);
  }

  viewports.forEach(gridViewport => {
    const { viewportId } = gridViewport.viewportOptions;
    const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
    if (!viewport) {
      return;
    }
    syncGroupService.addViewportToSyncGroup(viewportId, viewport.getRenderingEngine().id, {
      // Must match the button config's commandOptions.type ('imageIndex')
      // exactly - synchronizersByType/getSynchronizersOfType key off this
      // string as-is (unlike synchronizer *creation*, which lowercases it),
      // so a casing mismatch here silently breaks the toolbar's toggled
      // (selected) visual state without affecting the sync itself.
      type: 'imageIndex',
      id: syncId,
      source: true,
      target: true,
    });
  });
}

function disableSync(syncName, servicesManager: AppTypes.ServicesManager) {
  const { syncGroupService, viewportGridService, displaySetService, cornerstoneViewportService } =
    servicesManager.services;
  const viewports = getReconstructableStackViewports(viewportGridService, displaySetService);
  viewports.forEach(gridViewport => {
    const { viewportId } = gridViewport.viewportOptions;
    const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
    if (!viewport) {
      return;
    }
    syncGroupService.removeViewportFromSyncGroup(
      viewport.id,
      viewport.getRenderingEngine().id,
      syncName
    );
  });
}

function getReconstructableStackViewports(
  viewportGridService: ViewportGridService,
  displaySetService: DisplaySetService
) {
  let { viewports } = viewportGridService.getState();

  viewports = [...viewports.values()];
  viewports = viewports.filter(
    viewport => viewport.displaySetInstanceUIDs && viewport.displaySetInstanceUIDs.length
  );

  viewports = viewports.filter(viewport => {
    const { displaySetInstanceUIDs } = viewport;

    for (const displaySetInstanceUID of displaySetInstanceUIDs) {
      const displaySet = displaySetService.getDisplaySetByUID(displaySetInstanceUID);

      if (displaySet && displaySet.isReconstructable) {
        return true;
      }

      return false;
    }
  });
  return viewports;
}
