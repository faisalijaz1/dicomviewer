// The following are the default window level presets and can be further
// configured via the customization service.
//
// CT and PT are calibrated (Hounsfield units / SUV) so fixed absolute
// window/level numbers are meaningfully "correct" across scanners.
//
// The other modalities below (MR, US, CR, DX, MG, NM) are NOT calibrated to
// a shared physical scale - pixel value ranges vary by scanner/sequence/
// detector/exposure. A fixed guessed number (e.g. "window 2500, level 1250")
// can be wildly wrong for a specific image (over-exposed/blown-out, or the
// reverse) since it has no relation to that image's actual pixel values.
//
// Instead, these use two relative preset kinds resolved against the image's
// OWN native VOI (its DICOM WindowCenter/WindowWidth, which PACS-provided
// "for presentation" images already have burned in correctly for that exact
// acquisition) - so they're safe/sane regardless of the specific equipment:
//   - { native: true }              -> the image's own default VOI, unchanged
//   - { relativeWidth, relativeCenterShift } -> native width * relativeWidth,
//     with the level optionally shifted by relativeCenterShift * native width
// See setWindowLevelPreset in extensions/cornerstone/src/commandsModule.ts
// for how these are resolved. If exact absolute values ARE known for this
// site's equipment, override this in app-config.js's
// `cornerstone.windowLevelPresets` customization with fixed window/level
// pairs instead (note: that key REPLACES, not merges with, this default per
// modality - list the whole array).
const defaultWindowLevelPresets = {
  CT: [
    { id: 'ct-soft-tissue', description: 'Soft tissue', window: '400', level: '40' },
    { id: 'ct-lung', description: 'Lung', window: '1500', level: '-600' },
    { id: 'ct-liver', description: 'Liver', window: '150', level: '90' },
    { id: 'ct-bone', description: 'Bone', window: '2500', level: '480' },
    { id: 'ct-brain', description: 'Brain', window: '80', level: '40' },
    { id: 'ct-mediastinum', description: 'Mediastinum', window: '350', level: '50' },
    { id: 'ct-abdomen', description: 'Abdomen', window: '350', level: '40' },
  ],

  PT: [
    { id: 'pt-default', description: 'Default', window: '5', level: '2.5' },
    { id: 'pt-suv-3', description: 'SUV', window: '0', level: '3' },
    { id: 'pt-suv-5', description: 'SUV', window: '0', level: '5' },
    { id: 'pt-suv-7', description: 'SUV', window: '0', level: '7' },
    { id: 'pt-suv-8', description: 'SUV', window: '0', level: '8' },
    { id: 'pt-suv-10', description: 'SUV', window: '0', level: '10' },
    { id: 'pt-suv-15', description: 'SUV', window: '0', level: '15' },
  ],

  MR: [
    { id: 'mr-native', description: 'Default (as acquired)', native: true },
    { id: 'mr-higher-contrast', description: 'Higher contrast', relativeWidth: 0.5 },
    { id: 'mr-lower-contrast', description: 'Lower contrast', relativeWidth: 1.5 },
    { id: 'mr-narrower', description: 'Narrower', relativeWidth: 0.75 },
    { id: 'mr-wider', description: 'Wider', relativeWidth: 2 },
    {
      id: 'mr-brighter',
      description: 'Brighter',
      relativeWidth: 1,
      relativeCenterShift: -0.25,
    },
    {
      id: 'mr-darker',
      description: 'Darker',
      relativeWidth: 1,
      relativeCenterShift: 0.25,
    },
  ],

  US: [
    { id: 'us-native', description: 'Default (as acquired)', native: true },
    { id: 'us-higher-contrast', description: 'Higher contrast', relativeWidth: 0.7 },
  ],

  CR: [
    { id: 'cr-native', description: 'Default (as acquired)', native: true },
    { id: 'cr-higher-contrast', description: 'Higher contrast', relativeWidth: 0.5 },
    { id: 'cr-lower-contrast', description: 'Lower contrast', relativeWidth: 1.5 },
    { id: 'cr-narrower', description: 'Narrower', relativeWidth: 0.75 },
    { id: 'cr-wider', description: 'Wider', relativeWidth: 2 },
    {
      id: 'cr-brighter',
      description: 'Brighter',
      relativeWidth: 1,
      relativeCenterShift: -0.25,
    },
    {
      id: 'cr-darker',
      description: 'Darker',
      relativeWidth: 1,
      relativeCenterShift: 0.25,
    },
  ],

  DX: [
    { id: 'dx-native', description: 'Default (as acquired)', native: true },
    { id: 'dx-higher-contrast', description: 'Higher contrast', relativeWidth: 0.5 },
    { id: 'dx-lower-contrast', description: 'Lower contrast', relativeWidth: 1.5 },
    { id: 'dx-narrower', description: 'Narrower', relativeWidth: 0.75 },
    { id: 'dx-wider', description: 'Wider', relativeWidth: 2 },
    {
      id: 'dx-brighter',
      description: 'Brighter',
      relativeWidth: 1,
      relativeCenterShift: -0.25,
    },
    {
      id: 'dx-darker',
      description: 'Darker',
      relativeWidth: 1,
      relativeCenterShift: 0.25,
    },
  ],

  MG: [
    { id: 'mg-native', description: 'Default (as acquired)', native: true },
    { id: 'mg-higher-contrast', description: 'Higher contrast', relativeWidth: 0.5 },
  ],

  NM: [
    { id: 'nm-native', description: 'Default (as acquired)', native: true },
    { id: 'nm-higher-contrast', description: 'Higher contrast', relativeWidth: 0.5 },
  ],
};

export default defaultWindowLevelPresets;
