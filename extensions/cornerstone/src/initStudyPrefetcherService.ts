import { cache, imageLoadPoolManager, imageLoader, Enums, eventTarget, EVENTS as csEvents } from '@cornerstonejs/core';
import { subscribeStackNewImage } from './utils/skmStackNewImage';

function initStudyPrefetcherService(servicesManager: AppTypes.ServicesManager) {
  const { studyPrefetcherService } = servicesManager.services;

  studyPrefetcherService.requestType = Enums.RequestType.Prefetch;
  studyPrefetcherService.imageLoadPoolManager = imageLoadPoolManager;
  studyPrefetcherService.imageLoader = imageLoader;

  studyPrefetcherService.cache = {
    isImageCached(imageId: string): boolean {
      return !!cache.getImageLoadObject(imageId);
    },
    // SKM 2026-10-03 (W2): current decoded-cache fill fraction (0..1), so the
    // prefetcher can PAUSE before the cache overflows instead of flooding it and
    // triggering Cornerstone's CACHE_SIZE_EXCEEDED. Best-effort: returns 0 if the
    // cache API shape differs (→ prefetcher behaves exactly as before).
    getFillFraction(): number {
      try {
        const max = (cache as any).getMaxCacheSize?.() || 0;
        const cur = (cache as any).getCacheSize?.() || 0;
        return max > 0 ? cur / max : 0;
      } catch (e) {
        return 0;
      }
    },
  }

  studyPrefetcherService.imageLoadEventsManager = {
    addEventListeners(onImageLoaded, onImageLoadFailed) {
      eventTarget.addEventListener(csEvents.IMAGE_LOADED, onImageLoaded);
      eventTarget.addEventListener(csEvents.IMAGE_LOAD_FAILED, onImageLoadFailed);

      // SKM 2026-10-04 (Phase B): re-centre the prefetch window the INSTANT the displayed
      // slice changes (scroll or far jump), instead of waiting for an IMAGE_LOADED completion.
      // STACK_NEW_IMAGE is a NON-bubbling element event, so document/eventTarget listeners
      // never fired; wire it PER ELEMENT via ELEMENT_ENABLED. onActiveSliceChanged is a cheap
      // no-op unless windowedPrefetch is on, and it internally throttles / far-jump-cancels.
      const onStackNewImage = () => {
        try {
          studyPrefetcherService.onActiveSliceChanged?.();
        } catch (e) {
          /* best-effort */
        }
      };
      const unsubscribeStackNewImage = subscribeStackNewImage(onStackNewImage);

      return [
        {
          unsubscribe: () => eventTarget.removeEventListener(csEvents.IMAGE_LOADED, onImageLoaded)
        },
        {
          unsubscribe: () => eventTarget.removeEventListener(csEvents.IMAGE_LOAD_FAILED, onImageLoadFailed)
        },
        {
          unsubscribe: () => {
            try {
              unsubscribeStackNewImage();
            } catch (e) {
              /* noop */
            }
          }
        },
      ]
    }
  }

  // SKM 2026-10-09 (Phase 0 diagnostics — READ-ONLY): console reporter proving the
  // two-viewport scheduler-center / far-jump / cancel behaviour. Changes NO behaviour.
  //   skmSchedulerReport()  → per-viewport indices + recent far-jumps (center before/after,
  //                           delta, requests cancelled) + duplicate-request stats.
  //   window.__skmSchedulerLog → raw ring buffer of events.
  try {
    (window as any).skmSchedulerReport = () => {
      const diag = (studyPrefetcherService as any).getSchedulerDiagnostics?.();
      if (!diag) {
        // eslint-disable-next-line no-console
        console.log('[SKM-SCHED] diagnostics unavailable');
        return null;
      }
      /* eslint-disable no-console */
      console.log('[SKM-SCHED] stats', diag.stats);
      console.log('[SKM-SCHED] activeDisplaySetUIDs', diag.activeDisplaySetUIDs, 'lastCenter', diag.lastCenter, 'pending', diag.pending, 'inflight', diag.inflight);
      if (console.table) {
        console.table(diag.perViewport);
        console.table(
          (diag.recentEvents || []).map((e: any) => ({
            type: e.type,
            activeViewportId: e.activeViewportId,
            centerBefore: e.centerBefore,
            centerAfter: e.centerAfter,
            delta: e.delta,
            willCancel: e.willCancel,
            viewports: (e.perViewport || []).map((v: any) => `${v.viewportId}:${v.idx}${v.active ? '*' : ''}`).join(' | '),
          }))
        );
      } else {
        console.log('[SKM-SCHED] perViewport', diag.perViewport);
        console.log('[SKM-SCHED] recentEvents', diag.recentEvents);
      }
      /* eslint-enable no-console */
      return diag;
    };
  } catch (e) {
    /* best-effort */
  }
}

export default initStudyPrefetcherService;
