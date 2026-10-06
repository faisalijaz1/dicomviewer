/**
 * ────────────────────────────────────────────────────────────────────────────
 *  SKM-SCROLL-FOLLOW-TELEMETRY 2026-10-09 — user scroll position → displayed image
 *  (read-only measurement, NO behaviour change)
 *
 *  WHY
 *  A viewer can look perfect on every existing metric (scheduler telemetry, cache hit
 *  ratio, zero CACHE_SIZE_EXCEEDED, low WADO latency, memory inside the governor's
 *  ceiling) and STILL feel broken to the radiologist if the scrollbar/position keeps
 *  moving while the DISPLAYED image pauses and catches up later. None of the existing
 *  telemetry (skmTelemetry's scrollToDisplayMs is a per-GESTURE latency sample, not a
 *  continuous "is display currently behind request" signal) answers that directly.
 *
 *  WHAT THIS MEASURES, PER VIEWPORT
 *    - requestedIndex   : the index the user/scroll-tool is currently asking to show,
 *                         sampled on every STACK_VIEWPORT_SCROLL.
 *    - displayedIndex   : the index ACTUALLY on screen right now, sampled on every
 *                         STACK_NEW_IMAGE (CS3D fires this once the new image is
 *                         rendered).
 *    - schedulerCenterIndex / schedulerRequestedIndex : StudyPrefetcherService's own
 *                         view (window.__skmScheduler), for comparison.
 *  From the raw, timestamped logs of the two signals above it derives:
 *    - absoluteDisplayLagSlices        : |requestedIndex - displayedIndex| right now
 *    - display-follow latency samples  : time from a requested-index CHANGE to the
 *                                         displayed index first matching it (p50/p95)
 *    - VISIBLE STALLS                  : a maximal span where requestedIndex changed
 *                                         at least once while displayedIndex did NOT
 *                                         change, lasting >= stallThresholdMs. Reports
 *                                         count, longest, and total duration.
 *  This file does NOT invent a pass/fail threshold for "acceptable" lag — stallThresholdMs
 *  is a BINNING parameter for counting discrete stalls from the continuous raw log, is
 *  passed explicitly to the report call, and the raw log itself is always available via
 *  getRawLog() so analysis is never limited to one chosen threshold.
 *
 *  SOURCE-OF-LAG HINTS (best-effort, for narrowing down WHERE time went, not a precise
 *  attribution): each stall window is annotated with whatever other telemetry was active
 *  during it — scheduler farJump/activeChange events (F: intentional reprioritization),
 *  decode/network activity deltas (C/D: WADO + decode counts rose during the stall → likely
 *  waiting on network/decode; flat → likely render/scheduler-side), and the raw input→scroll-
 *  command gap (A: UI input lag, from a raw wheel/pointerdown listener on the same element).
 *
 *  TEST MODES — this module makes no assumption about layout; it tracks EVERY enabled
 *  viewport element independently by viewportId, so it works unmodified for 1 viewport,
 *  2 viewports, and with the cross-viewport position synchronizer ("auto-sync") on or off —
 *  a synchronizer-driven scroll on viewport B still fires the same STACK_VIEWPORT_SCROLL /
 *  STACK_NEW_IMAGE events B's own listeners observe.
 *
 *  SAFETY
 *  Pure event listeners + Performance APIs + bounded ring buffers. Never calls any
 *  Cornerstone mutator. Gated by appConfig.skmScrollFollow.enabled (default on, like
 *  skmTelemetry). To remove: delete the init call in init.tsx and this file.
 *
 *  CONSOLE API
 *    skmScrollFollowReport(viewportId?, { stallThresholdMs?: number })
 *       → per-viewport (or all) summary + prints console.table
 *    skmScrollFollowRawLog(viewportId)
 *       → the raw {t, type, index}[] timeline for deep-dive analysis
 *    skmScrollFollowReset()
 *       → clear all logs, start a fresh measurement window
 * ────────────────────────────────────────────────────────────────────────────
 */

// eslint-disable-next-line
import { eventTarget, Enums } from '@cornerstonejs/core';

export type SkmScrollFollowConfig = {
  enabled?: boolean;
  /** Ring-buffer cap per viewport per log (requested/displayed/raw). Default 4000. */
  maxLogEntries?: number;
  /** Default stall threshold (ms) used by skmScrollFollowReport() when none is passed. Default 150. */
  defaultStallThresholdMs?: number;
};

type LogEntry = { t: number; index: number };
type RawEntry = { t: number; type: 'requested' | 'displayed'; index: number };

type ViewportFollowState = {
  viewportId: string;
  requestedLog: LogEntry[];
  displayedLog: LogEntry[];
  rawLog: RawEntry[];
  lastRequestedIndex: number | null;
  lastRequestedAt: number;
  lastDisplayedIndex: number | null;
  lastDisplayedAt: number;
  // Source-A hint: raw input (wheel/pointerdown) → STACK_VIEWPORT_SCROLL gap samples.
  inputToScrollMs: number[];
  lastRawInputAt: number;
};

let initialized = false;
const states = new Map<string, ViewportFollowState>();

function nowMs(): number {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function p(arr: number[], frac: number): number {
  if (!arr.length) {
    return 0;
  }
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * frac))]);
}

function getOrCreateState(viewportId: string): ViewportFollowState {
  let s = states.get(viewportId);
  if (!s) {
    s = {
      viewportId,
      requestedLog: [],
      displayedLog: [],
      rawLog: [],
      lastRequestedIndex: null,
      lastRequestedAt: 0,
      lastDisplayedIndex: null,
      lastDisplayedAt: 0,
      inputToScrollMs: [],
      lastRawInputAt: 0,
    };
    states.set(viewportId, s);
  }
  return s;
}

function pushCapped<T>(arr: T[], item: T, cap: number): void {
  arr.push(item);
  if (arr.length > cap) {
    arr.splice(0, arr.length - cap);
  }
}

// Defensively read an index-like field from a CS3D event detail — field names have varied
// across versions (newImageIdIndex / imageIdIndex / currentImageIdIndex / index).
function readIndexFromDetail(detail: any): number | null {
  if (!detail) {
    return null;
  }
  const candidates = [
    detail.newImageIdIndex,
    detail.imageIdIndex,
    detail.currentImageIdIndex,
    detail.index,
  ];
  for (const c of candidates) {
    if (typeof c === 'number' && c >= 0) {
      return c;
    }
  }
  return null;
}

export function initSkmScrollFollowTelemetry(
  servicesManager: any,
  config: SkmScrollFollowConfig = {}
): void {
  if (initialized) {
    return;
  }
  if (config.enabled === false) {
    return;
  }
  initialized = true;

  const MAX_LOG = Math.max(200, config.maxLogEntries ?? 4000);
  const DEFAULT_STALL_MS = Math.max(0, config.defaultStallThresholdMs ?? 150);

  const getCornerstoneViewport = (viewportId: string): any => {
    try {
      return servicesManager?.services?.cornerstoneViewportService?.getCornerstoneViewport?.(
        viewportId
      );
    } catch (e) {
      return null;
    }
  };

  const queryCurrentIndex = (viewportId: string): number | null => {
    try {
      const vp = getCornerstoneViewport(viewportId);
      const idx = vp?.getCurrentImageIdIndex?.();
      return typeof idx === 'number' && idx >= 0 ? idx : null;
    } catch (e) {
      return null;
    }
  };

  const recordRequested = (s: ViewportFollowState, t: number, idx: number) => {
    // Only log an actual CHANGE (dedup consecutive identical values — a scroll event that
    // reports the same index as last time isn't a new "request").
    if (s.lastRequestedIndex === idx) {
      return;
    }
    s.lastRequestedIndex = idx;
    s.lastRequestedAt = t;
    pushCapped(s.requestedLog, { t, index: idx }, MAX_LOG);
    pushCapped(s.rawLog, { t, type: 'requested', index: idx }, MAX_LOG);
  };

  const recordDisplayed = (s: ViewportFollowState, t: number, idx: number) => {
    if (s.lastDisplayedIndex === idx) {
      return;
    }
    s.lastDisplayedIndex = idx;
    s.lastDisplayedAt = t;
    pushCapped(s.displayedLog, { t, index: idx }, MAX_LOG);
    pushCapped(s.rawLog, { t, type: 'displayed', index: idx }, MAX_LOG);
  };

  const wireElement = (element: any, viewportId: string) => {
    if (!element || element.__skmFollowWired || !viewportId) {
      return;
    }
    element.__skmFollowWired = true;
    const state = getOrCreateState(viewportId);
    const E: any = Enums.Events as any;
    const scrollName = E.STACK_VIEWPORT_SCROLL || 'CORNERSTONE_STACK_VIEWPORT_SCROLL';
    const newImageName = E.STACK_NEW_IMAGE || 'CORNERSTONE_STACK_NEW_IMAGE';

    // Source-A hint: raw user input time (wheel / mousedown / touchstart), compared against
    // the next STACK_VIEWPORT_SCROLL to approximate UI→scroll-command lag.
    const onRawInput = () => {
      state.lastRawInputAt = nowMs();
    };
    try {
      element.addEventListener('wheel', onRawInput, { passive: true });
      element.addEventListener('pointerdown', onRawInput, { passive: true });
    } catch (e) {
      /* best-effort */
    }

    element.addEventListener(scrollName, (evt: any) => {
      const t = nowMs();
      if (state.lastRawInputAt && t - state.lastRawInputAt < 2000) {
        state.inputToScrollMs.push(t - state.lastRawInputAt);
        if (state.inputToScrollMs.length > MAX_LOG) {
          state.inputToScrollMs.splice(0, state.inputToScrollMs.length - MAX_LOG);
        }
      }
      const idx = readIndexFromDetail(evt?.detail) ?? queryCurrentIndex(viewportId);
      if (typeof idx === 'number') {
        recordRequested(state, t, idx);
      }
    });

    element.addEventListener(newImageName, (evt: any) => {
      const t = nowMs();
      const idx = readIndexFromDetail(evt?.detail) ?? queryCurrentIndex(viewportId);
      if (typeof idx === 'number') {
        recordDisplayed(state, t, idx);
        // A displayed image IS, by definition, also the current requested position (the
        // viewport settled there) — if nothing logged a requested-change for this exact
        // index yet (e.g. a programmatic jump with no STACK_VIEWPORT_SCROLL), backfill one
        // so display-follow latency/stall math always has a matching requested entry.
        if (state.lastRequestedIndex !== idx) {
          recordRequested(state, t, idx);
        }
      }
    });
  };

  try {
    const elEnabled = (Enums.Events as any).ELEMENT_ENABLED || 'CORNERSTONE_ELEMENT_ENABLED';
    eventTarget.addEventListener(elEnabled, (evt: any) => {
      const element = evt?.detail?.element;
      const viewportId = evt?.detail?.viewportId;
      if (element && viewportId) {
        wireElement(element, viewportId);
      }
    });
  } catch (e) {
    /* element events unavailable — this module stays a no-op */
  }

  // ── analysis (pure functions over the logged state) ──────────────────────────────────
  const schedulerSnapshot = (): Record<string, number> => {
    try {
      const s = (globalThis as any).__skmScheduler;
      return {
        schedulerCenterIndex: s?.prefetchCenterIndex ?? 0,
        schedulerRequestedIndex: s?.requestedCenterIndex ?? 0,
      };
    } catch (e) {
      return { schedulerCenterIndex: 0, schedulerRequestedIndex: 0 };
    }
  };

  // Walk the merged raw log to compute (a) display-follow latency samples — time from each
  // DISTINCT requested-index change to the displayed index first matching it (skips/
  // supersessions during fast scroll are counted separately, not as a latency sample) and
  // (b) visible stalls — maximal spans where requestedIndex changed >=1 time while
  // displayedIndex stayed fixed, lasting >= stallThresholdMs.
  const analyze = (s: ViewportFollowState, stallThresholdMs: number) => {
    const follow: number[] = [];
    let superseded = 0;

    // Display-follow latency: for each requested entry, find the first LATER displayed
    // entry whose index matches it, provided no later requested entry (a supersession)
    // comes first.
    for (let i = 0; i < s.requestedLog.length; i++) {
      const req = s.requestedLog[i];
      const nextReq = s.requestedLog[i + 1];
      const match = s.displayedLog.find(
        d => d.t >= req.t && d.index === req.index && (!nextReq || d.t <= nextReq.t)
      );
      if (match) {
        follow.push(match.t - req.t);
      } else if (nextReq) {
        superseded++;
      }
    }

    // Visible stalls from the merged raw timeline.
    const stalls: { startT: number; endT: number; durationMs: number; requestedChanges: number }[] =
      [];
    let windowStart: number | null = null;
    let windowRequestedChanges = 0;
    let windowDisplayedIndexAtStart: number | null = null;

    for (const entry of s.rawLog) {
      if (entry.type === 'displayed') {
        if (windowStart !== null) {
          const duration = entry.t - windowStart;
          if (windowRequestedChanges > 0 && duration >= stallThresholdMs) {
            stalls.push({
              startT: windowStart,
              endT: entry.t,
              durationMs: Math.round(duration),
              requestedChanges: windowRequestedChanges,
            });
          }
        }
        windowStart = entry.t;
        windowDisplayedIndexAtStart = entry.index;
        windowRequestedChanges = 0;
      } else if (entry.type === 'requested') {
        if (windowStart === null) {
          windowStart = entry.t;
          windowDisplayedIndexAtStart = s.lastDisplayedIndex;
        }
        if (entry.index !== windowDisplayedIndexAtStart) {
          windowRequestedChanges++;
        }
      }
    }
    // Trailing open window (requested kept changing, no further display event logged yet).
    if (windowStart !== null && windowRequestedChanges > 0) {
      const duration = nowMs() - windowStart;
      if (duration >= stallThresholdMs) {
        stalls.push({
          startT: windowStart,
          endT: nowMs(),
          durationMs: Math.round(duration),
          requestedChanges: windowRequestedChanges,
        });
      }
    }

    const longest = stalls.reduce((m, st) => Math.max(m, st.durationMs), 0);
    const totalStallMs = stalls.reduce((sum, st) => sum + st.durationMs, 0);

    return {
      followLatencySamples: follow.length,
      followLatencyP50ms: p(follow, 0.5),
      followLatencyP95ms: p(follow, 0.95),
      supersededRequests: superseded,
      visibleStalls: stalls.length,
      longestStallMs: longest,
      totalStallMs,
      stalls,
    };
  };

  const buildViewportReport = (viewportId: string, stallThresholdMs: number) => {
    const s = states.get(viewportId);
    if (!s) {
      return null;
    }
    const a = analyze(s, stallThresholdMs);
    const lag =
      s.lastRequestedIndex !== null && s.lastDisplayedIndex !== null
        ? Math.abs(s.lastRequestedIndex - s.lastDisplayedIndex)
        : null;
    return {
      viewportId,
      requestedIndex: s.lastRequestedIndex,
      requestedAt: Math.round(s.lastRequestedAt),
      displayedIndex: s.lastDisplayedIndex,
      displayedAt: Math.round(s.lastDisplayedAt),
      ...schedulerSnapshot(),
      absoluteDisplayLagSlices: lag,
      inputToScrollLatencyP50ms: p(s.inputToScrollMs, 0.5),
      inputToScrollLatencyP95ms: p(s.inputToScrollMs, 0.95),
      followLatencySamples: a.followLatencySamples,
      followLatencyP50ms: a.followLatencyP50ms,
      followLatencyP95ms: a.followLatencyP95ms,
      supersededRequests: a.supersededRequests,
      visibleStalls: a.visibleStalls,
      longestStallMs: a.longestStallMs,
      totalStallMs: a.totalStallMs,
      stallThresholdMsUsed: stallThresholdMs,
      requestedSamples: s.requestedLog.length,
      displayedSamples: s.displayedLog.length,
    };
  };

  (window as any).skmScrollFollowReport = (
    viewportId?: string,
    opts: { stallThresholdMs?: number } = {}
  ) => {
    const stallThresholdMs = Math.max(0, opts.stallThresholdMs ?? DEFAULT_STALL_MS);
    const ids = viewportId ? [viewportId] : Array.from(states.keys());
    const rows = ids.map(id => buildViewportReport(id, stallThresholdMs)).filter(Boolean);
    /* eslint-disable no-console */
    console.log('[SKM-SCROLL-FOLLOW] report (stallThresholdMs=' + stallThresholdMs + ')');
    if (console.table) {
      console.table(rows.map(r => ({ ...r, stalls: undefined })));
    } else {
      console.log(rows);
    }
    /* eslint-enable no-console */
    return rows;
  };

  (window as any).skmScrollFollowRawLog = (viewportId: string) => {
    const s = states.get(viewportId);
    const log = s ? [...s.rawLog] : [];
    // eslint-disable-next-line no-console
    console.log(`[SKM-SCROLL-FOLLOW] raw log for ${viewportId}:`, log);
    return log;
  };

  (window as any).skmScrollFollowReset = () => {
    states.forEach(s => {
      s.requestedLog = [];
      s.displayedLog = [];
      s.rawLog = [];
      s.inputToScrollMs = [];
      s.lastRequestedIndex = null;
      s.lastDisplayedIndex = null;
    });
    // eslint-disable-next-line no-console
    console.log('[SKM-SCROLL-FOLLOW] reset — begin your scroll test now');
  };

  // eslint-disable-next-line no-console
  console.log(
    '[SKM-SCROLL-FOLLOW] active — call skmScrollFollowReset() before a test, ' +
      'skmScrollFollowReport() after (or skmScrollFollowReport(viewportId, {stallThresholdMs}))'
  );
}

export default initSkmScrollFollowTelemetry;
