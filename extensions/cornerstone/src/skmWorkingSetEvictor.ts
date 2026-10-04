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

export type SkmEvictionConfig = {
  enabled?: boolean;
  /** Decoded slices to KEEP ahead of the doctor (scroll direction). Default 400. */
  keepAhead?: number;
  /** Decoded slices to KEEP behind the doctor. Default 250. */
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

  const keepAhead = Math.max(1, config?.keepAhead ?? 400);
  const keepBehind = Math.max(1, config?.keepBehind ?? 250);
  const margin = Math.max(0, config?.margin ?? 50);
  const maxEvictPerTick = Math.max(1, config?.maxEvictPerTick ?? 300);
  const throttleMs = Math.max(50, config?.throttleMs ?? 250);
  const skipWhenVolumePresent = config?.skipWhenVolumePresent !== false;

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

      // Build the set of imageIds to KEEP (window around each stack viewport's current index).
      const keep = new Set<string>();
      let sawStack = false;
      viewports.forEach((_vpState: any, viewportId: string) => {
        const vp = csvs.getCornerstoneViewport?.(viewportId);
        if (!isStackViewport(vp)) {
          return;
        }
        sawStack = true;
        const imageIds: string[] = vp.getImageIds() || [];
        if (!imageIds.length) {
          return;
        }
        const idx = vp.getCurrentImageIdIndex?.() ?? 0;
        if (lastCenter !== null && idx !== lastCenter) {
          direction = idx > lastCenter ? 1 : -1;
        }
        lastCenter = idx;
        const ahead = direction >= 0 ? keepAhead : keepBehind;
        const behind = direction >= 0 ? keepBehind : keepAhead;
        const lo = Math.max(0, idx - behind - margin);
        const hi = Math.min(imageIds.length - 1, idx + ahead + margin);
        for (let i = lo; i <= hi; i++) {
          if (imageIds[i]) {
            keep.add(imageIds[i]);
          }
        }
      });

      if (!sawStack) {
        return;
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
          `[SKM-EVICTOR] center=${lastCenter} protected=${keep.size} removed=${evicted} ` +
            `absent=${alreadyAbsent} decodedMB ${sizeBeforeMB}→${sizeAfterMB} (total ${evictionCount})`
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
  // SKM 2026-10-04 (fix): STACK_NEW_IMAGE is a DOM CustomEvent dispatched on the viewport
  // ELEMENT and bubbles to `document` — it is NOT dispatched on Cornerstone's `eventTarget`
  // singleton. The previous eventTarget listener never fired, so the evictor never ran while
  // scrolling (activeEvictionsTotal≈1). Listen on `document` (same pattern as init.tsx).
  try {
    const stackNewImageName =
      (Enums.Events as any).STACK_NEW_IMAGE || 'CORNERSTONE_STACK_NEW_IMAGE';
    document.addEventListener(stackNewImageName, schedule);
  } catch (e) {
    /* older core: grid events still drive it */
  }
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
    `[SKM-EVICTOR] active working-set eviction on: keep ${keepBehind}+${keepAhead} (+${margin}) slices`
  );
}
