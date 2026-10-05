/**
 * ────────────────────────────────────────────────────────────────────────────
 *  SKM-PREFETCH-CONCURRENCY 2026-10-09 — adaptive background prefetch concurrency
 *
 *  WHY
 *  The StudyPrefetcherService keeps at most `config.maxNumPrefetchRequests` prefetch
 *  loads in flight. Validation showed that value (6) sitting PEGGED at its cap with a
 *  2000+ deep pending queue (sched_inflight 6, sched_queue ~2166) — i.e. background
 *  warming of a large series is throughput-limited by the concurrency cap, not by the
 *  network, the WADO server, decoding, or the decoded cache (fill 29–78%,
 *  cacheSizeExceeded 0, missLatencyP95 ~120 ms, decodedHitRatio 100%). The Cornerstone
 *  request pool already permits more prefetch-type requests than 6, so the prefetcher is
 *  leaving its own lane under-used.
 *
 *  WHAT
 *  A tiny controller that ADAPTS the prefetcher's inflight cap between a safe MIN and MAX
 *  using the memory governor's live state (window.__skmBudget) plus the decoded-cache
 *  fill. It never touches the governor, evictor, warmer, prefetch ordering, or Cornerstone
 *  core — it only writes studyPrefetcherService.config.maxNumPrefetchRequests, which the
 *  service already reads live on every dispatch (_effectiveMaxPrefetchRequests()).
 *
 *  POLICY (per eval, ~1 s; stepped ±2 so changes ramp, never burst):
 *    - this tab idle (not recently scrolled)        → MIN   (yield bandwidth/RAM)
 *    - ≥ 2 live tabs                                 → MULTITAB (reduced; protect the
 *                                                       shared HTTP connection pool + the
 *                                                       aggregate decoded budget)
 *    - single active tab:
 *        decoded-cache fill < raiseFill (lots room)  → MAX   (fill the series faster)
 *        fill ≥ backoffFill (near cap)               → MIN   (avoid overshoot/treadmill)
 *        otherwise                                   → BASE
 *
 *  SAFETY
 *    - The INTERACTION lane (the slice the doctor is viewing) is a SEPARATE request-pool
 *      lane (maxNumRequests.interaction) and is never changed here, so the displayed slice
 *      keeps top priority regardless of prefetch concurrency.
 *    - MAX is clamped to the pool's prefetch lane (appConfig.maxNumRequests.prefetch); the
 *      pool is the hard ceiling, this is only the throttle beneath it.
 *    - boundedPrefetch / boundedPrefetchHighWater still PAUSE the feed near the cap; this
 *      controller lowers concurrency before that, as a softer first line.
 *    - On ≥2 tabs or low headroom it REDUCES, matching the governor's own back-off, so it
 *      cannot push aggregate RAM or network past what the governor already allows.
 *
 *  Gated by appConfig.skmPrefetchConcurrency.enabled (default on). Publishes
 *  window.__skmPrefetchConcurrency for diagnostics.
 * ────────────────────────────────────────────────────────────────────────────
 */

// eslint-disable-next-line
import { cache } from '@cornerstonejs/core';

export type SkmPrefetchConcurrencyConfig = {
  /** Master gate. Default true. */
  enabled?: boolean;
  /** Lowest inflight prefetch cap. Default 4. */
  minRequests?: number;
  /** Normal inflight prefetch cap. Default 8. */
  baseRequests?: number;
  /** Highest inflight prefetch cap (clamped to the pool's prefetch lane). Default 10. */
  maxRequests?: number;
  /** Inflight cap when ≥ 2 live tabs. Default 6. */
  multiTabRequests?: number;
  /** Eval cadence (ms). Default 1000. */
  evalMs?: number;
  /** Single active tab + fill below this ⇒ raise toward MAX. Default 0.55. */
  raiseFill?: number;
  /** Fill at/above this ⇒ drop toward MIN (near the cap). Default 0.88. */
  backoffFill?: number;
  /** Max step change per eval (ramp, not burst). Default 2. */
  stepPerEval?: number;
};

let initialized = false;

export function initSkmPrefetchConcurrency(
  servicesManager: any,
  appConfig: any,
  config: SkmPrefetchConcurrencyConfig = {}
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

  const poolPrefetchLane = Math.max(1, appConfig?.maxNumRequests?.prefetch ?? 8);
  const MIN = Math.max(1, config.minRequests ?? 4);
  const BASE = Math.max(MIN, config.baseRequests ?? 8);
  const MAX = Math.min(poolPrefetchLane, Math.max(BASE, config.maxRequests ?? 10));
  const MULTITAB = Math.min(MAX, Math.max(MIN, config.multiTabRequests ?? 6));
  const EVAL_MS = Math.max(300, config.evalMs ?? 1000);
  const RAISE_FILL = Math.min(0.95, Math.max(0.2, config.raiseFill ?? 0.55));
  const BACKOFF_FILL = Math.min(0.98, Math.max(RAISE_FILL + 0.05, config.backoffFill ?? 0.88));
  const STEP = Math.max(1, config.stepPerEval ?? 2);

  let conc = BASE;

  const readBudget = (): any => {
    try {
      return (window as any).__skmBudget || null;
    } catch (e) {
      return null;
    }
  };

  const fillFraction = (): number => {
    try {
      const max = (cache as any).getMaxCacheSize?.() || 0;
      const cur = (cache as any).getCacheSize?.() || 0;
      return max > 0 ? cur / max : 0;
    } catch (e) {
      return 0;
    }
  };

  // SKM 2026-10-09 (Phase 2 Req 4): count open STACK viewports in THIS tab. Two panes in one
  // tab share one scheduler, so ≥2 panes should back off like ≥2 browser tabs (protect the
  // shared HTTP pool + avoid feeding the prefetch/evict churn). Browser-tab count comes from the
  // governor (liveTabs); this is the per-tab viewport count the governor does not know about.
  const countStackViewports = (): number => {
    try {
      const vgs = servicesManager?.services?.viewportGridService;
      const csvs = servicesManager?.services?.cornerstoneViewportService;
      if (!vgs || !csvs) {
        return 1;
      }
      const viewports = vgs.getState?.()?.viewports;
      if (!viewports || typeof viewports.forEach !== 'function') {
        return 1;
      }
      let n = 0;
      viewports.forEach((_vp: any, viewportId: string) => {
        const csVp = csvs.getCornerstoneViewport?.(viewportId);
        // A stack viewport exposes getCurrentImageIdIndex; volumes/3D do not.
        if (csVp && typeof csVp.getCurrentImageIdIndex === 'function') {
          n++;
        }
      });
      return Math.max(1, n);
    } catch (e) {
      return 1;
    }
  };

  const evalLoop = () => {
    try {
      const b = readBudget();
      const active = b ? !!b.activeTab : true;
      const liveTabs = b ? Math.max(1, b.liveTabs || 1) : 1;
      const stackViewports = countStackViewports();
      const fill = fillFraction();

      let target: number;
      if (!active) {
        target = MIN;
      } else if (liveTabs >= 2 || stackViewports >= 2) {
        // Multiple browser tabs OR multiple stack panes in this tab → conservative shared cap.
        target = MULTITAB;
      } else if (fill < RAISE_FILL) {
        target = MAX;
      } else if (fill >= BACKOFF_FILL) {
        target = MIN;
      } else {
        target = BASE;
      }

      // Ramp toward the target (±STEP) so concurrency never jumps in one burst.
      if (conc < target) {
        conc = Math.min(target, conc + STEP);
      } else if (conc > target) {
        conc = Math.max(target, conc - STEP);
      }
      conc = Math.max(MIN, Math.min(MAX, conc));

      if ((sp as any).config) {
        (sp as any).config.maxNumPrefetchRequests = conc;
      }

      (window as any).__skmPrefetchConcurrency = {
        current: conc,
        target,
        active,
        liveTabs,
        stackViewports,
        fillPct: Math.round(fill * 100),
        min: MIN,
        base: BASE,
        max: MAX,
        multiTab: MULTITAB,
        poolPrefetchLane,
      };
    } catch (e) {
      /* never break the viewer */
    }
  };

  evalLoop();
  window.setInterval(evalLoop, EVAL_MS);

  (window as any).skmGetPrefetchConcurrency = () => {
    // eslint-disable-next-line no-console
    console.log('[SKM-PREFETCH-CONC]', (window as any).__skmPrefetchConcurrency);
    return (window as any).__skmPrefetchConcurrency;
  };

  // eslint-disable-next-line no-console
  console.log(
    '[SKM-PREFETCH-CONC] adaptive prefetch concurrency active —',
    `min ${MIN}, base ${BASE}, max ${MAX} (pool lane ${poolPrefetchLane}), multiTab ${MULTITAB}` +
      ` | raiseFill ${RAISE_FILL}, backoffFill ${BACKOFF_FILL}, step ${STEP}/${EVAL_MS}ms` +
      ' | interaction lane untouched'
  );
}

export default initSkmPrefetchConcurrency;
