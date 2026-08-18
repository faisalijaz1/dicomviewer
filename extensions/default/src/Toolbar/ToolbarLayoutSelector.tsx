// Updated ToolbarLayoutSelector.tsx
import React, { useCallback, useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { CommandsManager } from '@ohif/core';

import { LayoutSelector } from '@ohif/ui-next';
import { useTranslation } from 'react-i18next';

function ToolbarLayoutSelectorWithServices({
  commandsManager,
  servicesManager,
  rows = 3,
  columns = 4,
  ...props
}) {
  const { customizationService, displaySetService } = servicesManager.services;
  const { t } = useTranslation('ToolbarLayoutSelector');

  // advancedPresetsGenerator (layoutSelectorCustomization.ts) decides which
  // presets are enabled/disabled based on which display sets are CURRENTLY
  // loaded (e.g. PET/CT Fusion needs both a CT and a PT display set) - but
  // it's only ever called inline during this component's own render, with
  // no subscription of its own. If a second modality's series is still
  // streaming in when this first renders (the common case - CT and PT
  // series don't load at the same instant), the dropdown keeps showing
  // that stale "disabled" snapshot from before the second series finished,
  // even though the underlying data has since become available and the
  // preset genuinely should be selectable. Force a re-render whenever the
  // set of loaded display sets changes so this stays live.
  const [, forceRecompute] = useState(0);
  useEffect(() => {
    if (!displaySetService) {
      return;
    }
    const subscriptions = [
      displaySetService.subscribe(displaySetService.EVENTS.DISPLAY_SETS_ADDED, () =>
        forceRecompute(n => n + 1)
      ),
      displaySetService.subscribe(displaySetService.EVENTS.DISPLAY_SETS_CHANGED, () =>
        forceRecompute(n => n + 1)
      ),
    ];
    return () => subscriptions.forEach(subscription => subscription.unsubscribe());
  }, [displaySetService]);

  // Get the presets from the customization service
  const commonPresets = customizationService?.getCustomization('layoutSelector.commonPresets') || [
    {
      icon: 'layout-single',
      commandOptions: {
        numRows: 1,
        numCols: 1,
      },
    },
    {
      icon: 'layout-side-by-side',
      commandOptions: {
        numRows: 1,
        numCols: 2,
      },
    },
    {
      icon: 'layout-four-up',
      commandOptions: {
        numRows: 2,
        numCols: 2,
      },
    },
    {
      icon: 'layout-three-row',
      commandOptions: {
        numRows: 3,
        numCols: 1,
      },
    },
  ];

  // Get the advanced presets generator from the customization service
  const advancedPresetsGenerator = customizationService?.getCustomization(
    'layoutSelector.advancedPresetGenerator'
  );

  // Generate the advanced presets
  const advancedPresets = advancedPresetsGenerator
    ? advancedPresetsGenerator({ servicesManager })
    : [
        {
          title: 'MPR',
          icon: 'layout-three-col',
          commandOptions: {
            protocolId: 'mpr',
          },
        },
        {
          title: 'Sagittal',
          icon: 'layout-side-by-side',
          commandOptions: {
            protocolId: 'mpr2up',
          },
        },
        {
          title: 'Coronal',
          icon: 'layout-side-by-side',
          commandOptions: {
            protocolId: 'mpr2up-coronal',
          },
        },
        {
          title: 'PET/CT Fusion',
          icon: 'layout-single',
          commandOptions: {
            protocolId: 'fusion',
          },
        },
        {
          title: '3D four up',
          icon: 'layout-four-up',
          commandOptions: {
            protocolId: '3d-four-up',
          },
        },
        {
          title: '3D main',
          icon: 'layout-three-row',
          commandOptions: {
            protocolId: '3d-main',
          },
        },
        {
          title: 'Axial Primary',
          icon: 'layout-side-by-side',
          commandOptions: {
            protocolId: 'axial-primary',
          },
        },
        {
          title: '3D only',
          icon: 'layout-single',
          commandOptions: {
            protocolId: '3d-only',
          },
        },
        {
          title: '3D primary',
          icon: 'layout-side-by-side',
          commandOptions: {
            protocolId: '3d-primary',
          },
        },
        {
          title: 'Frame View',
          icon: 'icon-stack',
          commandOptions: {
            protocolId: 'frame-view',
          },
        },
      ];

  // Unified selection handler that dispatches to the appropriate command
  const handleSelectionChange = useCallback(
    (commandOptions, isPreset) => {
      if (isPreset) {
        // Advanced preset selection
        commandsManager.run({
          commandName: 'setHangingProtocol',
          commandOptions,
        });
      } else {
        // Common preset or custom grid selection
        commandsManager.run({
          commandName: 'setViewportGridLayout',
          commandOptions,
        });
      }
    },
    [commandsManager]
  );

  return (
    <div
      id="Layout"
      data-cy="Layout"
    >
      <LayoutSelector
        onSelectionChange={handleSelectionChange}
        {...props}
      >
        <LayoutSelector.Trigger tooltip={t('Change layout')} />
        <LayoutSelector.Content>
          {/* Left side - Presets */}
          {(commonPresets.length > 0 || advancedPresets.length > 0) && (
            <div className="bg-popover flex flex-col gap-2.5 rounded-lg p-2">
              {commonPresets.length > 0 && (
                <>
                  <LayoutSelector.PresetSection title={t('Common')}>
                    {commonPresets.map((preset, index) => (
                      <LayoutSelector.Preset
                        key={`common-preset-${index}`}
                        icon={preset.icon}
                        commandOptions={preset.commandOptions}
                        isPreset={false}
                      />
                    ))}
                  </LayoutSelector.PresetSection>
                  <LayoutSelector.Divider />
                </>
              )}

              {advancedPresets.length > 0 && (
                <LayoutSelector.PresetSection title={t('Advanced')}>
                  {advancedPresets.map((preset, index) => (
                    <LayoutSelector.Preset
                      key={`advanced-preset-${index}`}
                      title={preset.title}
                      icon={preset.icon}
                      commandOptions={preset.commandOptions}
                      disabled={preset.disabled}
                      isPreset={true}
                    />
                  ))}
                </LayoutSelector.PresetSection>
              )}
            </div>
          )}

          {/* Right Side - Grid Layout */}
          <div className="bg-muted flex flex-col gap-2.5 border-l-2 border-solid border-background p-2">
            <div className="text-muted-foreground text-xs">{t('Custom')}</div>
            <LayoutSelector.GridSelector
              rows={rows}
              columns={columns}
            />
            <LayoutSelector.HelpText>
              {t('Hover to select')} <br />
              {t('rows and columns')} <br />
              {t('Click to apply')}
            </LayoutSelector.HelpText>
          </div>
        </LayoutSelector.Content>
      </LayoutSelector>
    </div>
  );
}

ToolbarLayoutSelectorWithServices.propTypes = {
  commandsManager: PropTypes.instanceOf(CommandsManager),
  servicesManager: PropTypes.object,
  rows: PropTypes.number,
  columns: PropTypes.number,
};

export default ToolbarLayoutSelectorWithServices;
