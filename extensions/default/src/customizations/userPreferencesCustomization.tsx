import React, { useMemo, useState, useEffect } from 'react';
import type { TFunction } from 'i18next';
import { useSystem, hotkeys as hotkeysModule } from '@ohif/core';
import { UserPreferencesModal, FooterAction } from '@ohif/ui-next';
import { useTranslation } from 'react-i18next';
import i18n from '@ohif/i18n';

import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Label,
  Switch,
} from '@ohif/ui-next';
import {
  MOUSE_TOOL_GROUP_ID,
  MOUSE_TOOL_OPTIONS,
  MOUSE_BUTTONS,
  getMouseBindingsState,
  applyMouseBindingChanges,
} from '../utils/mouseBindingsUtils';

const { availableLanguages, defaultLanguage, currentLanguage: currentLanguageFn } = i18n;

interface HotkeyDefinition {
  keys: string;
  label: string;
}

interface HotkeyDefinitions {
  [key: string]: HotkeyDefinition;
}

const MODIFIER_OPTIONS = [
  { value: '16', label: 'Shift' },
  { value: '17', label: 'Ctrl' },
  { value: '18', label: 'Alt' },
  { value: '91', label: 'Meta' },
];

const DEFAULT_TOOL_BINDINGS_STORAGE_KEY = 'user-preferred-tool-bindings';

// ────────────────────────────────────────────────────────────────────────────
//  DICOM Image Memory — production UI for the existing SKM adaptive governor.
//
//  This section ONLY drives the governor's per-workstation MACHINE HARD CEILING
//  (the maximum decoded-image budget) via its public window API. The selected
//  value is a ceiling, not a permanent allocation: the governor still starts near
//  its baseline and grows toward the ceiling under scroll pressure, shrinks when
//  idle, and splits the ceiling across tabs so Σ(tab allocations) ≤ ceiling.
//  No new cache mechanism, no change to the allocation algorithm.
// ────────────────────────────────────────────────────────────────────────────
const SKM_MEMORY_OPTIONS: { value: string; labelKey: string; defaultLabel: string; mb: number | null }[] =
  [
    { value: 'auto', labelKey: 'MemoryAuto', defaultLabel: 'Auto / Recommended', mb: null },
    { value: '2048', labelKey: 'Memory2GB', defaultLabel: '2 GB', mb: 2048 },
    { value: '2560', labelKey: 'Memory2_5GB', defaultLabel: '2.5 GB', mb: 2560 },
    { value: '3072', labelKey: 'Memory3GB', defaultLabel: '3 GB', mb: 3072 },
    { value: '3584', labelKey: 'Memory3_5GB', defaultLabel: '3.5 GB', mb: 3584 },
    { value: '4096', labelKey: 'Memory4GB', defaultLabel: '4 GB', mb: 4096 },
    { value: '5120', labelKey: 'Memory5GB', defaultLabel: '5 GB (high)', mb: 5120 },
    { value: '6144', labelKey: 'Memory6GB', defaultLabel: '6 GB (high)', mb: 6144 },
  ];

// 5/6 GB can exceed what a 16 GB workstation can safely decode. navigator.deviceMemory cannot
// reliably distinguish 16 GB from 32 GB (it caps at 8), so we do NOT auto-hide these tiers; we
// require an explicit acknowledgement instead (option B from the task spec).
const SKM_HIGH_TIERS = new Set(['5120', '6144']);

function skmGovernorAvailable(): boolean {
  return (
    typeof (window as any).skmGetMemoryBudget === 'function' &&
    typeof (window as any).skmSetMemoryCeiling === 'function' &&
    typeof (window as any).skmResetMemoryBudget === 'function'
  );
}

function skmReadBudget(): any {
  try {
    return (window as any).__skmBudget || null;
  } catch (e) {
    return null;
  }
}

/** Derive the current selection from the governor's own persisted state (single source of truth):
 *  source 'default' (no override) → Auto; otherwise map the hard ceiling to its option. */
function skmInitialSelection(): string {
  const b = skmReadBudget();
  if (!b || b.source === 'default') {
    return 'auto';
  }
  const ceil = Number(b.machineHardCeilingMB);
  const match = SKM_MEMORY_OPTIONS.find(o => o.mb === ceil);
  return match ? match.value : 'auto';
}

/** Apply the selection to the EXISTING governor (ceiling-only; baseline/adaptive logic untouched). */
function applySkmMemorySelection(value: string): void {
  if (!skmGovernorAvailable()) {
    return;
  }
  if (value === 'auto') {
    (window as any).skmResetMemoryBudget();
  } else {
    const mb = Number(value);
    if (Number.isFinite(mb) && mb > 0) {
      (window as any).skmSetMemoryCeiling(mb);
    }
  }
}

function skmFormatGB(mb: number | null | undefined): string {
  if (!mb || !Number.isFinite(mb)) {
    return '—';
  }
  const gb = mb / 1024;
  return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
}

interface DicomMemorySectionProps {
  value: string;
  onChange: (value: string) => void;
  ack: boolean;
  onAckChange: (ack: boolean) => void;
  t: TFunction;
}

function DicomMemorySection({ value, onChange, ack, onAckChange, t }: DicomMemorySectionProps) {
  // Live "current allocation" readout from the governor's published snapshot (read-only poll).
  const [budget, setBudget] = React.useState<any>(() => skmReadBudget());
  React.useEffect(() => {
    const id = window.setInterval(() => setBudget(skmReadBudget()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const selected = SKM_MEMORY_OPTIONS.find(o => o.value === value);
  const maximumMB = value === 'auto' ? budget?.machineHardCeilingMB : selected?.mb;
  const currentMB = budget?.tabAllocationMB;
  const isHigh = SKM_HIGH_TIERS.has(value);

  return (
    <>
      <UserPreferencesModal.SubHeading>
        {t('DicomImageMemory', { defaultValue: 'DICOM Image Memory' })}
      </UserPreferencesModal.SubHeading>
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground max-w-2xl text-sm">
          {t('DicomImageMemoryDescription', {
            defaultValue:
              'Controls the maximum memory available for decoded DICOM images. Higher values can improve scrolling of very large studies but use more system RAM. This is a ceiling, not a fixed reservation — the viewer uses less when demand is low and more while scrolling large studies.',
          })}
        </p>
        <div className="flex items-center space-x-14">
          <Label className="text-foreground text-base">
            {t('MaximumMemory', { defaultValue: 'Maximum memory' })}
          </Label>
          <Select
            value={value}
            onValueChange={onChange}
          >
            <SelectTrigger
              className="w-60"
              aria-label="DICOM image memory"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SKM_MEMORY_OPTIONS.map(opt => (
                <SelectItem
                  key={opt.value}
                  value={opt.value}
                >
                  {t(opt.labelKey, { defaultValue: opt.defaultLabel })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {budget && (
          <div className="text-muted-foreground flex flex-col text-sm">
            <span>
              {t('Maximum', { defaultValue: 'Maximum' })}: {skmFormatGB(maximumMB)}
              {value === 'auto'
                ? ` (${t('Recommended', { defaultValue: 'Recommended' })})`
                : ''}
              {' · '}
              {t('CurrentAllocation', { defaultValue: 'Current allocation' })}:{' '}
              {skmFormatGB(currentMB)}
            </span>
            {value === 'auto' && budget.machineBaselineMB && (
              <span>
                {t('RecommendedStartsAt', {
                  defaultValue: 'Recommended profile starts around {{baseline}} and grows to {{ceiling}} under load',
                  baseline: skmFormatGB(budget.machineBaselineMB),
                  ceiling: skmFormatGB(budget.machineHardCeilingMB),
                })}
              </span>
            )}
          </div>
        )}

        {isHigh && (
          <div className="border-primary/40 bg-primary/5 mt-1 flex flex-col gap-2 rounded-md border p-3">
            <p className="text-sm text-yellow-500">
              {t('HighMemoryWarning', {
                defaultValue:
                  'High-memory profiles (5–6 GB) are intended for 32 GB consultant workstations. On a 16 GB workstation — especially with multiple tabs — this can exhaust system RAM and slow the computer. Enable only if this machine has sufficient RAM.',
              })}
            </p>
            <div className="flex items-center gap-2">
              <Switch
                checked={ack}
                onCheckedChange={onAckChange}
                aria-label="Acknowledge high memory"
              />
              <Label className="text-foreground text-sm">
                {t('HighMemoryAck', {
                  defaultValue: 'I understand and want to enable this high-memory profile',
                })}
              </Label>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function getToolModifier(
  toolGroupService: any,
  toolGroupId: string,
  toolName: string,
  mouseButton: number
): string | null {
  if (!toolGroupService) {
    return null;
  }
  const bindings = toolGroupService.getToolBindings(toolGroupId, toolName);
  if (!bindings?.length) {
    return null;
  }
  const modifierBinding = bindings.find(
    binding =>
      binding.mouseButton === mouseButton &&
      binding.modifierKey != null &&
      binding.numTouchPoints == null
  );

  return modifierBinding?.modifierKey != null ? String(modifierBinding.modifierKey) : null;
}

function getModifierFromBindings(
  bindings: Array<Record<string, unknown>> | undefined,
  mouseButton: number
): string | null {
  if (!bindings?.length) {
    return null;
  }

  const modifierBinding = bindings.find(
    binding =>
      binding.mouseButton === mouseButton &&
      binding.modifierKey != null &&
      binding.numTouchPoints == null
  );

  return modifierBinding?.modifierKey != null ? String(modifierBinding.modifierKey) : null;
}

function UserPreferencesModalDefault({ hide }: { hide: () => void }) {
  const { hotkeysManager, servicesManager } = useSystem();
  const { t, i18n: i18nextInstance } = useTranslation('UserPreferencesModal');
  const toolGroupService = (servicesManager as any)?.services?.toolGroupService;

  const { hotkeyDefinitions = {}, hotkeyDefaults = {} } = hotkeysManager;

  const fallbackHotkeyDefinitions = useMemo(
    () =>
      hotkeysManager.getValidHotkeyDefinitions(
        hotkeysModule.defaults.hotkeyBindings
      ) as HotkeyDefinitions,
    [hotkeysManager]
  );

  useEffect(() => {
    if (!Object.keys(hotkeyDefaults).length) {
      hotkeysManager.setDefaultHotKeys(hotkeysModule.defaults.hotkeyBindings);
    }

    if (!Object.keys(hotkeyDefinitions).length) {
      hotkeysManager.setHotkeys(fallbackHotkeyDefinitions);
    }
  }, [hotkeysManager, hotkeyDefaults, hotkeyDefinitions, fallbackHotkeyDefinitions]);

  const resolvedHotkeyDefaults = Object.keys(hotkeyDefaults).length
    ? (hotkeyDefaults as HotkeyDefinitions)
    : fallbackHotkeyDefinitions;

  const initialHotkeyDefinitions = Object.keys(hotkeyDefinitions).length
    ? (hotkeyDefinitions as HotkeyDefinitions)
    : resolvedHotkeyDefaults;

  const currentLanguage = currentLanguageFn();

  const initialCrosshairModifier = useMemo(
    () => getToolModifier(toolGroupService, 'mpr', 'Crosshairs', 1),
    [toolGroupService]
  );
  const defaultCrosshairBindings = useMemo(
    () => toolGroupService?.getDefaultToolBindings?.('mpr', 'Crosshairs'),
    [toolGroupService]
  );

  const initialMouseBindings = useMemo(
    () => getMouseBindingsState(toolGroupService),
    [toolGroupService]
  );

  const memoryGovernorAvailable = skmGovernorAvailable();

  const [state, setState] = useState({
    hotkeyDefinitions: initialHotkeyDefinitions,
    languageValue: currentLanguage.value,
    crosshairModifier: initialCrosshairModifier,
    mouseBindings: initialMouseBindings,
    memoryPreference: skmInitialSelection(),
    memoryAck: false,
  });

  const onLanguageChangeHandler = (value: string) => {
    setState(state => ({ ...state, languageValue: value }));
  };

  const onHotkeyChangeHandler = (id: string, newKeys: string) => {
    setState(state => ({
      ...state,
      hotkeyDefinitions: {
        ...state.hotkeyDefinitions,
        [id]: {
          ...state.hotkeyDefinitions[id],
          keys: newKeys,
        },
      },
    }));
  };

  const onMouseBindingChangeHandler = (buttonKey: string, toolName: string) => {
    setState(state => ({
      ...state,
      mouseBindings: {
        ...state.mouseBindings,
        [buttonKey]: toolName,
      },
    }));
  };

  const onResetHandler = () => {
    let defaultMouseBindings: Record<string, string | null> = MOUSE_BUTTONS.reduce(
      (acc, { key }) => {
        acc[key] = null;
        return acc;
      },
      {} as Record<string, string | null>
    );

    if (toolGroupService) {
      MOUSE_TOOL_OPTIONS.forEach(({ value: toolName }) => {
        const defaultBindings = toolGroupService.getDefaultToolBindings(
          MOUSE_TOOL_GROUP_ID,
          toolName
        );
        if (!defaultBindings) {
          return;
        }
        toolGroupService.setToolBindings(MOUSE_TOOL_GROUP_ID, toolName, defaultBindings);
        toolGroupService.applyToolBindings(MOUSE_TOOL_GROUP_ID, toolName, {
          replaceExisting: true,
        });
        toolGroupService.removePersistedToolBindings(MOUSE_TOOL_GROUP_ID, toolName);
      });

      defaultMouseBindings = getMouseBindingsState(toolGroupService);
    }

    setState(state => ({
      ...state,
      languageValue: defaultLanguage.value,
      hotkeyDefinitions: resolvedHotkeyDefaults,
      crosshairModifier: getModifierFromBindings(defaultCrosshairBindings, 1),
      mouseBindings: defaultMouseBindings,
      memoryPreference: 'auto',
      memoryAck: false,
    }));

    hotkeysManager.restoreDefaultBindings();
    if (toolGroupService && defaultCrosshairBindings?.length) {
      toolGroupService.setToolBindings('mpr', 'Crosshairs', defaultCrosshairBindings);
      toolGroupService.applyToolBindings('mpr', 'Crosshairs', {
        replaceExisting: true,
      });
    }
    toolGroupService?.removePersistedToolBindings('mpr', 'Crosshairs');
  };

  const displayNames = React.useMemo(() => {
    if (typeof Intl === 'undefined' || typeof Intl.DisplayNames !== 'function') {
      return null;
    }

    const locales = [state.languageValue, currentLanguage.value, i18nextInstance.language, 'en'];
    const uniqueLocales = Array.from(new Set(locales.filter(Boolean)));

    try {
      return new Intl.DisplayNames(uniqueLocales, { type: 'language', fallback: 'none' });
    } catch (error) {
      console.warn('Intl.DisplayNames not supported for locales', uniqueLocales, error);
    }

    return null;
  }, [state.languageValue, currentLanguage.value, i18nextInstance.language]);

  const getLanguageLabel = React.useCallback(
    (languageValue: string, fallbackLabel: string) => {
      const translationKey = `LanguageName.${languageValue}`;
      if (i18nextInstance.exists(translationKey, { ns: 'UserPreferencesModal' })) {
        return t(translationKey);
      }

      if (displayNames) {
        try {
          const localized = displayNames.of(languageValue);
          if (localized && localized.toLowerCase() !== languageValue.toLowerCase()) {
            return localized.charAt(0).toUpperCase() + localized.slice(1);
          }
        } catch (error) {
          console.debug(`Unable to resolve display name for ${languageValue}`, error);
        }
      }

      return fallbackLabel;
    },
    [displayNames, i18nextInstance, t]
  );

  return (
    <UserPreferencesModal>
      <UserPreferencesModal.Body>
        {/* Language Section */}
        <div className="mb-3 flex items-center space-x-14">
          <UserPreferencesModal.SubHeading>{t('Language')}</UserPreferencesModal.SubHeading>
          <Select
            defaultValue={state.languageValue}
            onValueChange={onLanguageChangeHandler}
          >
            <SelectTrigger
              className="w-60"
              aria-label="Language"
            >
              <SelectValue placeholder={t('Select language')} />
            </SelectTrigger>
            <SelectContent>
              {availableLanguages.map(lang => (
                <SelectItem
                  key={lang.value}
                  value={lang.value}
                >
                  {getLanguageLabel(lang.value, lang.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {memoryGovernorAvailable && (
          <DicomMemorySection
            value={state.memoryPreference}
            onChange={value =>
              setState(s => ({
                ...s,
                memoryPreference: value,
                memoryAck: SKM_HIGH_TIERS.has(value) ? s.memoryAck : false,
              }))
            }
            ack={state.memoryAck}
            onAckChange={ack => setState(s => ({ ...s, memoryAck: ack }))}
            t={t}
          />
        )}

        <UserPreferencesModal.SubHeading>{t('Hotkeys')}</UserPreferencesModal.SubHeading>
        <UserPreferencesModal.HotkeysGrid>
          {Object.entries(state.hotkeyDefinitions).map(([id, definition]) => (
            <UserPreferencesModal.Hotkey
              key={id}
              label={t(definition.label)}
              value={definition.keys}
              onChange={newKeys => onHotkeyChangeHandler(id, newKeys)}
              placeholder={definition.keys}
              hotkeys={hotkeysModule}
            />
          ))}
        </UserPreferencesModal.HotkeysGrid>

        {state.crosshairModifier != null && (
          <>
            <UserPreferencesModal.SubHeading>
              {t('ModifierKeys', { defaultValue: 'Modifier Keys' })}
            </UserPreferencesModal.SubHeading>
            <UserPreferencesModal.HotkeysGrid>
              <div className="flex items-center justify-between gap-2">
                <span className="text-foreground text-base">
                  {t('CrosshairsModifier', { defaultValue: 'Crosshairs' })}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground text-sm">
                    {t('PlusLeftClick', { defaultValue: 'Left Click +' })}
                  </span>
                  <Select
                    value={state.crosshairModifier}
                    onValueChange={val => setState(s => ({ ...s, crosshairModifier: val }))}
                  >
                    <SelectTrigger className="w-16">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MODIFIER_OPTIONS.map(opt => (
                        <SelectItem
                          key={opt.value}
                          value={opt.value}
                        >
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </UserPreferencesModal.HotkeysGrid>
          </>
        )}

        {toolGroupService && (
          <>
            <UserPreferencesModal.SubHeading>
              {t('Mouse', { defaultValue: 'Mouse' })}
            </UserPreferencesModal.SubHeading>
            <UserPreferencesModal.HotkeysGrid>
              {MOUSE_BUTTONS.map(({ key, label }) => (
                <div
                  key={key}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="text-foreground text-base">
                    {t(`Mouse${key}`, { defaultValue: label })}
                  </span>
                  <div className="w-40">
                    <Select
                      value={state.mouseBindings[key] ?? undefined}
                      onValueChange={val => onMouseBindingChangeHandler(key, val)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t('Unassigned', { defaultValue: 'Unassigned' })} />
                      </SelectTrigger>
                      <SelectContent>
                        {MOUSE_TOOL_OPTIONS.map(opt => (
                          <SelectItem
                            key={opt.value}
                            value={opt.value}
                          >
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))}
            </UserPreferencesModal.HotkeysGrid>
          </>
        )}
      </UserPreferencesModal.Body>
      <FooterAction>
        <FooterAction.Left>
          <FooterAction.Auxiliary onClick={onResetHandler}>
            {t('Reset to defaults')}
          </FooterAction.Auxiliary>
        </FooterAction.Left>
        <FooterAction.Right>
          <FooterAction.Secondary
            onClick={() => {
              hotkeysModule.stopRecord();
              hotkeysModule.unpause();
              hide();
            }}
          >
            {t('Cancel')}
          </FooterAction.Secondary>
          <FooterAction.Primary
            onClick={() => {
              // Apply DICOM memory ceiling first so it persists even if a language change reloads.
              // High tiers (5/6 GB) require the explicit acknowledgement toggle; without it we leave
              // the governor's current ceiling unchanged.
              if (memoryGovernorAvailable) {
                const mem = state.memoryPreference;
                if (!SKM_HIGH_TIERS.has(mem) || state.memoryAck) {
                  applySkmMemorySelection(mem);
                }
              }

              if (state.languageValue !== currentLanguage.value) {
                i18n.changeLanguage(state.languageValue);
                // Force page reload after language change to ensure all translations are applied
                window.location.reload();
                return; // Exit early since we're reloading
              }
              hotkeysManager.setHotkeys(state.hotkeyDefinitions);

              if (toolGroupService && state.crosshairModifier != null) {
                const bindings = [
                  { mouseButton: 1, modifierKey: Number(state.crosshairModifier) },
                ];
                toolGroupService.setToolBindings('mpr', 'Crosshairs', bindings);
                toolGroupService.applyToolBindings('mpr', 'Crosshairs', {
                  replaceExisting: true,
                });
                toolGroupService.persistToolBindings('mpr', 'Crosshairs', bindings);
              }

              applyMouseBindingChanges(toolGroupService, state.mouseBindings);

              hotkeysModule.stopRecord();
              hotkeysModule.unpause();
              hide();
            }}
          >
            {t('Save')}
          </FooterAction.Primary>
        </FooterAction.Right>
      </FooterAction>
    </UserPreferencesModal>
  );
}

export default {
  'ohif.userPreferencesModal': UserPreferencesModalDefault,
  'ohif.userPreferences.toolBindingsStorageKey': DEFAULT_TOOL_BINDINGS_STORAGE_KEY,
};
