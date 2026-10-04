/**
 * ────────────────────────────────────────────────────────────────────────────
 *  SKM-TELEMETRY 2026-10 — in-app measurement harness (read-only)
 *
 *  PURPOSE
 *  Make the caching/RAM architecture decisions measurable instead of assumed.
 *  It validates the HTTP-cache assumptions (hit ratio, eviction) and the
 *  decode-cache behaviour (RAM, churn, CACHE_SIZE_EXCEEDED, scroll jank) that the
 *  windowed-decode / warmer work depends on.
 *
 *  ACCESS — NO POWERSHELL / NO ADMIN SCRIPTING (locked-down clinical workstations).
 *  Everything is reachable from the browser DevTools Console:
 *     window.skmTelemetry.report()   → prints a console.table summary + returns it
 *     window.skmTelemetry.reset()    → start a fresh measurement window (call before a scroll test)
 *     window.skmTelemetry.snapshot() → current raw counters
 *  It also auto-logs a rolling summary every 30 s so numbers are visible passively.
 *
 *  WHAT IT MEASURES
 *   - WADO cache hit ratio   : % of /wado/uri requests served from cache (transferSize===0)
 *   - Eviction frequency     : Cornerstone IMAGE_CACHE_IMAGE_REMOVED per minute
 *   - Decode rate            : IMAGE_LOADED per minute (re-decode cost proxy)
 *   - CACHE_SIZE_EXCEEDED    : count (must be 0)
 *   - Decode cache size      : cache.getCacheSize() vs getMaxCacheSize()
 *   - JS heap                : performance.memory.usedJSHeapSize (Chrome/Edge; total RAM = Task Manager)
 *   - Scroll jank            : long tasks > 50 ms (count + total ms)
 *
 *  SAFETY / REVERSIBILITY
 *  Pure listeners + Performance APIs. It changes NO behaviour. Gated by
 *  appConfig.skmTelemetry.enabled (default off). To remove: delete the init call in
 *  init.tsx and this file.
 * ────────────────────────────────────────────────────────────────────────────
 */

// eslint-disable-next-line
import { cache, eventTarget, Enums } from '@cornerstonejs/core';

let telemetryInitialized = false;

type Counters = {
  startedAt: number;
  wadoTotal: number;
  wadoHits: number;
  wadoMissBytes: number;
  wadoMissDurations: number[];
  decodes: number; // IMAGE_LOADED
  cacheAdds: number; // IMAGE_CACHE_IMAGE_ADDED
  cacheRemoves: number; // IMAGE_CACHE_IMAGE_REMOVED (evictions)
  cacheSizeExceeded: number;
  longTasks: number;
  longTaskMs: number;
  jsHeapSamplesMB: number[];
  cacheSizeSamplesMB: number[];
  // SKM 2026-10-04 (Option B): UX responsiveness.
  scrollToDisplayMs: number[]; // STACK_VIEWPORT_SCROLL → STACK_NEW_IMAGE latency
  spinnerStarts: number; // displays that crossed the 50 ms spinner threshold
  spinnerMs: number; // approx cumulative visible-spinner time
  displayTotal: number; // total scroll→display events classified
  decodedHits: number; // display ≤ 8 ms (slice already decoded → instant)
  reDecodes: number; // display > 8 ms (re-decode / network needed)
  // ── SKM 2026-10-05: authoritative /wado/uri cache-source breakdown ─────────
  // Thousands of calls can't be hand-counted in the Network tab, so classify every
  // /wado/uri PerformanceResourceTiming and expose exact counts + the REVISIT hit
  // ratio (the number that actually proves whether warmed bytes survive in the HTTP
  // disk cache, separated from unavoidable first-time downloads).
  wadoFromCache: number; // transferSize === 0 → served from HTTP (disk/memory) cache
  wadoFromNetwork: number; // transferSize > 0 with a body → real network download
  wado304: number; // transferSize > 0 but empty body → 304 revalidation (small network)
  wadoFirstReq: number; // first time this exact URL was requested in the window
  wadoRepeatReq: number; // a URL requested again in the window (a revisit)
  wadoRepeatFromCache: number; // of the revisits, how many were served from cache
  wadoUrlSeen: Map<string, number>; // per-URL request count (first-vs-repeat detection)
};

function freshCounters(): Counters {
  return {
    startedAt: Date.now(),
    wadoTotal: 0,
    wadoHits: 0,
    wadoMissBytes: 0,
    wadoMissDurations: [],
    decodes: 0,
    cacheAdds: 0,
    cacheRemoves: 0,
    cacheSizeExceeded: 0,
    longTasks: 0,
    longTaskMs: 0,
    jsHeapSamplesMB: [],
    cacheSizeSamplesMB: [],
    scrollToDisplayMs: [],
    spinnerStarts: 0,
    spinnerMs: 0,
    displayTotal: 0,
    decodedHits: 0,
    reDecodes: 0,
    wadoFromCache: 0,
    wadoFromNetwork: 0,
    wado304: 0,
    wadoFirstReq: 0,
    wadoRepeatReq: 0,
    wadoRepeatFromCache: 0,
    wadoUrlSeen: new Map<string, number>(),
  };
}

function pct(n: number, d: number): number {
  return d > 0 ? Math.round((100 * n) / d) : 0;
}
function p95(arr: number[]): number {
  if (!arr.length) {
    return 0;
  }
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]);
}
function p50(arr: number[]): number {
  if (!arr.length) {
    return 0;
  }
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.floor(s.length * 0.5)]);
}
// SKM 2026-10-04 (Phase A): count cached images by sharedCacheKey presence + volumes.
// Read-only inspection of the cache maps (same data the manual probe reads).
function cacheKeyStats(): Record<string, number> {
  try {
    const ic = (cache as any)._imageCache;
    const vc = (cache as any)._volumeCache;
    let sharedKeyImages = 0;
    let pureStackImages = 0;
    if (ic && typeof ic.forEach === 'function') {
      ic.forEach((ci: any) => {
        if (ci && ci.sharedCacheKey) {
          sharedKeyImages++;
        } else {
          pureStackImages++;
        }
      });
    }
    const volumesInCache = vc && typeof vc.size === 'number' ? vc.size : 0;
    const ps = (globalThis as any).__skmPurgeStats;
    const purgeWrapperCalls = ps?.calls || 0;
    const purgeWrapperCleared = ps?.cleared || 0;
    return { sharedKeyImages, pureStackImages, volumesInCache, purgeWrapperCalls, purgeWrapperCleared };
  } catch (e) {
    return {};
  }
}

// SKM Phase B: read the budget-based evictor's last-pass snapshot (window.__skmEvictorLast):
// the protected keep range, per-viewport keep size, and the last decodedMB before→after.
function evictorSnapshot(): Record<string, number> {
  try {
    const e = (globalThis as any).__skmEvictorLast;
    if (!e) {
      return {};
    }
    return {
      evict_keepLo: e.keepLo ?? 0,
      evict_keepHi: e.keepHi ?? 0,
      evict_keepAhead: e.keepAhead ?? 0,
      evict_keepBehind: e.keepBehind ?? 0,
      evict_protected: e.protectedCount ?? 0,
      evict_stackViewports: e.stackViewports ?? 0,
      evict_lastRemoved: e.removed ?? 0,
      evict_decodedBeforeMB: e.decodedBeforeMB ?? 0,
      evict_decodedAfterMB: e.decodedAfterMB ?? 0,
      // SKM 2026-10-05 (Fix 2): non-blocking idle-batched eviction telemetry.
      evict_batchCap: e.batchCap ?? 0, // configured per-batch cap (maxEvictPerTick)
      evict_batchesLastPass: e.batches ?? 0, // batches used to drain the last pass
      evict_maxBatch: e.maxBatch ?? 0, // largest single batch (should be ≤ batchCap)
      evict_yields: e.yields ?? 0, // batches deferred because the doctor was scrolling
      evict_aborted: e.aborted ?? 0, // 1 if the last pass aborted on a far jump
      evict_passMs: e.passMs ?? 0, // wall time of the last pass (incl. idle gaps)
      evict_evictMs: e.evictMs ?? 0, // main-thread time actually spent removing
      // SKM 2026-10-06 (Fix 3): reactive eviction — fill% and how many passes were skipped
      // because the decoded cache was below the high-water mark (series fit → zero churn).
      evict_fillPct: e.fillPct ?? 0,
      evict_reactiveSkips: e.reactiveSkips ?? 0,
      evict_reactiveSkip: e.reactiveSkip ? 1 : 0,
    };
  } catch (e) {
    return {};
  }
}

// SKM 2026-10-04 (Option B): read the read-only scheduler snapshot the
// StudyPrefetcherService publishes (window.__skmScheduler). Returns {} if absent.
function schedulerSnapshot(): Record<string, number> {
  try {
    const s = (globalThis as any).__skmScheduler;
    if (!s) {
      return {};
    }
    return {
      sched_center: s.prefetchCenterIndex ?? 0,
      sched_requested: s.requestedCenterIndex ?? 0,
      sched_direction: s.direction ?? 0,
      sched_ahead: s.prefetchAhead ?? 0,
      sched_behind: s.prefetchBehind ?? 0,
      sched_queue: s.queueSize ?? 0,
      sched_inflight: s.inflight ?? 0,
      sched_farJumps: s.farJumps ?? 0,
      sched_cancelled: s.cancelledRequests ?? 0,
    };
  } catch (e) {
    return {};
  }
}
function max(arr: number[]): number {
  return arr.length ? Math.round(Math.max(...arr)) : 0;
}

export function initSkmTelemetry(): void {
  if (telemetryInitialized) {
    return;
  }
  telemetryInitialized = true;

  let c = freshCounters();

  // ── WADO request outcomes + scroll jank (Performance APIs) ────────────────
  try {
    const resObs = new PerformanceObserver(list => {
      for (const e of list.getEntries() as PerformanceResourceTiming[]) {
        if (!e.name || e.name.indexOf('/wado/uri') === -1) {
          continue;
        }
        c.wadoTotal++;
        // First-vs-repeat: has this EXACT url been requested before in this window?
        const seen = c.wadoUrlSeen.get(e.name) || 0;
        c.wadoUrlSeen.set(e.name, seen + 1);
        const isRepeat = seen > 0;
        if (isRepeat) {
          c.wadoRepeatReq++;
        } else {
          c.wadoFirstReq++;
        }
        // Cache-source classification from the ResourceTiming entry:
        //   transferSize === 0                      → served from HTTP (disk/memory) cache
        //   transferSize > 0 && encodedBodySize 0   → 304 revalidation (headers only, body cached)
        //   transferSize > 0 && encodedBodySize > 0 → real network download (bytes over the wire)
        const fromCache = e.transferSize === 0;
        if (fromCache) {
          c.wadoHits++; // kept for backward-compatible cacheHitRatioPct
          c.wadoFromCache++;
          if (isRepeat) {
            c.wadoRepeatFromCache++;
          }
        } else if ((e.encodedBodySize || 0) === 0) {
          c.wado304++;
          // a 304 still reused the cached body → count as a cache hit for the headline ratio
          c.wadoHits++;
          if (isRepeat) {
            c.wadoRepeatFromCache++;
          }
        } else {
          c.wadoFromNetwork++;
          c.wadoMissBytes += e.transferSize || 0;
          c.wadoMissDurations.push(e.duration || 0);
        }
      }
    });
    resObs.observe({ type: 'resource', buffered: true });
  } catch (e) {
    /* resource timing unavailable */
  }
  try {
    const ltObs = new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        c.longTasks++;
        c.longTaskMs += e.duration || 0;
      }
    });
    ltObs.observe({ type: 'longtask', buffered: true });
  } catch (e) {
    /* longtask unsupported (Safari) */
  }

  // ── Cornerstone cache / decode events ─────────────────────────────────────
  const onDecode = () => {
    c.decodes++;
  };
  const onAdd = () => {
    c.cacheAdds++;
  };
  const onRemove = () => {
    c.cacheRemoves++;
  };
  const onExceeded = () => {
    c.cacheSizeExceeded++;
  };
  try {
    eventTarget.addEventListener(Enums.Events.IMAGE_LOADED, onDecode);
    eventTarget.addEventListener(Enums.Events.IMAGE_CACHE_IMAGE_ADDED, onAdd);
    eventTarget.addEventListener(Enums.Events.IMAGE_CACHE_IMAGE_REMOVED, onRemove);
    // CACHE_SIZE_EXCEEDED may be an enum or a bare string depending on version.
    const exceededName = (Enums.Events as any).CACHE_SIZE_EXCEEDED || 'CACHE_SIZE_EXCEEDED';
    eventTarget.addEventListener(exceededName, onExceeded);
  } catch (e) {
    /* event names differ in this version — report() still has WADO + jank + RAM */
  }

  // SKM 2026-10-04 (Option B correction): in CS3D 4.22.10 CACHE_SIZE_EXCEEDED is THROWN as
  // an Error, NOT dispatched on eventTarget — so the listener above never fired and the UI
  // modal was uncounted. Capture it from the global error channels + the Cornerstone
  // image-load-failed event instead, matching the message string. (Measurement only.)
  const looksLikeExceeded = (s: any) =>
    typeof s === 'string' && s.indexOf('CACHE_SIZE_EXCEEDED') !== -1;
  try {
    window.addEventListener('error', (ev: any) => {
      if (looksLikeExceeded(ev?.message) || looksLikeExceeded(ev?.error?.message)) {
        c.cacheSizeExceeded++;
      }
    });
    window.addEventListener('unhandledrejection', (ev: any) => {
      const r = ev?.reason;
      if (looksLikeExceeded(r) || looksLikeExceeded(r?.message)) {
        c.cacheSizeExceeded++;
      }
    });
    eventTarget.addEventListener(Enums.Events.IMAGE_LOAD_FAILED, (ev: any) => {
      const err = ev?.detail?.error;
      if (looksLikeExceeded(err) || looksLikeExceeded(err?.message)) {
        c.cacheSizeExceeded++;
      }
    });
  } catch (e) {
    /* best-effort */
  }

  // ── SKM 2026-10-04 (Option B): scroll → display latency + spinner ─────────
  // Mirror the loading indicator: it shows "Loading…" if STACK_NEW_IMAGE doesn't
  // follow STACK_VIEWPORT_SCROLL within 50 ms (ViewportImageSliceLoadingIndicator).
  // We time that gap per viewport element to measure real perceived responsiveness.
  const SPINNER_THRESHOLD_MS = 50;
  const DECODE_HIT_MS = 8; // ≤ this = slice was already decoded (instant display)
  const wireElement = (element: any) => {
    if (!element || element.__skmTelemetryWired) {
      return;
    }
    element.__skmTelemetryWired = true;
    let scrollT0 = 0;
    let pending = false;
    const E: any = Enums.Events as any;
    const scrollName = E.STACK_VIEWPORT_SCROLL || 'CORNERSTONE_STACK_VIEWPORT_SCROLL';
    const newImageName = E.STACK_NEW_IMAGE || 'CORNERSTONE_STACK_NEW_IMAGE';
    element.addEventListener(scrollName, () => {
      scrollT0 = performance.now();
      pending = true;
    });
    element.addEventListener(newImageName, () => {
      if (!pending) {
        return;
      }
      pending = false;
      const dt = performance.now() - scrollT0;
      if (dt >= 0 && dt < 60000) {
        c.scrollToDisplayMs.push(dt);
        // SKM Phase B: classify whether the scrolled-to slice was ALREADY decoded (instant,
        // dt ≤ 8 ms) vs required a re-decode/network (dt > 8 ms). This directly measures the
        // fast-scroll UX: high decodedHitRatio = lands on decoded images = smooth.
        c.displayTotal++;
        if (dt <= DECODE_HIT_MS) {
          c.decodedHits++;
        } else {
          c.reDecodes++;
        }
        if (dt > SPINNER_THRESHOLD_MS) {
          c.spinnerStarts++;
          c.spinnerMs += dt - SPINNER_THRESHOLD_MS;
        }
      }
    });
  };
  try {
    const elEnabled = (Enums.Events as any).ELEMENT_ENABLED || 'CORNERSTONE_ELEMENT_ENABLED';
    eventTarget.addEventListener(elEnabled, (evt: any) => {
      wireElement(evt?.detail?.element);
    });
  } catch (e) {
    /* element events unavailable — latency rows will be empty */
  }

  // ── Periodic RAM + cache-size sampling ────────────────────────────────────
  const sample = () => {
    try {
      const mem = (performance as any).memory;
      if (mem && typeof mem.usedJSHeapSize === 'number') {
        c.jsHeapSamplesMB.push(Math.round(mem.usedJSHeapSize / 1048576));
      }
      const sz = (cache as any).getCacheSize?.();
      if (typeof sz === 'number') {
        c.cacheSizeSamplesMB.push(Math.round(sz / 1048576));
      }
    } catch (e) {
      /* noop */
    }
  };
  window.setInterval(sample, 2000);

  const buildReport = () => {
    const minutes = Math.max(0.001, (Date.now() - c.startedAt) / 60000);
    let maxCacheMB = 0;
    try {
      maxCacheMB = Math.round(((cache as any).getMaxCacheSize?.() || 0) / 1048576);
    } catch (e) {
      /* noop */
    }
    return {
      windowMinutes: Math.round(minutes * 10) / 10,
      wadoRequests: c.wadoTotal,
      cacheHitRatioPct: pct(c.wadoHits, c.wadoTotal),
      cacheMisses: c.wadoTotal - c.wadoHits,
      missMBDownloaded: Math.round(c.wadoMissBytes / 1048576),
      missLatencyP95ms: p95(c.wadoMissDurations),
      // ── SKM 2026-10-05: authoritative cache-source breakdown ───────────────
      // Exact counts (no hand-counting the Network tab). The headline number is
      // wadoRepeatHitPct: of URLs requested MORE THAN ONCE, how many revisits were
      // served from the HTTP cache. ~100% = warmed bytes survive (cache works, low
      // overall ratio is just first-time loads). Low = the browser disk cache is
      // evicting warmed bytes → revisits re-download → spinner on scroll-back.
      wadoFromCache: c.wadoFromCache,
      wadoFromNetwork: c.wadoFromNetwork,
      wado304: c.wado304,
      wadoUniqueUrls: c.wadoUrlSeen.size,
      wadoFirstReq: c.wadoFirstReq,
      wadoRepeatReq: c.wadoRepeatReq,
      wadoRepeatFromCache: c.wadoRepeatFromCache,
      wadoRepeatHitPct: pct(c.wadoRepeatFromCache, c.wadoRepeatReq),
      wadoFirstReqMB: Math.round(c.wadoMissBytes / 1048576), // bytes are ~all first-time
      wadoAvgRequestsPerUrl:
        c.wadoUrlSeen.size > 0 ? Math.round((100 * c.wadoTotal) / c.wadoUrlSeen.size) / 100 : 0,
      decodesPerMin: Math.round(c.decodes / minutes),
      evictionsPerMin: Math.round(c.cacheRemoves / minutes),
      activeEvictionsTotal: (globalThis as any).__skmEvictions || 0,
      cacheSizeExceeded: c.cacheSizeExceeded,
      // SKM 2026-10-04 (Phase A diagnostics): prove sharedCacheKey is cleared. With the
      // flag ON, sharedKeyImages should be ~0 and pureStackImages ~= cached count.
      ...cacheKeyStats(),
      decodeCacheMB_now: c.cacheSizeSamplesMB[c.cacheSizeSamplesMB.length - 1] ?? 0,
      decodeCacheMB_peak: max(c.cacheSizeSamplesMB),
      decodeCacheCapMB: maxCacheMB,
      jsHeapMB_peak: max(c.jsHeapSamplesMB),
      longTasks_gt50ms: c.longTasks,
      longTaskTotalMs: Math.round(c.longTaskMs),
      // SKM 2026-10-04 (Option B) — UX responsiveness
      displayLatencyP50ms: p50(c.scrollToDisplayMs),
      displayLatencyP95ms: p95(c.scrollToDisplayMs),
      displaySamples: c.scrollToDisplayMs.length,
      // SKM Phase B: fraction of scrolls that landed on an already-decoded slice (instant).
      // High = smooth fast scroll; low = re-decode churn. The headline UX metric.
      decodedHitRatioPct: pct(c.decodedHits, c.displayTotal),
      reDecodes: c.reDecodes,
      spinnerStarts: c.spinnerStarts,
      spinnerTotalMs: Math.round(c.spinnerMs),
      spinnerRatePct: pct(c.spinnerStarts, c.scrollToDisplayMs.length),
      // SKM 2026-10-04 (Option B) — scheduler snapshot (from StudyPrefetcherService)
      ...schedulerSnapshot(),
      // SKM Phase B — evictor keep window (protected range) from the budget-based evictor
      ...evictorSnapshot(),
    };
  };

  // ── Phase-1 cap-sweep knob ────────────────────────────────────────────────
  // Lets the tester sweep 512 / 768 / 1024 MB WITHOUT rebuilding (locked-down
  // workstations can't rebuild). Changes ONLY the Cornerstone decode-cache ceiling;
  // when the cap is lowered below the current fill, Cornerstone evicts LRU down to it
  // immediately. Works cleanly because Phase 1 sets multiTabCacheSplit:false, so no
  // BroadcastChannel heartbeat in init.tsx fights this value. Call per tab.
  //     window.skmSetCacheCap(512)   // then re-run reset()/scroll test/report()
  //     window.skmGetCacheCap()      // -> { capMB, usedMB, fillPct }
  const setCap = (mb: number) => {
    try {
      const bytes = Math.round(mb * 1048576);
      (cache as any).setMaxCacheSize(bytes);
      const usedMB = Math.round(((cache as any).getCacheSize?.() || 0) / 1048576);
      // eslint-disable-next-line no-console
      console.log(
        `[SKM-TELEMETRY] cache cap set to ${mb} MB (now using ${usedMB} MB). ` +
          `Run skmTelemetry.reset(), do your scroll/jump test, then skmTelemetry.report().`
      );
      return { capMB: mb, usedMB };
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[SKM-TELEMETRY] setCap failed', e);
      return null;
    }
  };
  const getCap = () => {
    try {
      const capMB = Math.round(((cache as any).getMaxCacheSize?.() || 0) / 1048576);
      const usedMB = Math.round(((cache as any).getCacheSize?.() || 0) / 1048576);
      const r = { capMB, usedMB, fillPct: capMB ? Math.round((100 * usedMB) / capMB) : 0 };
      // eslint-disable-next-line no-console
      console.log('[SKM-TELEMETRY] cache', r);
      return r;
    } catch (e) {
      return null;
    }
  };
  (window as any).skmSetCacheCap = setCap;
  (window as any).skmGetCacheCap = getCap;

  (window as any).skmTelemetry = {
    setCacheCap: setCap,
    getCacheCap: getCap,
    report() {
      const r = buildReport();
      // eslint-disable-next-line no-console
      console.table(r);
      // eslint-disable-next-line no-console
      console.log('[SKM-TELEMETRY] (total RAM: use Task Manager; jsHeap is JS-only)', r);
      return r;
    },
    reset() {
      c = freshCounters();
      // eslint-disable-next-line no-console
      console.log('[SKM-TELEMETRY] counters reset — begin your scroll/jump test now');
    },
    snapshot() {
      return { ...c };
    },
    // SKM 2026-10-05: focused /wado/uri cache-source breakdown for sharing exact
    // counts (the Network tab can't be hand-counted across thousands of calls).
    wadoReport() {
      const total = c.wadoTotal;
      const r = {
        wadoRequests: total,
        uniqueUrls: c.wadoUrlSeen.size,
        avgRequestsPerUrl:
          c.wadoUrlSeen.size > 0 ? Math.round((100 * total) / c.wadoUrlSeen.size) / 100 : 0,
        fromDiskCache: c.wadoFromCache,
        revalidated304: c.wado304,
        fromNetwork: c.wadoFromNetwork,
        overallCacheHitPct: pct(c.wadoHits, total),
        firstRequests: c.wadoFirstReq,
        repeatRequests: c.wadoRepeatReq,
        repeatFromCache: c.wadoRepeatFromCache,
        // THE decisive number: of revisited URLs, how many were served from cache.
        repeatCacheHitPct: pct(c.wadoRepeatFromCache, c.wadoRepeatReq),
        networkMB: Math.round(c.wadoMissBytes / 1048576),
        missLatencyP95ms: p95(c.wadoMissDurations),
      };
      // eslint-disable-next-line no-console
      console.table(r);
      // eslint-disable-next-line no-console
      console.log('[SKM-TELEMETRY][WADO]', r);
      return r;
    },
  };

  // Passive rolling summary so numbers are visible without being asked for.
  window.setInterval(() => {
    // eslint-disable-next-line no-console
    console.log('[SKM-TELEMETRY]', buildReport());
  }, 30000);

  // eslint-disable-next-line no-console
  console.log(
    '[SKM-TELEMETRY] active — call skmTelemetry.reset() before a test, skmTelemetry.report() after'
  );
}
