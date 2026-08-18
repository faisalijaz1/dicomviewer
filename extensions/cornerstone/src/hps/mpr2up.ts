import { Types } from '@ohif/core';
import i18n from 'i18next';
import { VOI_SYNC_GROUP, HYDRATE_SEG_SYNC_GROUP } from './mpr';

const viewportStructure = {
  layoutType: 'grid',
  properties: {
    rows: 1,
    columns: 2,
    layoutOptions: [
      {
        x: 0,
        y: 0,
        width: 1 / 2,
        height: 1,
      },
      {
        x: 1 / 2,
        y: 0,
        width: 1 / 2,
        height: 1,
      },
    ],
  },
};

// RadiAnt names its 2-up MPR presets after the plane being added alongside
// axial (e.g. "Sagittal", "Coronal"), rather than a generic "MPR 2-up" -
// makes it clear to the radiologist which second plane they'll get before
// clicking. See mpr2upCoronal.ts for the coronal counterpart.
export const mpr2up: Types.HangingProtocol.Protocol = {
  id: 'mpr2up',
  name: i18n.t('Hps:Sagittal'),
  locked: true,
  icon: 'layout-advanced-mpr',
  isPreset: true,
  createdDate: '2026-07-17',
  modifiedDate: '2026-07-17',
  availableTo: {},
  editableBy: {},
  numberOfPriorsReferenced: 0,
  protocolMatchingRules: [],
  imageLoadStrategy: 'nth',
  callbacks: {},
  displaySetSelectors: {
    activeDisplaySet: {
      seriesMatchingRules: [
        {
          weight: 1,
          attribute: 'isReconstructable',
          constraint: {
            equals: {
              value: true,
            },
          },
          required: true,
        },
      ],
    },
  },
  stages: [
    {
      name: 'MPR 1x2',
      viewportStructure,
      viewports: [
        {
          viewportOptions: {
            viewportId: 'mpr2up-axial',
            toolGroupId: 'mpr',
            viewportType: 'volume',
            orientation: 'axial',
            initialImageOptions: {
              preset: 'middle',
            },
            syncGroups: [VOI_SYNC_GROUP, HYDRATE_SEG_SYNC_GROUP],
          },
          displaySets: [
            {
              id: 'activeDisplaySet',
            },
          ],
        },
        {
          viewportOptions: {
            viewportId: 'mpr2up-sagittal',
            toolGroupId: 'mpr',
            viewportType: 'volume',
            orientation: 'sagittal',
            initialImageOptions: {
              preset: 'middle',
            },
            syncGroups: [VOI_SYNC_GROUP, HYDRATE_SEG_SYNC_GROUP],
          },
          displaySets: [
            {
              id: 'activeDisplaySet',
            },
          ],
        },
      ],
    },
  ],
};

export default mpr2up;
