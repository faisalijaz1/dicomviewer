export default {
  'layoutSelector.advancedPresetGenerator': ({
    servicesManager,
  }: {
    servicesManager: AppTypes.ServicesManager;
  }) => {
    // Each displaySetSelector (e.g. fusion's "ctDisplaySet" + "ptDisplaySet")
    // needs to be satisfied by AT LEAST ONE of the available display sets -
    // not ALL of them simultaneously by the SAME single display set. The
    // previous version checked every selector against only `displaySets[0]`,
    // which made any protocol requiring more than one modality at once
    // (like PET/CT Fusion, which needs a CT selector AND a separate PT
    // selector to both match) permanently report as unavailable, since a
    // single display set can never be both Modality=CT and Modality=PT.
    const _areSelectorsValid = (
      hp: AppTypes.HangingProtocol.Protocol,
      displaySets: AppTypes.DisplaySet[],
      hangingProtocolService: AppTypes.HangingProtocolService
    ) => {
      if (!hp.displaySetSelectors || Object.values(hp.displaySetSelectors).length === 0) {
        return true;
      }

      return Object.values(hp.displaySetSelectors).every(selector =>
        displaySets.some(displaySet =>
          hangingProtocolService.areRequiredSelectorsValid([selector], displaySet)
        )
      );
    };

    const generateAdvancedPresets = ({
      servicesManager,
    }: {
      servicesManager: AppTypes.ServicesManager;
    }) => {
      const { hangingProtocolService, displaySetService } = servicesManager.services;

      const hangingProtocols = Array.from(hangingProtocolService.protocols.values());

      // Check against every currently-loaded display set in the study, not
      // just whatever's in the active viewport right now - a protocol like
      // PET/CT Fusion should be available as soon as the study has both a
      // CT and a PT series loaded, regardless of which one the user
      // currently has on screen.
      const activeDisplaySets = displaySetService.getActiveDisplaySets();

      if (!activeDisplaySets?.length) {
        return [];
      }

      const displaySets = activeDisplaySets.map(displaySet => {
        const referencedDisplaySetUID = displaySet?.measurements?.[0]?.displaySetInstanceUID;
        if (displaySet.Modality === 'SR' && referencedDisplaySetUID) {
          return displaySetService.getDisplaySetByUID(referencedDisplaySetUID);
        }
        return displaySet;
      });

      return hangingProtocols
        .map(hp => {
          if (!hp.isPreset) {
            return null;
          }

          const areValid = _areSelectorsValid(hp, displaySets, hangingProtocolService);

          return {
            icon: hp.icon,
            title: hp.name,
            commandOptions: {
              protocolId: hp.id,
            },
            disabled: !areValid,
          };
        })
        .filter(preset => preset !== null);
    };

    return generateAdvancedPresets({ servicesManager });
  },
  'layoutSelector.commonPresets': [
    {
      icon: 'layout-common-1x1',
      commandOptions: {
        numRows: 1,
        numCols: 1,
      },
    },
    {
      icon: 'layout-common-1x2',
      commandOptions: {
        numRows: 1,
        numCols: 2,
      },
    },
    {
      icon: 'layout-common-2x2',
      commandOptions: {
        numRows: 2,
        numCols: 2,
      },
    },
    {
      icon: 'layout-common-2x3',
      commandOptions: {
        numRows: 2,
        numCols: 3,
      },
    },
  ],
};
