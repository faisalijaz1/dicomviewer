/**
 * Pure adaptive-prefetch decision helpers (no Cornerstone imports).
 * Mirrors skmPrefetchConcurrency.ts evalLoop branch order exactly.
 */

export type PrefetchConcDecisionReason =
  | 'idle'
  | 'multi_tab'
  | 'multi_viewport'
  | 'raise_fill'
  | 'backoff_fill'
  | 'base_policy';

export type PrefetchConcDecisionInput = {
  activeTab: boolean;
  liveTabs: number;
  stackViewports: number;
  fill: number;
  minRequests: number;
  baseRequests: number;
  maxRequests: number;
  multiTabRequests: number;
  raiseFill: number;
  backoffFill: number;
};

export type PrefetchConcDecision = {
  target: number;
  reason: PrefetchConcDecisionReason;
};

/**
 * Same priority as evalLoop in skmPrefetchConcurrency.ts:
 * idle → multi_tab → multi_viewport → raise_fill → backoff_fill → base_policy
 */
export function decidePrefetchConcurrencyTarget(
  input: PrefetchConcDecisionInput
): PrefetchConcDecision {
  const MIN = Math.max(1, Math.floor(input.minRequests));
  const BASE = Math.max(MIN, Math.floor(input.baseRequests));
  const MAX = Math.max(BASE, Math.floor(input.maxRequests));
  const MULTITAB = Math.min(MAX, Math.max(MIN, Math.floor(input.multiTabRequests)));
  const RAISE = input.raiseFill;
  const BACKOFF = input.backoffFill;
  const fill = input.fill;
  const liveTabs = Math.max(1, Math.floor(input.liveTabs || 1));
  const stackViewports = Math.max(1, Math.floor(input.stackViewports || 1));

  if (!input.activeTab) {
    return { target: MIN, reason: 'idle' };
  }
  if (liveTabs >= 2) {
    return { target: MULTITAB, reason: 'multi_tab' };
  }
  if (stackViewports >= 2) {
    return { target: MULTITAB, reason: 'multi_viewport' };
  }
  if (fill < RAISE) {
    return { target: MAX, reason: 'raise_fill' };
  }
  if (fill >= BACKOFF) {
    return { target: MIN, reason: 'backoff_fill' };
  }
  return { target: BASE, reason: 'base_policy' };
}

export type PrefetchConcRampInput = {
  current: number;
  target: number;
  step: number;
  minRequests: number;
  maxRequests: number;
};

/** ±step ramp toward target, then clamp to [min,max] — same as evalLoop. */
export function rampPrefetchConcurrency(input: PrefetchConcRampInput): number {
  const MIN = Math.max(1, Math.floor(input.minRequests));
  const MAX = Math.max(MIN, Math.floor(input.maxRequests));
  const STEP = Math.max(1, Math.floor(input.step));
  let conc = input.current;
  const target = input.target;
  if (conc < target) {
    conc = Math.min(target, conc + STEP);
  } else if (conc > target) {
    conc = Math.max(target, conc - STEP);
  }
  return Math.max(MIN, Math.min(MAX, conc));
}
