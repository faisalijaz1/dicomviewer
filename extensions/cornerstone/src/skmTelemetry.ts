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
        if (e.transferSize === 0) {
          c.wadoHits++; // served from (disk or memory) HTTP cache
        } else {
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
      decodesPerMin: Math.round(c.decodes / minutes),
      evictionsPerMin: Math.round(c.cacheRemoves / minutes),
      cacheSizeExceeded: c.cacheSizeExceeded,
      decodeCacheMB_now: c.cacheSizeSamplesMB[c.cacheSizeSamplesMB.length - 1] ?? 0,
      decodeCacheMB_peak: max(c.cacheSizeSamplesMB),
      decodeCacheCapMB: maxCacheMB,
      jsHeapMB_peak: max(c.jsHeapSamplesMB),
      longTasks_gt50ms: c.longTasks,
      longTaskTotalMs: Math.round(c.longTaskMs),
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
