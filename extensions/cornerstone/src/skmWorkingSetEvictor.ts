/**
 * ────────────────────────────────────────────────────────────────────────────
 *  SKM-WORKING-SET-EVICTOR 2026-10-04 — Option B correction (Phase 1 failure fix)
 *
 *  WHY
 *  @cornerstonejs/core 4.22.10 does NOT LRU-evict decoded images that belong to the
 *  ACTIVE stack — when a decode would exceed maxCacheSize it THROWS CACHE_SIZE_EXCEEDED
 *  instead of evicting (observed: decode pinned at the cap, evictionsPerMin 0, then the
 *  modal). So a small cap is a hard wall, not a soft bound. This module does the eviction
 *  Cornerstone won't: it keeps only a WORKING WINDOW of decoded slices around the doctor
 *  and purges the rest, so decoded RAM stays ≈ the window (well under the cap → no throw),
 *  and evicted slices re-decode from the browser HTTP cache (trusted cert → transferSize 0)
 *  when the doctor returns.
 *
 *  SAFETY
 *  - STACK viewports only. If ANY MPR / volume (3D / orthographic) viewport is present it
 *    SKIPS entirely (volumes manage their own memory; we never touch them) → MPR,
 *    crosshairs, measurements, synchronisation and hanging protocols are unaffected.
 *  - Never evicts the current slice or its immediate neighbourhood (generous margin).
 *  - Bounded work per tick (maxEvictPerTick) so it can't cause a long task.
 *  - Pure cache.removeImageLoadObject() calls — no stack/imageId/core changes.
 *
 *  REVERSIBILITY
 *  Gated by appConfig.skmActiveEviction.enabled (default on). Off → behaviour is exactly
 *  the pre-fix build (Cornerstone's own non-evicting cap). To remove: delete the
 *  initSkmWorkingSetEvictor() call in init.tsx and this file.
 *
 *  Exposes window.__skmEvictions (count) for skmTelemetry.
 * ────────────────────────────────────────────────────────────────────────────
 */

// eslint-disable-next-line
import { cache, Enums } from '@cornerstonejs/core';
import { subscribeStackNewImage } from './utils/skmStackNewImage';

export type SkmEvictionConfig = {
  enabled?: boolean;
  /**
   * SKM 2026-10-04 (Phase B item 1): BUDGET-BASED working set. When true (default), the
   * number of decoded slices kept around the doctor is computed from the decoded-cache
   * budget (budgetFraction × maxCacheSize ÷ measured avg slice bytes), NOT a fixed window —
   * so the decoded set fills the committed 768 MB budget (adapting to real slice size)
   * without exceeding it, instead of under-using it (~350 MB) and forcing re-decode on fast
   * scroll. Set false to use the fixed keepAhead/keepBehind window.
   */
  budgetBased?: boolean;
  /** Fraction of maxCacheSize the decoded working set may fill. Default 0.9 (headroom below cap). */
  budgetFraction?: number;
  /** Of the budget, fraction allocated AHEAD (scroll direction). Default 0.65. */
  aheadBias?: number;
  /** Fallback avg decoded bytes/slice when the cache can't be measured yet. Default 524288 (~0.5 MB). */
  avgSliceBytesEstimate?: number;
  /** Fixed-window fallback (used when budgetBased is false): slices to KEEP ahead. Default 400. */
  keepAhead?: number;
  /** Fixed-window fallback: slices to KEEP behind. Default 250. */
  keepBehind?: number;
  /** Extra safety margin added on both sides of the keep-window. Default 50. */
  margin?: number;
  /** Max slices to evict per tick (long-task guard). Default 300. */
  maxEvictPerTick?: number;
  /** Throttle (ms) between eviction passes. Default 250. */
  throttleMs?: number;
  /** Skip all eviction when a volume/MPR viewport is present. Default true. */
  skipWhenVolumePresent?: boolean;
};

let evictorInitialized = false;
let evictionCount = 0;
let lastCenter: number | null = null;
let direction = 1;

export function initSkmWorkingSetEvictor(servicesManager: any, config: SkmEvictionConfig): void {
  if (evictorInitialized) {
    return;
  }
  evictorInitialized = true;

  const budgetBased = config?.budgetBased !== false;
  const budgetFraction = Math.min(0.98, Math.max(0.1, config?.budgetFraction ?? 0.9));
  const aheadBias = Math.min(0.9, Math.max(0.1, config?.aheadBias ?? 0.65));
  const avgSliceBytesEstimate = Math.max(1, config?.avgSliceBytesEstimate ?? 524288);
  const keepAhead = Math.max(1, config?.keepAhead ?? 400);
  const keepBehind = Math.max(1, config?.keepBehind ?? 250);
  const margin = Math.max(0, config?.margin ?? 50);
  const maxEvictPerTick = Math.max(1, config?.maxEvictPerTick ?? 300);
  const throttleMs = Math.max(50, config?.throttleMs ?? 250);
  const skipWhenVolumePresent = config?.skipWhenVolumePresent !== false;

  // Measure average decoded bytes/slice from the live cache (adapts to real slice size);
  // fall back to the estimate before anything is decoded.
  const measureAvgSliceBytes = (): number => {
    try {
      const ic = (cache as any)._imageCache;
      const total = (cache as any).getCacheSize?.() || 0;
      if (ic && typeof ic.forEach === 'function' && total > 0) {
        let n = 0;
        ic.forEach((ci: any) => {
          if (ci && ci.sizeInBytes > 0) {
            n++;
          }
        });
        if (n > 0) {
          return total / n;
        }
      }
    } catch (e) {
      /* fall through */
    }
    return avgSliceBytesEstimate;
  };

  // Budget-based per-viewport keep (slices), split ahead/behind by scroll direction. The
  // total across all open stack viewports stays within budgetFraction × cap, so N panes share
  // the budget instead of each demanding a full window.
  const computeKeep = (dir: number, nStack: number): { ahead: number; behind: number } => {
    if (!budgetBased) {
      return {
        ahead: dir >= 0 ? keepAhead : keepBehind,
        behind: dir >= 0 ? keepBehind : keepAhead,
      };
    }
    const capBytes = (cache as any).getMaxCacheSize?.() || 768 * 1048576;
    const avg = measureAvgSliceBytes();
    const totalSlices = Math.max(1, Math.floor((budgetFraction * capBytes) / avg));
    const perViewport = Math.max(1, Math.floor(totalSlices / Math.max(1, nStack)));
    const ahead = Math.max(1, Math.floor(perViewport * aheadBias));
    const behind = Math.max(1, perViewport - ahead);
    // Direction flips the ahead/behind allocation (keep more in the scroll direction).
    return dir >= 0 ? { ahead, behind } : { ahead: behind, behind: ahead };
  };

  let timer: ReturnType<typeof setTimeout> | null = null;

  const isStackViewport = (vp: any): boolean =>
    !!vp &&
    typeof vp.getCurrentImageIdIndex === 'function' &&
    typeof vp.getImageIds === 'function' &&
    vp.type !== Enums.ViewportType.ORTHOGRAPHIC &&
    vp.type !== Enums.ViewportType.VOLUME_3D;

  const anyVolumePresent = (viewports: Map<string, any>, csvs: any): boolean => {
    for (const [viewportId] of viewports) {
      try {
        const vp = csvs.getCornerstoneViewport?.(viewportId);
        if (
          vp &&
          (vp.type === Enums.ViewportType.ORTHOGRAPHIC || vp.type === Enums.ViewportType.VOLUME_3D)
        ) {
          return true;
        }
      } catch (e) {
        /* ignore */
      }
    }
    return false;
  };

  // Union of keep-ranges across all open STACK viewports, keyed by imageId, so a slice
  // kept by ANY viewport is never evicted (safe for side-by-side comparison panes).
  const runEviction = () => {
    try {
      const { viewportGridService, cornerstoneViewportService: csvs } =
        servicesManager.services;
      if (!viewportGridService || !csvs) {
        return;
      }
      const state = viewportGridService.getState();
      const viewports: Map<string, any> = state?.viewports;
      if (!viewports || typeof viewports.forEach !== 'function') {
        return;
      }
      if (skipWhenVolumePresent && anyVolumePresent(viewports, csvs)) {
        return; // MPR/3D session → leave memory to Cornerstone's volume management
      }

      // First pass: collect the open STACK viewports (and update scroll direction) so the
      // budget can be split across them.
      const stackVps: { imageIds: string[]; idx: number }[] = [];
      viewports.forEach((_vpState: any, viewportId: string) => {
        const vp = csvs.getCornerstoneViewport?.(viewportId);
        if (!isStackViewport(vp)) {
          return;
        }
        const imageIds: string[] = vp.getImageIds() || [];
        if (!imageIds.length) {
          return;
        }
        const idx = vp.getCurrentImageIdIndex?.() ?? 0;
        stackVps.push({ imageIds, idx });
      });

      if (!stackVps.length) {
        return;
      }

      // Update direction from the first (active) viewport's centre.
      const activeIdx = stackVps[0].idx;
      if (lastCenter !== null && activeIdx !== lastCenter) {
        direction = activeIdx > lastCenter ? 1 : -1;
      }
      lastCenter = activeIdx;

      // Budget-based keep window (slices), shared across the open stack viewports.
      const { ahead: keepAheadN, behind: keepBehindN } = computeKeep(direction, stackVps.length);

      // Build the union keep-set (a slice kept by ANY viewport is never evicted).
      const keep = new Set<string>();
      let keepLo = Infinity;
      let keepHi = -Infinity;
      for (const { imageIds, idx } of stackVps) {
        const lo = Math.max(0, idx - keepBehindN - margin);
        const hi = Math.min(imageIds.length - 1, idx + keepAheadN + margin);
        keepLo = Math.min(keepLo, lo);
        keepHi = Math.max(keepHi, hi);
        for (let i = lo; i <= hi; i++) {
          if (imageIds[i]) {
            keep.add(imageIds[i]);
          }
        }
      }

      // Evict decoded slices outside the union keep-set, bounded per tick.
      // Instrumentation (your requirement): prove the decoded cache actually falls.
      const sizeBeforeMB = Math.round(((cache as any).getCacheSize?.() || 0) / 1048576);
      let candidates = 0; // decoded + outside keep (eligible)
      let alreadyAbsent = 0; // outside keep but not decoded
      let evicted = 0;
      viewports.forEach((_vpState: any, viewportId: string) => {
        if (evicted >= maxEvictPerTick) {
          return;
        }
        const vp = csvs.getCornerstoneViewport?.(viewportId);
        if (!isStackViewport(vp)) {
          return;
        }
        const imageIds: string[] = vp.getImageIds() || [];
        for (let i = 0; i < imageIds.length && evicted < maxEvictPerTick; i++) {
          const imageId = imageIds[i];
          if (!imageId || keep.has(imageId)) {
            continue;
          }
          // Only purge things actually taking decoded memory.
          let present = false;
          try {
            present = !!(cache as any).getImageLoadObject?.(imageId);
          } catch (e) {
            present = false;
          }
          if (!present) {
            alreadyAbsent++;
            continue;
          }
          candidates++;
          try {
            (cache as any).removeImageLoadObject(imageId);
            evicted++;
          } catch (e) {
            /* image in use / already gone — skip */
          }
        }
      });

      if (evicted > 0) {
        evictionCount += evicted;
        (globalThis as any).__skmEvictions = evictionCount;
      }
      const sizeAfterMB = Math.round(((cache as any).getCacheSize?.() || 0) / 1048576);
      // Publish last-pass detail for inspection (window.__skmEvictorLast) and log when it acted.
      const last = {
        center: lastCenter,
        direction,
        keepAhead: keepAheadN,
        keepBehind: keepBehindN,
        keepLo: keepLo === Infinity ? 0 : keepLo,
        keepHi: keepHi === -Infinity ? 0 : keepHi,
        stackViewports: stackVps.length,
        protectedCount: keep.size,
        candidates,
        removed: evicted,
        alreadyAbsent,
        decodedBeforeMB: sizeBeforeMB,
        decodedAfterMB: sizeAfterMB,
        totalEvicted: evictionCount,
      };
      (globalThis as any).__skmEvictorLast = last;
      if (evicted > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `[SKM-EVICTOR] center=${lastCenter} keep=[${keepLo === Infinity ? 0 : keepLo}..` +
            `${keepHi === -Infinity ? 0 : keepHi}] (${keepBehindN}+${keepAheadN}×${stackVps.length}vp) ` +
            `protected=${keep.size} removed=${evicted} decodedMB ${sizeBeforeMB}→${sizeAfterMB} ` +
            `(total ${evictionCount})`
        );
      }
      // If we hit the per-tick cap there is more to purge → schedule a follow-up pass.
      if (evicted >= maxEvictPerTick) {
        schedule();
      }
    } catch (e) {
      /* best-effort; never break scrolling */
    }
  };

  const schedule = () => {
    if (timer) {
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      runEviction();
    }, throttleMs);
  };

  // Re-evaluate the working set whenever the displayed slice changes, and on grid changes.
  // SKM 2026-10-04 (Phase B): STACK_NEW_IMAGE is a NON-bubbling element CustomEvent
  // (triggerEvent sets no `bubbles`), so neither document nor eventTarget ever received it
  // and the evictor never ran while scrolling (activeEvictionsTotal≈1). Wire it PER ELEMENT
  // via ELEMENT_ENABLED (the pattern skmTelemetry uses successfully).
  subscribeStackNewImage(schedule);
  try {
    const { viewportGridService } = servicesManager.services;
    const E = viewportGridService.EVENTS;
    viewportGridService.subscribe(E.GRID_STATE_CHANGED, schedule);
    viewportGridService.subscribe(E.ACTIVE_VIEWPORT_ID_CHANGED, schedule);
  } catch (e) {
    /* best-effort */
  }

  // eslint-disable-next-line no-console
  console.log(
    budgetBased
      ? `[SKM-EVICTOR] active, BUDGET-BASED: fill ${Math.round(budgetFraction * 100)}% of cap, ` +
          `aheadBias ${aheadBias}, margin ${margin} (keep window sized live from avg slice bytes)`
      : `[SKM-EVICTOR] active, fixed window: keep ${keepBehind}+${keepAhead} (+${margin}) slices`
  );
}
