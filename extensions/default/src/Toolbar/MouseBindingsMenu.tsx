import React, { ReactNode, useState } from 'react';
import { useSystem } from '@ohif/core';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Icons,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  useIconPresentation,
} from '@ohif/ui-next';
import {
  MOUSE_BUTTONS,
  MOUSE_TOOL_OPTIONS,
  getMouseBindingsState,
  applyMouseBindingChanges,
} from '../utils/mouseBindingsUtils';

type MouseBindingsMenuProps = {
  location?: string;
  isOpen?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
  disabled?: boolean;
};

/**
 * Quick, top-bar-reachable popup for reassigning mouse buttons to tools -
 * a lighter-weight alternative to the full User Preferences modal, so users
 * with (or without) a 5-button mouse can change bindings in a couple of
 * clicks instead of opening Preferences. Applies each change immediately.
 */
export function MouseBindingsMenu(props: MouseBindingsMenuProps): ReactNode {
  const { isOpen = false, onOpen, onClose, disabled, ...rest } = props;
  const { t } = useTranslation('UserPreferencesModal');
  const { servicesManager } = useSystem();
  const { toolGroupService } = servicesManager.services;
  const { IconContainer, className: iconClassName, containerProps } = useIconPresentation();

  const [mouseBindings, setMouseBindings] = useState(() =>
    getMouseBindingsState(toolGroupService)
  );

  const handleOpenChange = (openState: boolean) => {
    if (openState) {
      // Re-sync with the current tool-group state each time the popup opens,
      // in case bindings changed elsewhere (e.g. the full Preferences modal).
      setMouseBindings(getMouseBindingsState(toolGroupService));
      onOpen?.();
    } else {
      onClose?.();
    }
  };

  const onChangeHandler = (buttonKey: string, toolName: string) => {
    const updated = { ...mouseBindings, [buttonKey]: toolName };
    setMouseBindings(updated);
    applyMouseBindingChanges(toolGroupService, updated);
  };

  const Icon = <Icons.GearSettings className={iconClassName} />;

  return (
    <Popover
      open={isOpen}
      onOpenChange={handleOpenChange}
    >
      <PopoverTrigger
        asChild
        className="flex items-center justify-center"
      >
        <div>
          {IconContainer ? (
            <IconContainer
              disabled={disabled}
              icon="GearSettings"
              {...rest}
              {...containerProps}
            >
              {Icon}
            </IconContainer>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              disabled={disabled}
            >
              {Icon}
            </Button>
          )}
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="w-64 p-3"
        align="start"
        sideOffset={5}
      >
        <div className="text-foreground mb-2 text-base font-semibold">
          {t('MouseBindings', { defaultValue: 'Mouse Bindings' })}
        </div>
        <div className="flex flex-col gap-2">
          {MOUSE_BUTTONS.map(({ key, label }) => (
            <div
              key={key}
              className="flex items-center justify-between gap-2"
            >
              <span className="text-foreground text-sm">
                {t(`Mouse${key}`, { defaultValue: label })}
              </span>
              <div className="w-32">
                <Select
                  value={mouseBindings[key] ?? undefined}
                  onValueChange={val => onChangeHandler(key, val)}
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
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default MouseBindingsMenu;
