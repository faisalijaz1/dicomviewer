/**
 * Pure eviction-step decisions. No Cornerstone imports.
 *
 * A reactive pass used to chain requestIdleCallback({timeout:500}) batches. The
 * interaction guard was only the 120ms quiet window, so a batch woken by that
 * timeout (or by a gap between wheel/key events) ran a full removal. One pass
 * then removed thousands of images on the main thread.
 *
 * The hold is the idle-callback timeout plus the quiet window, so a wake inside
 * that gap still defers. Each segment also stops after a removal count or an
 * elapsed removal-time budget and keeps the remaining candidates for a later
 * continuation. Emergency removals (fill at least prefetchPause + margin) are
 * one small batch, then the same hold, and cannot exceed the segment budget.
 * Images from a series that is no longer open are not part of that hold: they
 * keep draining in the same small batches while the current series is scrolling.
 */

export type EvictionStepOutcome =
  | 'run-batch'
  | 'interaction-deferred'
  | 'budget-exhausted'
  | 'completed'
  | 'no-eligible-candidates';

export type InteractionEvictionPlan = {
  removeCap: number;
  /** quiet-wait: setTimeout until input quiet. idle: caller may idle-schedule. */
  next: 'quiet-wait' | 'idle';
};

export function resolveInteractionHoldMs(inputQuietMs: number, idleTimeoutMs: number): number {
  const quiet = Math.max(0, inputQuietMs);
  const idle = Math.max(0, idleTimeoutMs);
  // Longer than the idle-callback timeout. A callback forced by that timeout
  // must still see the guard as active if input happened during the wait.
  return Math.max(quiet, idle + quiet);
}

export function isInteractionHeld(input: {
  now: number;
  lastInputAt: number;
  holdMs: number;
}): boolean {
  if (!(input.holdMs > 0) || !(input.lastInputAt > 0)) {
    return false;
  }
  return input.now - input.lastInputAt < input.holdMs;
}

/** Fill at which an in-progress gesture may remove a small emergency batch. */
export function emergencyFillThreshold(prefetchPauseFill: number, emergencyMargin = 0.05): number {
  const pause = Number.isFinite(prefetchPauseFill)
    ? Math.min(1, Math.max(0, prefetchPauseFill))
    : 1;
  if (!(pause < 1)) {
    return 1;
  }
  const margin = Number.isFinite(emergencyMargin) ? Math.max(0, emergencyMargin) : 0.05;
  return Math.min(0.98, Math.round((pause + margin) * 1000) / 1000);
}

export function planInteractionEvictionBatch(input: {
  interacting: boolean;
  fill: number;
  prefetchPauseFill: number;
  emergencyMargin?: number;
  normalBatchCap: number;
  emergencyBatchCap: number;
}): InteractionEvictionPlan {
  const normal = Math.max(0, Math.floor(input.normalBatchCap));
  const emergencyCap = Math.max(0, Math.floor(input.emergencyBatchCap));
  if (!input.interacting) {
    return { removeCap: normal, next: 'idle' };
  }
  const threshold = emergencyFillThreshold(input.prefetchPauseFill, input.emergencyMargin);
  const fill = Number.isFinite(input.fill) ? input.fill : 0;
  if (!(threshold < 1) || !(fill >= threshold)) {
    return { removeCap: 0, next: 'quiet-wait' };
  }
  return { removeCap: Math.min(normal, emergencyCap), next: 'quiet-wait' };
}

export function planEvictionStep(input: {
  candidatesRemaining: number;
  removedThisPass: number;
  segmentRemoved: number;
  segmentEvictMs: number;
  now: number;
  lastInputAt: number;
  holdMs: number;
  fill: number;
  prefetchPauseFill: number;
  emergencyMargin?: number;
  normalBatchCap: number;
  emergencyBatchCap: number;
  maxRemovalsPerSegment: number;
  maxSegmentEvictMs: number;
  yieldGapMs: number;
  /** Closed-series images at the end of the candidate list. Omitted = 0. */
  orphanCandidatesRemaining?: number;
}): {
  outcome: EvictionStepOutcome;
  removeCap: number;
  waitMs: number;
  emergency: boolean;
  /** When true, the caller may pop only the orphan suffix (closed series). */
  orphanOnly: boolean;
} {
  const remainingCandidates = Math.max(0, Math.floor(input.candidatesRemaining));
  const removedThisPass = Math.max(0, Math.floor(input.removedThisPass));
  if (remainingCandidates <= 0) {
    return {
      outcome: removedThisPass > 0 ? 'completed' : 'no-eligible-candidates',
      removeCap: 0,
      waitMs: 0,
      emergency: false,
      orphanOnly: false,
    };
  }

  const maxRemovals = Math.max(1, Math.floor(input.maxRemovalsPerSegment));
  const maxMs = Math.max(1, input.maxSegmentEvictMs);
  const yieldGap = Math.max(16, Math.floor(input.yieldGapMs));
  const segmentRemoved = Math.max(0, Math.floor(input.segmentRemoved));
  const segmentEvictMs = Math.max(0, input.segmentEvictMs);
  if (segmentRemoved >= maxRemovals || segmentEvictMs >= maxMs) {
    return {
      outcome: 'budget-exhausted',
      removeCap: 0,
      waitMs: yieldGap,
      emergency: false,
      orphanOnly: false,
    };
  }

  const held = isInteractionHeld({
    now: input.now,
    lastInputAt: input.lastInputAt,
    holdMs: input.holdMs,
  });
  const room = maxRemovals - segmentRemoved;
  const normal = Math.max(0, Math.floor(input.normalBatchCap));
  if (!held) {
    return {
      outcome: 'run-batch',
      removeCap: Math.max(0, Math.min(normal, room)),
      waitMs: 0,
      emergency: false,
      orphanOnly: false,
    };
  }

  // A closed series is not the slice on screen. Keep draining it during scroll,
  // still inside the segment budget, and do not pop the current series' window.
  const orphansLeft = Math.max(0, Math.floor(input.orphanCandidatesRemaining ?? 0));
  if (orphansLeft > 0) {
    return {
      outcome: 'run-batch',
      removeCap: Math.max(0, Math.min(normal, room, orphansLeft)),
      waitMs: 0,
      emergency: false,
      orphanOnly: true,
    };
  }

  const emergencyPlan = planInteractionEvictionBatch({
    interacting: true,
    fill: input.fill,
    prefetchPauseFill: input.prefetchPauseFill,
    emergencyMargin: input.emergencyMargin,
    normalBatchCap: normal,
    emergencyBatchCap: input.emergencyBatchCap,
  });
  if (emergencyPlan.removeCap <= 0) {
    const elapsed = input.lastInputAt > 0 ? input.now - input.lastInputAt : 0;
    const remain = Math.max(16, input.holdMs - elapsed);
    return {
      outcome: 'interaction-deferred',
      removeCap: 0,
      waitMs: remain,
      emergency: false,
      orphanOnly: false,
    };
  }
  return {
    outcome: 'run-batch',
    removeCap: Math.max(0, Math.min(emergencyPlan.removeCap, room)),
    waitMs: 0,
    emergency: true,
    orphanOnly: false,
  };
}

/**
 * Pop candidates (end of the array, matching the evictor) and return only IDs
 * that are present and not protected. Protected and absent IDs leave the
 * candidate list so they are not retried forever, but they are not removed
 * from the cache.
 */
export function selectRemovals(input: {
  candidates: string[];
  isProtected: (imageId: string) => boolean;
  isPresent: (imageId: string) => boolean;
  removeCap: number;
  maxExaminations: number;
}): { removed: string[]; examined: number } {
  const removed: string[] = [];
  const cap = Math.max(0, Math.floor(input.removeCap));
  const maxExam = Math.max(0, Math.floor(input.maxExaminations));
  let examined = 0;
  while (removed.length < cap && input.candidates.length && examined < maxExam) {
    const imageId = input.candidates.pop();
    examined++;
    if (!imageId || input.isProtected(imageId) || !input.isPresent(imageId)) {
      continue;
    }
    removed.push(imageId);
  }
  return { removed, examined };
}

export function volumeBlocksStackEviction(
  volumePresent: boolean,
  skipWhenVolumePresent: boolean
): boolean {
  return !!(volumePresent && skipWhenVolumePresent);
}
