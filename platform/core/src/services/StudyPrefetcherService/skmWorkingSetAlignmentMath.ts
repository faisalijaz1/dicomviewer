/**
 * One working-set divisor for prefetch and eviction.
 *
 * The governor writes a tab-level ahead/behind window. The evictor splits that
 * class of budget by every open stack viewport. The prefetcher used to divide
 * only by panes showing the same series, so two different series each prefetched
 * the full window while each keep window was half of it.
 *
 * Divisor is the larger of "panes of this series" and "open stack viewports".
 * Same series in both panes is unchanged (both counts are 2). Two series become
 * 2 as well. This is not a second clamp: the keep-window clamp stays off.
 */

export function alignedPrefetchWindow(input: {
  configuredAhead: number;
  configuredBehind: number;
  panesShowingThisSeries: number;
  openStackViewports: number;
  immediateRadius: number;
}): { ahead: number; behind: number; divisor: number } {
  const panes = Math.max(1, Math.floor(input.panesShowingThisSeries) || 1);
  const openStacks = Math.max(1, Math.floor(input.openStackViewports) || 1);
  const divisor = Math.max(panes, openStacks);
  const immediate = Math.max(0, Math.floor(input.immediateRadius) || 0);
  const floor = immediate + 1;
  const ahead = Math.max(floor, Math.floor((Number(input.configuredAhead) || 0) / divisor));
  const behind = Math.max(floor, Math.floor((Number(input.configuredBehind) || 0) / divisor));
  return { ahead, behind, divisor };
}

/** Slices the evictor keeps per open stack viewport before the safety margin. */
export function perViewportKeepSlices(totalKeepSlices: number, openStackViewports: number): number {
  const n = Math.max(1, Math.floor(openStackViewports) || 1);
  return Math.max(1, Math.floor((Number(totalKeepSlices) || 0) / n));
}
