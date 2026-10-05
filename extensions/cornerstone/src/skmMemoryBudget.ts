/**
 * ────────────────────────────────────────────────────────────────────────────
 *  SKM-MEMORY-BUDGET 2026-10-08 — ADAPTIVE runtime decoded-RAM governor (Fix 6)
 *
 *  WHY
 *  One central build serves 16 GB (Resident) and 32 GB (Consultant) workstations with
 *  mandatory multi-tab use. A single permanent cap is wrong: too small → fast-scroll
 *  lag on the big 4403 series; too large → wasted RAM / multi-tab OS pressure. This
 *  governor uses only as much decoded RAM as the doctor currently needs:
 *    - starts at a SAFE BASELINE (16 GB 2816 MB, 32 GB 5120 MB via runtime override)
 *    - raises the budget in small steps (+256 MB) ONLY under SUSTAINED scroll pressure
 *    - lowers it in steps (−256 MB) after SUSTAINED idle
 *    - never exceeds a per-machine HARD CEILING (16 GB 4096 MB, 32 GB 6144 MB)
 *    - allocates the machine ceiling across tabs by ACTIVITY (active tab gets more,
 *      idle tabs a small floor), aggregate across all tabs ≤ hard ceiling ALWAYS
 *    - derives the decode/prefetch window from the live per-tab allocation ÷ slice size
 *
 *  NO Windows-RAM guessing (browsers can't read it reliably). Upward adaptation is driven
 *  by performance pressure; the HARD CEILING (configurable, validated with Task Manager)
 *  is the only RAM guard. deviceMemory may only LOWER the budget on a genuinely weak box.
 *
 *  AGGREGATE GUARANTEE: every tab deterministically computes allocations from the shared
 *  localStorage tab registry; an active tab asks its adaptive desiredMB, an idle tab asks its
 *  FAIR SHARE min(desiredMB, max(idleFloor, ceiling/liveTabs)) — so a sole/uncontested tab keeps
 *  its baseline instead of collapsing to idleFloor (Fix 6.2). On overflow, idle tabs shrink
 *  toward idleMin first, then active tabs scale proportionally; Σ allocations ≤ machineHardCeilingMB
 *  by construction, with a strict equal split (ceiling / liveTabs) as the last-resort guarantee.
 *
 *  OSCILLATION GUARDS: EMA pressure score + threshold, min dwell between increases (4 s)
 *  and decreases (8 s), gradual ±256 steps, idle-before-decrease 10 s.
 *
 *  Publishes window.__skmBudget and console helpers:
 *    skmSetMemoryBudget(baselineMB, ceilingMB?)   // Consultant: skmSetMemoryBudget(5120, 6144)
 *    skmGetMemoryBudget()
 *
 *  Gated by appConfig.skmBoundedDecodeCache.enabled (default on). Only calls the public
 *  cache.setMaxCacheSize and mutates the prefetcher's own config object — no Cornerstone
 *  core change, no force:true. Preserves Phase A / reactive+idle-batched+eager-orphan
 *  eviction / self-tick / whole-study warming / MPR protection (those live in other modules).
 * ────────────────────────────────────────────────────────────────────────────
 */

// eslint-disable-next-line
import { cache, eventTarget, Enums } from '@cornerstonejs/core';
import { subscribeStackNewImage } from './utils/skmStackNewImage';

export type SkmMemoryBudgetConfig = {
  /** 16 GB-safe starting budget (MB) when no override is set. Default 2816. */
  baselineMB?: number;
  /** Max aggregate decoded budget across ALL tabs on this machine (MB). Default 4096. */
  hardCeilingMB?: number;
  /** Clamp bounds for any baseline/ceiling (override or default). Default 1024 / 8192. */
  minBudgetMB?: number;
  maxBudgetMB?: number;
  /** Adaptation step (MB). Default 256. */
  stepMB?: number;
  /** Per idle-tab allocation (MB). Default 512. */
  idleFloorMB?: number;
  /** Hard minimum an idle tab can be squeezed to under ceiling pressure (MB). Default 320. */
  idleMinMB?: number;
  /** Idle tabs collectively may take at most this fraction of the ceiling. Default 0.3. */
  idleMaxCeilingFraction?: number;
  /** Minimum allocation for an active tab (MB). Default 1024. */
  activeMinMB?: number;
  /** Fraction of the per-tab cap the decode window fills (below the 0.85 evict high-water). Default 0.82. */
  workingSetFraction?: number;
  aheadBias?: number;
  avgSliceBytesFallback?: number;
  minWindowSlices?: number;
  maxWindowSlices?: number;
  /** Adaptation eval cadence (ms). Default 1500. */
  evalMs?: number;
  /** Min time between budget INCREASES (ms). Default 4000. */
  increaseDwellMs?: number;
  /** Min time between budget DECREASES (ms). Default 8000. */
  decreaseDwellMs?: number;
  /** Idle duration before the budget starts decreasing (ms). Default 10000. */
  idleBeforeDecreaseMs?: number;
  /** A slice change within this window = "scrolling now" (pressure sampling). Default 700. */
  activeScrollMs?: number;
  /** A slice change within this window = tab "active" (allocation priority). Default 8000. */
  activeTabMs?: number;
  /** Decoded fill fraction (of current cap) above which, while scrolling+churning, counts as pressure. Default 0.82. */
  pressureFillFraction?: number;
  /** EMA pressure threshold to trigger an increase. Default 0.6. */
  pressureThreshold?: number;
};

let initialized = false;
const LS_BASE = 'skmMemoryBudgetMB';
const LS_CEIL = 'skmMemoryCeilingMB';

function readNum(key: string): number | null {
  try {
    const v = localStorage.getItem(key);
    const n = v ? parseInt(v, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch (e) {
    return null;
  }
}

function readUrlOverride(): void {
  try {
    const p = new URLSearchParams(window.location.search);
    const b = parseInt(p.get('skmBudgetMB') || '', 10);
    const c = parseInt(p.get('skmCeilingMB') || '', 10);
    if (Number.isFinite(b) && b > 0) {
      localStorage.setItem(LS_BASE, String(b));
    }
    if (Number.isFinite(c) && c > 0) {
      localStorage.setItem(LS_CEIL, String(c));
    }
  } catch (e) {
    /* noop */
  }
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
  readUrlOverride();

  const DEF_BASELINE = Math.max(256, config.baselineMB ?? 2816);
  const DEF_CEILING = Math.max(DEF_BASELINE, config.hardCeilingMB ?? 4096);
  const MIN_MB = config.minBudgetMB ?? 1024;
  const MAX_MB = config.maxBudgetMB ?? 8192;
  const STEP = Math.max(64, config.stepMB ?? 256);
  const IDLE_FLOOR = Math.max(128, config.idleFloorMB ?? 512);
  const IDLE_MIN = Math.max(128, config.idleMinMB ?? 320);
  const IDLE_MAX_FRAC = Math.min(0.6, Math.max(0.05, config.idleMaxCeilingFraction ?? 0.3));
  const ACTIVE_MIN = Math.max(256, config.activeMinMB ?? 1024);
  const WS_FRACTION = Math.min(0.95, Math.max(0.3, config.workingSetFraction ?? 0.82));
  const AHEAD_BIAS = Math.min(0.9, Math.max(0.1, config.aheadBias ?? 0.65));
  const AVG_FALLBACK = Math.max(1, config.avgSliceBytesFallback ?? 600 * 1024);
  const MIN_WIN = Math.max(1, config.minWindowSlices ?? 300);
  const MAX_WIN = Math.max(MIN_WIN, config.maxWindowSlices ?? 8000);
  const EVAL_MS = Math.max(500, config.evalMs ?? 1500);
  const INC_DWELL = Math.max(1000, config.increaseDwellMs ?? 4000);
  const DEC_DWELL = Math.max(1000, config.decreaseDwellMs ?? 8000);
  const IDLE_BEFORE_DEC = Math.max(2000, config.idleBeforeDecreaseMs ?? 10000);
  const ACTIVE_SCROLL_MS = Math.max(200, config.activeScrollMs ?? 700);
  const ACTIVE_TAB_MS = Math.max(1000, config.activeTabMs ?? 8000);
  const PRESSURE_FILL = Math.min(0.98, Math.max(0.5, config.pressureFillFraction ?? 0.82));
  const PRESSURE_THRESHOLD = Math.min(0.95, Math.max(0.2, config.pressureThreshold ?? 0.6));

  // ── machine baseline + ceiling (per workstation, runtime-overridable) ──────
  const getBaseline = (): number =>
    Math.min(MAX_MB, Math.max(MIN_MB, readNum(LS_BASE) ?? DEF_BASELINE));
  const getCeiling = (): number => {
    let ceil = readNum(LS_CEIL) ?? DEF_CEILING;
    ceil = Math.min(MAX_MB, Math.max(getBaseline(), ceil));
    // Downward-only safety on a genuinely weak box (deviceMemory < 8; a no-op for 16/32 GB).
    try {
      const dm = (navigator as any).deviceMemory;
      if (typeof dm === 'number' && dm > 0 && dm < 8) {
        ceil = Math.min(ceil, Math.max(1024, Math.round((dm / 16) * 4096)));
      }
    } catch (e) {
      /* noop */
    }
    return ceil;
  };

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

  // ── adaptive state (this tab) ──────────────────────────────────────────────
  const myId = Math.random().toString(36).slice(2) + '-' + Date.now();
  let desiredMB = getBaseline();
  let pressure = 0; // EMA 0..1
  let lastScrollAt = 0;
  let lastIncreaseAt = 0;
  let lastDecreaseAt = 0;
  let increaseCount = 0;
  let decreaseCount = 0;
  let lastChangeReason = 'init';
  let lastChangeTs = Date.now();
  let prevTotalEvicted = 0;
  let decodeCount = 0;
  let prevDecodeCount = 0;

  let channel: any = null; // BroadcastChannel is only an instant "nudge"; counting is via localStorage

  const now = () =>
    typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();

  // FIX 6.2 — seed lastScrollAt at init so a freshly opened viewer is treated as ACTIVE for the
  // first ACTIVE_TAB_MS. Previously lastScrollAt started at 0, so a brand-new tab was classified
  // idle on its very first allocation (before the doctor could scroll) and (pre-fix) grabbed only
  // IDLE_FLOOR. It must use the same monotonic clock as amActive(), hence it is seeded here,
  // after now() is defined, not at the declaration.
  lastScrollAt = now();

  // scroll activity (drives both "scrolling now" pressure and "active tab" priority)
  subscribeStackNewImage(() => {
    lastScrollAt = now();
  });
  try {
    eventTarget.addEventListener(Enums.Events.IMAGE_LOADED, () => {
      decodeCount++;
    });
  } catch (e) {
    /* noop */
  }

  const amActive = () => now() - lastScrollAt < ACTIVE_TAB_MS;

  // ── Multi-tab registry via localStorage (authoritative; reliable across same-origin tabs
  // even where BroadcastChannel is blocked/flaky in locked-down Edge). Each tab writes its
  // own entry every eval and reads all live entries to count tabs + learn their asks. ──────
  const REG_PREFIX = 'skm-tabreg-';
  const REG_STALE_MS = 12000; // an entry older than this = tab gone
  const REG_PRUNE_MS = 20000;

  const writeRegistry = () => {
    try {
      localStorage.setItem(
        REG_PREFIX + myId,
        JSON.stringify({ active: amActive(), desiredMB, ts: Date.now() })
      );
    } catch (e) {
      /* localStorage blocked → single-tab behaviour */
    }
  };
  const readRegistry = (): { id: string; active: boolean; desiredMB: number }[] => {
    const out: { id: string; active: boolean; desiredMB: number }[] = [];
    try {
      const nowTs = Date.now();
      const stale: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || key.indexOf(REG_PREFIX) !== 0) {
          continue;
        }
        try {
          const v = JSON.parse(localStorage.getItem(key) || '{}');
          const age = nowTs - (v.ts || 0);
          if (age > REG_PRUNE_MS) {
            stale.push(key);
            continue;
          }
          if (age <= REG_STALE_MS) {
            out.push({
              id: key.slice(REG_PREFIX.length),
              active: !!v.active,
              desiredMB: typeof v.desiredMB === 'number' ? v.desiredMB : getBaseline(),
            });
          }
        } catch (e) {
          stale.push(key);
        }
      }
      stale.forEach(k => {
        try {
          localStorage.removeItem(k);
        } catch (e) {
          /* noop */
        }
      });
    } catch (e) {
      /* noop */
    }
    // Always include self (registry write may lag or be blocked).
    if (!out.some(t => t.id === myId)) {
      out.push({ id: myId, active: amActive(), desiredMB });
    } else {
      // refresh self's live values
      const me = out.find(t => t.id === myId)!;
      me.active = amActive();
      me.desiredMB = desiredMB;
    }
    return out;
  };

  // ── ask-based machine-level allocation (active-priority, Σ ≤ ceiling) ───────
  // Each tab ASKS for its adaptive desiredMB (active) or an idle *fair share* (idle). Everyone
  // gets their ask when the asks fit the ceiling; only on overflow do idle tabs shrink first,
  // then active tabs scale proportionally. The aggregate across all tabs never exceeds the hard
  // ceiling.
  //
  // FIX 6.2 — uncontested / idle fair floor. An idle tab no longer collapses to the flat
  // IDLE_FLOOR (512 MB): that starved a *sole* tab that simply hadn't scrolled in the last
  // ACTIVE_TAB_MS, pinning its decode cap at 512 MB and forcing an eviction treadmill ("initial
  // fast-scroll lag then smooth"). Instead an idle tab asks for its FAIR SHARE of the ceiling,
  //   idleAsk = min(desiredMB, max(IDLE_FLOOR, floor(ceiling / liveTabs)))
  // so:
  //   • 1 live tab  → min(2560, max(512, 4096))  = 2560  (baseline, never 512)
  //   • 2 idle tabs → min(2560, max(512, 2048))  = 2048 each → Σ 4096 = ceiling
  //   • many tabs   → fair share shrinks toward IDLE_FLOOR, overflow logic keeps Σ ≤ ceiling
  // Genuine contention is unchanged: an ACTIVE tab still asks its full desiredMB, and the
  // overflow pass below shrinks the idle tab toward IDLE_MIN first so the active tab keeps its
  // allocation — active-tab priority preserved.
  const computeMyAllocationMB = (): number => {
    const ceiling = getCeiling();
    const tabs = readRegistry();
    const fairShare = Math.max(1, Math.floor(ceiling / Math.max(1, tabs.length)));
    const alloc = new Map<string, number>();
    tabs.forEach(t =>
      alloc.set(
        t.id,
        t.active
          ? Math.min(ceiling, Math.max(ACTIVE_MIN, t.desiredMB))
          : Math.min(t.desiredMB, Math.max(IDLE_FLOOR, fairShare))
      )
    );
    let total = 0;
    alloc.forEach(v => (total += v));

    if (total > ceiling) {
      // 1) shrink idle tabs toward IDLE_MIN first.
      const idle = tabs.filter(t => !t.active);
      let overflow = total - ceiling;
      const idleReducible = idle.reduce((s, t) => s + Math.max(0, (alloc.get(t.id) || 0) - IDLE_MIN), 0);
      if (idleReducible > 0 && overflow > 0) {
        const cut = Math.min(overflow, idleReducible);
        idle.forEach(t => {
          const cur = alloc.get(t.id) || 0;
          const reducible = Math.max(0, cur - IDLE_MIN);
          alloc.set(t.id, cur - Math.floor((reducible / idleReducible) * cut));
        });
        overflow -= cut;
      }
      // 2) scale active tabs proportionally (floored at ACTIVE_MIN; final equal-split if still over).
      if (overflow > 0) {
        const active = tabs.filter(t => t.active);
        const activeTotal = active.reduce((s, t) => s + (alloc.get(t.id) || 0), 0);
        const target = Math.max(active.length * 1, activeTotal - overflow);
        const scale = activeTotal > 0 ? target / activeTotal : 0;
        active.forEach(t => alloc.set(t.id, Math.max(1, Math.floor((alloc.get(t.id) || 0) * scale))));
        let after = 0;
        alloc.forEach(v => (after += v));
        if (after > ceiling) {
          // last-resort strict equal split guarantees Σ ≤ ceiling.
          const eq = Math.max(1, Math.floor(ceiling / Math.max(1, tabs.length)));
          return eq;
        }
      }
    }
    return Math.max(1, alloc.get(myId) || Math.floor(ceiling / Math.max(1, tabs.length)));
  };

  const applyAllocation = () => {
    try {
      const perTabCapMB = computeMyAllocationMB();
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

      const liveTabs = readRegistry().length;

      (globalThis as any).__skmBudget = {
        machineBaselineMB: getBaseline(),
        machineHardCeilingMB: getCeiling(),
        source: readNum(LS_BASE) != null ? 'override' : 'default',
        liveTabs,
        activeTab: amActive(),
        currentMB: desiredMB, // this tab's ADAPTIVE ask
        tabAllocationMB: perTabCapMB, // what this tab actually got after machine-level allocation
        perTabCapMB, // alias (back-compat)
        machineMB: getCeiling(), // alias (back-compat: the machine aggregate ceiling)
        avgSliceBytes: Math.round(avgSliceBytes),
        windowSlices,
        windowAhead,
        windowBehind,
        nearSkip: windowSlices,
        pressureScore: Math.round(pressure * 100) / 100,
        idleTimeMs: Math.round(now() - lastScrollAt),
        increaseCount,
        decreaseCount,
        lastChangeReason,
        lastChangeTimestamp: lastChangeTs,
      };

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
      /* never break */
    }
  };

  // ── adaptation eval loop ───────────────────────────────────────────────────
  const evalLoop = () => {
    try {
      const t = now();
      const scrollingNow = t - lastScrollAt < ACTIVE_SCROLL_MS;

      // churn deltas since last eval
      const evictTotal = ((globalThis as any).__skmEvictorLast?.totalEvicted as number) || 0;
      const evictionsDelta = Math.max(0, evictTotal - prevTotalEvicted);
      prevTotalEvicted = evictTotal;
      const decodesDelta = Math.max(0, decodeCount - prevDecodeCount);
      prevDecodeCount = decodeCount;

      // fill of the CURRENT cap
      let fill = 0;
      try {
        const capB = (cache as any).getMaxCacheSize?.() || 0;
        const curB = (cache as any).getCacheSize?.() || 0;
        fill = capB > 0 ? curB / capB : 0;
      } catch (e) {
        /* noop */
      }

      // Pressure = scrolling AND working set full AND actively churning (window crossed).
      const pressured = scrollingNow && fill >= PRESSURE_FILL && (evictionsDelta > 0 || decodesDelta > 10);
      pressure = pressured ? Math.min(1, pressure + 0.34) : pressure * 0.5;

      const ceiling = getCeiling();
      const baseline = getBaseline();
      if (desiredMB < baseline) {
        desiredMB = baseline;
      }

      // INCREASE: sustained pressure, below ceiling, dwell elapsed.
      if (
        pressure >= PRESSURE_THRESHOLD &&
        desiredMB < ceiling &&
        t - lastIncreaseAt >= INC_DWELL
      ) {
        desiredMB = Math.min(ceiling, desiredMB + STEP);
        lastIncreaseAt = t;
        lastDecreaseAt = t; // also delay any decrease right after an increase
        increaseCount++;
        lastChangeReason = 'pressure-increase';
        lastChangeTs = Date.now();
        pressure = Math.min(pressure, 0.5); // let the new budget take effect before stacking
      } else if (
        now() - lastScrollAt >= IDLE_BEFORE_DEC &&
        desiredMB > baseline &&
        t - lastDecreaseAt >= DEC_DWELL
      ) {
        // DECREASE: sustained idle, above baseline, dwell elapsed (gradual release).
        desiredMB = Math.max(baseline, desiredMB - STEP);
        lastDecreaseAt = t;
        decreaseCount++;
        lastChangeReason = 'idle-decrease';
        lastChangeTs = Date.now();
      }

      // publish my state to the shared registry (authoritative) + nudge peers via BroadcastChannel
      writeRegistry();
      try {
        channel?.postMessage({ type: 'state', id: myId, ts: Date.now() });
      } catch (e) {
        /* noop */
      }

      applyAllocation();
    } catch (e) {
      /* never break */
    }
  };

  // ── BroadcastChannel + storage event: instant "a peer changed, re-allocate now" nudges.
  // Tab COUNTING is via the localStorage registry (reliable); these just trigger a prompt
  // recompute so allocation reacts within a frame instead of waiting for the next eval tick. ──
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel('skm-budget-tabs');
      channel.onmessage = (ev: any) => {
        if (ev?.data?.id && ev.data.id !== myId) {
          applyAllocation();
        }
      };
    }
  } catch (e) {
    /* best-effort; registry eval still coordinates */
  }
  try {
    window.addEventListener('storage', (e: any) => {
      if (e && typeof e.key === 'string' && e.key.indexOf('skm-tabreg-') === 0) {
        applyAllocation();
      }
    });
  } catch (e) {
    /* noop */
  }
  window.addEventListener('pagehide', () => {
    try {
      localStorage.removeItem('skm-tabreg-' + myId);
    } catch (e) {
      /* noop */
    }
    try {
      channel?.postMessage({ type: 'bye', id: myId, ts: Date.now() });
      channel?.close();
    } catch (e) {
      /* noop */
    }
  });

  // initial registry write + apply + loops
  writeRegistry();
  applyAllocation();
  window.setInterval(evalLoop, EVAL_MS);

  (window as any).skmSetMemoryBudget = (baselineMB: number, ceilingMB?: number) => {
    try {
      if (Number.isFinite(baselineMB) && baselineMB > 0) {
        localStorage.setItem(LS_BASE, String(Math.round(baselineMB)));
      }
      if (Number.isFinite(ceilingMB as number) && (ceilingMB as number) > 0) {
        localStorage.setItem(LS_CEIL, String(Math.round(ceilingMB as number)));
      } else {
        // default the ceiling to baseline × 1.6 when only a baseline is given
        localStorage.setItem(LS_CEIL, String(Math.round((baselineMB as number) * 1.6)));
      }
    } catch (e) {
      /* localStorage blocked — still applies for this session via desired reset below */
    }
    desiredMB = getBaseline();
    applyAllocation();
    // eslint-disable-next-line no-console
    console.log('[SKM-BUDGET] baseline/ceiling set:', (globalThis as any).__skmBudget);
    return (globalThis as any).__skmBudget;
  };
  (window as any).skmGetMemoryBudget = () => {
    // eslint-disable-next-line no-console
    console.log('[SKM-BUDGET]', (globalThis as any).__skmBudget);
    return (globalThis as any).__skmBudget;
  };

  // ── UI-facing helpers (Preferences panel) ──────────────────────────────────
  // These only move the per-workstation override that getBaseline()/getCeiling() already read;
  // they do NOT change the adaptive allocation algorithm, pressure logic, or multi-tab registry.
  // The selected value is the MACHINE HARD CEILING, shared across tabs via localStorage, so the
  // existing ask-based allocation keeps Σ(tab allocations) ≤ ceiling. Takes effect on the next
  // eval (≤ evalMs) and immediately via the applyAllocation() call below.

  // Set ONLY the hard ceiling. Baseline stays at the configured default (adaptive headroom
  // preserved) unless the chosen ceiling is lower, in which case baseline drops to the ceiling
  // (baseline can never exceed the ceiling). Does NOT force the cache to the ceiling — the
  // governor still starts near baseline and grows under pressure.
  (window as any).skmSetMemoryCeiling = (ceilingMB: number) => {
    try {
      if (Number.isFinite(ceilingMB) && ceilingMB > 0) {
        const ceil = Math.round(ceilingMB);
        const base = Math.min(DEF_BASELINE, ceil);
        localStorage.setItem(LS_CEIL, String(ceil));
        localStorage.setItem(LS_BASE, String(base));
      }
    } catch (e) {
      /* localStorage blocked — desired reset below still applies for this session */
    }
    desiredMB = getBaseline();
    applyAllocation();
    // eslint-disable-next-line no-console
    console.log('[SKM-BUDGET] ceiling set via UI:', (globalThis as any).__skmBudget);
    return (globalThis as any).__skmBudget;
  };

  // Auto / Recommended — clear any per-workstation override so the governor uses the app-config
  // defaults (baseline/hard-ceiling from skmMemoryBudget). NOT a hard-coded alias to 4096: if the
  // deployed defaults change, Auto follows them. After this, __skmBudget.source === 'default'.
  (window as any).skmResetMemoryBudget = () => {
    try {
      localStorage.removeItem(LS_BASE);
      localStorage.removeItem(LS_CEIL);
    } catch (e) {
      /* noop */
    }
    desiredMB = getBaseline();
    applyAllocation();
    // eslint-disable-next-line no-console
    console.log('[SKM-BUDGET] reset to Auto/defaults:', (globalThis as any).__skmBudget);
    return (globalThis as any).__skmBudget;
  };

  // eslint-disable-next-line no-console
  console.log(
    '[SKM-BUDGET] ADAPTIVE governor active —',
    `baseline ${getBaseline()}MB, hardCeiling ${getCeiling()}MB, step ${STEP}MB` +
      ` | increase≥${PRESSURE_THRESHOLD} dwell ${INC_DWELL}ms, decrease idle ${IDLE_BEFORE_DEC}ms/${DEC_DWELL}ms` +
      ' | override: skmSetMemoryBudget(5120, 6144) for 32 GB'
  );
}
