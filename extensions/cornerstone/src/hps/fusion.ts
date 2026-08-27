import { Types } from '@ohif/core';
import i18n from 'i18next';

// PT window/level as SUV 0-5 (matches this app's default PT window/level
// presets) - a reasonable starting point for the fused overlay; the
// radiologist can still adjust window/level on the PT layer normally.
export const PT_VOI = { windowWidth: 5, windowCenter: 2.5 };
export const PT_WINDOW_LOWER = PT_VOI.windowCenter - PT_VOI.windowWidth / 2; // 0
export const PT_WINDOW_UPPER = PT_VOI.windowCenter + PT_VOI.windowWidth / 2; // 5
const PT_WINDOW_SPAN = PT_WINDOW_UPPER - PT_WINDOW_LOWER;

// Standard nuclear-medicine "hot iron"-style overlay: transparent at low
// activity, ramping up to opaque only near the top of the window - so the
// CT anatomy underneath stays visible everywhere except genuinely elevated
// uptake.
//
// IMPORTANT: cornerstone3D's real setOpacity() (BaseVolumeViewport.js)
// feeds these {value, opacity} points into a VTK piecewise function using
// `value` as an ABSOLUTE scalar value, completely independent of whatever
// VOI window is set - NOT a 0-1 fraction of the window, despite how
// tempting that reading is. The previous version of this ramp used plain
// fractions (0, 0.55, 0.75, 0.9, 1) as `value`, which cornerstone then
// treated as literal SUV values - so ANY real tissue with SUV >= 1 (i.e.
// essentially the entire body on correctly SUV-scaled data, since normal
// background/muscle/liver uptake alone is commonly SUV 1-3) clamped to the
// ramp's last defined point and rendered at ~95% opacity - producing a
// solid colored rind across the whole body, not just genuine hot spots.
// Expressing the ramp in real SUV units relative to PT_VOI's own window
// fixes this for genuinely SUV-scaled data. (Raw-count data with no usable
// SUV metadata - common on this hospital's PACS - is handled separately,
// by the percentile-based runtime VOI/opacity correction in init.tsx's
// applyRobustPTVolumeVOI, which only engages when SUV metadata is absent.)
export const PT_COLORMAP = {
  name: 'hot_iron',
  opacity: [
    { value: PT_WINDOW_LOWER, opacity: 0 },
    { value: PT_WINDOW_LOWER + PT_WINDOW_SPAN * 0.55, opacity: 0 },
    { value: PT_WINDOW_LOWER + PT_WINDOW_SPAN * 0.75, opacity: 0.35 },
    { value: PT_WINDOW_LOWER + PT_WINDOW_SPAN * 0.9, opacity: 0.75 },
    { value: PT_WINDOW_UPPER, opacity: 0.95 },
  ],
};

const CAMERA_SYNC_GROUP = {
  type: 'cameraPosition',
  id: 'fusionCameraSync',
  source: true,
  target: true,
};

const VOI_SYNC_GROUP = {
  type: 'voi',
  id: 'fusionVoiSync',
  source: true,
  target: true,
  options: {
    syncColormap: false,
  },
};

const displaySetSelectors = {
  ctDisplaySet: {
    seriesMatchingRules: [
      {
        attribute: 'Modality',
        constraint: { equals: { value: 'CT' } },
        required: true,
      },
      {
        attribute: 'isReconstructable',
        constraint: { equals: { value: true } },
        required: true,
      },
    ],
  },
  ptDisplaySet: {
    seriesMatchingRules: [
      {
        attribute: 'Modality',
        constraint: { equals: { value: 'PT' } },
        required: true,
      },
      {
        attribute: 'isReconstructable',
        constraint: { equals: { value: true } },
        required: true,
      },
      {
        weight: 2,
        attribute: 'SeriesDescription',
        constraint: { doesNotContain: { value: 'Uncorrected' } },
      },
    ],
  },
};

// Factory (not a shared object literal) - each stage gets its own fresh
// viewport definition with a distinct viewportId, since the hanging
// protocol engine can mutate a viewport's options in place and these are
// used across two different stages.
const createFusionViewport = (viewportId: string, syncGroups: unknown[]) => ({
  viewportOptions: {
    viewportId,
    viewportType: 'volume',
    orientation: 'axial',
    toolGroupId: 'mpr',
    initialImageOptions: {
      preset: 'middle',
    },
    syncGroups,
  },
  displaySets: [
    { id: 'ctDisplaySet' },
    {
      id: 'ptDisplaySet',
      options: {
        colormap: PT_COLORMAP,
        voi: PT_VOI,
      },
    },
  ],
});

const ptViewport = {
  viewportOptions: {
    viewportId: 'fusion-pt',
    viewportType: 'volume',
    orientation: 'axial',
    toolGroupId: 'mpr',
    initialImageOptions: {
      preset: 'middle',
    },
    syncGroups: [CAMERA_SYNC_GROUP, VOI_SYNC_GROUP],
  },
  displaySets: [
    {
      id: 'ptDisplaySet',
      options: {
        voi: PT_VOI,
      },
    },
  ],
};

const ctViewport = {
  viewportOptions: {
    viewportId: 'fusion-ct',
    viewportType: 'volume',
    orientation: 'axial',
    toolGroupId: 'mpr',
    initialImageOptions: {
      preset: 'middle',
    },
    syncGroups: [CAMERA_SYNC_GROUP],
  },
  displaySets: [{ id: 'ctDisplaySet' }],
};

export const fusion: Types.HangingProtocol.Protocol = {
  id: 'fusion',
  name: i18n.t('Hps:PET/CT Fusion'),
  locked: true,
  icon: 'layout-advanced-fusion',
  isPreset: true,
  createdDate: '2026-07-28',
  modifiedDate: '2026-07-28',
  availableTo: {},
  editableBy: {},
  numberOfPriorsReferenced: 0,
  // Requiring both CT and PT to be present (rather than an empty rule set,
  // like MPR/MPR 2-up use) isn't just about auto-eligibility - the
  // hanging-protocol matching engine only does a full study-wide scan for
  // *every* named display-set role when protocolMatchingRules narrows the
  // protocol to a specific study type; an empty rule set left the engine
  // resolving display sets against only the already-displayed series,
  // silently failing to find the CT layer whenever PT (not CT) happened to
  // be the currently active series.
  protocolMatchingRules: [
    {
      attribute: 'ModalitiesInStudy',
      constraint: {
        contains: ['CT', 'PT'],
      },
    },
  ],
  imageLoadStrategy: 'nth',
  callbacks: {},
  displaySetSelectors,
  stages: [
    {
      name: 'Fusion',
      viewportStructure: {
        layoutType: 'grid',
        properties: { rows: 1, columns: 1 },
      },
      viewports: [createFusionViewport('fusion', [CAMERA_SYNC_GROUP])],
    },
    {
      name: 'PET | CT | Fusion',
      viewportStructure: {
        layoutType: 'grid',
        properties: {
          rows: 1,
          columns: 3,
          layoutOptions: [
            { x: 0, y: 0, width: 1 / 3, height: 1 },
            { x: 1 / 3, y: 0, width: 1 / 3, height: 1 },
            { x: 2 / 3, y: 0, width: 1 / 3, height: 1 },
          ],
        },
      },
      viewports: [
        ptViewport,
        ctViewport,
        createFusionViewport('fusion-3up', [CAMERA_SYNC_GROUP]),
      ],
    },
  ],
};

export default fusion;
