/**
 * Whether a given hanging protocol's display-set selectors are satisfiable
 * by the study's currently-active display sets - e.g. the "PET/CT Fusion"
 * protocol needs at least one CT AND at least one PT display set present
 * (not necessarily both already open in a viewport, just loaded/available
 * for the study). Shared by the Layout dropdown's "Advanced" preset list
 * (layoutSelectorCustomization.ts) and the direct toolbar Fusion button
 * (modes/basic/src/toolbarButtons.ts, via evaluate.hangingProtocol.available
 * in getToolbarModule.tsx) so the two can never independently drift out of
 * sync with each other - previously the toolbar button had no such check at
 * all, so it stayed clickable even on a CT-only study while the dropdown's
 * own Fusion entry was correctly greyed out.
 */
export function isHangingProtocolAvailable(
  hp: AppTypes.HangingProtocol.Protocol | undefined,
  displaySetService: AppTypes.DisplaySetService,
  hangingProtocolService: AppTypes.HangingProtocolService
): boolean {
  if (!hp) {
    return false;
  }

  if (!hp.displaySetSelectors || Object.values(hp.displaySetSelectors).length === 0) {
    return true;
  }

  const activeDisplaySets = displaySetService.getActiveDisplaySets();
  if (!activeDisplaySets?.length) {
    return false;
  }

  // SR display sets reference another display set (e.g. the series a
  // measurement was made on) rather than being a real image series
  // themselves - resolve to the real referenced display set before
  // checking selectors against it, same as the Layout dropdown does.
  const displaySets = activeDisplaySets.map(displaySet => {
    const referencedDisplaySetUID = displaySet?.measurements?.[0]?.displaySetInstanceUID;
    if (displaySet.Modality === 'SR' && referencedDisplaySetUID) {
      return displaySetService.getDisplaySetByUID(referencedDisplaySetUID);
    }
    return displaySet;
  });

  return Object.values(hp.displaySetSelectors).every(selector =>
    displaySets.some(displaySet =>
      hangingProtocolService.areRequiredSelectorsValid([selector], displaySet)
    )
  );
}

export default isHangingProtocolAvailable;
