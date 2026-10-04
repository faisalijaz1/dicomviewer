import { cache, imageLoadPoolManager, imageLoader, Enums, eventTarget, EVENTS as csEvents } from '@cornerstonejs/core';

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

      // SKM 2026-10-04 (Option B): re-centre the prefetch window the INSTANT the
      // displayed slice changes (scroll or far jump), instead of waiting for an
      // IMAGE_LOADED completion. onActiveSliceChanged is a cheap no-op unless
      // windowedPrefetch is on, and it internally throttles / far-jump-cancels.
      // SKM 2026-10-04 (fix): STACK_NEW_IMAGE is a DOM event on the viewport ELEMENT that
      // bubbles to `document` — it is NOT dispatched on Cornerstone's `eventTarget`. The
      // previous eventTarget listener never fired (re-centring fell back to the sparser
      // IMAGE_LOADED path). Listen on `document` so scroll/jump re-centres immediately.
      const onStackNewImage = () => {
        try {
          studyPrefetcherService.onActiveSliceChanged?.();
        } catch (e) {
          /* best-effort */
        }
      };
      let stackNewImageName: string | undefined;
      try {
        stackNewImageName = (csEvents as any).STACK_NEW_IMAGE || 'CORNERSTONE_STACK_NEW_IMAGE';
        document.addEventListener(stackNewImageName, onStackNewImage);
      } catch (e) {
        /* older core: fall back to IMAGE_LOADED-driven re-centring only */
      }

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
              if (stackNewImageName) {
                document.removeEventListener(stackNewImageName, onStackNewImage);
              }
            } catch (e) {
              /* noop */
            }
          }
        },
      ]
    }
  }
}

export default initStudyPrefetcherService;
