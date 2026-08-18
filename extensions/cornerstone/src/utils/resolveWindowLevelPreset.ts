import { metaData } from '@cornerstonejs/core';

/**
 * Resolves a window/level preset entry into concrete { windowWidth, windowCenter }
 * numbers.
 *
 * Most presets (CT/PT) carry absolute `window`/`level` values, meaningful
 * because those modalities are calibrated to a physical scale (Hounsfield
 * units / SUV). Modalities without a shared physical scale (MR/US/CR/DX/MG/NM)
 * instead use presets resolved relative to the image's OWN native VOI (its
 * DICOM WindowCenter/WindowWidth, read via cornerstone's voiLutModule
 * metadata provider - NOT viewport.getDefaultProperties(), which is only
 * populated when something explicitly calls setDefaultProperties() and is
 * left empty for a plain stack load) via `native: true` or
 * `{ relativeWidth, relativeCenterShift }` - see defaultWindowLevelPresets.ts.
 */
export default function resolveWindowLevelPreset(preset, viewport) {
  if (!preset.native && preset.relativeWidth == null) {
    return {
      windowWidth: Number(preset.window),
      windowCenter: Number(preset.level),
    };
  }

  const currentImageId = viewport?.getCurrentImageId?.();

  if (!currentImageId) {
    return null;
  }

  const voiLutModule = metaData.get('voiLutModule', currentImageId);
  const nativeWidth = voiLutModule?.windowWidth?.[0];
  const nativeCenter = voiLutModule?.windowCenter?.[0];

  if (nativeWidth == null || nativeCenter == null) {
    return null;
  }

  if (preset.native) {
    return { windowWidth: nativeWidth, windowCenter: nativeCenter };
  }

  return {
    windowWidth: nativeWidth * preset.relativeWidth,
    windowCenter: nativeCenter + (preset.relativeCenterShift || 0) * nativeWidth,
  };
}
