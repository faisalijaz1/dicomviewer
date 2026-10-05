# Claude Cloud — DICOM Viewer Work History & Engineering Handover

> **Permanent engineering reference / handover document.**
> If you are a new engineer or AI agent picking up this work, read the
> **Executive Summary** and **Current Stopping Point** first (≈2 pages), then
> use the rest as reference. This document is reconstructed from the actual git
> history, current source, and configuration — not from memory alone.

**Repository:** `faisalijaz1/dicomviewer` (OHIF v3 fork)
**Document generated at commit:** `82b89de` (current `master` HEAD)
**Latest *functional* optimization commit:** `60d5317` (adaptive prefetch concurrency)
**Date of this document:** 2026-10-05

### Evidence labelling convention

Throughout this document, claims are tagged:

- **[Source-confirmed]** — verified in current source / config / git history.
- **[Office/runtime observation]** — established by real office testing on the PACS
  workstations; visible in telemetry output but not derivable from source alone.
- **[Hypothesis / not yet proven]** — a working theory, not yet validated.

---

## 1. Executive Summary

**The product.** An OHIF v3 / Cornerstone3D web DICOM viewer connected to a
hospital PACS over **WADO-URI** (`https://192.192.8.173`). Primary use: radiologists
reading **very large CT series** (tested at **~2001** and **~4403** slices) on
Windows/Edge, with **mandatory multi-tab** comparison and two hardware tiers:
**16 GB "Resident"** and **32 GB "Consultant"** workstations.

**The original problem.** On large studies the viewer threw
`CACHE_SIZE_EXCEEDED`, scrolled with lag and spinner flashes, stalled on
series switches, and under multi-tab use could drive Windows into memory
pressure / paging. The decoded-pixel cache was the real RAM consumer, and
Cornerstone's own cache could not evict the active series' images.

**The key root cause.** Cornerstone3D's WADO-URI loader stamps every image with
`image.sharedCacheKey`, and CS3D **4.22.10 treats any `sharedCacheKey` image as
non-purgeable** — so with a cache cap smaller than the study, the LRU could
*never* evict, and the cache hit a hard wall → `CACHE_SIZE_EXCEEDED`.
**[Source-confirmed]**

**The major architectural solution (layers, all in the `cornerstone` extension —
no Cornerstone-core changes):**

1. **Purgeable stack images** — a thin WADO loader wrapper clears the legacy
   `sharedCacheKey` so the native LRU can evict again.
2. **Working-set evictor** — idle-batched, reactive, orphan-aware eviction that
   keeps decoded RAM bounded without blocking the scroll thread.
3. **Windowed / priority / bounded prefetcher** — decodes an ahead-biased window,
   pauses near the cap, cancels stale work on far jumps.
4. **Background warmer** — byte-warms the study into the browser HTTP disk cache
   (no decode) so far jumps land on already-downloaded bytes.
5. **Adaptive memory governor** — one universal build for both RAM tiers: a safe
   baseline that grows under scroll pressure toward a hard ceiling and shrinks
   when idle, with multi-tab coordination that keeps aggregate decoded RAM under
   the machine ceiling.
6. **Preferences UI + adaptive prefetch concurrency** — production control of the
   ceiling, and governor-driven prefetch throughput.

**Current memory strategy.** Universal build. Per-workstation **baseline
2816 MB**, **hard ceiling 4096 MB** (16 GB default). Baseline is the *starting*
allocation, **not** a permanent reservation; the governor grows it in +256 MB
steps under sustained pressure and releases it when idle. Multiple tabs share
the machine ceiling (Σ allocations ≤ ceiling). **[Source-confirmed]**

**Current status.** The memory governor and the 2816/4096 profile are
**office-validated** on 16 GB single-tab and two-tab. The **adaptive prefetch
concurrency** (commit `60d5317`) is the newest functional change and is **not yet
office-A/B-proven**. The very latest commit `82b89de` is a cosmetic scrollbar/
progress-badge polish.

**What the next engineer/agent should do next.** Run the office **A/B validation
of adaptive prefetch concurrency** (Section 11). Do *not* start another
architectural change before that A/B is complete.

---

## 2. Chronological Timeline

```text
Early exploratory phase ("testng" commits, 2026-09-28 → 2026-10-04)
   - bulk loader experiments, purgeable stack images (Phase A),
     windowed/bounded prefetch, moving-window warmer (Phase B)
        ↓
Fix 1 + Fix 2            24b53cb  2026-10-04  warmer/prefetch de-overlap + non-blocking eviction
        ↓
Telemetry WADO breakdown 23e80e5  2026-10-04
        ↓
Fix 3                    44e62a0  2026-10-04  reactive eviction + 3 GB cap
        ↓
Fix 3b (orphan evict)    43737bb  2026-10-04  closed-series eviction + 3.5 GB cap
        ↓
Fix 3c (periodic tick)   268b1fc  2026-10-04  self-tick (series-switch pause) + 4 GB cap
        ↓
Fix 4                    6eddf81  2026-10-04  decode whole active series in background
        ↓
Fix 5 (governor v1)      4894355  2026-10-04  adaptive multi-tab-aware RAM governor
        ↓
Budget tune              efa86ef  2026-10-04  16 GB default 2048 → 3072
        ↓
Fix 6 (governor v2)      a22390f  2026-10-05  pressure-based, active-tab priority
        ↓
Fix 6.1                  12b6c75  2026-10-05  reliable multi-tab coordination (localStorage registry)
        ↓
Fix 6.2                  af17f45  2026-10-05  never starve a sole/uncontested tab to IDLE_FLOOR
        ↓
Preferences UI           6df68a4  2026-10-05  DICOM Image Memory control
        ↓
2816 MB baseline         469b95c  2026-10-05  production baseline 2560 → 2816
        ↓
Adaptive prefetch conc.  60d5317  2026-10-05  governor-driven prefetch concurrency  ← latest FUNCTIONAL
        ↓
Scrollbar/badge polish   82b89de  2026-10-05  RadiAnt-grey loading bar + badge alignment ← current HEAD
        ↓
>>> CURRENT STOPPING POINT <<<
        ↓
Office A/B validation of adaptive prefetch concurrency (NOT yet done)
```

> **Note on the early phase.** The pre-Fix-1 work (Phase A purgeable images,
> the warmer, windowed/bounded prefetch, the bulk-loader toggling) was committed
> under a long run of commits all messaged `testng` (2026-09-28 → 2026-10-04).
> Their design and rationale survive in the extensive dated comments inside
> `platform/app/public/app-config.js` and the `skm*` source files, which this
> document cites. Individual `testng` hashes are not meaningful anchors; treat
> this phase as "the exploratory foundation that the named Fix 1–6 commits
> built on." **[Source-confirmed]**

---

## 3. Project / Problem Background

### 3.1 What the viewer is

OHIF v3 (Open Health Imaging Foundation) web viewer — an extensible React
medical-imaging platform. Rendering is done by **Cornerstone3D**. This fork is
deployed as an **office-only static build** served against a hospital PACS.
**[Source-confirmed: `AGENTS.md`, repo structure]**

### 3.2 Relevant architecture

- **Monorepo** (`platform/`, `extensions/`, `modes/`). Core infra in
  `platform/core` + `platform/ui-next`; feature plugins in `extensions/`.
- **Service-oriented / pub-sub** design (Display Set, Measurement, Hanging
  Protocol, Viewport Grid, Cornerstone Viewport, Study Prefetcher, etc.).
- All of this project's performance work lives in the **`cornerstone` extension**
  and **app-config**, plus one customization in the **`default` extension**.
  **No Cornerstone-core files were modified.** **[Source-confirmed]**

### 3.3 Versions **[Source-confirmed: `package.json`]**

| Component | Version |
|---|---|
| OHIF (lerna) | `3.13.0-beta.82` |
| `@cornerstonejs/core` | `4.22.10` |
| `@cornerstonejs/dicom-image-loader` | `4.22.10` |
| `@cornerstonejs/tools` | `4.22.10` |
| React | 18 |
| Image transport | **WADO-URI** (`/wado/uri`), self-hosted PACS `https://192.192.8.173` |

### 3.4 Test studies

| Study | Slices | Role |
|---|---:|---|
| Body 0.5 | ~2001 | medium large-series |
| Body 0.5 CE | ~4403 | the stress series (≈2.9 GB decoded) **[Office/runtime observation]** |

### 3.5 Original symptoms (pre-optimization baseline)

- `CACHE_SIZE_EXCEEDED` modal at ~slice 1753 with the decoded cache pinned at the
  cap and **0 evictions**. **[Office/runtime observation]**
- Laggy fast-scroll, spinner flashes, scrollbar thumb lag.
- Series-switch stalls (old series stayed pinned; prefetch paused at its
  high-water until a scroll "unstuck" it).
- Excessive / unbounded decoded RAM; OS paging risk under multi-tab.
- Warmer previously overwhelmed the server (`net::ERR_FAILED`, ~2.9 GB
  downloaded, ~0% cache reuse). **[Office/runtime observation]**

---

## 4. Investigation & Key Discoveries

All **[Source-confirmed]** unless noted — each is encoded in current source
comments and/or code.

### 4.1 Cornerstone decoded-cache and `sharedCacheKey`

- Cornerstone keeps a **decoded pixel cache** capped by `setMaxCacheSize`.
- The WADO-URI loader stamps `image.sharedCacheKey = <dataset URL>` on every
  image. In CS3D **4.22.10**, an image with a `sharedCacheKey` is treated as
  **non-purgeable**: `isCacheable` excludes it, the native LRU skips it, and
  `_decacheImage` throws. **Consequence:** with a cap below the study size the
  cache can **never evict** → `CACHE_SIZE_EXCEEDED`. This was *the* root cause.
- **Fix:** a thin wrapper around the stock wadouri loader **clears that legacy
  `sharedCacheKey`** on the resolved image, so Cornerstone's own native LRU can
  evict at the cap again (`skmPurgeableStackImages.ts`).

### 4.2 What clearing `sharedCacheKey` does and does NOT do

- **Does:** re-enable native LRU eviction of decoded stack images → bounded
  decoded RAM, scroll-back re-decodes from the **HTTP cache**.
- **Does NOT:** disable or bypass the **browser HTTP cache**. Byte caching is
  independent of `sharedCacheKey`; clearing it only affects decoded-pixel
  cacheability, not network/disk byte caching.
- **Safe for MPR / volumes:** the volume path re-stamps `sharedCacheKey =
  volumeId` afterward, and multi-frame dataset sharing is handled separately by
  `dataSetCacheManager`. The evictor also skips when a volume is present.

### 4.3 The four distinct caches (do not conflate)

| Layer | What it stores | Bounded by |
|---|---|---|
| **Decoded pixel cache** (Cornerstone) | decoded images (RAM) | `setMaxCacheSize` + the SKM evictor |
| **Browser HTTP cache** (disk) | compressed WADO responses | browser disk quota |
| **WADO/network** | — (transport) | server + browser connection limits |
| **`dataSetCacheManager` / `volumeCache`** | parsed datasets / volumes | Cornerstone internal |

- **Byte warming** = downloading compressed bytes into the HTTP disk cache (no
  decode, no RAM). **Decoded residency** = images decoded and held in the pixel
  cache (RAM). These are different and must be reasoned about separately.

### 4.4 Why windowed prefetch alone does not bound steady-state RAM

Windowing the *prefetch* reduces how far ahead we decode, but **decoded pixels
are the real RAM consumer**, and images already decoded (by on-demand scroll or
earlier windows) stay resident until evicted. So windowing must be paired with
an **evictor** to actually bound steady-state decoded RAM. **[Source-confirmed:
evictor + prefetch comments]**

### 4.5 `STACK_NEW_IMAGE` event wiring

`STACK_NEW_IMAGE` is a **non-bubbling, per-element** Cornerstone event. Initial
listeners attached to `document`/global `eventTarget` **never fired**. The fix
was to subscribe **per viewport element** (via `ELEMENT_ENABLED`), centralized in
`utils/skmStackNewImage`. This is how the prefetcher re-centres its window the
instant the displayed slice changes, and how the governor detects "scrolling now".
**[Source-confirmed: `initStudyPrefetcherService.ts`, `skmMemoryBudget.ts`]**

### 4.6 Browser baseline RAM vs RadiAnt

RadiAnt is a native process; Edge/Chromium carries a larger baseline (renderer,
JS heap, GPU process). Observed `jsHeapMB_peak` ~4.6 GB and Edge total ~8.7 GB
with two studies open. This is why decoded-RAM budgeting must leave headroom for
the browser itself and cannot be reasoned about as "SSD/alloc has room."
**[Office/runtime observation]**

### 4.7 `navigator.deviceMemory` is not reliable for tiering

`navigator.deviceMemory` **caps at 8** and cannot distinguish a 16 GB from a
32 GB machine. Therefore it is used **only to LOWER** the ceiling on genuinely
weak boxes (`deviceMemory < 8`) and never to raise it — and it cannot be used to
auto-select hardware tiers or auto-hide memory options. **[Source-confirmed:
`skmMemoryBudget.ts` `getCeiling()`]**

---

## 5. Implementation Phases (chronological)

> For each phase: problem → change → files → commit → effect → result → status.
> Telemetry numbers are in Section 6.

### Phase 0 — Exploratory foundation (`testng` commits, 2026-09-28 → 10-04)

- **Problem:** `CACHE_SIZE_EXCEEDED`, unbounded decoded RAM, warmer flooding the
  server.
- **Changes introduced (survive in current source):**
  - **Phase A — `skmPurgeableStackImages.ts`:** clear legacy `sharedCacheKey` so
    the native LRU evicts. *THE* core enabler.
  - **`skmBulkImageLoader.ts`:** a bulk whole-series loader (an alternative to the
    per-slice prefetcher). **Currently DISABLED** (`skmBulkLoader.enabled:false`);
    exactly one of {bulk, prefetcher} loads the series, and the per-slice
    prefetcher is the retained path.
  - **Phase B — `skmBackgroundWarmer.ts`:** moving-window byte warmer into the
    HTTP disk cache (no decode).
  - **Windowed / bounded / priority prefetch** in `StudyPrefetcherService`.
- **Status:** Retained as the foundation. The bulk loader was **abandoned** in
  favour of the per-slice prefetcher. **[Source-confirmed]**

### Fix 1 + Fix 2 — `24b53cb` (2026-10-04)

- **Problem:** (1) warmer and prefetcher double-requested the same slices;
  (2) eviction ran as one big synchronous main-thread pass → scroll jank.
- **Change:**
  - **Fix 1:** warmer `nearSkip` band matched to the prefetch decode window so the
    warmer fetches strictly **beyond** the prefetcher's reach (no double-request).
  - **Fix 2:** evictor made **non-blocking** — drains candidates in small
    idle-scheduled batches (`maxEvictPerTick` 400 → 50), yielding to the viewport
    between batches, deferring on active scroll.
- **Files:** `skmBackgroundWarmer.ts`, `skmWorkingSetEvictor.ts`, `app-config.js`.
- **Effect / result:** removed the double-request band; eviction no longer blocked
  scrolling. **Retained.** **[Source-confirmed]**

### Telemetry WADO breakdown — `23e80e5` (2026-10-04)

- **Problem:** needed to know whether misses were network, 304, or disk-cache.
- **Change:** `skmTelemetry.ts` classifies each WADO response:
  `transferSize===0` → disk cache; `encodedBodySize===0` → 304; else network.
  Adds `skmTelemetry.wadoReport()`. **Retained** (diagnostic). **[Source-confirmed]**

### Fix 3 — reactive eviction — `44e62a0` (2026-10-04)

- **Problem:** evicting constantly churned even when the whole series fit under
  the cap.
- **Change:** evict **only when** decoded fill ≥ `reactiveHighWater` (0.85 × cap).
  Below it, zero eviction → a series that fits stays 100% resident with no churn.
  Cap raised to 3 GB.
- **Result:** **[Office/runtime observation]** the state that first produced
  "RadiAnt-smooth" scrolling (evictions/min 0, decodedHitRatio 100 %, displayP95
  1 ms, no spinner) when the series fit. **Retained.**

### Fix 3b — orphan eviction — `43737bb` (2026-10-04)

- **Problem:** switching/closing a series left its decoded images pinned.
- **Change:** **orphan (closed/switched-away series) eviction** — collect and
  evict images no longer belonging to any open viewport. Cap 3.5 GB.
- **Later correction (Fix 6.1-era):** orphan collection moved **above** the
  reactive gate so orphans are reclaimed **regardless of fill**.
- **Result:** frees the previous series on switch. **Retained.** **[Source-confirmed]**

### Fix 3c — periodic self-tick — `268b1fc` (2026-10-04)

- **Problem:** after a series switch the old series stayed pinned and the
  prefetcher paused at its high-water until a scroll "unstuck" it.
- **Change:** evictor **periodic self-tick** (`tickMs` 750) so eviction reclaims
  the previous series during background decode **without** waiting for a scroll.
  Cap 4 GB. **Retained.** **[Source-confirmed]**

### Fix 4 — background decode of whole active series — `6eddf81` (2026-10-04)

- **Problem:** series-switch load pause; the decode window initially stopped at
  ~600 slices (the `windowAhead` boundary), so a far jump hit not-yet-decoded
  slices.
- **Change:** widen the decode-ahead window so the prefetcher fills the budget
  (bounded by `boundedPrefetchHighWater` in **bytes**, not slice count); the
  evictor + bounded prefetch keep RAM bounded. **Retained** (window later becomes
  governor-driven). **[Source-confirmed]**

### Fix 5 — adaptive multi-tab-aware governor (v1) — `4894355` (2026-10-04)

- **Problem:** a single static cap is wrong for two RAM tiers and multi-tab.
- **Change:** first governor — owns the cache cap, a multi-tab split, and the
  derived decode/prefetch window. **Superseded by Fix 6.** **[Source-confirmed]**

### Budget tune — `efa86ef` (2026-10-04)

- 16 GB default decoded budget **2048 → 3072** after measured headroom.
  **Superseded** by later baseline work. **[Source-confirmed]**

### Fix 6 — adaptive runtime governor (v2) — `a22390f` (2026-10-05)

- **Problem:** need pressure-based growth + active-tab priority in one universal
  build, with per-workstation override.
- **Change:** rewrite `skmMemoryBudget.ts` as the **adaptive governor**:
  - baseline → grows **+256 MB** under sustained scroll pressure → hard ceiling;
    shrinks **−256 MB** after sustained idle.
  - EMA pressure score + threshold; dwell/hysteresis guards.
  - per-tab allocation by activity; derived decode/prefetch window.
  - runtime override `skmSetMemoryBudget(baseline, ceiling)`; `deviceMemory` only
    lowers.
- **Result:** confirmed smooth 32 GB/1-tab 4403 fully resident. **Retained
  (then fixed by 6.1/6.2).** **[Source-confirmed + Office/runtime observation]**

### Fix 6.1 — reliable multi-tab coordination — `12b6c75` (2026-10-05)

- **Problem:** **BroadcastChannel-only** peer counting was unreliable in
  locked-down Edge — two tabs both reported `liveTabs:1` and each took the full
  ceiling → aggregate ≈ 8 GB → near-OOM on 16 GB.
- **Change:** replace peer counting with a **localStorage tab registry**
  (`skm-tabreg-<id>`, written each eval, stale >12 s ignored, >20 s pruned);
  BroadcastChannel/storage events become mere "re-allocate now" nudges. Rewrite
  allocation to **ask-based** (active tab asks `desiredMB`; idle asks a floor;
  Σ ≤ ceiling).
- **Result:** reliable `liveTabs` counting. **Retained, but introduced the 6.2
  regression** (below). **[Source-confirmed]**

### Fix 6.2 — never starve a sole/uncontested tab — `af17f45` (2026-10-05)

- **Problem (regression from 6.1):** a single tab that hadn't scrolled within
  `activeTabMs` was classified idle and handed the flat `IDLE_FLOOR` (512 MB).
  For the 4403 series (~2.9 GB) this pinned the cap at 512 MB → **eviction
  treadmill** (~3000 evict/min, passes removing 1000–4570 slices, long tasks up
  to 12 s) and a flood of *"image purged from the cache before it completed
  loading"* — the observed "initial lag, then smooth once warmed."
- **Change (two targeted corrections in `skmMemoryBudget.ts`):**
  1. **Seed `lastScrollAt = now()` at init** so a freshly opened tab is ACTIVE
     for the first `activeTabMs`.
  2. **Idle fair-share floor:** idle ask =
     `min(desiredMB, max(IDLE_FLOOR, floor(ceiling / liveTabs)))`, so a sole tab
     gets its baseline (never 512). Contention unchanged: overflow still shrinks
     idle toward `IDLE_MIN` first, then scales active, strict equal-split last
     resort → Σ ≤ ceiling always.
- **Result:** **[Office/runtime observation]** Gate 1 (1 tab / 4403) came back at
  cap **2816 MB** (not 512), displayP95 1 ms, decodedHit 100 %, spinner 0 — user
  confirmed smooth. **Retained.**

### Preferences UI — `6df68a4` (2026-10-05)

- **Problem:** doctors must not use the console (`skmSetMemoryBudget`) in
  production.
- **Change:** "DICOM Image Memory" section in the existing User Preferences modal
  (`userPreferencesCustomization.tsx`, **default** extension — not core), driving
  the governor via new UI-facing helpers `skmSetMemoryCeiling(mb)` /
  `skmResetMemoryBudget()`. See Section 9. **Retained.** **[Source-confirmed]**

### 2816 MB production baseline — `469b95c` (2026-10-05)

- **Change:** production default baseline **2560 → 2816 MB** (ceiling stays
  4096). Config (`app-config.js skmMemoryBudget.baselineMB`) + governor fallback
  default + Auto display. See Section 8. **Retained.** **[Source-confirmed]**

### Adaptive prefetch concurrency — `60d5317` (2026-10-05) — latest functional

- **Problem:** the prefetcher's inflight cap (`maxNumPrefetchRequests = 6`) sat
  pegged at 6 with a ~2166-deep pending queue while network/decode/cache were
  healthy → background warming was **throttle-limited**, not resource-limited.
- **Change:** new `skmPrefetchConcurrency.ts` adapts the inflight cap **4..10**
  (base 8) from governor state (`__skmBudget`: active, liveTabs) + cache fill;
  pool prefetch lane raised **8 → 10** as the hard ceiling. See Section 10.
- **Status:** **NOT yet office-A/B-proven.** **[Source-confirmed]**

### Scrollbar / badge polish — `82b89de` (2026-10-05) — current HEAD

- **Change (cosmetic only):** moved the download-progress badge clear of the
  scrollbar (overlap fix) and recolored the loaded fill / badge accent / download
  frontier from cyan `highlight` (#5ACCE6) to a **RadiAnt-style neutral grey**
  (`ViewportSliceProgressScrollbar.tsx`). No logic change. **Retained.**
  **[Source-confirmed]**

---

## 6. Telemetry & Test Results

Telemetry is read-only, surfaced via the DevTools console
(`skmTelemetry.reset()` / `skmTelemetry.report()` / `skmTelemetry.wadoReport()`,
`skmGetMemoryBudget()`, `skmGetPrefetchConcurrency()`). All numbers below are
**[Office/runtime observation]**.

### 6.1 Gate 1 — 1 tab / 4403, Fix 6.2 build (fast scroll from cold)

| Metric | Value |
|---|---:|
| `decodeCacheCapMB` | 2816 |
| `decodeCacheMB_peak` | 2202 |
| `decodeCacheMB_now` | 2202 |
| `displayLatencyP50ms` / `P95ms` | 1 / 1 |
| `decodedHitRatioPct` | 100 |
| `spinnerRatePct` | 0 |
| `spinnerStarts` / `spinnerTotalMs` | 6 / 514 |
| `cacheSizeExceeded` | 0 |
| `longTasks_gt50ms` / `longTaskTotalMs` | 1 / 1179 |
| `evictionsPerMin` | 1165 |
| `activeEvictionsTotal` | 2002 |
| `reDecodes` | 6 |
| `pureStackImages` | 4403 |
| `sharedKeyImages` | 0 |
| `volumesInCache` | 0 |
| `wadoRequests` | 4402 |
| `missMBDownloaded` (networkMB) | 2095 |
| `missLatencyP95ms` | 127 |
| `cacheHitRatioPct` | 5 |
| `jsHeapMB_peak` | 4600 |
| `sched_inflight` | 6 |
| `sched_farJumps` | 8 |
| `sched_cancelled` | 11116 |
| `budget_baselineMB` / `budget_hardCeilingMB` | 2560 / 4096 *(pre-2816 build)* |
| `budget_tabAllocationMB` | 2816 |
| `budget_liveTabs` | 1 |

> Note: that Gate-1 run predated commit `469b95c`, so `budget_baselineMB`
> showed 2560 while the adaptive allocation had already climbed to 2816
> (`lastChangeReason: 'pressure-increase'`). The 2816 value is exactly what
> motivated making 2816 the new baseline.

### 6.2 Gate 2 — two browser tabs

| Metric | Tab A | Tab B |
|---|---:|---:|
| `budget_liveTabs` | 2 | 2 |
| `budget_activeTab` | toggled active/idle as scrolled | same |
| aggregate allocation | ≤ 4096 (coordinated) | — |
| OS freeze / `CACHE_SIZE_EXCEEDED` | none | none |

User comment: multi-tab coordinated correctly after 6.2 (`liveTabs:2` on both).

### 6.3 Fix 6.1 regression (the bug 6.2 fixed) — single/idle tab at 512 MB

| Metric | Value |
|---|---:|
| `budget_tabAllocationMB` / `decodeCacheCapMB` | 512 / 512 |
| `evictionsPerMin` | ~3000 |
| evict pass removed | 1000–4570 slices |
| `evict_evictMs` (peak) | ~1330 |
| `longTasks_gt50ms` / `longTaskTotalMs` | 24 / 12149 |
| "purged before completed loading" | flood |

### 6.4 WADO cache breakdown (1 tab / 4403)

| Metric | Value |
|---|---:|
| `wadoRequests` | 4402 (later 10286 across repeated passes) |
| `uniqueUrls` | 4402 → 6403 |
| `fromDiskCache` | 234 → 709 |
| `fromNetwork` | 4168 → 9577 |
| `overallCacheHitPct` | 5–7 |
| `repeatCacheHitPct` | ~4 |
| `missLatencyP95ms` | 117–127 |

Interpretation: low hit ratio is dominated by **first-time** cold downloads
from the PACS; decoded residency (not HTTP reuse) is what makes scrolling smooth
once warm.

### 6.5 Windows / Edge RAM

| Observation | Value |
|---|---:|
| Edge total (two studies open, Task Manager) | ~8,689 MB |
| Windows memory % at that time | ~95 % (16 GB box, many other apps open) |

### 6.6 Values explicitly NOT recorded

- Full A/B numbers for **adaptive prefetch concurrency** (`60d5317`):
  `Not recorded / not available in the test evidence.`
- 32 GB consultant full telemetry sweep: `Not recorded / not available`
  (only the 32 GB/1-tab "fully resident, displayP95 1 ms" qualitative result is
  on record).
- Per-value 2 GB / 2.5 GB / 3 GB / 3.5 GB / 4 GB Preferences sweep:
  `Not recorded / not available` (planned in Section 11).

---

## 7. Failed / Abandoned / Superseded Approaches

Kept deliberately so future agents don't repeat them.

| Approach | Why it failed / was dropped | Lesson |
|---|---|---|
| **Lower the cache cap aggressively** (e.g. 512–768 MB) on a >2 GB series | With non-evictable `sharedCacheKey` images → `CACHE_SIZE_EXCEEDED`; even after purgeable fix, too-small a cap causes an eviction treadmill + "purged before completed loading" | A cap below the working set is worse than none; bound RAM with eviction, not a tiny cap |
| **Whole-study warmer flooding** | Overwhelmed the PACS (`net::ERR_FAILED`), ~2.9 GB downloaded at ~0 % reuse — worsened by a bypassed self-signed cert disabling the HTTP cache | Warm as a **bounded moving window**; ensure the cert is trusted so the HTTP cache actually stores bytes |
| **6,404 background-fetch storm** | The warmer re-requested bands the prefetcher already fetched (near-skip narrower than the decode window) → double requests | Warmer must start **strictly beyond** the prefetch window (`nearSkip == decode window`) |
| **"Warmer downloaded N ⇒ images ready"** assumption | Byte-warming ≠ decoded residency; warmed bytes still need decode | Track **decoded** availability separately from byte availability |
| **Synchronous full-pass eviction** | One big main-thread pass → scroll jank / long tasks | Evict in small **idle-scheduled batches**, defer on active scroll |
| **Always-on (non-reactive) eviction** | Churned even when the series fit under the cap | **Reactive** eviction (only ≥ high-water) → zero churn when it fits |
| **Bulk whole-series loader** (`skmBulkImageLoader`) | Raced the per-slice prefetcher → network fallbacks; kept but **disabled** | Exactly one loader; the per-slice prefetcher won |
| **Full-series `6000/6000` prefetch/warm window** | Numerically huge, over-aggressive; superseded by byte-budget-bounded + runtime-derived windows | Bound by **bytes**, not slice count; derive from the governor |
| **BroadcastChannel-only tab counting** (Fix 6-era) | Unreliable in locked-down Edge → both tabs `liveTabs:1` → 2× ceiling → near-OOM | Use a **localStorage registry** as the authoritative count; BC only as a nudge |
| **Flat `IDLE_FLOOR` (512 MB) for idle tabs** (Fix 6.1) | Starved a sole/uncontested tab → treadmill ("initial lag then smooth") | Idle ask must be a **fair share of the ceiling**, never a flat floor when uncontested (Fix 6.2) |
| **Blindly `6 → 12` prefetch concurrency** | Not evidence-based; HTTP/1.1 ~6-connection-per-origin limit + two-tab contention risk | Adaptive concurrency with a validated ceiling (10), A/B before 12 |
| **`deviceMemory` to pick RAM tier / auto-hide options** | Caps at 8; can't tell 16 vs 32 GB | One universal build + runtime override; downward-only `deviceMemory` safety |
| **Cyan (`highlight`) scrollbar fill** | Too saturated against grayscale anatomy; user disliked | RadiAnt-style neutral grey |

---

## 8. Current Architecture (as of `82b89de`)

### 8.1 Data flow

```text
                        DICOM / WADO-URI PACS  (https://192.192.8.173)
                                    |
                                    v
                    Cornerstone WADO-URI loader
                                    |
                    skmPurgeableStackImages  (clears sharedCacheKey → LRU can evict)
                                    |
             +----------------------+-----------------------+
             |                      |                       |
             v                      v                       v
   Interaction lane (8)     Prefetch lane (≤10)       Thumbnail lane (2)   [request pool]
   (displayed slice)        (StudyPrefetcher)
                                    |
                   +----------------+----------------+
                   |                                 |
                   v                                 v
          windowed/priority/bounded          skmPrefetchConcurrency
          prefetch (ahead-biased)            (adapts inflight cap 4..10
                   |                           from __skmBudget + fill)
                   v
            Decoded pixel cache  <----  skmWorkingSetEvictor
                   ^                     (reactive ≥0.85, idle-batched,
                   |                      orphan reclaim, self-tick 750ms)
                   |
          skmBackgroundWarmer  (byte-warm BEYOND the decode window → HTTP disk cache)
                   |
                   v
            skmMemoryBudget  (ADAPTIVE GOVERNOR)
            - reads baseline/ceiling (localStorage override or config default)
            - grows +256 under pressure / shrinks -256 when idle
            - per-tab allocation; writes cache cap + decode window + nearSkip
            - publishes window.__skmBudget
                   |
        +----------+-----------+           localStorage tab registry
        |                      |           (skm-tabreg-<id>): authoritative
        v                      v           liveTabs count; Σ alloc ≤ ceiling
     Tab 1                  Tab 2
   allocation            allocation
   (active→desired,      (idle→fair share,
    grows under           shrinks under
    pressure)             contention)

   Preferences UI (DICOM Image Memory) --calls--> skmSetMemoryCeiling / skmResetMemoryBudget
   Telemetry (skmTelemetry) observes all layers (read-only)
   Scrollbar/progress overlay (ViewportSliceProgressScrollbar) shows ready/total + grey fill
```

### 8.2 Component responsibilities

- **`skmPurgeableStackImages.ts`** — WADO loader wrapper; clears legacy
  `sharedCacheKey` so decoded stack images are LRU-evictable. The core enabler.
- **`skmWorkingSetEvictor.ts`** — bounds decoded RAM: reactive (≥ `reactiveHighWater`
  0.85), idle-batched (`maxEvictPerTick` 50, yields on scroll), eager orphan
  reclaim (above the reactive gate), periodic self-tick (`tickMs` 750).
- **`StudyPrefetcherService`** (`platform/core/.../StudyPrefetcherService.ts`) —
  windowed + priority + bounded prefetch; reads `maxNumPrefetchRequests` **live**
  each dispatch; `boundedPrefetch` pauses the feed ≥ `boundedPrefetchHighWater`
  (0.90).
- **`initStudyPrefetcherService.ts`** — wires the service to Cornerstone (pool,
  loader, cache fill fraction, per-element `STACK_NEW_IMAGE`).
- **`skmBackgroundWarmer.ts`** — moving-window byte warmer into the HTTP disk
  cache; reads live `nearSkip` from the governor so it warms strictly beyond the
  decode window.
- **`skmMemoryBudget.ts`** — the **adaptive governor**: owns the cache cap, per-tab
  allocation, derived decode window; localStorage registry; publishes
  `window.__skmBudget`; exposes `skmSetMemoryBudget/skmGetMemoryBudget/
  skmSetMemoryCeiling/skmResetMemoryBudget`.
- **`skmPrefetchConcurrency.ts`** — adaptive prefetch inflight cap from governor
  state + fill; publishes `window.__skmPrefetchConcurrency`; exposes
  `skmGetPrefetchConcurrency`.
- **`skmTelemetry.ts`** — read-only measurement/console reporting.
- **`skmBulkImageLoader.ts`** — alternative bulk loader; **disabled**.
- **`userPreferencesCustomization.tsx`** (default ext) — the DICOM Image Memory UI.
- **`ViewportSliceProgressScrollbar.tsx`** — the ready/total badge + grey
  loaded-fill scrollbar.
- **`init.tsx`** (cornerstone ext) — wires all of the above; sets the request-pool
  lanes.

### 8.3 Feature flags (all in `app-config.js`)

| Flag | Default | Effect of `false` |
|---|---|---|
| `skmBoundedDecodeCache.enabled` | true | disables governor **and** prefetch-concurrency controller (unbounded cap) |
| `skmPurgeableStackImages.enabled` | true | images stay non-purgeable (old `CACHE_SIZE_EXCEEDED` risk) |
| `skmActiveEviction.enabled` | true | no SKM eviction |
| `skmWarmer.enabled` | true | no byte warming |
| `skmPrefetchConcurrency.enabled` | true | fixed `maxNumPrefetchRequests` (6) |
| `skmBulkLoader.enabled` | **false** | (would enable the bulk loader; must then disable the prefetcher) |
| `studyPrefetcher.enabled` | true | no per-slice prefetch |
| `skmTelemetry.enabled` | true | no console telemetry |

---

## 9. DICOM Image Memory Preferences UI (`6df68a4`)

**Location:** Preferences modal → "DICOM Image Memory"
(`extensions/default/src/customizations/userPreferencesCustomization.tsx`).

**Options & meaning** (the selected value is the **machine hard ceiling**, not a
reservation):

| Option | Ceiling | Baseline applied |
|---|---:|---:|
| Auto / Recommended | config default (4096) | 2816 |
| 2 GB | 2048 | 2048 |
| 2.5 GB | 2560 | 2560 |
| 3 GB | 3072 | 2816 |
| 3.5 GB | 3584 | 2816 |
| 4 GB | 4096 | 2816 |
| 5 GB (high) | 5120 | 2816 (ack required) |
| 6 GB (high) | 6144 | 2816 (ack required) |

- **Auto** calls `skmResetMemoryBudget()` → clears the override → governor uses
  config defaults (2816 / 4096). It is **not** a hard-coded 4096 alias; it follows
  config.
- **2–6 GB** call `skmSetMemoryCeiling(mb)` → set ceiling; baseline stays 2816
  unless the ceiling is lower, then baseline drops to the ceiling.
- **5/6 GB require an acknowledgement toggle** because `deviceMemory` cannot tell
  16 GB from 32 GB, so the UI warns instead of auto-hiding (option B). Without the
  ack, Save leaves the ceiling unchanged.
- **Persistence:** governor localStorage keys `skmMemoryBudgetMB` (baseline) and
  `skmMemoryCeilingMB` (ceiling). The dropdown's current selection is **derived
  from governor state** (`source==='default'` → Auto; else map ceiling → option).
- **Live readout:** "Maximum: X (Recommended) · Current allocation: Y", plus for
  Auto "starts around 2.8 GB and grows to 4 GB under load" — polled from
  `__skmBudget`.
- **Reset to defaults** also resets memory to Auto.
- **Console (still available for diagnostics):** `skmSetMemoryBudget(base,ceil)`,
  `skmGetMemoryBudget()`, `skmSetMemoryCeiling(mb)`, `skmResetMemoryBudget()`.
- **Multi-tab:** the ceiling is machine-wide (shared localStorage); the governor
  still divides it across `liveTabs` (Σ ≤ ceiling).

**[Source-confirmed]**

---

## 10. Adaptive Prefetch Concurrency (`60d5317`)

**Two independent limits existed:**

1. **Cornerstone request pool** lanes (`init.tsx`): `interaction`, `thumbnail`,
   `prefetch` — concurrency *per request type*. The **interaction** lane (the
   displayed slice) is separate and is **never** throttled by this feature.
2. **StudyPrefetcher** `maxNumPrefetchRequests` — how many prefetch loads the
   service hands to the pool at once.

**Diagnosis [Office/runtime observation]:** with `maxNumPrefetchRequests = 6`,
`sched_inflight` sat pegged at 6 with `sched_queue` ~2166, while network/decode/
cache were healthy → **throttle-limited**, not resource-limited. The pool prefetch
lane (8) already had spare capacity.

**Change [Source-confirmed]:**
- Pool prefetch lane **8 → 10** (hard ceiling; raising it alone changes nothing
  until the controller asks for more).
- `skmPrefetchConcurrency.ts` adapts the inflight cap (ramps ±2 per 1 s):

| Condition | Cap |
|---|---:|
| this tab idle | 4 |
| ≥ 2 live tabs | 6 |
| single active tab, fill < 0.55 | 10 |
| single active tab, fill ≥ 0.88 | 4 |
| single active tab, otherwise | 8 |

- Inputs: `__skmBudget.activeTab`, `__skmBudget.liveTabs`, decoded-cache fill.
- Writes **only** `studyPrefetcherService.config.maxNumPrefetchRequests`
  (read live). No governor/evictor/warmer/core change.
- **Why not blindly 12 / not touch interaction:** HTTP/1.1 allows ~6 connections
  per origin; interaction and prefetch share that pool. Interaction must stay
  top-priority, and >10 risks starving it on HTTP/1.1 with two tabs — needs A/B
  evidence first.
- **Disable:** `skmPrefetchConcurrency.enabled:false` → fixed cap 6.
- **Full revert:** `git revert 60d5317`.

**Status: NOT yet production-proven — requires the Section 11 A/B.**

---

## 11. CURRENT STOPPING POINT / WHERE WE STOPPED

- **Current `master` HEAD:** `82b89de` — cosmetic scrollbar/progress polish.
- **Latest *functional* change:** `60d5317` — adaptive prefetch concurrency.
- **Proven in office:** memory governor (6.2), 2816/4096 profile (16 GB 1-tab &
  2-tab), Preferences UI.
- **NOT yet proven:** adaptive prefetch concurrency (`60d5317`).

### Next step — Office A/B validation of adaptive prefetch concurrency

**A (control):** fixed prefetch concurrency = 6
(set `skmPrefetchConcurrency.enabled:false`, rebuild).
**B (new):** adaptive (shipped default).

For each of **2001** and **4403**: cold load → fast forward → fast reverse →
large jumps → two viewports → two browser tabs → study switching. Reset telemetry
before each; capture after.

**Measure:** `displayLatencyP95ms`, `spinnerRatePct`, `decodedHitRatioPct`,
`reDecodes`, `evictionsPerMin`, `cacheSizeExceeded`, `longTasks_gt50ms` /
`longTaskTotalMs`, `wadoRequests` / `networkMB`, `decodesPerMin`, `sched_queue`,
`sched_inflight`, `skmGetPrefetchConcurrency()`, Edge RAM, Windows memory %,
subjective smoothness.

**Success:** B shows higher `sched_inflight` (8–10 single-tab) and faster warm /
fewer not-ready edges on fast-reverse & multi-viewport, **with no regression**:
`cacheSizeExceeded` 0, no "purged before completed loading" flood, `displayP95`
≈ A (interaction not starved), evictions/re-decodes not materially worse, Edge RAM
within the same envelope, two-tab `skmGetPrefetchConcurrency()` = 6 per tab.
**Failure:** any of those regress → lower `multiTabRequests` to 4, or revert.

Do **not** start another architectural change before this A/B is complete.

---

## 12. Current Memory Strategy

```text
Recommended baseline : 2816 MB   (starting allocation, NOT a permanent reservation)
Default hard ceiling : 4096 MB   (max AGGREGATE decoded across all tabs on a 16 GB box)
```

- **2816 MB is the starting point**, chosen because 16 GB office validation on the
  4403 series ran smooth exactly at 2816 (displayP95 1 ms, decodedHit 100 %,
  spinner 0, cacheSizeExceeded 0). **[Office/runtime observation]**
- The governor **grows** allocation +256 MB under sustained pressure toward the
  ceiling and **shrinks** −256 MB when idle. **[Source-confirmed]**
- **Multiple tabs share the machine ceiling**; Σ(tab allocations) ≤ ceiling,
  enforced by ask-based allocation + the localStorage registry.
- **Why 4096, not "4 GB per tab":** Edge baseline + JS heap (~4.6 GB peak) + OS
  must fit in 16 GB; giving each tab 4 GB would blow the budget (the Fix 6.1 bug).
- **Why one universal build for 16 & 32 GB:** `deviceMemory` can't distinguish
  them, so hardware-specific builds aren't reliable; instead one build +
  per-workstation override (Preferences / `skmSetMemoryCeiling`).
- **Why SSD/disk is not the constraint:** decoded pixels live in **RAM**, not on
  disk; byte warming uses the HTTP disk cache but decoded residency is the RAM
  budget.

**Behavior examples (16 GB, ceiling 4096):**

| Scenario | Allocation |
|---|---|
| 1 active tab | starts ~2816, grows toward 4096 under pressure, releases when idle |
| 2 active tabs | coordinated, e.g. 2048 + 2048 or 2560 + 1536 — Σ ≤ 4096 |
| 1 active + 1 idle | active keeps ~desired; idle shrinks toward IDLE_MIN so Σ ≤ 4096 |
| sole idle tab | keeps baseline (Fix 6.2) — never collapses to 512 |

---

## 13. Files Changed — Inventory

> Paths verified against the repository at `82b89de`. **[Source-confirmed]**

| File | Responsibility |
|---|---|
| `platform/app/public/app-config.js` | All SKM tunables + request-pool lanes + feature flags |
| `extensions/cornerstone/src/skmPurgeableStackImages.ts` | Clear `sharedCacheKey` → LRU-evictable decoded images |
| `extensions/cornerstone/src/skmWorkingSetEvictor.ts` | Reactive/idle-batched/orphan/self-tick eviction |
| `extensions/cornerstone/src/skmBackgroundWarmer.ts` | Moving-window byte warmer (HTTP disk cache) |
| `extensions/cornerstone/src/skmMemoryBudget.ts` | **Adaptive memory governor** + UI helpers + registry |
| `extensions/cornerstone/src/skmPrefetchConcurrency.ts` | Adaptive prefetch inflight cap |
| `extensions/cornerstone/src/skmBulkImageLoader.ts` | Bulk whole-series loader (**disabled**) |
| `extensions/cornerstone/src/skmTelemetry.ts` | Read-only telemetry / console reports |
| `extensions/cornerstone/src/initStudyPrefetcherService.ts` | Wire prefetcher to Cornerstone + per-element events |
| `extensions/cornerstone/src/init.tsx` | Wire all SKM modules; set request-pool lanes |
| `platform/core/src/services/StudyPrefetcherService/StudyPrefetcherService.ts` | Windowed/priority/bounded prefetch engine (reads config live) |
| `extensions/default/src/customizations/userPreferencesCustomization.tsx` | DICOM Image Memory Preferences UI |
| `extensions/cornerstone/src/Viewport/Overlays/ViewportSliceProgressScrollbar/ViewportSliceProgressScrollbar.tsx` | Ready/total badge + grey loaded-fill scrollbar |

---

## 14. Configuration Reference

> **All values verified from `platform/app/public/app-config.js` at `82b89de`.**
> **[Source-confirmed]**

### 14.1 Request pool lanes (`maxNumRequests`)

| Key | Value | Purpose |
|---|---:|---|
| `interaction` | 8 | displayed-slice lane (top priority; never throttled) |
| `thumbnail` | 2 | thumbnails |
| `prefetch` | 10 | hard ceiling for adaptive prefetch cap |

### 14.2 Memory governor (`skmMemoryBudget`)

| Key | Value | Purpose |
|---|---:|---|
| `baselineMB` | 2816 | starting allocation |
| `hardCeilingMB` | 4096 | machine-wide aggregate ceiling |
| `minBudgetMB` / `maxBudgetMB` | 1024 / 8192 | override clamp bounds |
| `stepMB` | 256 | grow/shrink step |
| `idleFloorMB` | 512 | per idle-tab allocation (contended) |
| `idleMinMB` | 320 | hard floor under ceiling pressure |
| `idleMaxCeilingFraction` | 0.3 | idle tabs ≤ 30 % of ceiling |
| `activeMinMB` | 1024 | min for an active tab |
| `workingSetFraction` | 0.82 | decode window fills 82 % of cap |
| `aheadBias` | 0.65 | ahead/behind window split |
| `minWindowSlices` / `maxWindowSlices` | 300 / 8000 | derived-window clamp |
| `evalMs` | 1500 | governor eval cadence |
| `increaseDwellMs` / `decreaseDwellMs` | 4000 / 8000 | min time between steps |
| `idleBeforeDecreaseMs` | 10000 | idle before shrinking |
| `activeScrollMs` | 700 | "scrolling now" window |
| `activeTabMs` | 8000 | "tab active" window |
| `pressureFillFraction` | 0.82 | fill needed to count as pressure |
| `pressureThreshold` | 0.6 | EMA pressure to step up |

### 14.3 Prefetch concurrency (`skmPrefetchConcurrency`)

| Key | Value | Purpose |
|---|---:|---|
| `enabled` | true | master gate (false → fixed 6) |
| `minRequests` | 4 | idle / near-cap backoff |
| `baseRequests` | 8 | normal single active tab |
| `maxRequests` | 10 | ceiling (≤ pool prefetch lane) |
| `multiTabRequests` | 6 | ≥ 2 live tabs |
| `evalMs` | 1000 | controller cadence |
| `raiseFill` | 0.55 | fill below → raise toward max |
| `backoffFill` | 0.88 | fill at/above → drop to min |
| `stepPerEval` | 2 | ramp step |

### 14.4 Study prefetcher (`studyPrefetcher`)

| Key | Value | Purpose |
|---|---:|---|
| `enabled` | true | per-slice prefetch on |
| `displaySetsCount` | 1 | prefetch only the active series |
| `maxNumPrefetchRequests` | 6 | **static fallback** (overridden live by the concurrency controller) |
| `boundedPrefetch` | true | pause feed near cap |
| `boundedPrefetchHighWater` | 0.90 | pause threshold (bytes) |
| `windowedPrefetch` | true | decode only a window |
| `windowRadius` | 250 | windowed radius |
| `priorityPrefetch` | true | center-out ahead-biased + far-jump cancel |
| `immediateRadius` | 15 | priority-2 neighbourhood |
| `windowAhead` / `windowBehind` | 1100 / 580 | **seed** (governor rewrites at runtime) |
| `skmConcurrentPanes` | false | panes do **not** multiply prefetch |
| `skmConcurrentPanesMaxRequests` | 96 | (inactive while above is false) |

### 14.5 Eviction (`skmActiveEviction`)

| Key | Value | Purpose |
|---|---:|---|
| `enabled` | true | evictor on |
| `budgetBased` / `budgetFraction` | true / 0.9 | keep-window sized from byte budget |
| `aheadBias` | 0.65 | keep-window ahead bias |
| `avgSliceBytesEstimate` | 524288 | fallback slice size |
| `keepAhead` / `keepBehind` / `margin` | 400 / 250 / 50 | keep-window seeds |
| `maxEvictPerTick` | 50 | idle batch size (was 400) |
| `throttleMs` | 250 | min interval between passes |
| `skipWhenVolumePresent` | true | don't evict in MPR/volume |
| `reactiveHighWater` | 0.85 | only evict ≥ this fill |
| `tickMs` | 750 | periodic self-tick |

### 14.6 Warmer (`skmWarmer`)

| Key | Value | Purpose |
|---|---:|---|
| `enabled` | true | byte warmer on |
| `movingWindow` | true | moving-window mode |
| `warmWholeStudy` | true | sweep whole study (priority near-first) |
| `ahead` / `behind` | 1000 / 250 | priority ordering |
| `nearSkipAhead` / `nearSkipBehind` | 1680 / 1680 | **fallback** skip band (governor's `nearSkip` overrides live) |
| `concurrency` / `globalConcurrency` | 4 / 8 | per-tab / all-tab fetch cap |
| `rethrottleMs` | 250 | re-centre throttle |
| `farJumpThreshold` | 120 | far-jump re-centre |
| `activeSeriesOnly` | true | warm only the active series |
| `startDelayMs` | 1500 | delay after series open |

### 14.7 Caps / master switches

| Key | Value | Purpose |
|---|---:|---|
| `maxCacheSize` | 4294967296 (4 GB) | Cornerstone cap seed (governor owns it at runtime) |
| `skmBoundedDecodeCache.enabled` | true | master gate for governor + concurrency |
| `skmPurgeableStackImages.enabled` | true | purgeable images |
| `skmBulkLoader.enabled` | false | bulk loader off |
| `skmTelemetry.enabled` | true | telemetry on |

---

## 15. DO NOT CHANGE WITHOUT TESTING

These parameters are load-bearing. A "simple" change here can reintroduce
`CACHE_SIZE_EXCEEDED`, RAM exhaustion, re-decode storms, request storms, UI lag,
long tasks, or multi-tab OS freeze.

| Parameter(s) | Risk if changed blindly |
|---|---|
| `skmMemoryBudget.hardCeilingMB` / `baselineMB` | Too high → 16 GB OS paging / freeze (esp. multi-tab); too low → eviction treadmill + "purged before completed loading" |
| `skmPrefetchConcurrency.*` / `maxNumRequests.prefetch` | Too high → request storm, HTTP/1.1 connection starvation of the interaction lane, transient RAM overshoot; exceeding the pool lane does nothing |
| `maxNumRequests.interaction` | Lowering starves the displayed slice → spinner/lag |
| `studyPrefetcher.windowAhead/windowBehind/windowRadius` | Too large → decode floods past the byte budget; governor overrides these at runtime anyway |
| `skmWarmer.nearSkip*` / `ahead` / `behind` / `concurrency` | Too small a nearSkip → double-request storm; too high concurrency → PACS overload (`net::ERR_FAILED`) |
| `skmActiveEviction.reactiveHighWater` | Too low → constant churn even when the series fits; too high → cap overshoot before eviction engages |
| `skmActiveEviction.maxEvictPerTick` | Too large → synchronous-feeling long tasks / scroll jank |
| `boundedPrefetchHighWater` | Too high → `CACHE_SIZE_EXCEEDED`; too low → prefetch under-fills, constant re-decode |
| `skmPurgeableStackImages.enabled` | Disabling → images non-purgeable again → `CACHE_SIZE_EXCEEDED` on large series |

**Rule:** change one parameter at a time, reset telemetry, run the 2001 + 4403
fast-scroll + two-tab matrix, and confirm the no-regression gates in Section 11
before committing.

---

## 16. Rollback / Recovery

Prefer `git revert` (non-destructive) and runtime feature flags over history
rewrites. **Do not** use `reset --hard` on `master`.

### Runtime flags (no rebuild of logic; just edit `app-config.js` + rebuild assets)

| To disable | Set |
|---|---|
| Adaptive prefetch concurrency → fixed 6 | `skmPrefetchConcurrency.enabled: false` |
| Governor + concurrency (unbounded) | `skmBoundedDecodeCache.enabled: false` |
| Warmer | `skmWarmer.enabled: false` |
| Evictor | `skmActiveEviction.enabled: false` |
| Purgeable images | `skmPurgeableStackImages.enabled: false` *(reintroduces `CACHE_SIZE_EXCEEDED` risk)* |

### Per-commit reverts

```bash
# Adaptive prefetch concurrency (latest functional)
git revert 60d5317

# Scrollbar/badge cosmetic polish
git revert 82b89de

# Preferences UI
git revert 6df68a4

# 2816 baseline → restores 2560
git revert 469b95c

# Fix 6.2 (sole-tab floor)  — reverting reintroduces the 512 MB starvation bug
git revert af17f45
```

### Memory UI / governor runtime recovery (per workstation, no rebuild)

- Reset to defaults: Preferences → DICOM Image Memory → **Auto / Recommended**,
  or console `skmResetMemoryBudget()`.
- Set a specific ceiling: `skmSetMemoryCeiling(3072)` or
  `skmSetMemoryBudget(2816, 4096)`.
- Clear a stuck override: `skmResetMemoryBudget()` (clears `skmMemoryBudgetMB` /
  `skmMemoryCeilingMB`).

---

## 17. Open Issues / Future Work

Only genuinely unresolved items.

1. **Adaptive prefetch concurrency A/B** (`60d5317`) — needs the Section 11 office
   validation before it can be called production-proven.
2. **Final 16 GB vs 32 GB production tuning** — 32 GB consultants currently raise
   the ceiling manually (`skmSetMemoryBudget(5120, 6144)` / Preferences 5–6 GB).
   Whether a different *baseline* for 32 GB is worthwhile is unmeasured.
   `Not recorded / not available.`
3. **Whether >10 prefetch concurrency helps** — only worth testing if the WADO
   server is HTTP/2 (no 6-connection limit). Server protocol version:
   `Hypothesis / not yet proven` — verify before raising the pool lane past 10.
4. **Multi-viewport (Ctrl+click two-pane) full validation** — the sole-tab path is
   fixed; a formal two-pane telemetry sweep is `Not recorded / not available`.
5. **Preferences per-tier sweep** — 2/2.5/3/3.5/4 GB subjective + telemetry
   comparison on 16 GB to confirm 2816/4096 is optimal: `Not recorded / not available`.
6. **Study-switch UX** — functionally fixed (orphan evict + self-tick); no known
   open defect, but worth a final confirmation pass during the A/B.

---

## 18. Quick Reference — Console Diagnostics

```text
skmTelemetry.reset()            // before a scroll/jump test
skmTelemetry.report()           // console.table summary after
skmTelemetry.wadoReport()       // WADO cache-source breakdown
skmGetMemoryBudget()            // governor snapshot (__skmBudget)
skmSetMemoryBudget(base, ceil)  // e.g. skmSetMemoryBudget(5120, 6144) for 32 GB
skmSetMemoryCeiling(mb)         // set only the ceiling (UI uses this)
skmResetMemoryBudget()          // Auto / clear override
skmGetPrefetchConcurrency()     // adaptive concurrency snapshot (__skmPrefetchConcurrency)
```

**Build / deploy (office):**

```bash
git fetch origin master && git checkout master && git pull origin master
cd platform/app && npx yarn run build:viewer   # inlines app-config.js into dist/index.html
node ohif-static-server.js                      # serve dist
# hard-refresh the browser (Ctrl+Shift+R)
```

---

*End of document. Keep this file updated as the single source of truth whenever
the SKM memory/prefetch architecture changes.*
