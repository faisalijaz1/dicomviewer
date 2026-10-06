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
// pixel data) without carrying storagePath. We patch fetch + XHR here so
// every request to our backend automatically carries the storagePath the page
// was opened with. The backend keeps storagePath as required per our plan.
//
// ─── SKM 2026-09-30: THREE-ORIGIN ROUND-ROBIN (connection multiplier) ────────
// By alternating the high-volume pixel-data requests (/wado/uri) across THREE 
// origins (:443, :8443, :8444), we get 3 independent HTTP/2 multiplexed 
// connections. This perfectly balances header compression and congestion control,
// completely eliminating HTTP/2 head-of-line blocking on slow networks.
//
// TO REVERT: set _WADO_MULTI_ORIGIN = false — every request then goes to :443
// (the exact original single-origin behaviour), no rebuild logic changes needed
// beyond this one flag. 
// ─── STORAGEPATH & MULTI-ORIGIN INTERCEPTOR ─────────────────────────────────
var _WADO_MULTI_ORIGIN = false; // master on/off for sharding
if (storagePath) {
    var _encodedPath = encodeURIComponent(storagePath);
    var _backendPattern = '/wado/';
    var _requestCounter = 0; // Counter for round-robin
    // Helper to append storage path AND apply multi-origin load balancing
    function transformUrl(url) {
        if (typeof url !== 'string' || url.indexOf(_backendPattern) === -1) {
            return url;
        }
        // 1. Append storage path
        url = url + (url.indexOf('?') !== -1 ? '&' : '?') + 'storagePath=' + _encodedPath;
        // 2. Multi-Origin Round-Robin (3 Ports)
        if (_WADO_MULTI_ORIGIN) {
            var _origins = ['', ':8443', ':8444'];
            var currentOrigin = _origins[_requestCounter % 3];
            _requestCounter++;
            if (currentOrigin !== '') {
                // If URL is absolute, append the port to the IP
                if (url.indexOf('192.192.8.173') !== -1) {
                    url = url.replace('192.192.8.173', '192.192.8.173' + currentOrigin);
                }
                // If URL is relative, force it to be an absolute cross-origin URL
                else if (url.startsWith('/')) {
                    url = 'https://192.192.8.173' + currentOrigin + url;
                }
            }
        }
        return url;
    }
    // Patch fetch()
    var _origFetch = window.fetch;
    window.fetch = function(url, opts) {
        return _origFetch.call(this, transformUrl(url), opts);
    };
    // Patch XMLHttpRequest.open()
    var _origXhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
        var newUrl = transformUrl(url);
        return _origXhrOpen.apply(this, arguments.length === 2 ? [method, newUrl] : Array.from(arguments).map(function(a, i) { return i === 1 ? newUrl : a; }));
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
 
// Paste this at the VERY TOP of app-config.js
window._CUSTOM_NETWORK_PROGRESS_BAR = false;
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
  //maxNumberOfWebWorkers: 16,
  maxNumberOfWebWorkers: Math.max(2, Math.min(16, (navigator.hardwareConcurrency || 4) - 1)),
    // --- CUSTOM NETWORK PROGRESS BAR ---
  // Set to true to display a sleek blue progress bar at the bottom of the screen
  // that accurately tracks HTTP/2 Bulk API network streaming in real-time.
 
 
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
	 // ORIGINAL bulk api: interaction 8, thumbnail 2, prefetch 3.
    // SKM 2026-10-04 (Phase 1): interaction (the slice the doctor is on) keeps the
    // highest lane so a far-jump slice is never starved by background prefetch.
    // prefetch lowered 20 → 8 so a SMALL decoded cache isn't overrun by too many
    // simultaneously-in-flight (non-evictable) images → avoids CACHE_SIZE_EXCEEDED.
    // ORIGINAL: interaction 8, thumbnail 2, prefetch 20.
    // SKM 2026-10-09: prefetch lane raised 8 → 10 as the HARD CEILING for the adaptive
    // prefetch-concurrency controller (skmPrefetchConcurrency). This only RAISES the
    // ceiling; the controller still throttles the prefetcher's actual inflight cap between
    // 4 and 10 from governor state + cache fill, so raising the lane alone changes nothing
    // until headroom allows. interaction stays 8 (displayed-slice priority preserved).
    interaction: 8,
    thumbnail: 2,
    prefetch: 10
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
    enabled: false,
    chunkSize: 40,
    maxConcurrentChunks: 5, // Controls how many chunks a SINGLE viewport asks for   old 6
    maxGlobalConcurrentChunks: 20, // STRICT LIMIT: The absolute maximum concurrent chunks across the entire browser  old 6
	takeoverDelay: 500, // (Delay before Bulk API starts, allows 1st slice to load instantly)
    // SKM 2026-10-02 (P1.1): free a study's bulk bytes/tracking the instant it is
    // no longer open in ANY viewport (back-to-study-list, closing a pane, or
    // opening a new study in the same tab) — bounds memory across a long
    // multi-study reading session. Selective per-study and only ever frees CLOSED
    // studies, so it can never stall the slice being viewed. Set false to revert
    // to the old never-flush behaviour.
    flushOnStudyClose: true,
    // SKM 2026-10-02 (P2): bounded working-set decode (RadiAnt-style). When true,
    // the whole study still DOWNLOADS (bar reaches 100%), but background DECODE
    // pauses once Cornerstone's cache is ~85% full — remaining slices decode
    // on-demand as the doctor scrolls to them. Eliminates CACHE_SIZE_EXCEEDED churn
    // and the per-tab full-study decode that causes multi-tab OS freezes. The
    // vertical scrollbar is download-driven (see hooks.ts SKM_BULK_DOWNLOADED) so it
    // does NOT stick when decode pauses. Default OFF — turn on to A/B, flip off to
    // instantly return to full-eager-decode behaviour.
    boundedDecode: false,
    // SKM 2026-10-02 (P1.3): divide the Cornerstone cache budget across open tabs
    // (same-origin BroadcastChannel) so N tabs of large studies can't sum past
    // system RAM — the fix for the multi-tab OS freeze on 16 GB machines. Each tab
    // caps at (adaptiveCap / liveTabs), floored at 1 GB, recomputed as tabs open/
    // close. Default ON. Set false to give every tab the full cap (old behaviour).
    // Best paired with boundedDecode:true so the shrink evicts gracefully and the
    // download-driven bar stays monotonic.
    // SKM 2026-10-04 (Phase 1): true → FALSE for the bounded-decode experiment. The cap
    // is now small (maxCacheSize ≈ 768 MB), so N tabs sum to N × cap (e.g. 2 tabs ≈
    // 1.5 GB decoded) — already bounded, no need to DIVIDE. Dividing would also make the
    // per-tab cap drift below the 512/768/1024 values we are sweeping, muddying the
    // results. Each tab gets the FULL cap, so skmSetCacheCap(mb) in the console sets the
    // exact per-tab working set with no heartbeat fighting it. Re-enable (true) only if a
    // LARGE base cap is restored and tabs should share one budget. ORIGINAL: true.
    multiTabCacheSplit: false,
    // SKM 2026-10-02 (P2.2): hard cap (MB) on retained raw bulk bytes across ALL
    // open studies/viewports in a tab. With boundedDecode retaining raw bytes,
    // opening 4 studies in 4 viewports would otherwise hold 4 studies of raw data
    // at once and freeze a 16 GB box. Oldest bytes evict first; evicted slices
    // re-fetch on demand (wadouri) if scrolled to. 0 = unbounded. Default 600.
    maxBulkBufferMB: 400,
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
  enabled: true,
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
  // SKM 2026-10-03 (W1): 40 → 30. Lower in-flight prefetch pressure now that only
  // the ACTIVE series prefetches (skmConcurrentPanes:false below). ORIGINAL: 40.
  // SKM 2026-10-04 (Phase 1): 30 → 12. With a SMALL bounded decode cache, too many
  // prefetched-but-not-yet-evictable images in flight can transiently push the cache
  // past the cap → CACHE_SIZE_EXCEEDED. 12 keeps the pipeline fed while leaving the
  // cache room to evict. ORIGINAL: 30 (W1), 40 (pre-W1).
  // SKM 2026-10-04 (correction): 12 → 6. CS3D 4.22.10 does not evict active-stack images,
  // so a burst of concurrent decodes could overshoot the cap. 6 bounds the burst; the
  // active evictor keeps overall decoded RAM in check. ORIGINAL: 12.
  maxNumPrefetchRequests: 6,
  // SKM 2026-10-03 (W2): pause background prefetch once the decoded cache is ~90%
  // full, instead of flooding it (which overflowed a cache smaller than the series
  // and threw CACHE_SIZE_EXCEEDED). Remaining slices load on-demand as the doctor
  // scrolls. Bounds decoded RAM to ~the cache cap regardless of study size. Set
  // false to restore the old flood-the-whole-series behaviour.
  boundedPrefetch: true,
  // SKM 2026-10-04 (Phase 1): 0.9 → 0.85. With a small cap, pause the prefetch flood a
  // little earlier so in-flight decodes that land after the pause can't tip the cache
  // over 100% → zero CACHE_SIZE_EXCEEDED headroom. ORIGINAL: 0.9.
  // SKM 2026-10-04 (correction): 0.85 → 0.70. Larger headroom for fast-scroll bursts, and
  // with the active evictor freeing space the fill now actually drops below this again so
  // prefetch RESUMES (the old 0.85 + no-eviction combo deadlocked prefetch). ORIGINAL: 0.85.
  // SKM 2026-10-04 (Phase B item 1): 0.70 → 0.90. The 0.70 pause meant the prefetcher only
  // ever filled ~70% of the cap (~535 MB), under-using the committed 768 MB budget → fast
  // scroll re-decoded constantly. With Phase A (purgeable images) + the budget-based evictor
  // keeping a large decoded working set, it's safe to let decode fill to ~90% of the cap; the
  // evictor + native LRU bound it, and the ~77 MB headroom easily absorbs a 250 ms burst
  // (~7 decodes) so the native LRU does not cancel in-flight loads. ORIGINAL: 0.85 → 0.70.
  boundedPrefetchHighWater: 0.90,
  // SKM 2026-10-03 (W2-full): windowed (working-set) decode — the RadiAnt-style fix
  // for multi-viewport / multi-tab freezes. Only a window of ±windowRadius slices
  // around each visible viewport's CURRENT slice is prefetched/decoded (re-centred as
  // you scroll); far slices evict. Bounds decoded RAM to ~2·windowRadius slices PER
  // viewport regardless of study size, so several big series fit a modest cache with
  // no CACHE_SIZE_EXCEEDED / thrash / freeze. Scrolling past the window loads on-
  // demand. Set windowedPrefetch:false to restore full-series prefetch.
  windowedPrefetch: true,
  windowRadius: 250,
  // SKM 2026-10-04 (Option B — skmPriorityPrefetch): priority-aware, direction-adaptive
  // DECODE scheduling. The window is ordered center-out with an ahead-bias in the scroll
  // direction (nearest + ahead slices decode first), and a FAR JUMP cancels stale queued
  // + in-flight prefetch and rebuilds around the new centre — so background work around
  // the old slice never competes with a jump to a far one. The displayed slice itself is
  // still loaded by the viewport at 'interaction' priority (untouched). This governs the
  // small DECODE window (RAM); the larger DOWNLOAD window is skmWarmer above.
  //   windowAhead / windowBehind: ahead-biased DECODE window (slices). Kept modest so
  //     decoded RAM stays bounded: 400 + 150 ≈ 550 slices ≈ ~275 MB (< maxCacheSize).
  //   immediateRadius : Priority-2 neighbourhood decoded first, center-out.
  //   farJumpThreshold: |Δindex| treated as a far jump (cancel stale, re-centre now).
  // TO REVERT: priorityPrefetch:false → previous index-order windowed prefetch.
  priorityPrefetch: true,
  immediateRadius: 15,
  // SKM 2026-10-04 (correction): decode window trimmed 400→300 ahead so steady decoded RAM
  // is smaller and sits well below the cap, leaving headroom for fast-scroll bursts. The
  // active evictor (skmActiveEviction) keeps the actual working set bounded; this window is
  // what the prefetcher DECODES ahead. ORIGINAL: windowAhead 400.
  // SKM 2026-10-04 (Phase B item 1): 300/150 → 600/300. A bigger decode-ahead window lets the
  // prefetcher actually FILL the budget (bounded by boundedPrefetchHighWater 0.90 in BYTES, so
  // this is not "numerically huge" — the byte budget caps it); combined with on-demand decodes
  // the budget-based evictor KEEPS, the decoded working set reaches ~90% of the cap around the
  // doctor → far fewer re-decodes on revisits/jumps. ORIGINAL: 300/150.
  // SKM 2026-10-06 (Fix 4): 600/300 → 6000/6000. The windowed prefetcher only decoded
  // `windowAhead` slices past the current index, so background decode STOPPED at ~600 slices
  // and the loading bar froze at ~14% (603/4403) on a series switch until the doctor scrolled
  // (scrolling advanced the window → "scroll a little → resumes"). It also meant decoded fill
  // never rose, so the eviction/orphan machinery never engaged. With the 4 GB cap + reactive
  // evictor + boundedPrefetch(0.90) now bounding RAM, widen the window to span any clinical
  // series so the WHOLE active series decodes in the background (bar → 100% with no scroll,
  // RadiAnt-style), and a series switch pushes fill high enough for the evictor to reclaim the
  // previous series. priorityPrefetch still orders it center-out ahead-biased and cancels stale
  // work on a far jump. A series larger than the cap still pauses at boundedPrefetch and loads
  // the remainder on scroll (bounded). ORIGINAL: windowAhead 600, windowBehind 300.
  // SKM 2026-10-07 (Fix 5): these are now only INITIAL SEEDS. The adaptive memory-budget
  // governor (skmMemoryBudget.ts) recomputes windowAhead/windowBehind at runtime from the live
  // per-tab decoded budget ÷ measured slice size and writes them into this service's config, so
  // the decode window scales with machine RAM tier and tab count (no fixed 6000). Seeds are sized
  // for the 2048 MB single-tab default so behaviour is sane even if the governor is disabled.
  // ORIGINAL: 600/300 → 6000/6000 (fixed, removed) → runtime-derived.
  windowAhead: 1100,
  windowBehind: 580,
  farJumpThreshold: 120,
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
  // SKM 2026-10-03 (W1): true → FALSE. Prefetching EVERY open pane's full series at
  // once (4 viewports = 4 full studies decoded) is what ballooned RAM to ~9 GB and
  // froze 16 GB boxes. With false, only the ACTIVE pane's series prefetches; other
  // panes load on-demand when activated (RadiAnt-style). Scroll-sync across panes is
  // kept smooth by W4 (sync-window prefetch). Set back to true to restore the old
  // all-panes-at-once behaviour. ORIGINAL: skmConcurrentPanes: true,
  skmConcurrentPanes: false,
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
  // SKM 2026-10-03 (W2): 2.5 GB was too low — a single ~3600-slice series needs
  // ~3.6 GB decoded, so prefetch overflowed the cache and threw CACHE_SIZE_EXCEEDED.
  // Set to 5 GB so one large study (up to ~4400 slices) fits for smooth scrolling on
  // a single tab; multiTabCacheSplit divides it per tab (2 tabs → 2.5 GB each). This
  // is now SAFE even when divided small because studyPrefetcher.boundedPrefetch pauses
  // the prefetch flood near the cap (no overflow, no popup) — the cap is respected,
  // not exceeded. Aggressive users (many panes/tabs) stay bounded; normal users get a
  // big working set. 32 GB consultants can raise further. ORIGINAL: 6442450944 (6 GB).
  // SKM 2026-10-04 (Phase 1 — RAM Optimization / Bounded Decode): 5 GB → 768 MB.
  // This is now the PRIMARY RAM lever. A small cap means decoded RAM plateaus at ~the
  // cap regardless of study size (2000 or 4400 slices), instead of growing to ~1 GB+
  // per full study. 768 MB ≈ ~1500 decoded slices (~0.5 MB/slice) — a large working
  // set around the doctor's position; slices outside it evict (LRU) and re-decode from
  // the browser HTTP cache (now that SSL is trusted, transferSize 0) on scroll-back, or
  // re-fetch from WADO if the HTTP cache evicted too. boundedPrefetch + the lowered
  // prefetch concurrency keep the cache from being overrun → zero CACHE_SIZE_EXCEEDED.
  //
  // EXPERIMENT: do NOT treat 768 MB as final. Sweep 512 / 768 / 1024 WITHOUT rebuilding
  // using the DevTools console:  window.skmSetCacheCap(512)  (then 768, 1024).
  // Pick the smallest cap that keeps scrolling smooth with zero CACHE_SIZE_EXCEEDED,
  // then set it here permanently. Value is in BYTES. ORIGINAL: 6442450944 (6 GB).
  //   512 MB = 536870912 | 768 MB = 805306368 | 1024 MB = 1073741824
  // SKM 2026-10-06 (Fix 3): 768 MB → 3072 MB (3 GB). The office cap-sweep proved the
  // fast-scroll bottleneck was decoded RESIDENCY: at 768 MB the ~1 GB active series could not
  // stay resident, so a full-range scroll ran a constant evict→re-decode→WADO-refetch treadmill
  // (evictionsPerMin ~2000-3300, spinners, scrollbar lag). When the whole series fit in the
  // decoded cache (observed at skmSetCacheCap(3500): decodeCacheMB 1001, evictionsPerMin 0,
  // decodedHitRatio 100%, displayP95 1ms, zero spinner) scrolling was RadiAnt-smooth. Paired
  // with skmActiveEviction.reactiveHighWater (0.85), 3 GB holds BOTH clinical series fully —
  // the 2001 series (~1 GB) and the 4403 series (~2.2 GB) both sit under 0.85 × 3 GB = 2.55 GB,
  // so eviction never runs for a single open series; anything larger stays bounded. Safe on the
  // ≥32 GB reading workstations (3 GB decoded + ~2-3 GB heap leaves ample headroom); the
  // init.tsx device-memory clamp still shrinks this on <8 GB boxes. ORIGINAL: 805306368 (768 MB).
  //   2 GB = 2147483648 | 3 GB = 3221225472 | 3.5 GB = 3670016000 | 4 GB = 4294967296
  // SKM 2026-10-06 (Fix 3b): 3 GB → 3.5 GB. Office A/B: the 2001 series (~1001 MB decoded) is
  // smooth at 3 GB, but the 4403 series needs ~2790 MB decoded-resident, which exceeds the
  // 0.85 × 3 GB = 2.55 GB reactive high-water → eviction treadmill returned (lag + frequent
  // loading). At 3.5 GB the high-water is 0.85 × 3.5 = 2.98 GB > 2790 MB, so the 4403 series
  // stays fully resident (verified smooth at skmSetCacheCap(3500): evictionsPerMin 0,
  // decodedHitRatio 100%, displayP95 2ms, 0 spinners). RAM at that point is ~6 GB for the tab
  // (decoded ~2.8 GB + heap) — safe on the ≥32 GB reading workstations. NOTE: multiTabCacheSplit
  // is false, so N tabs each take up to this; keep that in mind for multi-study-per-tab use.
  // SKM 2026-10-06 (Fix 3c): 3.5 GB → 4 GB. The 4403 series decodes to ~2900 MB, which sat right
  // at the 0.85 × 3.5 = 2.98 GB high-water → borderline oscillation + residual lag. 0.85 × 4 GB =
  // 3.4 GB gives the 4403 series comfortable headroom to stay fully resident with no churn, while
  // still evicting the previous series on a switch (old+new > 3.4 GB → orphan eviction engages).
  // Decoded RAM for a single series is the series size (~2.9 GB) regardless of the cap, so this
  // raises the ceiling for headroom, not steady-state RAM. Safe on the ≥32 GB workstations.
  // ORIGINAL: 805306368 (768 MB) → 3221225472 (3 GB) → 3670016000 (3.5 GB) → this.
  maxCacheSize: 4294967296, // 4 GB (comfortable headroom for the 4403-slice series)

  // SKM 2026-10-04 (Option B — skmBoundedDecodeCache): master gate for the bounded
  // Cornerstone decoded-RAM cap applied in init.tsx. enabled:true applies maxCacheSize
  // (above) + the device/tab scaling. Set enabled:false to run UNBOUNDED (old pre-cap
  // behaviour) for an A/B. This cap is INDEPENDENT of the skmWarmer download window:
  // decoded RAM is bounded here; downloaded compressed bytes live in the HTTP disk cache.
  skmBoundedDecodeCache: {
    enabled: true,
  },

  // SKM 2026-10-07 (Fix 5 — adaptive, multi-tab-aware decoded-RAM governor). Single universal
  // build for both hardware tiers. The governor (skmMemoryBudget.ts) owns the Cornerstone cache
  // cap, the per-tab budget split across live tabs (BroadcastChannel), and the derived decode/
  // prefetch window + warmer near-skip — superseding the static maxCacheSize + multiTabCacheSplit
  // below. Machine decoded budget per WORKSTATION:
  //   - default 2048 MB  → 16 GB-safe for every client with no action
  //   - 32 GB Consultant → run once in the console:  skmSetMemoryBudget(5120)
  //     (persists in that workstation's localStorage; same deployed build/URL for everyone)
  //   - also settable via ?skmBudgetMB=5120 URL param (persisted)
  // AGGREGATE GUARANTEE: perTabCap = floor(machineBudget / liveTabs) — strict division, so the
  // sum across all tabs can never exceed the machine budget. The usable minimum lives on the
  // decode WINDOW (minWindowSlices), not the cap, so RAM stays strictly bounded at any tab count.
  // navigator.deviceMemory is NOT trusted to raise the budget (it caps at 8, can't tell 16 from
  // 32 GB); it can only LOWER it on a genuinely weak box. Tune the two numbers below if needed.
  // SKM 2026-10-08 (Fix 6 — ADAPTIVE runtime governor). The governor starts at the BASELINE and
  // raises the decoded budget in +256 MB steps ONLY under sustained fast-scroll pressure, up to a
  // per-machine HARD CEILING, then lowers it in −256 MB steps after sustained idle. Across tabs it
  // allocates the ceiling by ACTIVITY (active tab gets more, idle tabs a small floor); the sum of
  // all tab allocations never exceeds the hard ceiling. 16 GB validated smooth at 2560 (Edge ~4.5 GB).
  //   16 GB Resident  : baseline 2560, hardCeiling 4096  (default — no action)
  //   32 GB Consultant: run once →  skmSetMemoryBudget(5120, 6144)   (persists per workstation)
  //   URL form:  ?skmBudgetMB=5120&skmCeilingMB=6144
  // deviceMemory only LOWERS the ceiling on a genuinely weak box; never raises it. The hard
  // ceilings are safety values for the adaptive experiment — tune after real Edge/Task-Manager
  // validation on both tiers (they are not yet proven final).
  skmMemoryBudget: {
    baselineMB: 2816,       // 16 GB-safe starting budget (validated smooth on the 4403 series: displayP95 1ms, decodedHit 100%, spinner 0, cacheSizeExceeded 0)
    hardCeilingMB: 4096,    // max AGGREGATE decoded across all tabs on a 16 GB machine
    minBudgetMB: 1024,
    maxBudgetMB: 8192,
    stepMB: 256,            // gradual adaptation step
    idleFloorMB: 512,       // per idle-tab allocation
    idleMinMB: 320,         // hard floor an idle tab can be squeezed to under ceiling pressure
    idleMaxCeilingFraction: 0.3, // idle tabs collectively ≤ 30% of the ceiling
    activeMinMB: 1024,      // minimum allocation for an active (scrolling) tab
    workingSetFraction: 0.82, // decode window fills 82% of the per-tab cap (< 0.85 evict high-water)
    aheadBias: 0.65,
    minWindowSlices: 300,
    maxWindowSlices: 8000,
    // adaptation timing / oscillation guards
    evalMs: 1500,
    increaseDwellMs: 4000,  // min time between increases
    decreaseDwellMs: 8000,  // min time between decreases (slower down than up)
    idleBeforeDecreaseMs: 10000,
    activeScrollMs: 700,    // "scrolling now" window for pressure sampling
    activeTabMs: 8000,      // "tab active" window for allocation priority
    pressureFillFraction: 0.82,
    pressureThreshold: 0.6, // EMA pressure needed to step up
  },

  // SKM 2026-10-09 (adaptive prefetch concurrency — skmPrefetchConcurrency):
  // The StudyPrefetcherService keeps at most maxNumPrefetchRequests prefetch loads in flight.
  // Validation showed that cap (6) pegged with a 2000+ deep pending queue — background warming
  // of a large series was throttle-limited, not network/decode/cache limited. This controller
  // ADAPTS the inflight cap between min and max using the governor's live state
  // (window.__skmBudget: active tab, live tab count) + decoded-cache fill, so it fills faster
  // when there is headroom and backs off under memory/multi-tab pressure. It writes ONLY
  // studyPrefetcherService.config.maxNumPrefetchRequests (read live by the service); it does
  // NOT touch the governor, evictor, warmer, prefetch ordering, or Cornerstone core. The
  // INTERACTION lane (displayed slice) is a separate request-pool lane and is never changed, so
  // the viewed slice keeps top priority. max is clamped to maxNumRequests.prefetch (10 above).
  // Gated by skmBoundedDecodeCache.enabled (same master switch as the governor).
  // Diagnostics: window.skmGetPrefetchConcurrency() / window.__skmPrefetchConcurrency.
  // TO REVERT to the old fixed cap: set enabled:false (the service then uses
  // studyPrefetcher.maxNumPrefetchRequests, i.e. 6).
  skmPrefetchConcurrency: {
    enabled: true,
    minRequests: 4,       // idle tab / near-cap backoff
    baseRequests: 8,      // normal single active tab
    maxRequests: 10,      // headroom-permitting ceiling (≤ maxNumRequests.prefetch)
    multiTabRequests: 6,  // ≥ 2 live tabs: protect shared HTTP pool + aggregate RAM
    evalMs: 1000,
    raiseFill: 0.55,      // single active tab + fill below this → raise toward max
    backoffFill: 0.88,    // fill at/above this → drop toward min (near the cap)
    stepPerEval: 2,       // ramp ±2 so concurrency never jumps in one burst
  },

  // SKM 2026-10-04 (Phase A — skmPurgeableStackImages): THE Cornerstone-level fix.
  // The WADO-URI loader stamps image.sharedCacheKey = <dataset URL> on every image, and
  // CS3D 4.22.10 treats ANY sharedCacheKey image as non-purgeable (isCacheable excludes it,
  // the native LRU skips it, _decacheImage throws). So with a cap below the study size the
  // cache can NEVER evict → CACHE_SIZE_EXCEEDED (what we measured: decode pegged at 768,
  // evictions 0). When enabled, a thin wrapper around the stock wadouri loader clears that
  // legacy sharedCacheKey on the resolved image, so Cornerstone's OWN native LRU evicts at
  // the cap → bounded decoded RAM, zero CACHE_SIZE_EXCEEDED, scroll-back from HTTP cache.
  // Safe for MPR (the volume path re-stamps sharedCacheKey=volumeId afterwards) and for
  // multi-frame (dataset sharing is handled separately by dataSetCacheManager).
  // DEFAULT OFF for a clean A/B — enable ONLY on the validation workstation to test.
  skmPurgeableStackImages: {
    enabled: true,
  },

  // SKM 2026-10-04 (Option B correction — skmActiveEviction): the REAL RAM bound.
  // CS3D 4.22.10 does NOT LRU-evict decoded images that belong to the active stack — it
  // THROWS CACHE_SIZE_EXCEEDED at the cap (observed: decode pinned at 768 MB, 0 evictions,
  // then the blocking modal at ~slice 1753). So maxCacheSize alone is a hard wall, not a
  // bound. This evictor purges decoded STACK slices OUTSIDE a window around the doctor
  // (cache.removeImageLoadObject), keeping decoded RAM ≈ the window (~250–350 MB) so the
  // cap is never reached (no throw) and scroll-back re-decodes from the HTTP cache.
  //   keepAhead/keepBehind : decoded slices to retain around the doctor (direction-aware).
  //                          Must be >= the prefetch decode window above so we don't evict
  //                          what the prefetcher just decoded.
  //   margin               : extra safety band never evicted.
  //   maxEvictPerTick      : long-task guard (purge in bounded batches).
  //   skipWhenVolumePresent: true → eviction is DISABLED whenever an MPR/3D viewport is
  //                          open, so volumes/crosshairs are never disturbed.
  // TO REVERT: enabled:false → Cornerstone's own (non-evicting) cap behaviour.
  //
  // SKM 2026-10-04 (Phase B item 1): BUDGET-BASED working set. Instead of a fixed small window
  // (~350 MB, which under-used the 768 MB budget and forced re-decode on fast scroll), the keep
  // window is sized LIVE from the byte budget: budgetFraction × maxCacheSize ÷ measured avg
  // slice bytes, split ahead/behind by aheadBias and scroll direction, and SHARED across open
  // stack viewports. This fills the committed decoded budget (adapting to real slice size)
  // WITHOUT exceeding the 768 MB cap → most fast-scroll/jumps land on already-decoded slices.
  //   budgetBased     : true = fill the byte budget (this); false = fixed keepAhead/keepBehind.
  //   budgetFraction  : fraction of the cap the decoded working set may fill (0.90 → ~690 MB,
  //                     leaving headroom below the cap so the native LRU doesn't cancel in-flight).
  //   aheadBias       : fraction of the per-viewport budget allocated ahead (scroll direction).
  //   avgSliceBytesEstimate : fallback bytes/slice before the cache can be measured (~0.5 MB).
  //   keepAhead/keepBehind  : fixed-window FALLBACK (only used when budgetBased:false).
  //   maxEvictPerTick : long-task guard (purge in bounded batches; raised for larger jumps).
  //   skipWhenVolumePresent : eviction DISABLED whenever an MPR/3D viewport is open.
  skmActiveEviction: {
    enabled: true,
    budgetBased: true,
    budgetFraction: 0.9,
    aheadBias: 0.65,
    avgSliceBytesEstimate: 524288,
    keepAhead: 400,
    keepBehind: 250,
    margin: 50,
    // SKM 2026-10-05 (Fix 2): 400 → 50. The evictor no longer purges a whole pass in one
    // synchronous main-thread task; it drains candidates in small idle-scheduled batches of
    // this size, yielding to the viewport between batches (see skmWorkingSetEvictor.ts). A
    // small batch bounds the worst-case single-task cost; the idle pump still drains the full
    // working-set overflow across batches, so the RAM bound is unchanged. ORIGINAL: 400.
    maxEvictPerTick: 50,
    throttleMs: 250,
    skipWhenVolumePresent: true,
    // SKM 2026-10-06 (Fix 3 — REACTIVE eviction): only evict when the decoded cache is at or
    // above this fraction of the cap. Below it, eviction is skipped entirely, so any series
    // that fits under (0.85 × cap) stays 100% decoded-resident with ZERO eviction churn — the
    // state the office A/B proved gives RadiAnt-smooth scrolling (evictionsPerMin 0,
    // decodedHitRatio 100%, displayP95 1ms, no spinner). Eviction only engages when a series
    // exceeds the cap, where it stays bounded. Sits below boundedPrefetchHighWater (0.90) so
    // the evictor frees space before the prefetcher pauses (no oscillation). 0 = old behaviour.
    reactiveHighWater: 0.85,
    // SKM 2026-10-06 (Fix 3c): periodic self-tick (ms) so eviction reclaims the PREVIOUS series
    // during background decode after a series switch, without waiting for the doctor to scroll.
    // Without it, switching 2001→4403 left the old series pinned and the prefetcher paused at its
    // high-water until a scroll "unstuck" it (the reported pause). Near-free while idle. 0 = off.
    tickMs: 750,
  },

  // SKM 2026-10-03 (W3 "indicator" warmer): background-download the ACTIVE series
  // into the browser HTTP cache so the vertical progress bar reaches 100% while
  // decode stays windowed (W2). It never decodes or touches the stack/MPR — it only
  // fetches bytes (same /wado/uri URLs Cornerstone uses → cache parity) and emits
  // SKM_SLICE_AVAILABLE for the bar. Default OFF; set enabled:true to A/B test.
  //   concurrency         : per-tab background fetches (keep low to not starve the
  //                         on-screen slice). Default 3.
  //   globalConcurrency   : absolute cap across ALL tabs (BroadcastChannel) — the
  //                         NAS-burst guard. Default 6.
  //   activeSeriesOnly    : warm only the active series (true) vs all open (false).
  //   startDelayMs        : wait after a series opens before warming, so first image
  //                         + initial window win the network first. Default 1500.
  // TO REVERT: enabled:false (whole module dormant; identical to the W2 build).
  // SKM 2026-10: DISABLED after telemetry showed it overwhelmed the server
  // (net::ERR_FAILED) while delivering 0% cache reuse (~2.9 GB downloaded, no hits).
  // THAT failure was caused by the bypassed self-signed cert disabling the HTTP cache
  // (0% reuse) + whole-series flooding. BOTH are now fixed: the cert is trusted
  // (transferSize 0 on re-fetch) and the warmer runs as a bounded MOVING WINDOW.
  //
  // SKM 2026-10-04 (Option B — skmMovingWindow): the warmer now downloads an
  // ahead-biased MOVING WINDOW of compressed bytes around the doctor (into the browser
  // HTTP disk cache, NO decode → no RAM), following the doctor and restarting on a far
  // jump. This is what makes a far jump land on already-downloaded bytes → decode-only
  // (~16 ms) → no spinner, while decoded RAM stays bounded by maxCacheSize (independent).
  //   movingWindow     : true = moving-window mode (Option B); false = old whole-series.
  //   ahead / behind   : slices to warm ahead/behind the doctor (CONFIGURABLE; these are
  //                      byte downloads to disk, NOT simultaneous requests — concurrency
  //                      below bounds how many fetch at once).
  //   concurrency      : per-tab concurrent background fetches (bounded; keep low so the
  //                      on-screen slice is never starved). Current request always wins.
  //   globalConcurrency: absolute cap across ALL tabs (BroadcastChannel) — NAS-burst guard.
  //   rethrottleMs     : min gap between scroll-driven window re-centres.
  //   farJumpThreshold : |Δindex| beyond which the window abandons + restarts.
  // TO REVERT: enabled:false (whole module dormant; identical to the pre-Option-B build).
  // ORIGINAL: enabled: false (and whole-series when it was on).
  skmWarmer: {
    enabled: true,
    movingWindow: true,
    // SKM 2026-10-04 (Phase B): sweep the WHOLE study (near-doctor first, ahead-biased)
    // into the HTTP cache so the Ready N/Total frontier keeps advancing to 100% in the
    // background instead of stopping at the initial window. ahead/behind below only set the
    // PRIORITY ordering; the sweep continues past them to the ends. false = bounded window.
    warmWholeStudy: true,
    ahead: 1000,
    behind: 250,
    // SKM 2026-10-04 (fix G): warm only the FAR band — skip the near band the prefetcher
    // already decodes+HTTP-caches, so the warmer's fetch() never double-requests those
    // slices. Keep these == the prefetch decode window (studyPrefetcher.windowAhead/Behind).
    // SKM 2026-10-05 (Fix 1): matched to the prefetch DECODE window
    // (studyPrefetcher.windowAhead:600 / windowBehind:300). Previously 300/150, which
    // was NARROWER than the prefetch window, so the warmer's fetch() re-requested the
    // 300→600-ahead and 150→300-behind bands that the prefetcher was already fetching
    // via Cornerstone XHR → a guaranteed double-request band. Keeping these == the
    // prefetch window makes the warmer start strictly BEYOND the prefetcher's reach.
    // SKM 2026-10-07 (Fix 5): FALLBACK seeds only. The warmer reads the live near-skip from the
    // adaptive governor (window.__skmBudget.nearSkip = the current prefetch decode window) so it
    // always byte-warms only BEYOND the band the prefetcher decodes — scaling with RAM tier and
    // tab count. These static values apply only if the governor is absent/disabled.
    // ORIGINAL: nearSkipAhead 300/150 → 600/300 → 6000/6000 → runtime-derived.
    nearSkipAhead: 1680,
    nearSkipBehind: 1680,
    concurrency: 4,
    globalConcurrency: 8,
    rethrottleMs: 250,
    farJumpThreshold: 120,
    activeSeriesOnly: true,
    startDelayMs: 1500,
  },

  // SKM 2026-10: read-only in-app telemetry for VALIDATING the caching/RAM
  // architecture with real measurements (HTTP-cache hit ratio, eviction frequency,
  // decode-cache size, CACHE_SIZE_EXCEEDED count, JS heap, scroll jank). Surfaced via
  // the DevTools console — NO PowerShell / host scripting:
  //   skmTelemetry.reset()   before a scroll/jump test
  //   skmTelemetry.report()  after → console.table summary
  // Changes NO behaviour. Enable during validation; set false for production.
  skmTelemetry: {
    enabled: true,
  },

  // SKM 2026-10-09 (QA fix): read-only scroll-position → displayed-image follow
  // instrumentation (see skmScrollFollowTelemetry.ts). Surfaced via DevTools console:
  //   skmScrollFollowReset()                         before a scroll test
  //   skmScrollFollowReport()                         after → per-viewport summary
  //   skmScrollFollowReport(viewportId, {stallThresholdMs}) for a specific viewport/threshold
  //   skmScrollFollowRawLog(viewportId)                raw requested/displayed timeline
  // Changes NO behaviour. Enable during validation; set false for production.
  skmScrollFollow: {
    enabled: true,
  },

  // SKM 2026-10-09 (QA fix — Priority 2): read-only study/series-switch timing
  // breakdown (see skmStudySwitchTelemetry.ts). Surfaced via DevTools console:
  //   skmStudySwitchReport()   after switching studies/series → stage breakdown
  // Changes NO behaviour. Enable during validation; set false for production.
  skmStudySwitchTelemetry: {
    enabled: true,
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
	    // SKM-FIX: Hide the confusing blue fill and percentage badge from the vertical scrollbar!
    // It will now function strictly as a clean, normal scrollbar.
	//  'viewportScrollbar.showLoadedEndpoints': false,
   //  viewportScrollbar.showLoadedFill': false,
   //   'viewportScrollbar.showViewedFill': false,
   //   'viewportScrollbar.showLoadingPattern': false,
    //  'viewportScrollbar.showPercentBadge': false,
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