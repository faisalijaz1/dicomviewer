/**
 * Pure decision for one eviction batch while the user may be scrolling.
 * No Cornerstone imports.
 *
 * Interacting + fill below the emergency line → remove nothing, and wait out the
 * quiet interval with setTimeout. requestIdleCallback's timeout must not be used
 * for that wait, or it can run removals during a busy scroll.
 *
 * Emergency removals are allowed only above prefetchPauseFill + margin. The
 * prefetcher already refuses new loads at prefetchPauseFill, and one small batch
 * cannot drop fill back through that pause, so those removals are not refilled
 * in a loop. Below the pause, continuous scrolling only defers; prefetch's own
 * high-water is what bounds decoded growth.
 */

export type InteractionEvictionPlan = {
  removeCap: number;
  /** quiet-wait: setTimeout until input quiet. idle: requestIdleCallback between batches. */
  next: 'quiet-wait' | 'idle';
};

export function planInteractionEvictionBatch(input: {
  interacting: boolean;
  fill: number;
  /** Fill at which StudyPrefetcher stops issuing loads. 1 = it does not pause. */
  prefetchPauseFill: number;
  /** Added above the pause before any removal is allowed during interaction. */
  emergencyMargin?: number;
  normalBatchCap: number;
  emergencyBatchCap: number;
}): InteractionEvictionPlan {
  const normal = Math.max(0, Math.floor(input.normalBatchCap));
  const emergencyCap = Math.max(0, Math.floor(input.emergencyBatchCap));
  if (!input.interacting) {
    return { removeCap: normal, next: 'idle' };
  }

  const pause = Number.isFinite(input.prefetchPauseFill)
    ? Math.min(1, Math.max(0, input.prefetchPauseFill))
    : 1;
  // Prefetch never pauses → do not evict open-series images during interaction.
  if (!(pause < 1)) {
    return { removeCap: 0, next: 'quiet-wait' };
  }

  const margin = Number.isFinite(input.emergencyMargin) ? (input.emergencyMargin as number) : 0.05;
  // Round so 0.90 + 0.05 is 0.95, not 0.9500000000000001.
  const emergencyFill = Math.min(0.98, Math.round((pause + Math.max(0, margin)) * 1000) / 1000);
  const fill = Number.isFinite(input.fill) ? input.fill : 0;
  if (!(fill >= emergencyFill)) {
    return { removeCap: 0, next: 'quiet-wait' };
  }

  return {
    removeCap: Math.min(normal, emergencyCap),
    next: 'quiet-wait',
  };
}
