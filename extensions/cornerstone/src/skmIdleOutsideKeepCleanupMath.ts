/**
 * SKM idle outside-keep cleanup — pure gating helpers (no Cornerstone imports).
 * When fill is below the reactive high-water, windowed eviction may still scan
 * for outside-keep candidates ONLY if enabled and input has been quiet long enough.
 * Default-off: callers must pass enabled === true.
 */

export type IdleOutsideKeepScanGateInput = {
  /** Master feature flag; must be true to allow idle windowed scan. */
  enabled: boolean;
  /** True when fill >= effective reactive high-water (normal pressure path). */
  underPressure: boolean;
  /** ms since last STACK_NEW_IMAGE / navigation input. */
  msSinceLastInput: number;
  /** Required quiet period before idle outside-keep reclaim. */
  idleOutsideKeepQuietMs: number;
};

export type IdleOutsideKeepScanGateResult = {
  /**
   * When true and !underPressure, caller may run the same outside-keep scan
   * used under pressure. Under pressure this is always false (pressure path owns scan).
   */
  mayScanIdleWindowed: boolean;
  /** Diagnostics: why idle scan was allowed or denied. */
  idleGateReason: string;
};

/**
 * Pre-scan gate: may we collect windowed (outside-keep) candidates while below
 * the reactive fill threshold? Does not itself prove candidates exist — the
 * existing keep/in-flight/present scan does that; empty result means stop.
 */
export function evaluateIdleOutsideKeepScanGate(
  input: IdleOutsideKeepScanGateInput
): IdleOutsideKeepScanGateResult {
  if (input.underPressure) {
    return {
      mayScanIdleWindowed: false,
      idleGateReason: 'n/a-under-pressure-uses-reactive-windowed-path',
    };
  }
  if (input.enabled !== true) {
    return {
      mayScanIdleWindowed: false,
      idleGateReason: 'idle-outside-keep-cleanup-disabled',
    };
  }
  const quietMs = Math.max(0, Math.floor(input.idleOutsideKeepQuietMs));
  const since = Math.max(0, input.msSinceLastInput);
  if (since < quietMs) {
    return {
      mayScanIdleWindowed: false,
      idleGateReason: `idle-outside-keep-quiet-not-met(${Math.round(since)}ms<${quietMs}ms)`,
    };
  }
  return {
    mayScanIdleWindowed: true,
    idleGateReason: 'idle-outside-keep-scan-allowed',
  };
}

/** Whether to run the outside-keep decoded-image scan this pass. */
export function shouldCollectWindowedCandidates(
  underPressure: boolean,
  idleScan: IdleOutsideKeepScanGateResult
): boolean {
  return underPressure === true || idleScan.mayScanIdleWindowed === true;
}

/**
 * Path reason after the scan (and orphan check) for diagnostics.
 * Prefer idle-outside-keep-cleanup when idle path queued work.
 */
export function resolveWindowedPathReason(input: {
  underPressure: boolean;
  idleScan: IdleOutsideKeepScanGateResult;
  windowedCount: number;
  orphanCount: number;
  fillPct: number;
  effectiveReactiveHighWater: number;
}): string {
  if (input.windowedCount > 0) {
    if (!input.underPressure && input.idleScan.mayScanIdleWindowed) {
      return 'idle-outside-keep-cleanup';
    }
    return 'windowed-eviction-queued';
  }
  if (input.orphanCount > 0) {
    return input.underPressure
      ? 'orphan-eviction-queued'
      : 'orphan-eviction-queued-below-reactive-gate';
  }
  if (!input.underPressure) {
    if (input.idleScan.mayScanIdleWindowed) {
      return 'idle-outside-keep-no-eligible-candidates';
    }
    // When the idle feature is disabled, keep the classic reactive-skip string so
    // default-off behaviour/diagnostics match the pre-feature build.
    if (input.idleScan.idleGateReason === 'idle-outside-keep-cleanup-disabled') {
      return `skipped-below-effective-reactive-high-water(fill=${input.fillPct}%<${Math.round(input.effectiveReactiveHighWater * 100)}%)`;
    }
    // Quiet-not-met (feature on but scrolling recently): expose idle gate reason.
    return input.idleScan.idleGateReason;
  }
  return 'under-pressure-but-no-candidates-outside-keep';
}

/**
 * Batch size for this pass: smaller cap for idle cleanup; normal cap under pressure.
 */
export function resolveEvictBatchCap(input: {
  underPressure: boolean;
  idleOutsideKeepCleanupActive: boolean;
  maxEvictPerTick: number;
  maxIdleEvictPerTick: number;
}): number {
  const normal = Math.max(1, Math.floor(input.maxEvictPerTick));
  const idle = Math.max(1, Math.floor(input.maxIdleEvictPerTick));
  if (!input.underPressure && input.idleOutsideKeepCleanupActive) {
    return idle;
  }
  return normal;
}

/** True when this pass is an idle outside-keep cleanup drain (not reactive pressure). */
export function isIdleOutsideKeepCleanupActive(
  underPressure: boolean,
  idleScan: IdleOutsideKeepScanGateResult,
  windowedCount: number
): boolean {
  return (
    !underPressure && idleScan.mayScanIdleWindowed === true && windowedCount > 0
  );
}
