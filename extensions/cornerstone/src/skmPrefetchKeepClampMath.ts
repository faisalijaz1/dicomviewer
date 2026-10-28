/**
 * SKM Experiment C — pure clamp math (no Cornerstone imports).
 * Prefetch windows must never exceed the effective keep window; navigation lead
 * is a minimum inside that budget, optionally boosted by scroll velocity.
 */

export type PrefetchKeepClampInput = {
  keepAhead: number;
  keepBehind: number;
  governorAhead: number;
  governorBehind: number;
  navigationLeadSlices: number;
  /** Scroll direction: >=0 forward (boost ahead), <0 reverse (boost behind). */
  direction: number;
  /** Slices/second EMA; 0 if unknown. */
  velocitySlicesPerSec: number;
  /** Look-ahead time used to turn velocity into extra lead slices. */
  velocityLookAheadMs: number;
  /** Hard cap on velocity-boosted lead (still ≤ keep). */
  maxVelocityLeadSlices: number;
};

export type PrefetchKeepClampResult = {
  clampedAhead: number;
  clampedBehind: number;
  baseLead: number;
  adaptedLeadForward: number;
  adaptedLeadBehind: number;
  grantedLeadForward: number;
  grantedLeadBehind: number;
  leadCappedToKeep: boolean;
  requestedLeadForward: number;
  requestedLeadBehind: number;
};

export function computePrefetchKeepClamp(input: PrefetchKeepClampInput): PrefetchKeepClampResult {
  const keepAhead = Math.max(1, Math.floor(input.keepAhead));
  const keepBehind = Math.max(1, Math.floor(input.keepBehind));
  const govAhead = Math.max(1, Math.floor(input.governorAhead));
  const govBehind = Math.max(1, Math.floor(input.governorBehind));
  const baseLead = Math.max(1, Math.floor(input.navigationLeadSlices));
  const lookAheadSec = Math.max(0, input.velocityLookAheadMs) / 1000;
  const vel = Math.max(0, input.velocitySlicesPerSec);
  const maxVelLead = Math.max(baseLead, Math.floor(input.maxVelocityLeadSlices));
  const velocityExtra = Math.min(maxVelLead, Math.ceil(vel * lookAheadSec));

  // Directional boost: navigation direction gets velocity-adapted lead; reverse side
  // keeps the base lead (still ≤ keep) so a sudden reversal is not empty.
  const requestedForward = Math.max(baseLead, velocityExtra);
  const requestedBehind = baseLead;
  const forwardIsAhead = input.direction >= 0;
  const requestedLeadForward = forwardIsAhead ? requestedForward : requestedBehind;
  const requestedLeadBehind = forwardIsAhead ? requestedBehind : requestedForward;

  const grantedLeadForward = Math.min(keepAhead, requestedLeadForward);
  const grantedLeadBehind = Math.min(keepBehind, requestedLeadBehind);
  const leadCappedToKeep =
    requestedLeadForward > keepAhead || requestedLeadBehind > keepBehind;

  // Hard rule: never exceed keep. Prefer granted lead over a larger governor window.
  const clampedAhead = Math.min(keepAhead, Math.max(grantedLeadForward, Math.min(govAhead, keepAhead)));
  const clampedBehind = Math.min(
    keepBehind,
    Math.max(grantedLeadBehind, Math.min(govBehind, keepBehind))
  );

  return {
    clampedAhead,
    clampedBehind,
    baseLead,
    adaptedLeadForward: requestedLeadForward,
    adaptedLeadBehind: requestedLeadBehind,
    grantedLeadForward,
    grantedLeadBehind,
    leadCappedToKeep,
    requestedLeadForward,
    requestedLeadBehind,
  };
}
