/**
 * ────────────────────────────────────────────────────────────────────────────
 *  SKM-MEMORY-BUDGET 2026-10-07 — adaptive, multi-tab-aware decoded-RAM governor
 *
 *  WHY
 *  One central viewer build serves both 16 GB (Resident) and 32 GB (Consultant)
 *  workstations, and doctors open multiple comparison tabs. navigator.deviceMemory
 *  is capped at 8 by Chromium so it CANNOT tell 16 GB from 32 GB. This module makes
 *  the decoded-RAM policy adaptive at runtime from ONE number — the machine decoded
 *  budget — divided across live tabs, and derives every downstream knob from it:
 *    - Cornerstone decoded-cache cap  (cache.setMaxCacheSize)
 *    - the prefetcher decode window   (studyPrefetcherService.config.windowAhead/Behind)
 *    - the warmer byte-warm near-skip (published; the warmer reads it live)
 *
 *  MACHINE BUDGET (single build, per-workstation, no deviceMemory dependence)
 *    1) localStorage 'skmMemoryBudgetMB'  (admin sets once: skmSetMemoryBudget(5120))
 *    2) ?skmBudgetMB=5120 URL param (also persisted to localStorage)
 *    3) else DEFAULT 2048 MB (16 GB-safe for every client)
 *    clamped to [minBudgetMB, maxBudgetMB]; deviceMemory only ever lowers it (safety),
 *    never raises it (both tiers report 8, so it is a no-op for them).
 *
 *  AGGREGATE GUARANTEE (the correction):
 *    perTabCapMB = floor(machineBudgetMB / liveTabs)   — STRICT division, no multiplying
 *    floor — so Σ over tabs = liveTabs × perTabCapMB ≤ machineBudgetMB, ALWAYS. The
 *    usable minimum lives on the WINDOW (clamped ≥ minWindowSlices), not on the cap,
 *    so RAM stays strictly bounded no matter how many tabs open.
 *
 *  MULTI-TAB COORDINATION
 *    A same-origin BroadcastChannel ('skm-budget-tabs') heartbeat counts live viewer
 *    tabs. Opening/closing a tab recomputes the budget in EVERY tab, each re-applies
 *    its smaller/larger cap, and the evictor trims to it. Floors are per-tab-only via
 *    the window clamp; the cap always divides strictly.
 *
 *  WINDOW DERIVATION
 *    workingSetMB  = workingSetFraction (0.82) × perTabCapMB   (sits below the 0.85
 *                    reactive-evict high-water so the window is never self-evicted)
 *    windowSlices  = clamp( workingSetMB / avgSliceMB , minWindowSlices , maxWindowSlices )
 *    windowAhead   = round(windowSlices × aheadBias 0.65);  windowBehind = remainder
 *    nearSkip      = windowSlices  (warmer byte-warms ONLY beyond the decode window)
 *    avgSliceBytes is measured live from the cache (adapts to real slice size),
 *    fallback 600 KB before anything is decoded.
 *
 *  Publishes window.__skmBudget for the evictor/warmer/telemetry to read live, and
 *  window.skmSetMemoryBudget(mb) / skmGetMemoryBudget() console helpers.
 *
 *  SAFETY / REVERSIBILITY
 *  Gated by appConfig.skmBoundedDecodeCache.enabled (default on). Off → the decode
 *  cache is unbounded (old behaviour) and this module does nothing. It only calls the
 *  public cache.setMaxCacheSize and mutates the prefetcher's own config object — no
 *  Cornerstone core change, no force:true.
 * ────────────────────────────────────────────────────────────────────────────
 */

// eslint-disable-next-line
import { cache } from '@cornerstonejs/core';

export type SkmMemoryBudgetConfig = {
  /** 16 GB-safe default machine decoded budget (MB) when no override is set. Default 2048. */
  defaultBudgetMB?: number;
  /** Clamp bounds for any machine budget (override or default). Default 1024 / 8192. */
  minBudgetMB?: number;
  maxBudgetMB?: number;
  /** Fraction of the per-tab cap the decode working set may fill (below reactiveHighWater). Default 0.82. */
  workingSetFraction?: number;
  /** Of the window, fraction allocated ahead (scroll direction). Default 0.65. */
  aheadBias?: number;
  /** Avg decoded bytes/slice before the cache can be measured. Default 614400 (600 KB). */
  avgSliceBytesFallback?: number;
  /** Decode-window clamp (slices). Default 300 / 8000. */
  minWindowSlices?: number;
  maxWindowSlices?: number;
  /** Recompute cadence (ms) to pick up measured avg-slice size + override/tab changes. Default 3000. */
  recomputeMs?: number;
};

let initialized = false;

const LS_KEY = 'skmMemoryBudgetMB';

function readOverrideMB(): number | null {
  // URL param (persist so it survives navigation), then localStorage.
  try {
    const url = new URLSearchParams(window.location.search).get('skmBudgetMB');
    const n = url ? parseInt(url, 10) : NaN;
    if (Number.isFinite(n) && n > 0) {
      try {
        localStorage.setItem(LS_KEY, String(n));
      } catch (e) {
        /* localStorage may be blocked */
      }
      return n;
    }
  } catch (e) {
    /* noop */
  }
  try {
    const v = localStorage.getItem(LS_KEY);
    const n = v ? parseInt(v, 10) : NaN;
    if (Number.isFinite(n) && n > 0) {
      return n;
    }
  } catch (e) {
    /* noop */
  }
  return null;
}

export function initSkmMemoryBudget(
  servicesManager: any,
  appConfig: any,
  config: SkmMemoryBudgetConfig = {}
): void {
  if (initialized) {
    return;
  }
  initialized = true;

  const DEFAULT_MB = Math.max(256, config.defaultBudgetMB ?? 2048);
  const MIN_MB = config.minBudgetMB ?? 1024;
  const MAX_MB = config.maxBudgetMB ?? 8192;
  const WS_FRACTION = Math.min(0.95, Math.max(0.3, config.workingSetFraction ?? 0.82));
  const AHEAD_BIAS = Math.min(0.9, Math.max(0.1, config.aheadBias ?? 0.65));
  const AVG_FALLBACK = Math.max(1, config.avgSliceBytesFallback ?? 600 * 1024);
  const MIN_WIN = Math.max(1, config.minWindowSlices ?? 300);
  const MAX_WIN = Math.max(MIN_WIN, config.maxWindowSlices ?? 8000);
  const RECOMPUTE_MS = Math.max(1000, config.recomputeMs ?? 3000);

  const machineBudgetMB = (): { mb: number; source: string } => {
    const override = readOverrideMB();
    let mb = override ?? DEFAULT_MB;
    let source = override != null ? 'override' : 'default';
    mb = Math.min(MAX_MB, Math.max(MIN_MB, mb));
    // Downward-only safety: a genuinely weak box (deviceMemory < 8) gets a smaller budget.
    // Never raises — both 16 GB and 32 GB report 8, so this is a no-op for the target tiers.
    try {
      const dm = (navigator as any).deviceMemory;
      if (typeof dm === 'number' && dm > 0 && dm < 8) {
        const safe = Math.max(768, Math.round((dm / 16) * 2048));
        if (safe < mb) {
          mb = safe;
          source += '+devmem';
        }
      }
    } catch (e) {
      /* noop */
    }
    return { mb, source };
  };

  // Measure average decoded bytes/slice from the live cache (adapts to real slice size).
  const measureAvgSliceBytes = (): number => {
    try {
      const ic = (cache as any)._imageCache;
      const total = (cache as any).getCacheSize?.() || 0;
      if (ic && typeof ic.forEach === 'function' && total > 0) {
        let n = 0;
        ic.forEach((ci: any) => {
          if (ci && ci.sizeInBytes > 0) {
            n++;
          }
        });
        if (n > 0) {
          return total / n;
        }
      }
    } catch (e) {
      /* fall through */
    }
    return AVG_FALLBACK;
  };

  // ── Live-tab count via same-origin BroadcastChannel heartbeat ──────────────
  let liveTabs = 1;
  let channel: any = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const myId = Math.random().toString(36).slice(2) + '-' + Date.now();
      const peers = new Map<string, number>();
      channel = new BroadcastChannel('skm-budget-tabs');
      const recount = () => {
        const cutoff = Date.now() - 12000; // drop peers silent > 12 s (crashed tabs)
        peers.forEach((t, id) => {
          if (t < cutoff) {
            peers.delete(id);
          }
        });
        const n = peers.size + 1;
        if (n !== liveTabs) {
          liveTabs = n;
          apply(); // a tab opened/closed → every tab re-divides the budget immediately
        }
      };
      channel.onmessage = (ev: any) => {
        const d = ev?.data;
        if (!d || !d.id || d.id === myId) {
          return;
        }
        if (d.type === 'hello') {
          peers.set(d.id, Date.now());
          try {
            channel.postMessage({ type: 'ack', id: myId });
          } catch (e) {
            /* noop */
          }
          recount();
        } else if (d.type === 'ack' || d.type === 'heartbeat') {
          peers.set(d.id, Date.now());
          recount();
        } else if (d.type === 'bye') {
          peers.delete(d.id);
          recount();
        }
      };
      try {
        channel.postMessage({ type: 'hello', id: myId });
      } catch (e) {
        /* noop */
      }
      window.setInterval(() => {
        try {
          channel.postMessage({ type: 'heartbeat', id: myId });
        } catch (e) {
          /* noop */
        }
        recount();
      }, 5000);
      window.addEventListener('pagehide', () => {
        try {
          channel.postMessage({ type: 'bye', id: myId });
          channel.close();
        } catch (e) {
          /* noop */
        }
      });
    }
  } catch (e) {
    /* best-effort; liveTabs stays 1 → single-tab budget */
  }

  const apply = () => {
    try {
      const { mb: machineMB, source } = machineBudgetMB();
      // STRICT division → aggregate across tabs can never exceed the machine budget.
      const perTabCapMB = Math.max(1, Math.floor(machineMB / Math.max(1, liveTabs)));
      try {
        (cache as any).setMaxCacheSize(perTabCapMB * 1048576);
      } catch (e) {
        /* noop */
      }

      const avgSliceBytes = measureAvgSliceBytes();
      const workingSetBytes = WS_FRACTION * perTabCapMB * 1048576;
      let windowSlices = Math.floor(workingSetBytes / avgSliceBytes);
      windowSlices = Math.min(MAX_WIN, Math.max(MIN_WIN, windowSlices));
      const windowAhead = Math.max(1, Math.round(windowSlices * AHEAD_BIAS));
      const windowBehind = Math.max(1, windowSlices - windowAhead);

      (globalThis as any).__skmBudget = {
        machineMB,
        source,
        liveTabs,
        perTabCapMB,
        avgSliceBytes: Math.round(avgSliceBytes),
        windowSlices,
        windowAhead,
        windowBehind,
        nearSkip: windowSlices,
        aggregateMB: perTabCapMB * liveTabs,
      };

      // Push the derived window into the prefetcher's own config (private at the type
      // level, but a plain object at runtime). The service reads these on its next
      // re-window, so a tab open/close or avg-slice change retargets decode live.
      try {
        const sp = servicesManager?.services?.studyPrefetcherService;
        if (sp && (sp as any).config) {
          (sp as any).config.windowAhead = windowAhead;
          (sp as any).config.windowBehind = windowBehind;
          (sp as any).config.windowRadius = Math.max(1, Math.round(windowSlices / 2));
        }
      } catch (e) {
        /* best-effort */
      }
    } catch (e) {
      /* never break init */
    }
  };

  // Initial apply + periodic recompute (picks up measured avg-slice size as decode
  // progresses, and any runtime override change).
  apply();
  window.setInterval(apply, RECOMPUTE_MS);

  (window as any).skmSetMemoryBudget = (mb: number) => {
    try {
      localStorage.setItem(LS_KEY, String(Math.round(mb)));
    } catch (e) {
      /* localStorage blocked — still apply for this session */
    }
    apply();
    // eslint-disable-next-line no-console
    console.log('[SKM-BUDGET] machine budget set to', mb, 'MB (persisted). Now:', (globalThis as any).__skmBudget);
    return (globalThis as any).__skmBudget;
  };
  (window as any).skmGetMemoryBudget = () => {
    // eslint-disable-next-line no-console
    console.log('[SKM-BUDGET]', (globalThis as any).__skmBudget);
    return (globalThis as any).__skmBudget;
  };

  // eslint-disable-next-line no-console
  console.log(
    '[SKM-BUDGET] adaptive governor active —',
    JSON.stringify((globalThis as any).__skmBudget),
    '| override: skmSetMemoryBudget(5120) for 32 GB workstations'
  );
}
