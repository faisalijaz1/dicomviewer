import isHangingProtocolAvailable from '../utils/isHangingProtocolAvailable';

export default {
  'layoutSelector.advancedPresetGenerator': ({
    servicesManager,
  }: {
    servicesManager: AppTypes.ServicesManager;
  }) => {
    const generateAdvancedPresets = ({
      servicesManager,
    }: {
      servicesManager: AppTypes.ServicesManager;
    }) => {
      const { hangingProtocolService, displaySetService } = servicesManager.services;

      const hangingProtocols = Array.from(hangingProtocolService.protocols.values());

      return hangingProtocols
        .map(hp => {
          if (!hp.isPreset) {
            return null;
          }

          const areValid = isHangingProtocolAvailable(
            hp,
            displaySetService,
            hangingProtocolService
          );

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
