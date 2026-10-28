/**
 * ────────────────────────────────────────────────────────────────────────────
 *  SKM-PREFETCH-CONCURRENCY 2026-10-09 — adaptive background prefetch concurrency
 *
 *  Policy unchanged: only writes studyPrefetcherService.config.maxNumPrefetchRequests.
 *  Decision reason + ring buffer are READ-ONLY diagnostics for Testing Agent.
 *
 *  Office-test fixed pin (OFF by default):
 *    appConfig.skmPrefetchConcurrency.allowFixedPrefetchConcurrency === true
 *    then: skmSetFixedPrefetchConcurrency(n) / skmResetFixedPrefetchConcurrency()
 *          / skmGetFixedPrefetchConcurrency()
 *  Pin only affects prefetch scheduling; does not change interaction lane, workers,
 *  warmer, cache, eviction, WADO, or adaptive policy defaults.
 * ────────────────────────────────────────────────────────────────────────────
 */

// eslint-disable-next-line
import { cache } from '@cornerstonejs/core';
import {
  decidePrefetchConcurrencyEvalWithPin,
  resolveFixedPrefetchPin,
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
  /**
   * OFFICE-TEST ONLY. Default false.
   * When true, registers skmSet/Reset/GetFixedPrefetchConcurrency so the Testing Agent
   * can pin maxNumPrefetchRequests across adaptive eval ticks. A console call alone cannot
   * enable this — the flag must be true in app-config.
   */
  allowFixedPrefetchConcurrency?: boolean;
};

export type SkmPrefetchConcDecisionRecord = {
  t: number; // performance.now()
  reason: PrefetchConcDecisionReason;
  previous: number;
  current: number;
  target: number;
  /** Tester-requested pin when reason===test_pin; otherwise null. */
  requested: number | null;
  /** Value written to maxNumPrefetchRequests (same as current). */
  configured: number;
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
  const allowFixedPin = config.allowFixedPrefetchConcurrency === true;

  let conc = BASE;
  /** Session pin: raw tester request; null = adaptive. Only honored when allowFixedPin. */
  let fixedPinRequested: number | null = null;
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

  const pinCaps = () => ({
    poolOrControllerMax: MAX,
    decodeAheadCap: decodeAheadCap(),
    minAllowed: MIN,
  });

  const idleNote = (
    reason: PrefetchConcDecisionReason,
    stackViewports: number,
    previous: number,
    current: number
  ): string | null => {
    if (reason === 'test_pin') {
      return null;
    }
    if (reason === 'idle' && stackViewports >= 2 && previous > current) {
      return 'idle_overrides_multi_viewport: activeTab=false forces MIN even with ≥2 stack panes';
    }
    if (reason === 'idle' && stackViewports >= 2) {
      return 'idle_overrides_multi_viewport: activeTab=false; multi_viewport branch not evaluated';
    }
    return null;
  };

  const pinNote = (decision: {
    reason: PrefetchConcDecisionReason;
    requested: number | null;
    configured: number;
    effective: number;
    cappedBelowRequest: boolean;
  }): string | null => {
    if (decision.reason !== 'test_pin') {
      return null;
    }
    if (decision.cappedBelowRequest) {
      return (
        `test_pin: requested=${decision.requested} configured=${decision.configured} ` +
        `effective=${decision.effective} (capped below request by pool/decodeAhead limits)`
      );
    }
    return `test_pin: requested=${decision.requested} configured=${decision.configured} effective=${decision.effective}`;
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

      const aheadCap = decodeAheadCap();
      const decision = decidePrefetchConcurrencyEvalWithPin({
        pinRequested: allowFixedPin ? fixedPinRequested : null,
        pinCaps: {
          poolOrControllerMax: MAX,
          decodeAheadCap: aheadCap,
          minAllowed: MIN,
        },
        current: conc,
        step: STEP,
        adaptive: {
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
        },
      });

      const previous = conc;
      conc = decision.configured;

      if ((sp as any).config) {
        (sp as any).config.maxNumPrefetchRequests = conc;
      }

      const sched = readScheduler();
      const note =
        pinNote(decision) || idleNote(decision.reason, stackViewports, previous, conc);

      const snap = {
        current: conc,
        target: decision.target,
        requested: decision.requested,
        configured: decision.configured,
        effective: decision.effective,
        reason: decision.reason,
        previous,
        changed: previous !== conc,
        pinActive: decision.pinActive,
        adaptiveEnabled: true,
        allowFixedPrefetchConcurrency: allowFixedPin,
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
        reason: decision.reason,
        previous,
        current: conc,
        target: decision.target,
        requested: decision.requested,
        configured: decision.configured,
        effective: decision.effective,
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
          requested: r.requested,
          configured: r.configured,
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

  const snapshotFixedPin = (status: string) => {
    const aheadCap = decodeAheadCap();
    const pin =
      fixedPinRequested != null
        ? resolveFixedPrefetchPin(fixedPinRequested, pinCaps())
        : null;
    const result = {
      status,
      allowFixedPrefetchConcurrency: allowFixedPin,
      adaptiveEnabled: true,
      pinActive: fixedPinRequested != null,
      requested: fixedPinRequested,
      configured: pin?.configured ?? (fixedPinRequested != null ? null : conc),
      effectiveMax: pin?.effectiveMax ?? null,
      current: conc,
      cappedBelowRequest: pin?.cappedBelowRequest ?? false,
      poolOrControllerMax: MAX,
      decodeAheadCap: aheadCap,
      minAllowed: MIN,
      error: null as string | null,
    };
    // eslint-disable-next-line no-console
    console.log('[SKM-PREFETCH-CONC][TEST] fixed prefetch concurrency:', result);
    return result;
  };

  const rejectFixedPin = (status: string, error: string, requested: number | null = null) => {
    const result = {
      status,
      allowFixedPrefetchConcurrency: allowFixedPin,
      adaptiveEnabled: true,
      pinActive: fixedPinRequested != null,
      requested,
      configured: null as number | null,
      effectiveMax: null as number | null,
      current: conc,
      cappedBelowRequest: false,
      poolOrControllerMax: MAX,
      decodeAheadCap: decodeAheadCap(),
      minAllowed: MIN,
      error,
    };
    // eslint-disable-next-line no-console
    console.warn('[SKM-PREFETCH-CONC][TEST]', error);
    // eslint-disable-next-line no-console
    console.log('[SKM-PREFETCH-CONC][TEST] fixed prefetch concurrency:', result);
    return result;
  };

  (window as any).skmSetFixedPrefetchConcurrency = (n: number | null | undefined) => {
    if (!allowFixedPin) {
      return rejectFixedPin(
        'rejected-gate',
        'skmSetFixedPrefetchConcurrency rejected: allowFixedPrefetchConcurrency is false in app-config (office-test gate). Console alone cannot enable this.',
        typeof n === 'number' ? n : null
      );
    }
    if (n === null || n === undefined) {
      fixedPinRequested = null;
      evalLoop();
      return snapshotFixedPin('reset');
    }
    const resolved = resolveFixedPrefetchPin(n, pinCaps());
    if (!resolved.ok) {
      return rejectFixedPin(
        'rejected-invalid',
        resolved.error || 'invalid pin request',
        typeof n === 'number' ? Math.floor(n) : null
      );
    }
    fixedPinRequested = resolved.requested;
    evalLoop();
    const snap = snapshotFixedPin(resolved.cappedBelowRequest ? 'set-capped' : 'set');
    if (resolved.cappedBelowRequest) {
      // eslint-disable-next-line no-console
      console.warn(
        '[SKM-PREFETCH-CONC][TEST] requested',
        resolved.requested,
        'exceeds supported effective max',
        resolved.effectiveMax,
        '(configured=',
        resolved.configured,
        '). Pin held at configured; requested and effective remain distinguishable.'
      );
    }
    return snap;
  };

  (window as any).skmResetFixedPrefetchConcurrency = () => {
    if (!allowFixedPin) {
      return rejectFixedPin(
        'rejected-gate',
        'skmResetFixedPrefetchConcurrency rejected: allowFixedPrefetchConcurrency is false in app-config.'
      );
    }
    fixedPinRequested = null;
    evalLoop();
    return snapshotFixedPin('reset');
  };

  (window as any).skmGetFixedPrefetchConcurrency = () => {
    if (!allowFixedPin) {
      return rejectFixedPin(
        'gate-off',
        'allowFixedPrefetchConcurrency is false; pin APIs are inactive. Adaptive controller is running; production policy unchanged.'
      );
    }
    return snapshotFixedPin(fixedPinRequested != null ? 'active' : 'inactive');
  };

  // eslint-disable-next-line no-console
  console.log(
    '[SKM-PREFETCH-CONC] adaptive prefetch concurrency active —',
    `min ${MIN}, base ${BASE}, max ${MAX} (pool lane ${poolPrefetchLane}), multiTab ${MULTITAB}` +
      ` | raiseFill ${RAISE_FILL}, backoffFill ${BACKOFF_FILL}, step ${STEP}/${EVAL_MS}ms` +
      ' | interaction lane untouched | decisions: skmPrefetchConcDecisionLog()' +
      (allowFixedPin
        ? ' | OFFICE-TEST pin: skmSetFixedPrefetchConcurrency(n) / skmResetFixedPrefetchConcurrency() / skmGetFixedPrefetchConcurrency()'
        : ' | fixed pin gate OFF (allowFixedPrefetchConcurrency:false)')
  );
}

export default initSkmPrefetchConcurrency;
