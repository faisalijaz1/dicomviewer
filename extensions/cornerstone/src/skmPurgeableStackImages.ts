/**
 * ────────────────────────────────────────────────────────────────────────────
 *  SKM-PURGEABLE-STACK-IMAGES 2026-10-04 — Phase A (the real Cornerstone fix)
 *
 *  WHY
 *  The WADO-URI loader stamps `image.sharedCacheKey = <dataset URL>` on EVERY image
 *  (dicom-image-loader 4.22.10, wadouri/loadImage.js line 31). In @cornerstonejs/core
 *  4.22.10, ANY cached image that has a sharedCacheKey is treated as NON-purgeable:
 *    - cache.isCacheable() counts only non-shared-key images as free-able,
 *    - decacheIfNecessaryUntilBytesAvailable() (the native LRU) skips shared-key images,
 *    - _decacheImage() THROWS on a shared-key image.
 *  So with WADO-URI, the whole decoded cache is non-purgeable → a cap smaller than the
 *  study can never evict → CACHE_SIZE_EXCEEDED (the exact failure we measured). The
 *  default cap is 3 GB, which hides this; our 768 MB cap exposed it.
 *
 *  WHAT THIS DOES
 *  Registers a thin wrapper around the stock `wadouri` image loader (the official
 *  imageLoader.registerImageLoader extension point — NOT a core modification) that calls
 *  the stock loader unchanged and clears `image.sharedCacheKey` on the resolved image,
 *  BEFORE it is placed in the cache. The image then becomes purgeable and Cornerstone's
 *  OWN native LRU evicts it at the cap → bounded decoded RAM, no CACHE_SIZE_EXCEEDED.
 *
 *  WHY IT IS SAFE (verified against installed 4.22.10 source)
 *   - sharedCacheKey is NOT read anywhere in core/tools/dicom-image-loader to share or
 *     dedupe decoded data; its only live effect is eviction control. Clearing it only
 *     makes the image evictable.
 *   - Multi-frame dataset sharing is handled by dataSetCacheManager (keyed by URL),
 *     independent of sharedCacheKey — unaffected.
 *   - MPR/3D: when a volume is built, cache._putVolumeCommon re-stamps
 *     sharedCacheKey = volumeId on the cache entries AFTER this loader runs, so volume
 *     slices stay protected. This wrapper does not touch VolumeViewport behaviour.
 *   - Scheme scope: ONLY `wadouri` (the sole scheme this app uses). SEG/RT/SR use their
 *     own load functions and are untouched.
 *
 *  SAFETY / REVERSIBILITY
 *   - Gated by appConfig.skmPurgeableStackImages.enabled (DEFAULT OFF).
 *   - Idempotent: wraps once; captures the ORIGINAL module loader (not the registry),
 *     so it can never recursively wrap itself.
 *   - Preserves the loader object shape (promise/cancelFn/decache) — only chains .promise.
 *   - To remove: set the flag false (instant revert to stock behaviour), or delete the
 *     initSkmPurgeableStackImages() call in init.tsx and this file.
 * ────────────────────────────────────────────────────────────────────────────
 */

// registerImageLoader is a top-level named export of core — the SAME one the stock
// dicom-image-loader uses in its register.js, so this is the sanctioned extension point.
// eslint-disable-next-line
import { registerImageLoader } from '@cornerstonejs/core';
// eslint-disable-next-line
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';

let initialized = false;

export function initSkmPurgeableStackImages(): void {
  if (initialized) {
    return;
  }
  initialized = true;

  try {
    // Capture the ORIGINAL stock loader by direct module reference (NOT the registry),
    // so our wrapper calling it can never recurse into itself.
    const original = (dicomImageLoader as any)?.wadouri?.loadImage;
    if (typeof original !== 'function') {
      // eslint-disable-next-line no-console
      console.warn(
        '[SKM-PURGEABLE] dicomImageLoader.wadouri.loadImage not found — leaving stock loader in place'
      );
      return;
    }

    const wrapped = (imageId: string, options: any) => {
      // Call the stock loader unchanged (preserves webworker decode, beforeSend headers,
      // cancelFn, decache, options, etc.).
      const imageLoadObject: any = original(imageId, options);
      if (
        imageLoadObject &&
        imageLoadObject.promise &&
        typeof imageLoadObject.promise.then === 'function'
      ) {
        // Only transform the RESOLVED image: drop the legacy per-URL sharedCacheKey so
        // the cache entry (_putImageCommon copies image.sharedCacheKey) is purgeable.
        // Mutate .promise in place to keep cancelFn/decache on the same object.
        imageLoadObject.promise = imageLoadObject.promise.then((image: any) => {
          if (image) {
            try {
              image.sharedCacheKey = undefined;
            } catch (e) {
              /* non-fatal */
            }
          }
          return image;
        });
      }
      return imageLoadObject;
    };

    // Override ONLY the wadouri scheme (the only scheme this app uses). This runs AFTER
    // dicomImageLoader.init() (initWADOImageLoader) has registered the stock loaders.
    registerImageLoader('wadouri', wrapped);

    // eslint-disable-next-line no-console
    console.log(
      '[SKM-PURGEABLE] wadouri images now cached WITHOUT sharedCacheKey → purgeable by native LRU'
    );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[SKM-PURGEABLE] init failed — stock loader remains active', e);
  }
}
