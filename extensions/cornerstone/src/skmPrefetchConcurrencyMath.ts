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
  | 'base_policy'
  | 'test_pin';

/**
 * Resolve an office-test fixed prefetch pin against scheduler/worker caps.
 * requested = what the tester asked for
 * configured = value written to maxNumPrefetchRequests (clamped to pool/controller max)
 * effectiveMax = min(configured, decodeAheadCap) — actual scheduler dispatch ceiling
 */
export type FixedPrefetchPinCaps = {
  /** Hard ceiling from imageLoadPoolManager prefetch lane / controller MAX. */
  poolOrControllerMax: number;
  /** StudyPrefetcher maxConcurrentDecodeAheadRequests (workers−1), if set. */
  decodeAheadCap: number | null;
  /** Absolute minimum allowed pin (usually controller MIN). */
  minAllowed?: number;
};

export type FixedPrefetchPinResult = {
  ok: boolean;
  requested: number | null;
  configured: number | null;
  effectiveMax: number | null;
  cappedBelowRequest: boolean;
  error: string | null;
};

export function resolveFixedPrefetchPin(
  requested: number | null | undefined,
  caps: FixedPrefetchPinCaps
): FixedPrefetchPinResult {
  if (requested === null || requested === undefined) {
    return {
      ok: true,
      requested: null,
      configured: null,
      effectiveMax: null,
      cappedBelowRequest: false,
      error: null,
    };
  }
  if (typeof requested !== 'number' || !Number.isFinite(requested)) {
    return {
      ok: false,
      requested: null,
      configured: null,
      effectiveMax: null,
      cappedBelowRequest: false,
      error: 'requested must be a finite number or null',
    };
  }
  const req = Math.floor(requested);
  if (req !== requested) {
    return {
      ok: false,
      requested: null,
      configured: null,
      effectiveMax: null,
      cappedBelowRequest: false,
      error: 'requested must be an integer',
    };
  }
  const minAllowed = Math.max(1, Math.floor(caps.minAllowed ?? 1));
  const poolMax = Math.max(minAllowed, Math.floor(caps.poolOrControllerMax));
  if (req < minAllowed) {
    return {
      ok: false,
      requested: req,
      configured: null,
      effectiveMax: null,
      cappedBelowRequest: false,
      error: `requested ${req} is below minimum allowed ${minAllowed}`,
    };
  }
  const configured = Math.min(req, poolMax);
  const decodeCap =
    typeof caps.decodeAheadCap === 'number' && Number.isFinite(caps.decodeAheadCap)
      ? Math.max(1, Math.floor(caps.decodeAheadCap))
      : null;
  const effectiveMax = decodeCap != null ? Math.min(configured, decodeCap) : configured;
  const cappedBelowRequest = effectiveMax < req || configured < req;
  return {
    ok: true,
    requested: req,
    configured,
    effectiveMax,
    cappedBelowRequest,
    error: null,
  };
}

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

/**
 * One eval-tick decision: when pinRequested is set, hold the pin (test_pin) and do not
 * apply adaptive targets. When cleared, resume normal adaptive decide+ramp.
 */
export type PrefetchConcEvalWithPinInput = {
  pinRequested: number | null;
  pinCaps: FixedPrefetchPinCaps;
  current: number;
  step: number;
  adaptive: PrefetchConcDecisionInput;
};

export type PrefetchConcEvalWithPinResult = {
  reason: PrefetchConcDecisionReason;
  /** Adaptive or pin target before/at apply. */
  target: number;
  /** Value written to maxNumPrefetchRequests. */
  configured: number;
  /** min(configured, decodeAheadCap). */
  effective: number;
  /** Tester-requested pin, or null when adaptive. */
  requested: number | null;
  pinActive: boolean;
  cappedBelowRequest: boolean;
};

export function decidePrefetchConcurrencyEvalWithPin(
  input: PrefetchConcEvalWithPinInput
): PrefetchConcEvalWithPinResult {
  if (input.pinRequested != null) {
    const pin = resolveFixedPrefetchPin(input.pinRequested, input.pinCaps);
    if (pin.ok && pin.configured != null && pin.effectiveMax != null) {
      return {
        reason: 'test_pin',
        target: pin.configured,
        configured: pin.configured,
        effective: pin.effectiveMax,
        requested: pin.requested,
        pinActive: true,
        cappedBelowRequest: pin.cappedBelowRequest,
      };
    }
    // Invalid pin should have been rejected at set-time; fall through to adaptive.
  }
  const { target, reason } = decidePrefetchConcurrencyTarget(input.adaptive);
  const configured = rampPrefetchConcurrency({
    current: input.current,
    target,
    step: input.step,
    minRequests: input.adaptive.minRequests,
    maxRequests: input.adaptive.maxRequests,
  });
  const decodeCap = input.pinCaps.decodeAheadCap;
  const effective =
    typeof decodeCap === 'number' ? Math.min(configured, decodeCap) : configured;
  return {
    reason,
    target,
    configured,
    effective,
    requested: null,
    pinActive: false,
    cappedBelowRequest: false,
  };
}
