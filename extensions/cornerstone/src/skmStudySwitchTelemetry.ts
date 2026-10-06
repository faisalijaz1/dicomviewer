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

  const onSwitchBegin = () => {
    switchSeq++;
    watching = true;
    firstWadoAt = 0;
    firstDecodeAt = 0;
    backgroundCompleteAt = 0;
    firstDisplayAtByViewport.clear();
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

  // First NEW /wado/uri request observed after the switch began.
  try {
    const resObs = new PerformanceObserver(list => {
      if (!watching || firstWadoAt) {
        return;
      }
      for (const e of list.getEntries() as PerformanceResourceTiming[]) {
        if (e.name && e.name.indexOf('/wado/uri') !== -1) {
          firstWadoAt = nowMs();
          break;
        }
      }
    });
    resObs.observe({ type: 'resource', buffered: false });
  } catch (e) {
    /* resource timing unavailable */
  }

  // First decode completion after the switch began.
  try {
    eventTarget.addEventListener(Enums.Events.IMAGE_LOADED, () => {
      if (watching && !firstDecodeAt) {
        firstDecodeAt = nowMs();
      }
    });
  } catch (e) {
    /* best-effort */
  }

  // First STACK_NEW_IMAGE per viewport after the switch began — "first useful image
  // SHOWN", tracked per viewport so 1-viewport and 2-viewport switches are both visible.
  try {
    const wireElement = (element: any, viewportId: string) => {
      if (!element || element.__skmSwitchWired || !viewportId) {
        return;
      }
      element.__skmSwitchWired = true;
      const E: any = Enums.Events as any;
      const newImageName = E.STACK_NEW_IMAGE || 'CORNERSTONE_STACK_NEW_IMAGE';
      element.addEventListener(newImageName, () => {
        if (watching && !firstDisplayAtByViewport.has(viewportId)) {
          firstDisplayAtByViewport.set(viewportId, nowMs());
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
