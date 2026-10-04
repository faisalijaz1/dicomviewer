/**
 * ────────────────────────────────────────────────────────────────────────────
 *  SKM-WARMER 2026-10-03 — Phase 1 / W3 "indicator"
 *
 *  PURPOSE
 *  Windowed decode (W2) bounds RAM, but the progress bar stalled because it
 *  reflected *decode* of only a window. This module background-downloads the
 *  ACTIVE series' DICOM files into the browser HTTP disk cache and emits one
 *  `SKM_SLICE_AVAILABLE` event per slice. The vertical progress bar (monotonic,
 *  see ViewportSliceProgressScrollbar hooks) marks those, so it climbs to 100%
 *  while decode stays windowed. As a bonus, scrolling to a warmed slice is served
 *  from the HTTP cache (the warmer fetches the EXACT same /wado/uri URL Cornerstone
 *  uses, via the same app-config interceptor → cache parity → no re-download).
 *
 *  WHAT IT DOES NOT DO
 *  It never decodes, never calls setStack, and never touches MPR/Crosshairs or any
 *  Cornerstone internals. It only fetches bytes and dispatches an event. Bodies are
 *  read (to complete the cache entry) then discarded → ~zero persistent JS heap.
 *
 *  REVERSIBILITY
 *  Entirely gated by appConfig.skmWarmer.enabled (default OFF). With the flag off
 *  nothing is wired and behaviour is identical to the W2 build. To remove: delete
 *  the initSkmWarmer() call in init.tsx and this file.
 * ────────────────────────────────────────────────────────────────────────────
 */

// eslint-disable-next-line
import { cache, eventTarget } from '@cornerstonejs/core';
import { subscribeStackNewImage } from './utils/skmStackNewImage';

export type SkmWarmerConfig = {
  enabled?: boolean;
  /** Per-tab concurrent background fetches. Default 3. */
  concurrency?: number;
  /** Absolute concurrent fetches across ALL tabs (BroadcastChannel). Default 6. */
  globalConcurrency?: number;
  /** Warm only the active series (true) vs every open series (false). Default true. */
  activeSeriesOnly?: boolean;
  /** ms to wait after a series becomes active before warming (lets the first image
   *  and the initial decode window win the network first). Default 1500. */
  startDelayMs?: number;
  /**
   * ── SKM 2026-10-04 (Option B — skmMovingWindow) ─────────────────────────
   * When true, warm a MOVING, ahead-biased window of compressed bytes around the
   * doctor's current slice (into the browser HTTP disk cache, no decode) instead of
   * the whole series front-to-back. The window follows the doctor and a far jump
   * abandons the old window and restarts at the new position. This is what makes a
   * far jump land on already-downloaded bytes → decode-only → no spinner — without
   * decoding (RAM stays bounded by the separate Cornerstone cap). Set false to
   * restore whole-series warming.
   */
  movingWindow?: boolean;
  /** Phase B: sweep the whole study (near-first, ahead-biased) into the HTTP cache. Default true. */
  warmWholeStudy?: boolean;
  /** Moving window: slices to warm AHEAD of the doctor (scroll direction). Default 1000. */
  ahead?: number;
  /** Moving window: slices to warm BEHIND the doctor. Default 250. */
  behind?: number;
  /**
   * SKM 2026-10-04 (fix G — far band only): skip warming the NEAR band that the prefetcher
   * already decodes (and thereby HTTP-caches via Cornerstone's own XHR), so the warmer's
   * fetch() doesn't double-request those slices. Set to the prefetch decode window.
   * The warmer then warms only the FAR band (beyond the prefetcher's reach). Default 300/150.
   */
  nearSkipAhead?: number;
  nearSkipBehind?: number;
  /** Throttle (ms) between scroll-driven window re-centres. Default 250. */
  rethrottleMs?: number;
  /** |Δindex| beyond which the moving window abandons and restarts (far jump). Default 120. */
  farJumpThreshold?: number;
};

/** Event the monotonic progress bar listens to (see scrollbar hooks). */
export const SKM_SLICE_AVAILABLE = 'SKM_SLICE_AVAILABLE';

let warmerInitialized = false;
// displaySetInstanceUIDs we've already started warming (avoid re-warming on every
// grid event). A re-opened series is skipped — its bytes are already in the cache.
const warmedDisplaySets = new Set<string>();
// SKM 2026-10-04 (Option B): imageIds whose bytes we've already fetched into the HTTP
// cache this session, so the sliding moving-window doesn't re-request the same slice
// each time it re-centres. (If the HTTP cache later evicts, the on-demand path refetches.)
const warmedImageIds = new Set<string>();
// Bumps whenever the active series changes; in-flight warmers compare against it
// and abort when stale, so a series/study switch cancels the previous warm.
let currentRunId = 0;

function urlFromImageId(imageId: string): string | null {
  if (!imageId) {
    return null;
  }
  // imageIds look like "dicomweb:https://host/wado/uri?..." or "wadouri:https://..."
  const i = imageId.indexOf('http');
  return i >= 0 ? imageId.substring(i) : null;
}

function emitAvailable(imageId: string): void {
  try {
    eventTarget.dispatchEvent(new CustomEvent(SKM_SLICE_AVAILABLE, { detail: { imageId } }));
  } catch (e) {
    /* non-fatal: the bar just won't advance for this slice */
  }
}

export function initSkmWarmer(
  servicesManager: any,
  extensionManager: any,
  config: SkmWarmerConfig
): void {
  if (warmerInitialized) {
    return;
  }
  warmerInitialized = true;

  const perTab = Math.max(1, config?.concurrency ?? 3);
  const globalCap = Math.max(1, config?.globalConcurrency ?? 6);
  const startDelayMs = typeof config?.startDelayMs === 'number' ? config.startDelayMs : 1500;

  // ── Cross-tab concurrency division (NAS-burst guard) ──────────────────────
  // Each tab divides the global cap by the number of live warmer tabs, so N tabs
  // can't launch N× the connections. Same lightweight heartbeat pattern as the
  // cache splitter in init.tsx. Best-effort: falls back to per-tab cap on failure.
  let liveTabs = 1;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const myId = Math.random().toString(36).slice(2) + '-' + Date.now();
      const peers = new Map<string, number>();
      const ch = new BroadcastChannel('skm-warmer-tabs');
      const recount = () => {
        const cutoff = Date.now() - 12000;
        peers.forEach((t, id) => {
          if (t < cutoff) {
            peers.delete(id);
          }
        });
        liveTabs = peers.size + 1;
      };
      ch.onmessage = (ev: any) => {
        const d = ev?.data;
        if (!d || !d.id || d.id === myId) {
          return;
        }
        if (d.type === 'hello') {
          peers.set(d.id, Date.now());
          try {
            ch.postMessage({ type: 'ack', id: myId });
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
        ch.postMessage({ type: 'hello', id: myId });
      } catch (e) {
        /* noop */
      }
      window.setInterval(() => {
        try {
          ch.postMessage({ type: 'heartbeat', id: myId });
        } catch (e) {
          /* noop */
        }
        recount();
      }, 5000);
      window.addEventListener('pagehide', () => {
        try {
          ch.postMessage({ type: 'bye', id: myId });
          ch.close();
        } catch (e) {
          /* noop */
        }
      });
    }
  } catch (e) {
    /* best-effort; per-tab cap still applies */
  }

  const effectiveConcurrency = () =>
    Math.max(1, Math.min(perTab, Math.floor(globalCap / Math.max(1, liveTabs)) || 1));

  const warmSeries = async (imageIds: string[], runId: number) => {
    let next = 0;
    const worker = async () => {
      while (next < imageIds.length) {
        if (runId !== currentRunId) {
          return; // a newer series took over → abort this warm
        }
        const imageId = imageIds[next++];
        if (!imageId) {
          continue;
        }
        // Already fetched this session → bytes are in the HTTP cache; skip silently (the bar
        // is monotonic and already marked it — no redundant event dispatch, Phase B).
        if (warmedImageIds.has(imageId)) {
          continue;
        }
        // Already decoded in Cornerstone → it's available; mark it available without a fetch.
        try {
          if (cache.getImageLoadObject && cache.getImageLoadObject(imageId)) {
            warmedImageIds.add(imageId);
            emitAvailable(imageId);
            continue;
          }
        } catch (e) {
          /* fall through to fetch */
        }
        const url = urlFromImageId(imageId);
        if (!url) {
          continue;
        }
        try {
          // GET with default (same-origin) credentials → identical to Cornerstone's
          // XHR, and the app-config interceptor appends storagePath to both, so this
          // warms the SAME HTTP cache entry Cornerstone will later read.
          const res = await fetch(url, { method: 'GET' });
          if (res.ok) {
            // Read the body to completion so the cache entry is fully stored, then
            // discard it (no persistent heap).
            await res.arrayBuffer().catch(() => undefined);
            warmedImageIds.add(imageId);
            emitAvailable(imageId);
          } else if (res.body) {
            await res.body.cancel().catch(() => undefined);
          }
        } catch (e) {
          /* skip — the on-demand path will fetch this slice if the doctor scrolls to it */
        }
        // Yield so the warmer never starves the on-screen slice's request.
        await new Promise(r => setTimeout(r, 0));
      }
    };

    const n = effectiveConcurrency();
    const workers: Promise<void>[] = [];
    for (let i = 0; i < n; i++) {
      workers.push(worker());
    }
    await Promise.all(workers);
  };

  const run = () => {
    try {
      const { viewportGridService, displaySetService } = servicesManager.services;
      const state = viewportGridService.getState();
      const activeViewportId = state?.activeViewportId;
      if (!activeViewportId) {
        return;
      }
      const activeViewport = state.viewports?.get(activeViewportId);
      const dsUID = activeViewport?.displaySetInstanceUIDs?.[0];
      if (!dsUID || warmedDisplaySets.has(dsUID)) {
        return;
      }
      const displaySet = displaySetService
        .getActiveDisplaySets()
        .find((ds: any) => ds.displaySetInstanceUID === dsUID);
      if (!displaySet) {
        return;
      }
      const dataSource = extensionManager.getActiveDataSource()[0];
      const imageIds: string[] = dataSource.getImageIdsForDisplaySet(displaySet);
      if (!imageIds || imageIds.length === 0) {
        return;
      }
      warmedDisplaySets.add(dsUID);
      currentRunId++;
      const myRun = currentRunId;
      // eslint-disable-next-line no-console
      console.log(`[SKM-WARMER] warming ${imageIds.length} slices for ${dsUID}`);
      window.setTimeout(() => {
        warmSeries(imageIds, myRun).catch(() => undefined);
      }, startDelayMs);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[SKM-WARMER] run() error', e);
    }
  };

  // ── SKM 2026-10-04 (Option B): moving-window warmer ───────────────────────
  // Warm an ahead-biased window of compressed bytes around the doctor's current
  // slice (HTTP disk cache, no decode), following the doctor and restarting on a
  // far jump. This replaces whole-series warming when config.movingWindow is true.
  const mwAhead = Math.max(0, config?.ahead ?? 1000);
  const mwBehind = Math.max(0, config?.behind ?? 250);
  const mwSkipAhead = Math.max(0, config?.nearSkipAhead ?? 300);
  const mwSkipBehind = Math.max(0, config?.nearSkipBehind ?? 150);
  const mwThrottle = Math.max(50, config?.rethrottleMs ?? 250);
  // SKM 2026-10-04 (Phase B): sweep the WHOLE study (near-doctor first, ahead-biased), not
  // just ±ahead/behind, so the Ready N/Total frontier keeps advancing to 100% in the
  // background instead of stopping around the initial window. Bytes only (HTTP cache); the
  // moving window just prioritises order. Set false to restore the bounded ±ahead window.
  const mwWholeStudy = config?.warmWholeStudy !== false;
  let mwLastCenter: number | null = null;
  let mwDirection = 1;
  let mwTimer: ReturnType<typeof setTimeout> | null = null;

  const mwGetActiveSeries = (): { dsUID: string; imageIds: string[]; viewportId: string } | null => {
    try {
      const { viewportGridService, displaySetService } = servicesManager.services;
      const state = viewportGridService.getState();
      const viewportId = state?.activeViewportId;
      if (!viewportId) {
        return null;
      }
      const activeViewport = state.viewports?.get(viewportId);
      const dsUID = activeViewport?.displaySetInstanceUIDs?.[0];
      if (!dsUID) {
        return null;
      }
      const displaySet = displaySetService
        .getActiveDisplaySets()
        .find((ds: any) => ds.displaySetInstanceUID === dsUID);
      if (!displaySet) {
        return null;
      }
      const dataSource = extensionManager.getActiveDataSource()[0];
      const imageIds: string[] = dataSource.getImageIdsForDisplaySet(displaySet);
      if (!imageIds || imageIds.length === 0) {
        return null;
      }
      return { dsUID, imageIds, viewportId };
    } catch (e) {
      return null;
    }
  };

  const mwGetCenter = (viewportId: string): number => {
    try {
      const csvs = servicesManager.services.cornerstoneViewportService;
      const vp = csvs?.getCornerstoneViewport?.(viewportId);
      const idx = vp?.getCurrentImageIdIndex?.();
      return typeof idx === 'number' && idx >= 0 ? idx : 0;
    } catch (e) {
      return 0;
    }
  };

  // Ordered, ahead-biased list of imageIds to warm around `center` (center-out).
  const mwOrderedWindow = (imageIds: string[], center: number, dir: number): string[] => {
    const last = imageIds.length - 1;
    // Phase B: when warming the whole study, extend the walk to both ends (still near-first,
    // ahead-biased); otherwise keep the bounded ±ahead/behind window.
    const aEnd = mwWholeStudy ? last : Math.min(last, center + (dir > 0 ? mwAhead : mwBehind));
    const bEnd = mwWholeStudy ? 0 : Math.max(0, center - (dir > 0 ? mwBehind : mwAhead));
    // Far-band only: skip the near band the prefetcher decodes (fix G — no double-fetch).
    // SKM 2026-10-07 (Fix 5): the prefetch decode window is now derived at runtime from the
    // adaptive per-tab memory budget (skmMemoryBudget → window.__skmBudget.nearSkip). Read it
    // live so the warmer always skips exactly the band the prefetcher currently decodes and
    // byte-warms only BEYOND it — regardless of machine tier or tab count. Falls back to the
    // static config values when the budget governor isn't present.
    let skipAhead = mwSkipAhead;
    let skipBehind = mwSkipBehind;
    try {
      const b = (globalThis as any).__skmBudget;
      if (b && typeof b.nearSkip === 'number' && b.nearSkip > 0) {
        skipAhead = b.nearSkip;
        skipBehind = b.nearSkip;
      }
    } catch (e) {
      /* use config fallback */
    }
    const nearLo = center - skipBehind;
    const nearHi = center + skipAhead;
    const out: string[] = [];
    const push = (i: number) => {
      if (i < 0 || i > last || !imageIds[i]) {
        return;
      }
      if (i >= nearLo && i <= nearHi) {
        return; // prefetcher owns this slice
      }
      if (warmedImageIds.has(imageIds[i])) {
        return; // already byte-warmed this session — keep the sweep list to UNwarmed only,
        // so it shrinks as progress advances (no re-scan/re-emit storm). Phase B.
      }
      out.push(imageIds[i]);
    };
    push(center);
    let a = center + dir;
    let b = center - dir;
    // 2 ahead : 1 behind interleave.
    while (a >= bEnd - 0 && a <= aEnd) {
      push(a);
      push(a + dir);
      a += dir * 2;
      if (b >= bEnd && b <= aEnd) {
        push(b);
        b -= dir;
      }
    }
    // drain any remaining behind side
    while (b >= bEnd && b <= aEnd) {
      push(b);
      b -= dir;
    }
    const seen = new Set<string>();
    const result: string[] = [];
    for (const id of out) {
      if (!seen.has(id)) {
        seen.add(id);
        result.push(id);
      }
    }
    return result;
  };

  const mwRecenter = () => {
    const s = mwGetActiveSeries();
    if (!s) {
      return;
    }
    const center = mwGetCenter(s.viewportId);
    if (mwLastCenter !== null && center !== mwLastCenter) {
      mwDirection = center > mwLastCenter ? 1 : -1;
    }
    // Phase B: only RESTART (re-prioritise) the sweep on a meaningful move. The sweep already
    // warms the whole study near-first and dedups via warmedImageIds, so we don't need to tear
    // it down and rebuild on every 1-slice scroll (that caused re-scan churn). Between restarts
    // the running sweep keeps progressing. A far jump (> restart threshold) re-prioritises.
    const MW_RESTART_THRESHOLD = 50;
    if (
      mwLastCenter !== null &&
      currentRunId > 0 &&
      Math.abs(center - mwLastCenter) < MW_RESTART_THRESHOLD
    ) {
      return;
    }
    mwLastCenter = center;
    currentRunId++; // abandon the previous sweep's workers; dedup keeps completed work
    const myRun = currentRunId;
    const list = mwOrderedWindow(s.imageIds, center, mwDirection);
    // eslint-disable-next-line no-console
    console.log(
      `[SKM-WARMER] moving window @${center} dir=${mwDirection} warming ${list.length} remaining slices`
    );
    warmSeries(list, myRun).catch(() => undefined);
  };

  const mwSchedule = () => {
    if (mwTimer) {
      return;
    }
    mwTimer = setTimeout(() => {
      mwTimer = null;
      mwRecenter();
    }, mwThrottle);
  };

  try {
    const { viewportGridService } = servicesManager.services;
    const E = viewportGridService.EVENTS;
    if (config?.movingWindow) {
      // Follow the doctor: re-centre on viewport/grid changes and on every slice change.
      viewportGridService.subscribe(E.VIEWPORTS_READY, mwSchedule);
      viewportGridService.subscribe(E.ACTIVE_VIEWPORT_ID_CHANGED, mwSchedule);
      viewportGridService.subscribe(E.GRID_STATE_CHANGED, mwSchedule);
      // SKM 2026-10-04 (Phase B): STACK_NEW_IMAGE is a NON-bubbling element event, so the old
      // document/eventTarget listener never fired and the window only warmed once (@0). Wire it
      // PER ELEMENT via ELEMENT_ENABLED so the moving window actually follows the doctor.
      subscribeStackNewImage(mwSchedule);
    } else {
      // Whole-series warming (previous behaviour).
      viewportGridService.subscribe(E.VIEWPORTS_READY, run);
      viewportGridService.subscribe(E.ACTIVE_VIEWPORT_ID_CHANGED, run);
      viewportGridService.subscribe(E.GRID_STATE_CHANGED, run);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[SKM-WARMER] failed to subscribe', e);
  }
}
