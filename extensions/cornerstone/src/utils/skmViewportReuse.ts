/**
 * Office 7033dc3 (`index.278a36fd.js`): one StackViewport was retained per series
 * switch (178 switches, +178 instances, ~1.2 MB of the last image each).
 * setViewportData called renderingEngine.enableElement on every switch, which
 * disables the current viewport and constructs a new one on the same element.
 * The VIEWPORT_NEW_IMAGE_SET listener added in _setStackViewport closed over
 * that viewport and was never removed, so the disabled instance stayed alive.
 */

const STACK_VIEWPORT_TYPE = 'stack';

export function shouldReuseStackViewport(
  previous: { element?: unknown; type?: string; isDisabled?: boolean } | null | undefined,
  element: unknown,
  type: string | undefined
): boolean {
  if (!previous || !element || previous.isDisabled) {
    return false;
  }
  if (previous.element !== element) {
    return false;
  }
  if (!type || previous.type !== type) {
    return false;
  }
  return type === STACK_VIEWPORT_TYPE;
}

/** Drop the last image and the id maps on a viewport that enableElement just disabled. */
export function releaseRetiredViewport(viewport: any): void {
  if (!viewport) {
    return;
  }
  try {
    viewport._actors = new Map();
  } catch (e) {
    /* actors map is not writable */
  }
  const clear = (key: string, value: unknown) => {
    try {
      viewport[key] = value;
    } catch (e) {
      /* property is not writable */
    }
  };
  clear('csImage', undefined);
  clear('_imageData', undefined);
  clear('cpuImagePixelData', undefined);
  clear('imagesLoader', undefined);
  clear('imageIds', []);
  try {
    viewport.imageKeyToIndexMap?.clear?.();
  } catch (e) {
    /* map shape differs */
  }
  try {
    viewport.perImageIdDefaultProperties?.clear?.();
  } catch (e) {
    /* map shape differs */
  }
  try {
    if (viewport._cpuFallbackEnabledElement) {
      viewport._cpuFallbackEnabledElement.image = undefined;
    }
  } catch (e) {
    /* cpu fallback element shape differs */
  }
}
