/**
 * ────────────────────────────────────────────────────────────────────────────
 *  SKM-THROUGHPUT-DIAGNOSTICS — read-only office instrumentation
 *
 *  Answers: why adaptive prefetch settles at 4 vs 6; request-lane activity;
 *  client-side bytes/s and WADO→IMAGE_LOADED latency. Does NOT prove server/NAS
 *  saturation (browser-only). Changes NO scheduling / concurrency / cache policy.
 *
 *  Gated by appConfig.skmThroughputDiagnostics.enabled (default OFF).
 *  Console:
 *    skmThroughput.reset()
 *    skmThroughput.snapshot()
 *    skmThroughput.report()
 *    skmThroughput.lanes()
 * ────────────────────────────────────────────────────────────────────────────
 */

// eslint-disable-next-line
import { cache, eventTarget, Enums, imageLoadPoolManager } from '@cornerstonejs/core';
import RequestTypes from '@cornerstonejs/core/enums/RequestType';

export type SkmThroughputDiagnosticsConfig = {
  enabled?: boolean;
  /** Periodic sample cadence (ms). Default 1000. */
  sampleIntervalMs?: number;
  /** Max WADO→decode latency samples retained. Default 400. */
  maxLatencySamples?: number;
  /** Max periodic samples retained. Default 180. */
  maxSamples?: number;
};

type LaneCounters = {
  starts: number;
  completions: number;
  failures: number;
  bytes: number;
  inflightEstimate: number | null;
  measurable: boolean;
  note: string;
};

type WindowCounters = {
  startedAtPerf: number;
  startedAtEpoch: number;
  wadoCompleted: number;
  wadoUniqueUrls: number;
  wadoRepeat: number;
  wadoFromCache: number;
  wadoFromNetwork: number;
  wadoBytes: number;
  decodeCompletions: number;
  wadoToDecodeMs: number[];
  wadoToDecodeMissing: number;
  longTasks: number;
  longTaskMs: number;
  urlSeen: Map<string, number>;
  pendingWadoBySop: Map<string, number[]>; // responseEnd perf times awaiting IMAGE_LOADED
};

type PeriodicSample = {
  t: number;
  bytesPerSec: number | null;
  uniqueUrlsPerSec: number | null;
  wadoCompletedDelta: number;
  decodeCompletionsDelta: number;
  prefetchInflight: number | null;
  prefetchQueue: number | null;
  warmerInflight: number | null;
  interactionInflight: number | null;
  concCurrent: number | null;
  concTarget: number | null;
  concReason: string | null;
  concEffective: number | null;
  cacheFillPct: number | null;
  cacheMB: number | null;
};

let initialized = false;

function sopFromImageIdOrUrl(s: string): string | null {
  if (!s) {
    return null;
  }
  try {
    const m = /[?&]objectUID=([^&]+)/i.exec(s);
    if (m && m[1]) {
      return decodeURIComponent(m[1]);
    }
  } catch (e) {
    /* ignore */
  }
  // Cornerstone imageIds sometimes embed the same query string after dicomweb:
  const i = s.indexOf('objectUID=');
  if (i >= 0) {
    const rest = s.slice(i + 'objectUID='.length);
    const amp = rest.indexOf('&');
    return decodeURIComponent(amp >= 0 ? rest.slice(0, amp) : rest);
  }
  return null;
}

function isWadoUrl(url: string): boolean {
  return typeof url === 'string' && /\/wado\//i.test(url);
}

function freshWindow(): WindowCounters {
  return {
    startedAtPerf: performance.now(),
    startedAtEpoch: Date.now(),
    wadoCompleted: 0,
    wadoUniqueUrls: 0,
    wadoRepeat: 0,
    wadoFromCache: 0,
    wadoFromNetwork: 0,
    wadoBytes: 0,
    decodeCompletions: 0,
    wadoToDecodeMs: [],
    wadoToDecodeMissing: 0,
    longTasks: 0,
    longTaskMs: 0,
    urlSeen: new Map(),
    pendingWadoBySop: new Map(),
  };
}

function p50(arr: number[]): number | null {
  if (!arr.length) {
    return null;
  }
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.floor(s.length * 0.5)]);
}

function p95(arr: number[]): number | null {
  if (!arr.length) {
    return null;
  }
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]);
}

function readPoolLaneInflight(type: string): { count: number | null; measurable: boolean; note: string } {
  try {
    const poolMgr = imageLoadPoolManager as any;
    const pool =
      poolMgr?.getRequestPool?.() ||
      poolMgr?.requestPool ||
      poolMgr?.pool;
    if (!pool) {
      return {
        count: null,
        measurable: false,
        note: 'imageLoadPoolManager pool shape unavailable',
      };
    }
    const lane = pool[type] || pool[type?.toLowerCase?.()] || pool[type?.toUpperCase?.()];
    if (!lane) {
      return {
        count: null,
        measurable: false,
        note: `lane ${type} not found on pool`,
      };
    }
    // Cornerstone pool lanes are often { 0: [], 1: [], ... } priority buckets or arrays.
    if (Array.isArray(lane)) {
      return { count: lane.length, measurable: true, note: 'array lane length' };
    }
    let n = 0;
    let found = false;
    Object.keys(lane).forEach(k => {
      const v = lane[k];
      if (Array.isArray(v)) {
        found = true;
        n += v.length;
      }
    });
    if (found) {
      return { count: n, measurable: true, note: 'sum of priority-bucket lengths (queued, not necessarily HTTP-inflight)' };
    }
    return {
      count: null,
      measurable: false,
      note: 'lane present but unrecognized shape',
    };
  } catch (e) {
    return {
      count: null,
      measurable: false,
      note: 'pool read threw',
    };
  }
}

export function initSkmThroughputDiagnostics(
  servicesManager: any,
  config: SkmThroughputDiagnosticsConfig = {}
): void {
  if (initialized) {
    return;
  }
  if (config.enabled !== true) {
    return;
  }
  initialized = true;

  const SAMPLE_MS = Math.max(500, config.sampleIntervalMs ?? 1000);
  const MAX_LAT = Math.max(50, config.maxLatencySamples ?? 400);
  const MAX_SAMPLES = Math.max(30, config.maxSamples ?? 180);

  let win = freshWindow();
  const samples: PeriodicSample[] = [];
  let lastSample = {
    t: performance.now(),
    wadoCompleted: 0,
    decodeCompletions: 0,
    wadoBytes: 0,
    uniqueUrls: 0,
  };

  const prefetchLane: LaneCounters = {
    starts: 0,
    completions: 0,
    failures: 0,
    bytes: 0,
    inflightEstimate: null,
    measurable: true,
    note: 'prefetch starts/completions from StudyPrefetcher IMAGE_LOADED correlation only partially; inflight from scheduler diagnostics',
  };
  const warmerLane: LaneCounters = {
    starts: 0,
    completions: 0,
    failures: 0,
    bytes: 0,
    inflightEstimate: null,
    measurable: true,
    note: 'inflight from skmWarmerDiagnostics; start/complete/byte counters not instrumented inside warmer (avoid double-count with ResourceTiming)',
  };
  const interactionLane: LaneCounters = {
    starts: 0,
    completions: 0,
    failures: 0,
    bytes: 0,
    inflightEstimate: null,
    measurable: false,
    note: 'pool queued depth only if readable; not true HTTP-inflight',
  };

  // Resource Timing — WADO only (shared by all lanes; do not attribute bytes to a lane).
  let resObserver: PerformanceObserver | null = null;
  try {
    resObserver = new PerformanceObserver(list => {
      for (const e of list.getEntries() as PerformanceResourceTiming[]) {
        const url = e.name || '';
        if (!isWadoUrl(url)) {
          continue;
        }
        win.wadoCompleted++;
        const prev = win.urlSeen.get(url) || 0;
        win.urlSeen.set(url, prev + 1);
        if (prev === 0) {
          win.wadoUniqueUrls++;
        } else {
          win.wadoRepeat++;
        }
        const xfer = typeof e.transferSize === 'number' ? e.transferSize : 0;
        const encoded = typeof e.encodedBodySize === 'number' ? e.encodedBodySize : 0;
        if (xfer === 0) {
          win.wadoFromCache++;
        } else {
          win.wadoFromNetwork++;
          win.wadoBytes += xfer > 0 ? xfer : encoded;
        }
        const sop = sopFromImageIdOrUrl(url);
        if (sop) {
          const responseEnd = e.responseEnd || e.startTime + (e.duration || 0);
          const arr = win.pendingWadoBySop.get(sop) || [];
          arr.push(responseEnd);
          // Cap pending per SOP to avoid growth if decode never arrives.
          while (arr.length > 8) {
            arr.shift();
            win.wadoToDecodeMissing++;
          }
          win.pendingWadoBySop.set(sop, arr);
        }
      }
    });
    resObserver.observe({ type: 'resource', buffered: true } as any);
  } catch (e) {
    /* PerformanceObserver unavailable */
  }

  // Long tasks (optional).
  let ltObserver: PerformanceObserver | null = null;
  try {
    ltObserver = new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        win.longTasks++;
        win.longTaskMs += e.duration || 0;
      }
    });
    ltObserver.observe({ type: 'longtask', buffered: true } as any);
  } catch (e) {
    /* longtask not supported */
  }

  // Decode completions + WADO→decode latency.
  const onLoaded = (evt: any) => {
    win.decodeCompletions++;
    const imageId = evt?.detail?.image?.imageId || evt?.detail?.imageId;
    const sop = sopFromImageIdOrUrl(imageId || '');
    if (!sop) {
      win.wadoToDecodeMissing++;
      return;
    }
    const pending = win.pendingWadoBySop.get(sop);
    if (!pending || !pending.length) {
      win.wadoToDecodeMissing++;
      return;
    }
    const responseEnd = pending.shift()!;
    if (!pending.length) {
      win.pendingWadoBySop.delete(sop);
    } else {
      win.pendingWadoBySop.set(sop, pending);
    }
    const dt = performance.now() - responseEnd;
    if (dt >= 0 && dt < 120000) {
      win.wadoToDecodeMs.push(dt);
      while (win.wadoToDecodeMs.length > MAX_LAT) {
        win.wadoToDecodeMs.shift();
      }
    }
  };
  eventTarget.addEventListener(Enums.Events.IMAGE_LOADED, onLoaded);

  const readPrefetchSched = () => {
    try {
      const sp = servicesManager?.services?.studyPrefetcherService;
      const diag = sp?.getSchedulerDiagnostics?.();
      if (!diag) {
        return { inflight: null as number | null, queue: null as number | null };
      }
      return {
        inflight: typeof diag.inflight === 'number' ? diag.inflight : null,
        queue: typeof diag.pending === 'number' ? diag.pending : null,
      };
    } catch (e) {
      return { inflight: null, queue: null };
    }
  };

  const readWarmerInflight = (): number | null => {
    try {
      if (typeof (window as any).skmWarmerInFlight === 'function') {
        const n = (window as any).skmWarmerInFlight();
        return typeof n === 'number' ? n : null;
      }
    } catch (e) {
      /* ignore */
    }
    return null;
  };

  const readCache = () => {
    try {
      const max = (cache as any).getMaxCacheSize?.() || 0;
      const cur = (cache as any).getCacheSize?.() || 0;
      return {
        fillPct: max > 0 ? Math.round((cur / max) * 1000) / 10 : null,
        cacheMB: Math.round((cur / (1024 * 1024)) * 10) / 10,
      };
    } catch (e) {
      return { fillPct: null, cacheMB: null };
    }
  };

  const sampleOnce = () => {
    const now = performance.now();
    const dtSec = Math.max(0.001, (now - lastSample.t) / 1000);
    const wadoDelta = win.wadoCompleted - lastSample.wadoCompleted;
    const decodeDelta = win.decodeCompletions - lastSample.decodeCompletions;
    const bytesDelta = win.wadoBytes - lastSample.wadoBytes;
    const uniqueDelta = win.wadoUniqueUrls - lastSample.uniqueUrls;
    const sched = readPrefetchSched();
    const warmerInflight = readWarmerInflight();
    const inter = readPoolLaneInflight(RequestTypes.Interaction || 'interaction');
    interactionLane.inflightEstimate = inter.count;
    interactionLane.measurable = inter.measurable;
    interactionLane.note = inter.note;
    warmerLane.inflightEstimate = warmerInflight;
    prefetchLane.inflightEstimate = sched.inflight;

    const conc = (window as any).__skmPrefetchConcurrency || null;
    const c = readCache();
    const sample: PeriodicSample = {
      t: now,
      bytesPerSec: Math.round(bytesDelta / dtSec),
      uniqueUrlsPerSec: Math.round((uniqueDelta / dtSec) * 10) / 10,
      wadoCompletedDelta: wadoDelta,
      decodeCompletionsDelta: decodeDelta,
      prefetchInflight: sched.inflight,
      prefetchQueue: sched.queue,
      warmerInflight,
      interactionInflight: inter.count,
      concCurrent: conc?.current ?? null,
      concTarget: conc?.target ?? null,
      concReason: conc?.reason ?? null,
      concEffective: conc?.effective ?? null,
      cacheFillPct: c.fillPct,
      cacheMB: c.cacheMB,
    };
    samples.push(sample);
    while (samples.length > MAX_SAMPLES) {
      samples.shift();
    }
    lastSample = {
      t: now,
      wadoCompleted: win.wadoCompleted,
      decodeCompletions: win.decodeCompletions,
      wadoBytes: win.wadoBytes,
      uniqueUrls: win.wadoUniqueUrls,
    };
    (window as any).__skmThroughputLastSample = sample;
  };

  sampleOnce();
  const sampleTimer = window.setInterval(sampleOnce, SAMPLE_MS);

  const buildReport = () => {
    const elapsedSec = Math.max(0.001, (performance.now() - win.startedAtPerf) / 1000);
    const sched = readPrefetchSched();
    const warmerInflight = readWarmerInflight();
    const inter = readPoolLaneInflight(RequestTypes.Interaction || 'interaction');
    const conc = (window as any).__skmPrefetchConcurrency || null;
    const c = readCache();
    const totalInflightPartial =
      (sched.inflight ?? 0) + (warmerInflight ?? 0) + (inter.count ?? 0);
    const lanesComplete =
      sched.inflight != null && warmerInflight != null && inter.measurable;

    return {
      measurement: {
        elapsedSec: Math.round(elapsedSec * 10) / 10,
        startedAtEpoch: win.startedAtEpoch,
        monotonic: 'performance.now()',
        sampleCount: samples.length,
        wadoToDecodeSampleCount: win.wadoToDecodeMs.length,
        wadoToDecodeMissing: win.wadoToDecodeMissing,
      },
      adaptive: conc
        ? {
            current: conc.current,
            target: conc.target,
            effective: conc.effective,
            reason: conc.reason,
            previous: conc.previous,
            activeTab: conc.active,
            idleTimeMs: conc.idleMs,
            liveTabs: conc.liveTabs,
            stackViewports: conc.stackViewports,
            fillPct: conc.fillPct,
            raiseFill: conc.raiseFill,
            backoffFill: conc.backoffFill,
            min: conc.min,
            base: conc.base,
            max: conc.max,
            multiTab: conc.multiTab,
            note: conc.note,
            measured: true,
          }
        : { measured: false, note: 'skmPrefetchConcurrency not publishing' },
      lanes: {
        prefetch: {
          inflight: sched.inflight,
          queue: sched.queue,
          measurable: sched.inflight != null,
          note: 'StudyPrefetcher _inflightRequests / _pendingRequests',
        },
        warmer: {
          inflight: warmerInflight,
          measurable: warmerInflight != null,
          note: warmerLane.note,
        },
        interaction: {
          inflight: inter.count,
          measurable: inter.measurable,
          note: inter.note,
        },
        totalInflight: totalInflightPartial,
        totalInflightPartial: !lanesComplete,
        warning:
          'Do not sum ResourceTiming WADO count into a lane — warmer+prefetch+interaction share /wado/uri URLs',
      },
      throughput: {
        clientBytesPerSecAvg: Math.round(win.wadoBytes / elapsedSec),
        uniqueUrlsPerSecAvg: Math.round((win.wadoUniqueUrls / elapsedSec) * 10) / 10,
        wadoCompleted: win.wadoCompleted,
        uniqueUrls: win.wadoUniqueUrls,
        repeats: win.wadoRepeat,
        fromCache: win.wadoFromCache,
        fromNetwork: win.wadoFromNetwork,
        networkBytes: win.wadoBytes,
        note: 'Browser ResourceTiming only — not server/NAS throughput',
      },
      decode: {
        completions: win.decodeCompletions,
        completionsPerSecAvg: Math.round((win.decodeCompletions / elapsedSec) * 10) / 10,
        wadoToImageLoadedMs_p50: p50(win.wadoToDecodeMs),
        wadoToImageLoadedMs_p95: p95(win.wadoToDecodeMs),
        wadoToImageLoadedSamples: win.wadoToDecodeMs.length,
        unmatchedDecodesOrWados: win.wadoToDecodeMissing,
        note: 'IMAGE_LOADED correlated to prior WADO ResourceTiming by objectUID; unmatched counted separately',
      },
      cache: {
        fillPct: c.fillPct,
        decodedMB: c.cacheMB,
      },
      longTasks: {
        count: win.longTasks,
        totalMs: Math.round(win.longTaskMs),
      },
      lastSample: (window as any).__skmThroughputLastSample || null,
    };
  };

  const api = {
    reset: () => {
      win = freshWindow();
      samples.length = 0;
      lastSample = {
        t: performance.now(),
        wadoCompleted: 0,
        decodeCompletions: 0,
        wadoBytes: 0,
        uniqueUrls: 0,
      };
      // eslint-disable-next-line no-console
      console.log('[SKM-THROUGHPUT] reset');
      return true;
    },
    snapshot: () => {
      const s = buildReport();
      // eslint-disable-next-line no-console
      console.log('[SKM-THROUGHPUT] snapshot', s);
      return s;
    },
    report: () => {
      const s = buildReport();
      // eslint-disable-next-line no-console
      console.log('[SKM-THROUGHPUT] report');
      if (console.table) {
        // eslint-disable-next-line no-console
        console.table({
          elapsedSec: s.measurement.elapsedSec,
          bytesPerSecAvg: s.throughput.clientBytesPerSecAvg,
          uniqueUrlsPerSec: s.throughput.uniqueUrlsPerSecAvg,
          wadoCompleted: s.throughput.wadoCompleted,
          uniqueUrls: s.throughput.uniqueUrls,
          decodePerSec: s.decode.completionsPerSecAvg,
          wadoToDecodeP50: s.decode.wadoToImageLoadedMs_p50,
          wadoToDecodeP95: s.decode.wadoToImageLoadedMs_p95,
          prefetchInflight: s.lanes.prefetch.inflight,
          prefetchQueue: s.lanes.prefetch.queue,
          warmerInflight: s.lanes.warmer.inflight,
          conc: s.adaptive.measured ? (s.adaptive as any).current : null,
          reason: s.adaptive.measured ? (s.adaptive as any).reason : null,
          effective: s.adaptive.measured ? (s.adaptive as any).effective : null,
          fillPct: s.cache.fillPct,
        });
        if (samples.length) {
          // eslint-disable-next-line no-console
          console.table(
            samples.slice(-30).map(x => ({
              tMs: Math.round(x.t),
              Bps: x.bytesPerSec,
              urlsPs: x.uniqueUrlsPerSec,
              prefIn: x.prefetchInflight,
              prefQ: x.prefetchQueue,
              warmIn: x.warmerInflight,
              conc: x.concCurrent,
              tgt: x.concTarget,
              eff: x.concEffective,
              reason: x.concReason,
              fill: x.cacheFillPct,
            }))
          );
        }
      }
      return s;
    },
    lanes: () => {
      const s = buildReport().lanes;
      // eslint-disable-next-line no-console
      console.log('[SKM-THROUGHPUT] lanes', s);
      return s;
    },
    samples: () => samples.slice(),
    _dispose: () => {
      window.clearInterval(sampleTimer);
      try {
        resObserver?.disconnect();
      } catch (e) {
        /* noop */
      }
      try {
        ltObserver?.disconnect();
      } catch (e) {
        /* noop */
      }
      eventTarget.removeEventListener(Enums.Events.IMAGE_LOADED, onLoaded);
    },
  };

  (window as any).skmThroughput = api;

  // eslint-disable-next-line no-console
  console.log(
    '[SKM-THROUGHPUT] read-only diagnostics ON — skmThroughput.reset()/snapshot()/report()/lanes() | ' +
      'also skmGetPrefetchConcurrency() / skmPrefetchConcDecisionLog()'
  );
}

export default initSkmThroughputDiagnostics;
