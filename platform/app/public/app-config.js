/**
 * OHIF Viewer v3 — SKM PACS configuration
 *
 * Place this file along with the OHIF build output.
 * Run OHIF with: OHIF_APP_CONFIG=app-config.js yarn start
 *
 * DICOMweb endpoint: pacs-dicom-service, reverse-proxied at
 * https://192.192.8.173 (standard HTTPS port, no port suffix)
 * (WADO-RS / QIDO-RS served at /wado/rs)
 *
 * How to deploy OHIF for this project:
 *   1. git clone https://github.com/OHIF/Viewers.git ohif
 *   2. cd ohif
 *   3. yarn install
 *   4. Copy this file to ohif/platform/app/public/app-config.js
 *   5. yarn run dev (or yarn run build for production)
 *   6. OHIF will be available at http://localhost:3000
 */
window.config = {
  routerBasename: '/',
  extensions: [],
  modes: [],

  // RadiAnt-style: load current slice first, prefetch neighbours while scrolling.
  // These control concurrent HTTP requests FROM EACH VIEWER TO THE PACS SERVER -
  // unlike decode (which runs in the browser's own web workers, no server
  // load at all), this number multiplies by however many radiologists are
  // using the viewer at once. Bumped moderately (16->24, 20->30) for faster
  // loading; if the PACS server shows strain under multi-user load, dial
  // these back down rather than increasing further.
  maxNumRequests: {
    interaction: 24,
    thumbnail: 2,
    prefetch: 30,
  },

  showStudyList: true,
  showLoadingIndicator: true,
  showWarningMessageForCrossOrigin: false,
  showCPUFallbackMessage: true,

  // RadiAnt-style: a mouse action (scroll/drag/click) on an unselected pane
  // acts immediately AND makes that pane active, in one step - instead of
  // the OHIF default, where the first interaction on an unselected pane is
  // swallowed just to activate it, and the user has to repeat the same
  // scroll/drag a second time to actually do anything.
  activateViewportBeforeInteraction: false,

  // RadiAnt-style: patient name, MRN, sex, age always visible — no click required
  showPatientInfo: 'visibleReadOnly',

  // Default is 'standard', which pops up "Track measurements for this
  // series?" the moment a radiologist draws their first Length/Bidirectional/
  // etc. measurement - interrupting mid-workflow to ask a question most
  // users don't want to answer every time. 'simplified' skips that prompt
  // and just tracks automatically, without disabling measurement/report
  // functionality the way 'none' would.
  measurementTrackingMode: 'simplified',

  whiteLabeling: {
    createLogoComponentFn: function (React) {
      return React.createElement(
        'div',
        { className: 'flex items-center gap-2.5 min-w-0' },
        React.createElement(
          'div',
          {
            className:
              'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-white shadow-[0_2px_10px_rgba(0,0,0,0.22)] ring-1 ring-white/30',
          },
          React.createElement('img', {
            src: './assets/skmlogo1.png',
            alt: 'SKM',
            className: 'h-[72%] w-[72%] translate-x-[0.5px] translate-y-[1px] object-contain',
          })
        ),
        React.createElement(
          'div',
          {
            className:
              'truncate whitespace-nowrap text-[13px] font-semibold tracking-[-0.01em] text-white',
          },
          'SKM DICOM Viewer'
        )
      );
    },
  },

  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'dicomweb',
      configuration: {
        friendlyName: 'SKM PACS',
        name: 'SKM',
        // WADO URI — single-file retrieve, no multipart, most reliable with Cornerstone
        wadoUriRoot: 'https://192.192.8.173/wado/uri',
        // WADO-RS / QIDO-RS base
        qidoRoot: 'https://192.192.8.173/wado/rs',
        wadoRoot: 'https://192.192.8.173/wado/rs',
        qidoSupportsIncludeField: false,
        supportsReject: false,
        // wadouri uses GET /wado/uri?requestType=WADO&objectUID=...&contentType=application/dicom
        // This returns a single DICOM file — much simpler than WADO-RS multipart
        imageRendering: 'wadouri',
        thumbnailRendering: 'wadouri',
        // Lazy series metadata: first series opens fast, rest load in background.
        // Pixel data (WADO-URI) is always loaded on-demand via Cornerstone prefetch.
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        staticWado: false,
        singlepart: 'pdf,video',
        omitQuotationForMultipartRequest: true,
      },
    },
  ],

  defaultDataSourceName: 'dicomweb',

  investigationalUseDialog: {
    option: 'never',
  },

  // When opened from PACS workstation with Modality= in URL, sidebar stays on primary study.
  customizationService: {
    'studyBrowser.studyMode': 'primary',
    // PET: use hot colormap + SUV-friendly window presets (matches OHIF PT defaults)
    // NOTE: this whole key replaces (not merges with) the extension's default -
    // CT must be listed explicitly here too, or CT presets/hotkeys silently stop
    // working entirely (this previously wiped out CT with only a PT override).
    'cornerstone.windowLevelPresets': {
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
        // Clinical PET presets — WW covers the full SUV range, WC at mid-point
        // RadiAnt default: WW=10 WC=5 → matches "0 to 10 SUV" range visible
        { id: 'pt-default', description: 'Default (SUV 0-10)', window: '10', level: '5' },
        { id: 'pt-soft', description: 'Soft (SUV 0-5)', window: '5', level: '2.5' },
        { id: 'pt-high', description: 'High Activity', window: '20', level: '10' },
        { id: 'pt-wholebody', description: 'Whole Body', window: '15', level: '7.5' },
      ],
      // MR/US/CR/DX/MG/NM aren't calibrated to a shared physical scale the
      // way CT (Hounsfield units) and PT (SUV) are — pixel ranges vary by
      // scanner/sequence/detector/exposure, so a FIXED guessed window/level
      // number (like the old CR/DX "2500/1250" here) can be badly wrong for
      // a specific image - this was reported as a blown-out white X-ray in
      // practice. These presets are instead resolved RELATIVE to each
      // image's own native VOI (its DICOM WindowCenter/WindowWidth, already
      // burned in correctly by the modality/PACS for that exact image):
      //   { native: true }  -> the image's own default, unchanged
      //   { relativeWidth, relativeCenterShift } -> native window width
      //   scaled/shifted proportionally - always sane regardless of the
      //   image's actual pixel range. See setWindowLevelPreset in
      //   extensions/cornerstone/src/commandsModule.ts for the resolution
      //   logic. Replace with fixed { window, level } pairs here if exact
      //   values are known for this site's equipment.
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
        { id: 'mr-darker', description: 'Darker', relativeWidth: 1, relativeCenterShift: 0.25 },
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
        { id: 'cr-darker', description: 'Darker', relativeWidth: 1, relativeCenterShift: 0.25 },
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
        { id: 'dx-darker', description: 'Darker', relativeWidth: 1, relativeCenterShift: 0.25 },
      ],
      MG: [
        { id: 'mg-native', description: 'Default (as acquired)', native: true },
        { id: 'mg-higher-contrast', description: 'Higher contrast', relativeWidth: 0.5 },
      ],
      NM: [
        { id: 'nm-native', description: 'Default (as acquired)', native: true },
        { id: 'nm-higher-contrast', description: 'Higher contrast', relativeWidth: 0.5 },
      ],
    },
  },
};
