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
    // SKM 2026-10-09 (QA fix — Priority 2 round 6): whether Cornerstone's own tracked
    // load object for this imageId has a real cancelFn. Traced against the actual
    // @cornerstonejs/dicom-image-loader@4.22.10 source: the wadouri/wadors loaders
    // construct their imageLoadObject with `cancelFn: undefined` and never assign it,
    // so imageLoader.cancelLoadImages() unconditionally throws "cancelFn is not a
    // function" for a WADO image still in cache (@cornerstonejs/core's own
    // cancelLoadImage() calls `.cancelFn()` with no guard). Mirrors the SAME guard
    // Cornerstone's own internal cache eviction uses (cache.js removeImageLoadObject:
    // `imageLoadObject?.cancelFn`) before this service ever calls the public API.
    isCancellable(imageId: string): boolean {
      try {
        const loadObject = (cache as any).getImageLoadObject?.(imageId);
        return typeof loadObject?.cancelFn === 'function';
      } catch (e) {
        return false;
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

  // SKM 2026-10-09 (QA fix — Priority 2 round 4): console reporter for the
  // imageLoader.cancelLoadImages() cancellation path added to StudyPrefetcherService's
  // _stopPrefetching()/_cancelPendingPrefetch(). Proves the cancellation CALL happened
  // and what it was given (stale pending/in-flight counts, imageIds handed to
  // cancelLoadImages, old/new series identity) — it does NOT by itself prove old-series
  // network traffic stopped; that still needs a network-level
  // (performance.getEntriesByType) check correlated against this report's timestamps.
  try {
    (window as any).skmPrefetchCancelReport = () => {
      const diag = (studyPrefetcherService as any).getPrefetchCancelDiagnostics?.();
      if (!diag) {
        // eslint-disable-next-line no-console
        console.log('[SKM-PREFETCH-CANCEL] diagnostics unavailable');
        return null;
      }
      // eslint-disable-next-line no-console
      console.log('[SKM-PREFETCH-CANCEL]', diag);
      return diag;
    };
  } catch (e) {
    /* best-effort */
  }

  // SKM 2026-10-09 (QA fix — Priority 2 round 7): console reporter for the new
  // synchronous switch-signal path (onViewportDisplaySetWillChange), added to close
  // the ~6.9s gap proven in round 7's investigation between a series switch and
  // _stopPrefetching() actually running (the deferred GRID_STATE_CHANGED
  // setTimeout(0) getting starved by the old series' own completion-callback loop).
  // lastStopPrefetchingAt - lastSyncAt (when lastSyncSource is 'synchronous') is the
  // key number to compare against the old ~6.9s figure. deferredRestartCount staying
  // flat immediately after a synchronous restart is the proof there is no duplicate.
  try {
    (window as any).skmSyncReport = () => {
      const diag = (studyPrefetcherService as any).getSyncDiagnostics?.();
      if (!diag) {
        // eslint-disable-next-line no-console
        console.log('[SKM-SYNC] diagnostics unavailable');
        return null;
      }
      // eslint-disable-next-line no-console
      console.log('[SKM-SYNC]', diag);
      return diag;
    };
  } catch (e) {
    /* best-effort */
  }
}

export default initStudyPrefetcherService;
