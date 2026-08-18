import { Types } from '@ohif/core';
import i18n from 'i18next';
import { VOI_SYNC_GROUP, HYDRATE_SEG_SYNC_GROUP } from './mpr';

// Axial + Coronal 2-up - the coronal counterpart to mpr2up.ts's Axial +
// Sagittal, matching RadiAnt's separate "Sagittal" / "Coronal" MPR presets
// rather than one generic "MPR 2-up" a radiologist has to guess the plane
// of.
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

export const mpr2upCoronal: Types.HangingProtocol.Protocol = {
  id: 'mpr2up-coronal',
  name: i18n.t('Hps:Coronal'),
  locked: true,
  icon: 'layout-advanced-mpr',
  isPreset: true,
  createdDate: '2026-08-07',
  modifiedDate: '2026-08-07',
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
      name: 'MPR 1x2 Coronal',
      viewportStructure,
      viewports: [
        {
          viewportOptions: {
            viewportId: 'mpr2up-coronal-axial',
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
            viewportId: 'mpr2up-coronal-coronal',
            toolGroupId: 'mpr',
            viewportType: 'volume',
            orientation: 'coronal',
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

export default mpr2upCoronal;
