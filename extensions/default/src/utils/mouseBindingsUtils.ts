import { Enums as csToolsEnums } from '@cornerstonejs/tools';

export const MOUSE_TOOL_GROUP_ID = 'default';

export const MOUSE_TOOL_OPTIONS = [
  { value: 'WindowLevel', label: 'Window/Level' },
  { value: 'Zoom', label: 'Zoom' },
  { value: 'Pan', label: 'Pan' },
  { value: 'StackScroll', label: 'Stack Scroll' },
  { value: 'Length', label: 'Length' },
  { value: 'Magnify', label: 'Magnify' },
  { value: 'Probe', label: 'Probe' },
];

// Fourth/Fifth (the "back"/"forward" side buttons on a 5-button mouse) are
// unassigned by default - most users don't have them, and those who do can
// assign them via the Mouse Bindings popup or User Preferences.
export const MOUSE_BUTTONS = [
  { key: 'left', label: 'Left Button', mouseButton: csToolsEnums.MouseBindings.Primary },
  { key: 'right', label: 'Right Button', mouseButton: csToolsEnums.MouseBindings.Secondary },
  { key: 'middle', label: 'Middle Button', mouseButton: csToolsEnums.MouseBindings.Auxiliary },
  { key: 'fourth', label: '4th Button', mouseButton: csToolsEnums.MouseBindings.Fourth_Button },
  { key: 'fifth', label: '5th Button', mouseButton: csToolsEnums.MouseBindings.Fifth_Button },
];

export function findToolForButton(
  toolGroupService: any,
  toolGroupId: string,
  mouseButton: number
): string | null {
  if (!toolGroupService) {
    return null;
  }
  for (const { value: toolName } of MOUSE_TOOL_OPTIONS) {
    const bindings = toolGroupService.getToolBindings(toolGroupId, toolName);
    if (bindings?.some(binding => binding.mouseButton === mouseButton && binding.modifierKey == null)) {
      return toolName;
    }
  }
  return null;
}

export function withButtonRemoved(
  bindings: Array<Record<string, unknown>> | undefined,
  mouseButton: number
) {
  return (bindings || []).filter(binding => binding.mouseButton !== mouseButton);
}

export function withButtonSet(
  bindings: Array<Record<string, unknown>> | undefined,
  mouseButton: number
) {
  return [...withButtonRemoved(bindings, mouseButton), { mouseButton }];
}

export function getMouseBindingsState(toolGroupService: any): Record<string, string | null> {
  return MOUSE_BUTTONS.reduce(
    (acc, { key, mouseButton }) => {
      acc[key] = findToolForButton(toolGroupService, MOUSE_TOOL_GROUP_ID, mouseButton);
      return acc;
    },
    {} as Record<string, string | null>
  );
}

/**
 * Applies a { [buttonKey]: toolName | null } map of desired mouse-button
 * assignments to the tool group, persisting each change. Only buttons whose
 * assigned tool actually changed are touched.
 */
export function applyMouseBindingChanges(
  toolGroupService: any,
  mouseBindings: Record<string, string | null>
): void {
  if (!toolGroupService) {
    return;
  }

  MOUSE_BUTTONS.forEach(({ key, mouseButton }) => {
    const newToolName = mouseBindings[key];
    if (!newToolName) {
      return;
    }

    const currentOwner = findToolForButton(toolGroupService, MOUSE_TOOL_GROUP_ID, mouseButton);

    if (currentOwner === newToolName) {
      return;
    }

    if (currentOwner) {
      const ownerBindings = toolGroupService.getToolBindings(MOUSE_TOOL_GROUP_ID, currentOwner);
      const updatedOwnerBindings = withButtonRemoved(ownerBindings, mouseButton);
      toolGroupService.setToolBindings(MOUSE_TOOL_GROUP_ID, currentOwner, updatedOwnerBindings);
      toolGroupService.applyToolBindings(MOUSE_TOOL_GROUP_ID, currentOwner, {
        replaceExisting: true,
      });
      toolGroupService.persistToolBindings(MOUSE_TOOL_GROUP_ID, currentOwner, updatedOwnerBindings);
    }

    const newToolBindings = toolGroupService.getToolBindings(MOUSE_TOOL_GROUP_ID, newToolName);
    const updatedNewBindings = withButtonSet(newToolBindings, mouseButton);
    toolGroupService.setToolBindings(MOUSE_TOOL_GROUP_ID, newToolName, updatedNewBindings);
    toolGroupService.applyToolBindings(MOUSE_TOOL_GROUP_ID, newToolName, {
      replaceExisting: true,
    });
    toolGroupService.persistToolBindings(MOUSE_TOOL_GROUP_ID, newToolName, updatedNewBindings);
  });
}
