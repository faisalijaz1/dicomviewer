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
};

/** Event the monotonic progress bar listens to (see scrollbar hooks). */
export const SKM_SLICE_AVAILABLE = 'SKM_SLICE_AVAILABLE';

let warmerInitialized = false;
// displaySetInstanceUIDs we've already started warming (avoid re-warming on every
// grid event). A re-opened series is skipped — its bytes are already in the cache.
const warmedDisplaySets = new Set<string>();
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
        // Already decoded in Cornerstone → it's available; mark it without a fetch.
        try {
          if (cache.getImageLoadObject && cache.getImageLoadObject(imageId)) {
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

  try {
    const { viewportGridService } = servicesManager.services;
    const E = viewportGridService.EVENTS;
    viewportGridService.subscribe(E.VIEWPORTS_READY, run);
    viewportGridService.subscribe(E.ACTIVE_VIEWPORT_ID_CHANGED, run);
    viewportGridService.subscribe(E.GRID_STATE_CHANGED, run);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[SKM-WARMER] failed to subscribe', e);
  }
}
