# Temporary office canary: prefetch concurrency 15–20

**Status:** configuration only. No office measurements have been collected. Do not treat 15–20 as faster until the protocol below is run.

This is a diagnostic override in `platform/app/public/app-config.js`. Production fallbacks in `skmPrefetchConcurrency.ts` stay min 4 / base 8 / max 10 / multiTab 6. Bulk API stays disabled. The background warmer, interaction lane, memory governor, cache limits, eviction, and decode worker count are unchanged.

## Why the adaptive numbers alone were not enough

Effective prefetch concurrency is the minimum of:

1. The adaptive value written to `studyPrefetcherService.config.maxNumPrefetchRequests`.
2. `maxNumRequests.prefetch` — the Cornerstone request-pool prefetch lane (`init.tsx`). The controller clamps its max to this lane.
3. `StudyPrefetcherService.maxConcurrentDecodeAheadRequests`, applied in `_effectiveMaxPrefetchRequests()`. Production sets that to `maxNumberOfWebWorkers − 1` (`initStudyPrefetcherService.ts`). `maxNumberOfWebWorkers` is `min(16, hardwareConcurrency − 1)`, and `initWADOImageLoader.js` starts that many decode workers. So the production dispatch ceiling is at most **15**, and on an 8-core machine it is **6**.

A two-viewport session never uses `maxRequests`. `decidePrefetchConcurrencyTarget` returns `multiTabRequests` whenever `stackViewports >= 2` (same value as two live tabs). With min 15 and the old multiTab 6, that target is clamped to **15** and cannot reach 20.

## Office override (this canary)

| Knob | Production | Canary | Why |
|---|---:|---:|---|
| `skmPrefetchConcurrency.minRequests` | 4 | 15 | idle / high-fill backoff |
| `skmPrefetchConcurrency.baseRequests` | 8 | 15 | seed (`conc` starts at base) and single-tab mid-fill |
| `skmPrefetchConcurrency.maxRequests` | 10 | 20 | single-tab, fill &lt; 0.55 only |
| `skmPrefetchConcurrency.multiTabRequests` | 6 | 20 | **required** so 2 viewports (and 2 tabs) target 20 |
| `maxNumRequests.prefetch` | 10 | 20 | pool lane; interaction stays 8, thumbnail stays 2 |
| `canaryDecodeAheadCap` | omitted (workers−1) | 20 | prefetch dispatch ceiling only |

`canaryDecodeAheadCap` does **not** increase `maxNumberOfWebWorkers`. Decode parallelism stays `hardwareConcurrency − 1` capped at 16. Up to 20 prefetch loads can be in flight while decode beyond the worker count queues. The displayed slice still has its own interaction request lane (8), but its decode can wait behind prefetch decodes. That scrolling risk is part of what this test is meant to observe.

On a two-viewport run the controller reason is `multi_viewport` and the target is **20** after a ramp of +2 per second from the seed of 15 (15 → 17 → 19 → 20). It does not wander between 15 and 20 with cache fill. Fill-based 15 vs 20 applies only to a single stack viewport. Idle (tab not active) drops to 15.

## What you can verify

After a hard refresh of the rebuilt viewer:

```text
skmPrefetchCanaryReport()
skmGetPrefetchConcurrency()
skmPrefetchConcDecisionLog()
```

Check these fields, not the config file:

- `configuredMin` / `configuredMax` — 15 / 20
- `adaptiveTarget` — 20 once the two viewports are open and the tab is active
- `configuredPrefetchLimit` — value written to `maxNumPrefetchRequests` (ramps from 15)
- `effectivePrefetchLimit` — min(configured, `decodeAheadCap`). Must be 20 once the ramp finishes. If it is lower, `decodeAheadSource` is not `canary-override` or the pool lane is still 10.
- `prefetchInflight` / `prefetchQueue` — scheduler in-flight and pending depth (`getSchedulerDiagnostics`)
- `decodeWorkerCount` — actual loader worker count. `workerSaturation` is **null**: the DICOM image loader does not expose queued decode-task depth.
- `warmerInFlightFetches` — background warmer only. Warmer concurrency is still 4 per tab / 8 global.

Separate consoles, already in the build:

| Question | Command | Limit |
|---|---|---|
| Throughput, lane counters, unique URLs | `skmThroughput.reset()` then `skmThroughput.report()` / `.lanes()` | Enabled. Does not by itself print "unique image IDs warmed per second"; use `skmWarmerDiagnostics().warmedImageIdCount` sampled over time. |
| Warmer in flight | `skmWarmerDiagnostics()` | Separate from prefetch inflight. |
| Cache hit, peak decoded cache, JS heap, errors | `skmTelemetry.reset()` then `skmTelemetry.report()` | `jsHeapMB_peak` is the JS heap (Edge/Chrome). Task Manager RAM is not measurable from the page. |
| Scrolling | `skmScrollFollowReset()` / `skmScrollFollowReport()` | Run only after the warm pass. |

`boundedPrefetchHighWater` (0.90) still pauses prefetch when the decoded cache is near its cap. A late drop in `prefetchInflight` can be that pause, not the concurrency controller.

## Controlled protocol

Use the same two distinct 3,674-slice series, two viewports, one tab, and the same browser-cache state for every run. Do not mix viewport counts.

1. Record the **baseline** first by reverting this canary (see below), rebuilding, and running at least three valid repetitions.
2. Restore this canary, rebuild, hard-refresh, and run at least three valid repetitions.
3. For each run: cold or matched cache state, open both series, **do not scroll** until byte-warming is complete. Completion is the same definition every time (both Ready bars at the warmed total you are using; record which one).
4. Then, separately, one repeatable scroll pass per run. Do not mix scroll time into the warm time.
5. Discard a run if the viewport count, cache state, or completion rule differs.

Compare first-image display, warm completion, decoded readiness, scroll responsiveness, `cacheSizeExceeded`, errors, peak decoded cache, and JS heap. This document does not claim a winner.

## Revert

In `platform/app/public/app-config.js`:

- `maxNumRequests.prefetch`: `20` → `10` (leave `interaction: 8`, `thumbnail: 2`)
- `skmPrefetchConcurrency`: `minRequests: 4`, `baseRequests: 8`, `maxRequests: 10`, `multiTabRequests: 6`, delete `canaryDecodeAheadCap`

Leave `skmBulkLoader.enabled: false`, `skmWarmer` concurrency, and `maxNumberOfWebWorkers` as they are. Rebuild `platform/app` and hard-refresh. `skmPrefetchCanaryReport()` should then show min 4, max 10, and `decodeAheadSource: workers-minus-one`.

## Recommendation before measurements exist

Revert this canary after the manual session unless the three-rep comparison shows a clear warm or scroll improvement **and** no rise in errors, cache-size failures, or scroll stalls. If 15–20 only adds memory pressure or worker contention, revert and do not keep the override.
