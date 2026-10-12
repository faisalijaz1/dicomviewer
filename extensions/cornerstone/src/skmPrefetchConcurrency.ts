/**
 * ────────────────────────────────────────────────────────────────────────────
 *  SKM-PREFETCH-CONCURRENCY 2026-10-09 — adaptive background prefetch concurrency
 *
 *  Policy unchanged: only writes studyPrefetcherService.config.maxNumPrefetchRequests.
 *  Decision reason + ring buffer are READ-ONLY diagnostics for Testing Agent.
 * ────────────────────────────────────────────────────────────────────────────
 */

// eslint-disable-next-line
import { cache } from '@cornerstonejs/core';
import {
  decidePrefetchConcurrencyTarget,
  rampPrefetchConcurrency,
  type PrefetchConcDecisionReason,
} from './skmPrefetchConcurrencyMath';

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
  /** Ring buffer size for decision traces. Default 120. */
  decisionLogMax?: number;
};

export type SkmPrefetchConcDecisionRecord = {
  t: number; // performance.now()
  reason: PrefetchConcDecisionReason;
  previous: number;
  current: number;
  target: number;
  effective: number;
  activeTab: boolean;
  idleMs: number | null;
  liveTabs: number;
  stackViewports: number;
  fillPct: number;
  raiseFill: number;
  backoffFill: number;
  min: number;
  base: number;
  max: number;
  multiTab: number;
  poolPrefetchLane: number;
  decodeAheadCap: number | null;
  schedInflight: number | null;
  schedQueue: number | null;
  note: string | null;
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
  const LOG_MAX = Math.max(20, Math.min(500, config.decisionLogMax ?? 120));

  let conc = BASE;
  const decisionLog: SkmPrefetchConcDecisionRecord[] = [];

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
        if (csVp && typeof csVp.getCurrentImageIdIndex === 'function') {
          n++;
        }
      });
      return Math.max(1, n);
    } catch (e) {
      return 1;
    }
  };

  const readScheduler = (): { inflight: number | null; queue: number | null } => {
    try {
      const diag = (sp as any).getSchedulerDiagnostics?.();
      if (!diag) {
        return { inflight: null, queue: null };
      }
      const inflight =
        typeof diag.inflight === 'number'
          ? diag.inflight
          : typeof diag.stats?.inflight === 'number'
            ? diag.stats.inflight
            : null;
      const queue =
        typeof diag.pending === 'number'
          ? diag.pending
          : typeof diag.stats?.queueSize === 'number'
            ? diag.stats.queueSize
            : null;
      return { inflight, queue };
    } catch (e) {
      return { inflight: null, queue: null };
    }
  };

  const decodeAheadCap = (): number | null => {
    try {
      const v = (sp as any).maxConcurrentDecodeAheadRequests;
      return typeof v === 'number' ? v : null;
    } catch (e) {
      return null;
    }
  };

  const idleNote = (
    reason: PrefetchConcDecisionReason,
    stackViewports: number,
    previous: number,
    current: number
  ): string | null => {
    if (reason === 'idle' && stackViewports >= 2 && previous > current) {
      return 'idle_overrides_multi_viewport: activeTab=false forces MIN even with ≥2 stack panes';
    }
    if (reason === 'idle' && stackViewports >= 2) {
      return 'idle_overrides_multi_viewport: activeTab=false; multi_viewport branch not evaluated';
    }
    return null;
  };

  const evalLoop = () => {
    try {
      const b = readBudget();
      const active = b ? !!b.activeTab : true;
      const liveTabs = b ? Math.max(1, b.liveTabs || 1) : 1;
      const stackViewports = countStackViewports();
      const fill = fillFraction();
      const idleMs =
        b && typeof b.idleTimeMs === 'number'
          ? b.idleTimeMs
          : b && typeof b.idleMs === 'number'
            ? b.idleMs
            : null;

      const { target, reason } = decidePrefetchConcurrencyTarget({
        activeTab: active,
        liveTabs,
        stackViewports,
        fill,
        minRequests: MIN,
        baseRequests: BASE,
        maxRequests: MAX,
        multiTabRequests: MULTITAB,
        raiseFill: RAISE_FILL,
        backoffFill: BACKOFF_FILL,
      });

      const previous = conc;
      conc = rampPrefetchConcurrency({
        current: conc,
        target,
        step: STEP,
        minRequests: MIN,
        maxRequests: MAX,
      });

      if ((sp as any).config) {
        (sp as any).config.maxNumPrefetchRequests = conc;
      }

      const aheadCap = decodeAheadCap();
      const effective =
        typeof aheadCap === 'number' ? Math.min(conc, aheadCap) : conc;
      const sched = readScheduler();
      const note = idleNote(reason, stackViewports, previous, conc);

      const snap = {
        current: conc,
        target,
        effective,
        reason,
        previous,
        changed: previous !== conc,
        active,
        idleMs,
        liveTabs,
        stackViewports,
        fillPct: Math.round(fill * 1000) / 10,
        raiseFill: RAISE_FILL,
        backoffFill: BACKOFF_FILL,
        min: MIN,
        base: BASE,
        max: MAX,
        multiTab: MULTITAB,
        poolPrefetchLane,
        decodeAheadCap: aheadCap,
        schedInflight: sched.inflight,
        schedQueue: sched.queue,
        note,
        t: performance.now(),
      };
      (window as any).__skmPrefetchConcurrency = snap;

      const rec: SkmPrefetchConcDecisionRecord = {
        t: snap.t,
        reason,
        previous,
        current: conc,
        target,
        effective,
        activeTab: active,
        idleMs,
        liveTabs,
        stackViewports,
        fillPct: snap.fillPct,
        raiseFill: RAISE_FILL,
        backoffFill: BACKOFF_FILL,
        min: MIN,
        base: BASE,
        max: MAX,
        multiTab: MULTITAB,
        poolPrefetchLane,
        decodeAheadCap: aheadCap,
        schedInflight: sched.inflight,
        schedQueue: sched.queue,
        note,
      };
      decisionLog.push(rec);
      while (decisionLog.length > LOG_MAX) {
        decisionLog.shift();
      }
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

  (window as any).skmPrefetchConcDecisionLog = () => {
    // eslint-disable-next-line no-console
    console.log('[SKM-PREFETCH-CONC] decision log (oldest→newest), n=' + decisionLog.length);
    if (console.table) {
      // eslint-disable-next-line no-console
      console.table(
        decisionLog.map(r => ({
          tMs: Math.round(r.t),
          reason: r.reason,
          prev: r.previous,
          curr: r.current,
          target: r.target,
          effective: r.effective,
          fillPct: r.fillPct,
          active: r.activeTab,
          tabs: r.liveTabs,
          stackVPs: r.stackViewports,
          inflight: r.schedInflight,
          queue: r.schedQueue,
          note: r.note || '',
        }))
      );
    }
    return decisionLog.slice();
  };

  // eslint-disable-next-line no-console
  console.log(
    '[SKM-PREFETCH-CONC] adaptive prefetch concurrency active —',
    `min ${MIN}, base ${BASE}, max ${MAX} (pool lane ${poolPrefetchLane}), multiTab ${MULTITAB}` +
      ` | raiseFill ${RAISE_FILL}, backoffFill ${BACKOFF_FILL}, step ${STEP}/${EVAL_MS}ms` +
      ' | interaction lane untouched | decisions: skmPrefetchConcDecisionLog()'
  );
}

export default initSkmPrefetchConcurrency;
