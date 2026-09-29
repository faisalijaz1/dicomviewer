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


// Standard SKM PACS data source for production
const dataSourceConfiguration = {
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
  //
  // ── A/B TEST 2026-09-28 (REVERTED): wadors per-frame retrieval was measured at
  // 36.3s vs wadouri 32s on the LAN — slightly slower (same ~2001 requests, ~same
  // bytes, plus a per-request server-side DICOM parse). Reverted to wadouri.
  // To retry wadors, swap the two 'wadors' lines back in below.
  // imageRendering: 'wadors',
  // thumbnailRendering: 'wadors',
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

  // ── DECODE PARALLELISM FIX 2026-09-28 ──────────────────────────────────────
  // OS-level profiling proved the 32s load is CLIENT-SIDE DECODE-BOUND: during
  // load, Chrome pegged ~2.4 CPU cores while the gigabit LAN sat ~70% idle
  // (~33 MB/s). The browser can't pull pixels faster than it can decode them
  // (~63 slices/s = ~16ms/slice). Server/NAS/HTTP-2 changes cannot help this.
  //
  // This value was previously UNSET, so initWADOImageLoader.js computed
  //   Math.min(hardwareConcurrency - 1, undefined) === NaN
  // and the DICOM image loader fell back to only a couple of decode workers.
  // Setting it high lets that same min() resolve to (hardwareConcurrency - 1),
  // i.e. use nearly every CPU core for parallel decode. On an 8-core box this
  // goes from ~2-3 workers to 7 → roughly 2-3x decode throughput, which is the
  // path from ~32s toward the 15-20s target. It auto-scales per machine (a
  // 4-core box still caps at 3); one core is always left free for the UI.
  maxNumberOfWebWorkers: 16,

  // RadiAnt-style: load current slice first, prefetch neighbours while scrolling.
  // These control concurrent HTTP requests FROM EACH VIEWER TO THE PACS SERVER -
  // unlike decode (which runs in the browser's own web workers, no server
  // load at all), this number multiplies by however many radiologists are
  // using the viewer at once. Bumped moderately (16->24, 20->30) for faster
  // loading; if the PACS server shows strain under multi-user load, dial
  // these back down rather than increasing further.
  maxNumRequests: {
    // Concurrent HTTP requests from the viewer to the PACS, per priority class.
    // Bottleneck is the client-facing transfer, not the server (NAS read + ES
    // are both fast once gzip-on-DICOM was removed). 'interaction' = the slice
    // you're actively viewing/scrolling (highest priority); 'prefetch' = the
    // background full-series pull. Kept modest because more concurrency does not
    // raise throughput here (already delivery-bound), and it lets the image you
    // are looking at win bandwidth for smooth scroll.
    // ── PIPELINE-FEED FIX 2026-09-28 ──────────────────────────────────────
    // Performance profile proved the client is IDLE ~58% during load (network
    // ~36% used, CPU not pegged) → the pipe is STARVED, not delivery-bound.
    // Earlier "24 vs 40 = no change" was measured while decode was the wall;
    // that wall is gone (web workers), so concurrency now matters. Pushed hard
    // to keep many requests in flight over the HTTP/2 connection. REQUIRES
    // nginx on http2 (h1 caps the browser at 6 conns/host and nullifies this).
    // ORIGINAL: interaction 8, thumbnail 2, prefetch 20.
    interaction: 16,
    thumbnail: 4,
    prefetch: 80,
  },
  // ── SKM-BULK 2026-09-28 (Fix 3) ───────────────────────────────────────────
  // Batch pixel retrieval: one request pulls ~50 slices instead of 50 separate
  // round-trips, removing the per-request latency gaps that were the LAN wall
  // (client, server, storage and network were all measured idle). Bytes are the
  // SAME uncompressed DICOM files as /wado/uri and are decoded by Cornerstone's
  // own pipeline — identical pixels, no compression, no quality change.
  //   enabled            : master on/off (set false to instantly revert to the
  //                        proven per-slice wadouri path).
  //   chunkSize          : slices per bulk request (50 = ~40 requests for 2001).
  //   maxConcurrentChunks: bulk requests in flight; bounds transient memory to
  //                        ~maxConcurrentChunks * chunkSize slices (~100 MB).
  // SKM-BULK 2026-09-28 (perf): with the backend now reading each chunk's files
  // in parallel (shared 48-thread pool), the storage side is what saturates the
  // 1 Gbps link. Keep chunkSize modest and run a few chunks concurrently so
  // several HTTP/2 streams overlap and the pipe stays full end-to-end. Transient
  // memory ≈ maxConcurrentChunks * chunkSize slices (~6*20*0.5MB ≈ 60 MB).
  // ORIGINAL: chunkSize: 30, maxConcurrentChunks: 4
  // SKM 2026-09-30: DISABLED. It was left ON at the SAME TIME as
  // studyPrefetcher below (both `enabled: true`), which violates this config's
  // own rule ("exactly one of the two loads the full series"). The result was a
  // DOUBLE-FETCH: every slice pulled once as a /wado/bulk chunk AND again as a
  // per-slice uri?requestType=WADO request — Network tab showed 1,594 MB moved
  // for a ~1,054 MB study (~1.5x), which is why the load took 36s even after the
  // nginx HTTP/1.1 change raised throughput to ~450 Mbps. Disabling bulk leaves
  // exactly ONE loader (the per-slice prefetcher, historically the faster path:
  // 27s vs bulk 33.7s) so we get a clean read on the HTTP/1.1 gain.
  // TO RE-ENABLE BULK: set this enabled:true AND set studyPrefetcher.enabled:false
  // (never both true at once).
  // ORIGINAL: enabled: true,
  skmBulkLoader: {
    enabled: true,
    chunkSize: 20,
    maxConcurrentChunks: 6,
  },

  studyPrefetcher: {
  // Disabled while skmBulkLoader is ON — the bulk driver loads the full series,
  // so the old per-slice prefetcher would only race it and cause network
  // fallbacks. If you set skmBulkLoader.enabled=false, set this back to true.
  // ORIGINAL: enabled: true,
  // SKM 2026-09-28: bulk is now DISABLED again, so the prefetcher MUST be ON —
  // otherwise nothing eagerly loads the series and the centre spinner stalls
  // when the progress bar completes (the regression that reappeared). Keep this
  // = !skmBulkLoader.enabled: exactly one of the two loads the full series.
  enabled: false,
  // Prefetch ONLY the series currently open in the viewport (active series).
  // With our StudyPrefetcherService change the active series is first in the
  // prefetch list, so displaySetsCount:1 = active series only — it loads fully
  // and eagerly (instant scrolling), but other series are NOT pulled over the
  // network until the user actually opens them (opening a series makes it active
  // and re-triggers prefetch for it). Raise this number to also pre-pull that
  // many nearest neighbouring series if desired.
  displaySetsCount: 1,
  // Raised 20 → 48 to match maxNumRequests.prefetch (pipeline-feed fix 2026-09-28).
  // ORIGINAL: maxNumPrefetchRequests: 20,
  maxNumPrefetchRequests: 50,
  order: 'closest',            // load nearest-to-current slice first, then outward
  // Give the first (visible) image a clear runway before the background prefetch
  // flood starts, so time-to-first-image stays low instead of the first image
  // sharing the HTTP/2 connection with 20 concurrent prefetch downloads. Only
  // the initial study-open is delayed; series switches restart immediately.
  // Tune: raise if TTFI still competes, lower/0 to disable.
  prefetchStartDelayMs: 1000,
  // SKM 2026-09-28: concurrent multi-viewport prefetch. When >1 study/pane is
  // open (Ctrl+click), interleave every open series so all viewport progress
  // bars advance together, and scale the in-flight cap by the number of open
  // panes so the focused study is not slowed by sharing a fixed 48-slot budget
  // (bounded by skmConcurrentPanesMaxRequests). Only helps to the extent the
  // storage/network has spare capacity. Set to false to revert to the original
  // "one series fully, then the next" behaviour — no other change needed.
  skmConcurrentPanes: true,
  // Ceiling for the pane-scaled cap (default = maxNumPrefetchRequests * 2 = 96).
  // Keep it near the level proven safe against the storage share.
  skmConcurrentPanesMaxRequests: 96,
  },

  // Hard cap on the Cornerstone image cache (decoded pixel data held in
  // browser memory). Without this the cache grows unbounded as a radiologist
  // scrolls a huge CT (6,000+ slices), climbing past Chrome's ~4 GB tab limit
  // and crashing the tab (OOM). With a cap, the oldest slices are evicted once
  // the limit is reached, so memory plateaus instead of climbing to a crash.
  // Read in extensions/cornerstone/src/init.tsx -> setMaxCacheSize(), where the
  // EFFECTIVE cap = min(this value, 20% of navigator.deviceMemory). This value is
  // a CEILING; the 20%-of-RAM rule is what actually scales the cache to the
  // machine (and safely shrinks it on smaller boxes).
  //
  // Configured for the LIVE reading workstations (min 32 GB RAM), NOT this dev
  // box (2026-09-28):
  //   32 GB machine -> min(8 GB, 20% * 32 = 6.4 GB) = 6.4 GB  (caches ~6k-12k
  //                    decoded CT slices — essentially every study stays fully
  //                    cached, instant scrolling, no re-fetch), ~25 GB left free.
  //   >=40 GB       -> 8 GB (this ceiling).
  //   16 GB (dev)   -> min(8 GB, 3.2 GB) = 3.2 GB (auto-scaled down; if a starved
  //                    dev box still OOMs, lower this value locally only).
  // deviceMemory reports TOTAL installed RAM, not FREE RAM (no browser API exposes
  // free RAM), so pick this ceiling for the fleet's guaranteed-min spec.
  // Value is in BYTES (8 * 1024^3).
  maxCacheSize: 2147483648,



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
