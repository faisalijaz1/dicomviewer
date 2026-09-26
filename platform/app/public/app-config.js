/**
 * OHIF Viewer v3 — SKM PACS configuration
 *
 * IMPORTANT: this project's production build (`npx yarn run build:viewer`
 * from platform/app, served via the repo's ohif-static-server.js) INLINES
 * this file's content directly into dist/index.html at build time - it is
 * NOT fetched separately at runtime the way a plain `app-config.js` script
 * tag normally would be. Editing this file and only copying it into
 * dist/app-config.js has NO EFFECT on what the browser actually loads;
 * a full rebuild is required for any change here to take effect.
 * (The OHIF_APP_CONFIG env var / `yarn start` workflow mentioned in some
 * upstream OHIF docs is a different run method not used by this project.)
 *
 * DICOMweb endpoint: pacs-dicom-service, reverse-proxied at
 * https://192.192.8.173 (standard HTTPS port, no port suffix)
 * (WADO-RS / QIDO-RS served at /wado/rs)
 *
 * How to deploy OHIF for this project:
 *   1. git clone https://bitbucket.org/skmch/skmch-dicom-viewer.git ohif
 *   2. cd ohif
 *   3. yarn install
 *   4. Edit this file directly at ohif/platform/app/public/app-config.js
 *   5. cd platform/app && npx yarn run build:viewer (rebuilds dist/,
 *      inlining this file's content)
 *   6. From the repo root: node ohif-static-server.js
 *      (set PORT=3000 first to choose the port)
 */


// ---------------------------------------------------------------------------
// EMR integration (Java PACS backend)
//
// The EMR opens a new browser tab pointed at:
//   http://<this-viewer>/viewer?storagePath=\\192.192.1.100\pacs_storage\2023\10\24\ACC12345
// storagePath identifies the study on the hospital's file-based PACS storage.
// The Java backend below resolves it to the real StudyInstanceUID/
// SeriesInstanceUID and serves standard QIDO-RS/WADO-RS from there - the
// EMR developer never needs to know DICOM UIDs at all.
//
// storagePath is sent as a URL PATH SEGMENT (.../wado/rs/<storagePath>/studies),
// not a query parameter - OHIF's DICOMweb client always builds request URLs
// as `root + '/studies'`, `root + '/series'`, etc, so a value baked into the
// root as a query string would end up with "/studies" appended onto the
// query value itself instead of being its own path, which the backend can't
// parse. As a path segment it composes correctly with every request
// automatically, no extra code needed per-endpoint.
//
// Change HOST/PORT here only if the backend moves - nothing else below
// needs to change.
const EMR_BACKEND_PROTOCOL = 'http';
const EMR_BACKEND_HOST = '192.192.8.173';
const EMR_BACKEND_PORT = '9095';

const emrStoragePath = new URLSearchParams(window.location.search).get('storagePath');

const emrBackendRoot = emrStoragePath
  ? `${EMR_BACKEND_PROTOCOL}://${EMR_BACKEND_HOST}:${EMR_BACKEND_PORT}/wado/rs/${encodeURIComponent(emrStoragePath)}`
  : null;

// The viewer route only knows how to open a study from a StudyInstanceUIDs
// URL param (the EMR's storagePath is meaningless to it) - so before the
// viewer tries to load anything, this queries QIDO-RS at the storagePath-
// scoped root above (which the Java backend resolves down to exactly the
// one matching study) and injects the real StudyInstanceUID into the URL's
// query params. `query` here is the SAME URLSearchParams instance Mode.tsx
// reads right after this to decide what to open, so setting it here is
// enough - no other plumbing needed, every other request already uses the
// storagePath-scoped qidoRoot/wadoRoot regardless of the resolved UID.
async function resolveEmrStorageStudy(config, { query }) {
  try {
    const response = await fetch(`${emrBackendRoot}/studies`, {
      headers: { Accept: 'application/dicom+json' },
    });
    if (!response.ok) {
      console.error(
        `[EMR] QIDO lookup for storagePath failed: ${response.status} ${response.statusText}`
      );
      return config;
    }
    const studies = await response.json();
    const studyInstanceUID = studies?.[0]?.['0020000D']?.Value?.[0];
    if (!studyInstanceUID) {
      console.error('[EMR] QIDO lookup for storagePath returned no study - nothing to open.', studies);
      return config;
    }
    query.set('StudyInstanceUIDs', studyInstanceUID);
  } catch (error) {
    console.error('[EMR] Failed to resolve storagePath to a study:', error);
  }
  return config;
}

// Fallback data source: the original SKM PACS connection, unchanged, used
// only when this tab was opened WITHOUT a storagePath (e.g. testing the
// viewer directly, or browsing the worklist) - the EMR-driven path above is
// now the primary way studies are opened.
const dataSourceConfiguration = emrStoragePath
  ? {
      friendlyName: 'EMR Study (Java PACS backend)',
      name: 'EMR',
      qidoRoot: emrBackendRoot,
      wadoRoot: emrBackendRoot,
      qidoSupportsIncludeField: false,
      supportsReject: false,
      // Standard multipart WADO-RS retrieval - this backend implements
      // QIDO-RS/WADO-RS only, no separate single-file WADO-URI endpoint.
      imageRendering: 'wadors',
      thumbnailRendering: 'wadors',
      enableStudyLazyLoad: true,
      supportsFuzzyMatching: false,
      supportsWildcard: true,
      staticWado: false,
      singlepart: 'pdf,video',
      omitQuotationForMultipartRequest: true,
      onConfiguration: resolveEmrStorageStudy,
    }
  : {
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
    };

const urlParams = new URLSearchParams(window.location.search);
const storagePath = urlParams.get('storagePath');
const studyUIDs = urlParams.get('StudyInstanceUIDs');

// ─── STORAGEPATH INTERCEPTOR ────────────────────────────────────────────────
// OHIF's DICOMweb client makes many internal calls (series list, metadata,
// pixel data) without carrying storagePath.  We patch fetch + XHR here so
// every request to our backend automatically carries the storagePath the page
// was opened with.  The backend keeps storagePath as required per our plan.
if (storagePath) {
  var _encodedPath = encodeURIComponent(storagePath);
  var _backendPattern = '/wado/';

  // Patch fetch()
  var _origFetch = window.fetch;
  window.fetch = function(url, opts) {
    if (typeof url === 'string' && url.indexOf(_backendPattern) !== -1) {
      url = url + (url.indexOf('?') !== -1 ? '&' : '?') + 'storagePath=' + _encodedPath;
    }
    return _origFetch.call(this, url, opts);
  };

  // Patch XMLHttpRequest.open()
  var _origXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    if (typeof url === 'string' && url.indexOf(_backendPattern) !== -1) {
      url = url + (url.indexOf('?') !== -1 ? '&' : '?') + 'storagePath=' + _encodedPath;
    }
    return _origXhrOpen.apply(this, arguments.length === 2 ? [method, url] : Array.from(arguments).map(function(a, i) { return i === 1 ? url : a; }));
  };
}

// ─── AUTO-REDIRECT ──────────────────────────────────────────────────────────
// When the EMR opens /viewer?storagePath=\\..., fetch the StudyInstanceUID
// from the backend and redirect OHIF to the correct viewer URL with the UID.
// (storagePath stays in the URL so the interceptor above keeps injecting it.)
if (storagePath && !studyUIDs && window.location.pathname.indexOf('/viewer') !== -1) {
  // The interceptor already added storagePath to this fetch automatically
  fetch('https://192.192.8.173/wado/rs/studies')
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data && data.length > 0 && data[0]['0020000D'] && data[0]['0020000D'].Value) {
        var studyUID = data[0]['0020000D'].Value[0];
        window.location.replace(
          '/viewer?StudyInstanceUIDs=' + encodeURIComponent(studyUID) +
          '&storagePath=' + encodeURIComponent(storagePath)
        );
      } else {
        alert('No DICOM study found in this storage folder:\n' + storagePath);
      }
    })
    .catch(function(err) { console.error('SKM PACS: failed to fetch study metadata', err); });
}


window.config = {
  routerBasename: '/',
  pacsApiUrl: window.location.origin, // forces secure same-origin HTTPS requests
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
    interaction: 30,
    thumbnail: 2,
    prefetch: 30,
  },
  studyPrefetcher: {
    enabled: true,
    displaySetsCount: 1,
    maxNumPrefetchRequests: 25,
    order: 'closest',
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
        )
      );
    },
  },

  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'dicomweb',
      configuration: dataSourceConfiguration,
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
