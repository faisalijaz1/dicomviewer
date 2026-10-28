# SKM Multi-Viewport Performance Audit (P0)

**Baseline candidate:** `2523c72` (fair warmer, `activeSeriesOnly: false`)  
**Incomplete office observation (not a completed benchmark):** 2×3674 — one viewport byte-warm ~100% @ ~41s; other ~90% @ ~176s. Four-viewport not measured.  
**Do not claim RadiAnt parity** until comparable cold/warm Scenario A/B runs complete.

## 1. Configuration audit (load-bearing)

| Setting | Configured | Consumer | Effective | Inert? | Recommendation |
|---|---|---|---|---|---|
| `studyPrefetcher.enabled` | `true` | `StudyPrefetcherService` | Decode prefetch ON | no | leave |
| `studyPrefetcher.displaySetsCount` | `1` | `_getSortedDisplaySetsToPrefetch` | Extra neighbours = 0; **all displayed** still listed | no | leave (comment misleading) |
| `studyPrefetcher.maxNumPrefetchRequests` | `6` seed | overwritten by `skmPrefetchConcurrency` | ~6 with ≥2 panes | seed | leave |
| `studyPrefetcher.skmConcurrentPanes` | `false` | `_loadDisplaySets` | **Sequential** enqueue (focused window first) | no | leave for now (RAM risk); warmer fills inactive near band |
| `studyPrefetcher.prefetchStartDelayMs` | `1000` | VIEWPORTS_READY | TTFI head start | no | leave |
| `studyPrefetcher.windowAhead/Behind` | seeds | governor + keep-clamp | runtime keep window | seeds | leave (canary) |
| `studyPrefetcher.farJumpThreshold` | `120` | prefetcher only | cancel/rebuild prefetch | **warmer ignored until this change** | warmer now reads `skmWarmer.farJumpThreshold` |
| `maxNumRequests.interaction/prefetch` | `8` / `10` | `imageLoadPoolManager` | pool lanes | no | leave |
| `skmWarmer.enabled` | `true` | `initSkmWarmer` | raw `fetch()` outside pool | no | leave |
| `skmWarmer.activeSeriesOnly` | `false` | fair path | multi-series jobs | no | leave false |
| `skmWarmer.activeBias` | **`1` (new)** | `pickFairSeriesIndex` | ~1:1 picks | was hard-coded 2 | **set 1** |
| `skmWarmer.nearSkipPreferredOnly` | **`true` (new)** | `mwOrderedWindow` / fairSync | skip near only on preferred | was skip-all | **true** |
| `skmWarmer.nearSkipAhead/Behind` | `1680` | overridden by clamp/budget | preferred far-band only | seeds | leave |
| `skmWarmer.concurrency` / `globalConcurrency` | `4` / `8` | `effectiveConcurrency` | shared fair slots | no | leave (no blind raise) |
| `skmWarmer.startDelayMs` | `1500` | fair first sync | **now honored** | was inert on fair path | leave |
| `skmWarmer.farJumpThreshold` | `120` | fairSync / mwRecenter | **now wired** | was inert / hard-coded 50 | leave 120 |
| `skmPrefetchKeepClamp.*` | canary on | clamp + `__skmPrefetchKeepClampNearSkip` | warmer nearSkip source | no | **do not change thresholds** |
| `skmActiveEviction.*` / reactive / idle | canary | evictor | keep window | no | **paused changes** |
| `skmBulkLoader.enabled` | `false` | init | must stay off | intentional | keep false |
| `skmMemoryBudget.*` / `maxCacheSize` | governor | cap + windows | live | no | leave values |

Full interaction notes: inactive Ready bar marks via `SKM_SLICE_AVAILABLE` + `IMAGE_CACHE_IMAGE_ADDED` filtered by per-viewport `imageIdToIndex` (`ViewportSliceProgressScrollbar/hooks.ts`).

## 2. Root cause(s) (code evidence)

1. **Inactive near-band hole (strongest):** warmer `nearSkip` assumed prefetch owns `[center±skip]` for **every** open series, but `skmConcurrentPanes:false` enqueues focused series first. Inactive near slices got neither warmer events nor timely prefetch decode → bar stalls near ~90% when skip ≈ 10% of 3674.
2. **Asymmetric progress paths:** active near fills via decode (`IMAGE_CACHE_IMAGE_ADDED`); inactive near depended on warmer (which skipped).
3. **2:1 fair bias + warmer outside pool:** stacked with (1)–(2); alone insufficient for 4× wall time but worsens far-band share.
4. **Fair warmer still necessary:** without `activeSeriesOnly:false`, inactive series were aborted entirely (`2523c72`); that fix is kept, not replaced.

## 3. Prioritized optimization plan

| P | Change | Status |
|---|---|---|
| P0 | Series-aware nearSkip (`nearSkipPreferredOnly`) | implemented |
| P0 | Fair `activeBias: 1` | implemented |
| P0 | Wire `farJumpThreshold` + fair `startDelayMs` | implemented |
| P1 | Soft-interleave prefetch for inactive near decode | deferred (RAM risk; re-eval after A/B) |
| P1 | Pool-aware warmer / NAS throughput proof before raising concurrency | deferred |
| P2 | Four-viewport tune after Scenario B data | deferred |

## 4. Implementation

See commit on `master` after this doc lands. Diagnostics: `skmWarmerDiagnostics()` (`fairPicksActive/Other`, `nearSkipPreferredOnly`, `fairActiveBias`, `fairQueues`), `skmSchedulerReport()`, `skmTelemetry.wadoReport()`.

## 5. Testing Agent brief (required before production)

Compare **`2523c72`** vs **this commit** under equivalent conditions. Do **not** label incomplete runs as completed benchmarks.

**Scenario A:** two distinct 3674-slice series, two viewports.  
**Scenario B:** four viewports — two series >3000 slices + two >500 slices.

Per viewport: first visible render; fresh first-touch latency; byte-warm completion; decoded-cache vs byte-warm; request count/bytes/failures.  
Per scenario: time until last viewport byte-warm complete; starvation; scroll/switch responsiveness; JS heap / process memory.  
Cold-cache and separate warm-cache; raw timestamps; repeated runs; limitations; before/after.

**Pass signals (directional):** inactive bar reaches ~100% without a long ~90% stall; last-complete wall time improves; TTFI / first-touch not regressed vs ~0.6–0.9s reference; interaction lane stays responsive.  
**No RadiAnt claim** until comparable numbers exist.

---

## 6. Post-`722b80e` focused findings (3673/3674 + ~9.3s TTFI)

**TA artifact:** full report for `index.62f482eb.js` was not checked into the repo; symptoms taken from the TA summary.

### Issue A — Ready stuck at 3,673/3,674 after queues drained

**Evidence (code):**
- Ready denominator used `viewport.getNumberOfSlices()` while marks only resolve via `imageIds` / `imageIdToIndex` (single index; duplicates overwrite).
- Fair warmer shifted a slice off the queue before fetch completed; non-OK / network failure did **not** re-queue → permanent unwarmed hole after drain.
- Walk simulation: no off-by-one outside `nearSkip`; a single-slice plateau matches failure/accounting, not fairness starvation.

**Likely causes (ranked):** (1) failed/aborted warmer fetch without retry; (2) progress accounting (`numberOfSlices` vs `imageIds`, or duplicate `imageId`); (3) one preferred nearSkip slice never decoded and never warmed — less likely alone if only **one** missing after long idle.

**Fix (minimal):** retry failed fair fetches (≤2); drain-reconcile only when ≤8 unwarmed+uncached (emit cache hits; do not storm nearSkip); Ready total + multi-index marks from `imageIds`. Does **not** fake completion.

### Issue B — ~9.3s first visible after assignment

**Evidence (code):** `skmWarmer.startDelayMs` (1500) and `prefetchStartDelayMs` (1000) delay **background** work only; displayed slice still uses the interaction lane. Neither can alone explain 9.3s.

**Likely causes:** cold study/metadata/assignment path, or TA waiting on Ready/overlay rather than `IMAGE_RENDERED` / first canvas paint. Historical ~0.6–0.9s is a warm-path reference.

**Fix:** no scheduler change without measuring `IMAGE_RENDERED` (or equivalent) vs badge observation. TA should record both timestamps.
