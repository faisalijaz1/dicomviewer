/**
 * ────────────────────────────────────────────────────────────────────────────
 *  SKM-STUDY-SWITCH-TELEMETRY 2026-10-09 — study/series switch timing breakdown
 *  (read-only measurement, NO behaviour change)
 *
 *  WHY
 *  QA measured a ~5,047–5,059ms stall on study switch, predating the 755e83e scheduler
 *  work. Before touching anything, we need to know WHERE that time actually goes:
 *  main-thread synchronous work building data structures, network contention, decode,
 *  render, or an unnecessary sequential dependency — rather than assuming "network".
 *
 *  WHAT THIS MEASURES
 *  StudyPrefetcherService.ts now calls performance.mark() at the key stages of a
 *  restart (every real study/series switch runs _stopPrefetching() then
 *  _startPrefetching() → _loadDisplaySets()):
 *    skm-switch:restart-begin        - _restartPrefetching() entered
 *    skm-switch:stop-end             - old prefetch state fully torn down
 *    skm-switch:loadDisplaySets-begin
 *    skm-switch:addLoadingState-end  - the loop over EVERY active display set in the
 *                                      WHOLE STUDY (not just the one being shown) —
 *                                      isolated because it's the suspected dominant
 *                                      synchronous cost (unmemoized imageId building +
 *                                      cache.isImageCached() per instance, for every
 *                                      series, not just the window being prefetched)
 *    skm-switch:enqueue-end          - prefetch window built (bounded by window size)
 *    skm-switch:sendNext-end         - first prefetch batch dispatched
 *    skm-switch:restart-end
 *  This module reads those marks and overlays three externally-observed signals to
 *  build the full breakdown the user actually feels:
 *    - first NEW /wado/uri request observed after the switch (network start)
 *    - first IMAGE_LOADED after the switch (decode complete)
 *    - first STACK_NEW_IMAGE per viewport after the switch (first useful image SHOWN)
 *    - DISPLAYSET_LOAD_COMPLETE (all background prefetch for the new study finished)
 *  explicitly separating "switch → first useful image" from "switch → background
 *  initialization complete", since those are NOT the same thing and conflating them
 *  would hide whether the viewer is unnecessarily waiting on the second before doing
 *  the first.
 *
 *  CAVEAT (documented, not solved here — read-only diagnostic, not a correctness
 *  requirement): a trailing network completion from the PREVIOUS series (marked
 *  aborted by _stopPrefetching() but not actually cancelled at the socket level) can
 *  arrive after a new switch starts and be misattributed as that switch's "first WADO".
 *  This affects only this measurement's precision, not any production behaviour.
 *
 *  SKM 2026-10-09 (Priority 2 telemetry correction): independent Playwright QA proved
 *  switchToFirstDisplayMs can report a deceptively fast number (~40-50ms) because the
 *  FIRST displayed slice was already decoded from thumbnail generation BEFORE the switch —
 *  which is not proof the new series' real content pipeline has started. All ORIGINAL
 *  fields above are preserved unchanged. Four ADDITIONAL, stricter fields only count
 *  activity provably caused by THIS switch, matched by DICOM objectUID/SOP across the
 *  network response, the decode (IMAGE_LOADED fires only on an actual decode, never a pure
 *  cache hit), and the displayed slice:
 *    switchToFirstNewSeriesWadoMs            - first /wado/uri response whose SOP later
 *                                               decoded genuinely new during this switch
 *    switchToFirstNewSeriesNetworkResponseMs - that same response's completion time
 *    switchToFirstNewSeriesDecodeMs          - first IMAGE_LOADED for a SOP not seen
 *                                               before this switch began
 *    switchToFirstNewSeriesDisplayMs         - first STACK_NEW_IMAGE whose displayed SOP
 *                                               matches one of the above (per viewport,
 *                                               see firstNewSeriesDisplayMsByViewport)
 *  null on any of these means "not yet observed" — including the case where the whole
 *  switch resolved from cache with no genuinely new content at all, which is itself a
 *  meaningful, reportable result rather than a measurement gap.
 *
 *  SAFETY
 *  Pure event listeners + Performance APIs. Never calls any Cornerstone/service
 *  mutator. Gated by appConfig.skmStudySwitchTelemetry.enabled (default on, like
 *  skmTelemetry). To remove: delete the init call in init.tsx and this file.
 *
 *  CONSOLE API
 *    skmStudySwitchReport()  → prints + returns the latest switch's breakdown
 * ────────────────────────────────────────────────────────────────────────────
 */

// eslint-disable-next-line
import { eventTarget, Enums } from '@cornerstonejs/core';

export type SkmStudySwitchConfig = {
  enabled?: boolean;
};

let initialized = false;

function nowMs(): number {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function markTime(name: string): number {
  try {
    const entries = performance.getEntriesByName(name, 'mark');
    const e = entries[entries.length - 1];
    return e ? e.startTime : 0;
  } catch (e) {
    return 0;
  }
}

function delta(a: number, b: number): number | null {
  return a && b ? Math.round(b - a) : null;
}

// SKM 2026-10-09 (QA fix — Priority 2 telemetry correction): extract the objectUID (SOP)
// query param from either a /wado/uri resource URL or a dicomweb imageId — same pattern as
// skmBulkImageLoader.ts's extractSop(), duplicated locally (read-only diagnostics; no
// cross-module coupling) — used to correlate a network response and a decode event back to
// the SAME instance without needing the full imageId string to match exactly.
function extractSopFromUrlOrImageId(s: string): string | null {
  if (!s) {
    return null;
  }
  const m = s.match(/objectUID=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function initSkmStudySwitchTelemetry(
  servicesManager: any,
  config: SkmStudySwitchConfig = {}
): void {
  if (initialized) {
    return;
  }
  if (config.enabled === false) {
    return;
  }
  const sp = servicesManager?.services?.studyPrefetcherService;
  if (!sp) {
    return;
  }
  initialized = true;

  let switchSeq = 0;
  let watching = false;
  let firstWadoAt = 0;
  let firstDecodeAt = 0;
  let backgroundCompleteAt = 0;
  const firstDisplayAtByViewport = new Map<string, number>();

  // SKM 2026-10-09 (QA fix — Priority 2 telemetry correction): independent Playwright QA
  // proved switchToFirstDisplayMs can be misleadingly fast (~40-50ms) because the FIRST
  // displayed slice was already decoded from thumbnail generation BEFORE the switch, which
  // is not proof the new series' real content pipeline has started. These track only
  // activity PROVABLY caused by THIS switch: decodedSopsSinceSwitch is populated from
  // IMAGE_LOADED (which fires only on an ACTUAL decode, never a pure cache hit), and
  // wadoEntriesThisSwitch buffers /wado/uri resource-timing entries observed after the
  // switch began so a later decode can be correlated back to the network response that
  // produced it, by matching the DICOM objectUID (SOP) embedded in both the URL and the
  // imageId — not by assuming order or coincidental timing.
  const decodedSopsSinceSwitch = new Set<string>();
  let wadoEntriesThisSwitch: { sop: string; startTime: number; responseEnd: number }[] = [];
  let firstNewSeriesWadoAt = 0;
  let firstNewSeriesNetworkResponseAt = 0;
  let firstNewSeriesDecodeAt = 0;
  const firstNewSeriesDisplayAtByViewport = new Map<string, number>();

  const onSwitchBegin = () => {
    switchSeq++;
    watching = true;
    firstWadoAt = 0;
    firstDecodeAt = 0;
    backgroundCompleteAt = 0;
    firstDisplayAtByViewport.clear();
    decodedSopsSinceSwitch.clear();
    wadoEntriesThisSwitch = [];
    firstNewSeriesWadoAt = 0;
    firstNewSeriesNetworkResponseAt = 0;
    firstNewSeriesDecodeAt = 0;
    firstNewSeriesDisplayAtByViewport.clear();
  };

  try {
    // SERVICE_STARTED fires at the end of EVERY _startPrefetching() call — both the
    // very first study open and every restart (study/series switch). Using it as the
    // "a switch just happened, start watching" trigger needs no changes to
    // StudyPrefetcherService.ts beyond the marks already added there.
    sp.subscribe(sp.EVENTS.SERVICE_STARTED, onSwitchBegin);
    sp.subscribe(sp.EVENTS.DISPLAYSET_LOAD_COMPLETE, () => {
      if (watching) {
        backgroundCompleteAt = nowMs();
      }
    });
  } catch (e) {
    /* best-effort */
  }

  // First NEW /wado/uri request observed after the switch began, PLUS (QA fix) buffer every
  // such entry's objectUID/startTime/responseEnd so a later decode can be correlated back to
  // the exact network response that produced it.
  try {
    const resObs = new PerformanceObserver(list => {
      if (!watching) {
        return;
      }
      for (const e of list.getEntries() as PerformanceResourceTiming[]) {
        if (!e.name || e.name.indexOf('/wado/uri') === -1) {
          continue;
        }
        if (!firstWadoAt) {
          firstWadoAt = nowMs();
        }
        const sop = extractSopFromUrlOrImageId(e.name);
        if (sop) {
          wadoEntriesThisSwitch.push({
            sop,
            startTime: e.startTime,
            responseEnd: e.responseEnd || e.startTime,
          });
          // Forward correlation: this response's SOP was already seen as decoded (rare
          // ordering, but handled) — the decode listener below handles the normal order
          // (response arrives, THEN decode fires) via backward correlation.
          if (decodedSopsSinceSwitch.has(sop) && !firstNewSeriesWadoAt) {
            firstNewSeriesWadoAt = e.startTime;
            firstNewSeriesNetworkResponseAt = e.responseEnd || e.startTime;
          }
        }
      }
    });
    resObs.observe({ type: 'resource', buffered: false });
  } catch (e) {
    /* resource timing unavailable */
  }

  // First decode completion after the switch began, PLUS (QA fix) the first decode whose
  // imageId's SOP was never seen before this switch — i.e. an ACTUAL new decode, not Cornerstone
  // short-circuiting on an already-cached image (which does not re-fire IMAGE_LOADED).
  try {
    eventTarget.addEventListener(Enums.Events.IMAGE_LOADED, (evt: any) => {
      if (!watching) {
        return;
      }
      if (!firstDecodeAt) {
        firstDecodeAt = nowMs();
      }
      const imageId = evt?.detail?.image?.imageId;
      const sop = imageId ? extractSopFromUrlOrImageId(imageId) : null;
      if (sop && !decodedSopsSinceSwitch.has(sop)) {
        decodedSopsSinceSwitch.add(sop);
        if (!firstNewSeriesDecodeAt) {
          firstNewSeriesDecodeAt = nowMs();
        }
        // Backward correlation: find the (already-buffered) network response that produced
        // this decode, by matching SOP — the normal case, since the response always precedes
        // the decode it fed.
        if (!firstNewSeriesWadoAt) {
          const match = wadoEntriesThisSwitch.find(w => w.sop === sop);
          if (match) {
            firstNewSeriesWadoAt = match.startTime;
            firstNewSeriesNetworkResponseAt = match.responseEnd;
          }
        }
      }
    });
  } catch (e) {
    /* best-effort */
  }

  // First STACK_NEW_IMAGE per viewport after the switch began — "first useful image
  // SHOWN", tracked per viewport so 1-viewport and 2-viewport switches are both visible.
  // QA fix: ALSO resolve the actually-displayed imageId and check whether its SOP is one we
  // know was genuinely decoded during THIS switch (decodedSopsSinceSwitch) — a plain
  // STACK_NEW_IMAGE alone does not prove that; it can fire just as fast for a slice that was
  // already decoded before the switch (e.g. from thumbnail generation).
  try {
    const wireElement = (element: any, viewportId: string) => {
      if (!element || element.__skmSwitchWired || !viewportId) {
        return;
      }
      element.__skmSwitchWired = true;
      const E: any = Enums.Events as any;
      const newImageName = E.STACK_NEW_IMAGE || 'CORNERSTONE_STACK_NEW_IMAGE';
      element.addEventListener(newImageName, () => {
        if (!watching) {
          return;
        }
        if (!firstDisplayAtByViewport.has(viewportId)) {
          firstDisplayAtByViewport.set(viewportId, nowMs());
        }
        if (!firstNewSeriesDisplayAtByViewport.has(viewportId)) {
          try {
            const vp =
              servicesManager?.services?.cornerstoneViewportService?.getCornerstoneViewport?.(
                viewportId
              );
            const idx = vp?.getCurrentImageIdIndex?.();
            const ids = vp?.getImageIds?.();
            const currentImageId =
              typeof idx === 'number' && ids ? ids[idx] : undefined;
            const sop = currentImageId ? extractSopFromUrlOrImageId(currentImageId) : null;
            if (sop && decodedSopsSinceSwitch.has(sop)) {
              firstNewSeriesDisplayAtByViewport.set(viewportId, nowMs());
            }
          } catch (e) {
            /* best-effort */
          }
        }
      });
    };
    const elEnabled = (Enums.Events as any).ELEMENT_ENABLED || 'CORNERSTONE_ELEMENT_ENABLED';
    eventTarget.addEventListener(elEnabled, (evt: any) => {
      const element = evt?.detail?.element;
      const viewportId = evt?.detail?.viewportId;
      if (element && viewportId) {
        wireElement(element, viewportId);
      }
    });
  } catch (e) {
    /* best-effort */
  }

  (window as any).skmStudySwitchReport = () => {
    const restartBegin = markTime('skm-switch:restart-begin');
    const stopEnd = markTime('skm-switch:stop-end');
    const loadBegin = markTime('skm-switch:loadDisplaySets-begin');
    const addLoadingEnd = markTime('skm-switch:addLoadingState-end');
    const enqueueEnd = markTime('skm-switch:enqueue-end');
    const sendNextEnd = markTime('skm-switch:sendNext-end');
    const restartEnd = markTime('skm-switch:restart-end');
    // base = the switch's t0. restart-begin exists for every REAL switch (a restart); a
    // plain initial study open (no prior series shown) has no restart, so fall back to
    // loadDisplaySets-begin so first-open timing is still reported.
    const base = restartBegin || loadBegin || 0;

    const firstDisplayEntries = Array.from(firstDisplayAtByViewport.entries());
    const firstDisplayMsByViewport: Record<string, number | null> = {};
    firstDisplayEntries.forEach(([vpId, t]) => {
      firstDisplayMsByViewport[vpId] = delta(base, t);
    });
    const earliestDisplayAt = firstDisplayEntries.reduce(
      (min, [, t]) => (min === 0 ? t : Math.min(min, t)),
      0
    );

    // SKM 2026-10-09 (QA fix — Priority 2 telemetry correction): earliest confirmed-genuine
    // new-series display, derived the SAME way as earliestDisplayAt above but from
    // firstNewSeriesDisplayAtByViewport (only populated when the displayed imageId's SOP is
    // provably in decodedSopsSinceSwitch — i.e. actually decoded during THIS switch).
    const firstNewSeriesDisplayEntries = Array.from(firstNewSeriesDisplayAtByViewport.entries());
    const firstNewSeriesDisplayMsByViewport: Record<string, number | null> = {};
    firstNewSeriesDisplayEntries.forEach(([vpId, t]) => {
      firstNewSeriesDisplayMsByViewport[vpId] = delta(base, t);
    });
    const earliestNewSeriesDisplayAt = firstNewSeriesDisplayEntries.reduce(
      (min, [, t]) => (min === 0 ? t : Math.min(min, t)),
      0
    );

    const report = {
      switchSeq,
      // Stage breakdown (each relative to the PREVIOUS stage, not to base) —
      // matches the requested "study switch / |-- stage: xxx ms" tree.
      oldPrefetchStopMs: delta(restartBegin, stopEnd),
      addLoadingStateMs: delta(loadBegin, addLoadingEnd), // suspected dominant sync cost
      enqueueMs: delta(addLoadingEnd, enqueueEnd),
      sendNextDispatchMs: delta(enqueueEnd, sendNextEnd),
      restartTotalMs: delta(restartBegin, restartEnd),
      // The two user-experience numbers that are NOT the same thing:
      switchToFirstDisplayMs: delta(base, earliestDisplayAt), // switch → first useful image
      switchToBackgroundCompleteMs: delta(base, backgroundCompleteAt), // switch → all prefetch done
      // Supporting breakdown for distinguishing WHERE time went (network/decode/render):
      switchToFirstWadoMs: delta(base, firstWadoAt),
      switchToFirstDecodeMs: delta(base, firstDecodeAt),
      firstDisplayMsByViewport,
      viewportsDisplayed: firstDisplayEntries.length,
      // SKM 2026-10-09 (QA fix — Priority 2 telemetry correction): preserved ALL fields
      // above unchanged; these are ADDITIONAL, stricter metrics that only count activity
      // provably caused by THIS switch (matched by DICOM objectUID/SOP across the network
      // response, the decode, and the displayed slice) — so a pre-switch cached/thumbnail
      // image can never masquerade as proof the new series' real content pipeline started.
      // null means "not yet observed" (e.g. the whole switch resolved from cache with no
      // genuinely new content at all, which is itself a meaningful, reportable result).
      switchToFirstNewSeriesWadoMs: delta(base, firstNewSeriesWadoAt),
      switchToFirstNewSeriesNetworkResponseMs: delta(base, firstNewSeriesNetworkResponseAt),
      switchToFirstNewSeriesDecodeMs: delta(base, firstNewSeriesDecodeAt),
      switchToFirstNewSeriesDisplayMs: delta(base, earliestNewSeriesDisplayAt),
      firstNewSeriesDisplayMsByViewport,
      newSeriesSopsDecoded: decodedSopsSinceSwitch.size,
    };
    /* eslint-disable no-console */
    console.log('[SKM-STUDY-SWITCH] breakdown for switch #' + switchSeq);
    console.table(report);
    console.log('[SKM-STUDY-SWITCH]', report);
    /* eslint-enable no-console */
    return report;
  };

  // eslint-disable-next-line no-console
  console.log('[SKM-STUDY-SWITCH] active — switch studies/series, then call skmStudySwitchReport()');
}

export default initSkmStudySwitchTelemetry;
