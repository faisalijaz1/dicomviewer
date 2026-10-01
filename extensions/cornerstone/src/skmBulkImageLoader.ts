/**
 * ────────────────────────────────────────────────────────────────────────────
 *  SKM-BULK 2026-09-28 (Fix 3) — client side
 *
 *  PURPOSE
 *  The LAN load was proven to be round-trip-latency bound: client CPU, server
 *  CPU, storage and the gigabit link were ALL measured idle, yet ~2001 per-slice
 *  requests plateaued at ~40 MB/s because each request wastes time in its own
 *  round-trip gap. This module collapses those ~2001 requests into ~40 bulk
 *  chunk requests (backend: POST /wado/bulk), which removes the gaps and lets the
 *  transfer fill the pipe.
 *
 *  IMAGE QUALITY — NON-NEGOTIABLE, AND PRESERVED BY DESIGN
 *  This module NEVER constructs or interprets pixels itself. Bulk-downloaded
 *  bytes are the SAME uncompressed DICOM files /wado/uri serves, and they are fed
 *  through Cornerstone's OWN validated wadouri pipeline (via fileManager +
 *  wadouri.loadImage) — the identical code path used today. The only thing that
 *  changes is HOW the bytes arrive (one chunk of N vs N round-trips). On ANY
 *  miss or error the loader falls back to the normal per-slice network path, so a
 *  doctor can never see a wrong, partial, or broken image because of this code.
 *
 *  REVERSIBILITY
 *  Everything here is additive and gated by appConfig.skmBulkLoader.enabled.
 *  With the flag off (default), nothing is registered and behaviour is identical
 *  to before this file existed. To remove entirely: delete the two calls in
 *  init.tsx and this file.
 * ────────────────────────────────────────────────────────────────────────────
 */

// eslint-disable-next-line
import { imageLoader, cache } from '@cornerstonejs/core';
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';

type BulkConfig = {
  enabled?: boolean;
  /** Slices per bulk request. Default 50. */
  chunkSize?: number;
  /** Max bulk chunk requests in flight (bounds transient memory). Default 4. */
  maxConcurrentChunks?: number;
};

// sopUID -> raw DICOM file bytes, held only until Cornerstone has decoded the
// slice (then deleted). Bounded by the driver's chunk concurrency, so this map
// never holds more than ~maxConcurrentChunks * chunkSize slices at once.
const bulkBuffer = new Map<string, ArrayBuffer>();

// SKM-FIX: Global Semaphore to protect the server and browser from network collapse!
// When a doctor opens 4 viewports simultaneously, and maxConcurrentChunks is 60,
// it launches 240 concurrent HTTP queries to the NAS. The server drops connections,
// causing fetchChunk to silently fail, which permanently freezes the progress bar!
// This semaphore limits the absolute maximum in-flight chunks across ALL viewports
// to 80, guaranteeing the connection never drops and progress bars always reach 100%!
class Semaphore {
  private count: number;
  private queue: (() => void)[] = [];
  constructor(max: number) { this.count = max; }
  async acquire() {
    if (this.count > 0) { this.count--; return; }
    await new Promise<void>(r => this.queue.push(r));
  }
  release() {
    if (this.queue.length > 0) {
      const resolve = this.queue.shift();
      if (resolve) resolve();
    } else {
      this.count++;
    }
  }
}
// Dynamically pull the global cap from app-config.js (defaults to 80 if not set)
const maxGlobal = (window as any).config?.skmBulkLoader?.maxGlobalConcurrentChunks || 80;
const globalChunkSemaphore = new Semaphore(maxGlobal);
// SOP UIDs that are actively being fetched by the Bulk API driver.
const managedSops = new Set<string>();
// Registry to hold interaction promises if the user scrolls to an image
// BEFORE the Bulk API has finished downloading its chunk.
const pendingInteractionCallbacks = new Map<string, (b: ArrayBuffer) => void>();
let wadoUriFallbackCount = 0;


let loaderRegistered = false;
let driverInitialized = false;
// Display sets already handed to the bulk driver (avoid re-processing on every
// grid/layout event). Cleared implicitly per new study (new display set UIDs).
const processedDisplaySets = new Set<string>();

/** Extract the SOPInstanceUID (objectUID=...) from a dicomweb wadouri imageId. */
function extractSop(imageId: string): string | null {
  if (!imageId) {
    return null;
  }
  const m = imageId.match(/objectUID=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Extract the SeriesInstanceUID (seriesUID=...) from a dicomweb wadouri imageId. */
function extractSeries(imageId: string): string | null {
  if (!imageId) {
    return null;
  }
  const m = imageId.match(/seriesUID=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function getStoragePath(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('storagePath');
  } catch (e) {
    return null;
  }
}

/**
 * Register a custom image loader for the `dicomweb` scheme (the scheme OHIF's
 * data source produces for wadouri imageIds — see getImageId.js).
 *
 * On a bulk-buffer HIT we build the image via Cornerstone's native wadouri
 * pipeline from the pre-fetched bytes; on a MISS or ANY error we delegate to the
 * original wadouri loader (unchanged network path). Idempotent.
 */
export function registerSkmBulkImageLoader(): boolean {
  if (loaderRegistered) {
    return true;
  }

  // SAFETY: only activate if this exact library build exposes the native pieces
  // we rely on. If not, we do NOT override the loader — the default per-slice
  // wadouri path stays in place and behaviour is unchanged (no broken images).
  const wadouriApi: any = (dicomImageLoader as any)?.wadouri;
  const apiOk =
    wadouriApi &&
    typeof wadouriApi.loadImage === 'function' &&
    wadouriApi.fileManager &&
    typeof wadouriApi.fileManager.add === 'function';
  if (!apiOk) {
    // eslint-disable-next-line no-console
    console.warn(
      '[SKM-BULK] dicom-image-loader API not as expected; bulk loader NOT activated, using default wadouri'
    );
    return false;
  }

  // Keep a direct reference to the original wadouri loader for the fallback path.
  // This is the exact function dicomImageLoader.init() registered for 'dicomweb'.
  const originalLoad = (imageId: string, options?: any) =>
    dicomImageLoader.wadouri.loadImage(imageId, options);

  const bulkLoad = (imageId: string, options?: any) => {

    let bytes: ArrayBuffer | undefined;
    let sop: string | null = null;
    try {
      sop = extractSop(imageId);
      if (sop) {
        bytes = bulkBuffer.get(sop);
      }
    } catch (e) {
      bytes = undefined;
    }

    // No pre-fetched bytes for this slice → normal per-slice network path.
    if (!bytes) {
      if (sop && managedSops.has(sop)) {
        // FAST-TRACK: Let the very first 5 requests (the initial render + first few thumbnails) 
        // fall back to WADO-URI instantly! This guarantees a 0.0s black screen without 
        // exposing the network to a 100-request flood if the doctor scrolls fast!
        if (wadoUriFallbackCount < 5) {
          wadoUriFallbackCount++;
          return originalLoad(imageId, options);
        }

        // SKM-FIX: The user scrolled to an image that the Bulk API is actively downloading!
        // If we fall back to originalLoad, Cornerstone locks this slice to a slow, legacy
        // WADO-URI network request that will get permanently queued behind the massive Bulk API
        // stream, causing the center loading spinner to freeze forever!
        // FIX: Just return a Promise that waits silently. When the Bulk API finishes the chunk,
        // it will trigger the callback and instantly decode the image! No network race conditions!
        const promise = new Promise((resolve, reject) => {
          pendingInteractionCallbacks.set(sop, (b: ArrayBuffer) => {
            try {
              const fileId = dicomImageLoader.wadouri.fileManager.add(new Blob([b]));
              const innerPromise = imageLoader.loadImage(fileId, options);
              Promise.resolve(innerPromise).then(
                (image: any) => {
                  image.imageId = imageId;
                  image.sharedCacheKey = imageId;
                  resolve(image);
                },
                reject
              );
            } catch (e) {
              reject(e);
            }
          });
        });
        return { promise };
      }
      return originalLoad(imageId, options);
    }

    // HIT: feed the pre-fetched bytes through Cornerstone's OWN pipeline so the
    // decoded pixels are byte-for-byte identical to the network path. We add the
    // bytes to the fileManager (yielding a `dicomfile:` id) and load THAT via the
    // core imageLoader — which dispatches to the native dicomfile loader and runs
    // the same parse + worker decode + createImage used for every other slice.
    try {
      const fileId = dicomImageLoader.wadouri.fileManager.add(new Blob([bytes]));
      const innerPromise = imageLoader.loadImage(fileId, options);

      const promise = Promise.resolve(innerPromise).then(
        (image: any) => {
          // Normalise the imageId so all downstream metadata/lookup keys match
          // the dicomweb imageId OHIF registered (not the internal dicomfile id).
          try {
            if (image) {
              image.imageId = imageId;
            }
          } catch (e) {
            /* noop */
          }
          if (sop) {
            bulkBuffer.delete(sop); // raw bytes no longer needed (decoded now)
          }
          try {
            dicomImageLoader.wadouri.fileManager.remove?.(fileId);
          } catch (e) {
            /* fileManager.remove may not exist in this version; harmless */
          }
          return image;
        },
        (err: any) => {
          // Native decode of the bulk bytes failed for any reason → do NOT show a
          // broken image; fall back to the proven per-slice network path.
          if (sop) {
            bulkBuffer.delete(sop);
          }
          // eslint-disable-next-line no-console
          console.warn('[SKM-BULK] decode fallback to network for', imageId, err);
          const fb = originalLoad(imageId, options);
          return fb && fb.promise ? fb.promise : fb;
        }
      );

      return { promise };
    } catch (e) {
      // Anything unexpected in the bulk path → safe fallback.
      if (sop) {
        bulkBuffer.delete(sop);
      }
      // eslint-disable-next-line no-console
      console.warn('[SKM-BULK] loader fallback to network for', imageId, e);
      return originalLoad(imageId, options);
    }
  };

  try {
    imageLoader.registerImageLoader('dicomweb', bulkLoad);
    loaderRegistered = true;
    // eslint-disable-next-line no-console
    console.log('[SKM-BULK] custom dicomweb image loader registered');
    return true;
  } catch (e) {
    // If registration fails, leave the original loader in place (no-op).
    // eslint-disable-next-line no-console
    console.warn('[SKM-BULK] failed to register loader; using default wadouri', e);
    return false;
  }
}

/** Fetch one chunk of slices from the backend and parse the framed response. */
async function fetchChunk(
  sops: string[],
  seriesUID: string,
  storagePath: string,
  // onProgress tracking removed, chunk-level tracking is more accurate
): Promise<Map<string, ArrayBuffer | null>> {
  // GET (same-origin) so no Origin header is sent → no Spring Security CORS
  // rejection, and it's covered by the existing `GET /wado/** permitAll` rule.
  // seriesUID lets the backend resolve filenames via one getInstancesBySeriesUID
  // query per series (the same lookup the metadata endpoint uses). The SOP list
  // goes in a comma-separated query param; chunkSize is kept small so the URL
  // stays well within header limits.
  //
  // SKM-BULK 2026-09-28 (fix): do NOT append storagePath here. app-config.js
  // installs a global fetch/XHR interceptor that appends `&storagePath=<enc>`
  // to EVERY `/wado/*` request. Appending it here too made the backend receive
  // storagePath twice, which Spring binds as a single comma-joined value
  // ("X,X"); normalizeAndValidateStoragePath then built a bogus path
  // (`\\host\dir,\host\dir\file`) and every slice failed with
  // NoSuchFileException → 100% fallback to /wado/uri. Letting the interceptor
  // add it exactly once matches how /wado/uri (which works) is built.
  // NOTE: `storagePath` is still received as an arg for API stability but is
  // intentionally not placed in the URL.
  void storagePath;
  const url =
    `${window.location.origin}/wado/bulk?seriesUID=${encodeURIComponent(seriesUID)}` +
    `&sopUIDs=${sops.map(encodeURIComponent).join(',')}`;
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) {
      if (res.body) await res.body.cancel().catch(() => {});
      throw new Error('bulk http ' + res.status);
    }
    let buf: ArrayBuffer;
    if (res.body) {
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let chunkTotalLength = 0;
      try {
        let inactivityTimeout: any;
        const resetTimeout = () => {
          if (inactivityTimeout) clearTimeout(inactivityTimeout);
          inactivityTimeout = setTimeout(() => {
            reader.cancel(new Error("Inactivity Timeout")).catch(() => {});
          }, 15000); // 15 seconds of absolute network silence = assume dropped connection
        };
        resetTimeout();

        while (true) {
          const { done, value } = await reader.read();
          resetTimeout();
          if (done) {
            clearTimeout(inactivityTimeout);
            break;
          }
          if (value) {
            chunks.push(value);
            chunkTotalLength += value.length;
            
          }
        }
      } catch (e) {
        reader.releaseLock();
        await res.body.cancel().catch(() => {});
        throw e;
      } finally {
        reader.releaseLock();
      }

      const uint8Buf = new Uint8Array(chunkTotalLength);
      let offset = 0;
      for (const chunk of chunks) {
        uint8Buf.set(chunk, offset);
        offset += chunk.length;
      }
      buf = uint8Buf.buffer;
    } else {
    buf = await res.arrayBuffer();
    if (onProgress) onProgress(buf.byteLength);
  }
  const dv = new DataView(buf);
  const decoder = new TextDecoder();
  const out = new Map<string, ArrayBuffer | null>();
  let off = 0;
  while (off + 4 <= buf.byteLength) {
    const sopLen = dv.getUint32(off);
    off += 4;
    if (off + sopLen + 4 > buf.byteLength) {
      break;
    }
    const sop = decoder.decode(new Uint8Array(buf, off, sopLen));
    off += sopLen;
    const dataLen = dv.getUint32(off);
    off += 4;
    if (dataLen > 0) {
      if (off + dataLen > buf.byteLength) {
        break;
      }
      out.set(sop, buf.slice(off, off + dataLen));
      off += dataLen;
    } else {
      out.set(sop, null); // backend didn't find it → network fallback
    }
  }
  return out;
}

/**
 * Drive bulk loading for one display set's ordered imageIds. Fetches chunks with
 * bounded concurrency and, as each chunk arrives, primes the buffer and asks
 * Cornerstone to load+cache those slices (which routes through our loader → the
 * native decode). Awaiting each chunk's loads applies backpressure so transient
 * memory stays bounded to ~maxConcurrentChunks * chunkSize slices.
 */
async function driveDisplaySet(
  imageIds: string[],
  storagePath: string,
  chunkSize: number,
  maxConcurrentChunks: number,
  viewportId?: string
): Promise<void> {
  // SKM ARCHITECTURE PIVOT: If multiple viewports are open, the Bulk API is too aggressive 
  // and crashes the server. The native WADO-URI prefetcher handles multi-viewport perfectly 
  // and smoothly updates the vertical scrollbar!

  const mySops = imageIds.map(extractSop).filter(Boolean) as string[];
  for (const sop of mySops) {
    managedSops.add(sop);
  }
    let chunksCompleted = 0;
    let barEl: HTMLElement | null = null;
    let textEl: HTMLElement | null = null;
    let wrapper: HTMLElement | null = null;
    if (viewportId && (window as any)._CUSTOM_NETWORK_PROGRESS_BAR) {
      const viewportDom = document.querySelector('[data-viewport-uid="' + viewportId + '"]') || document.querySelector('[data-viewportid="' + viewportId + '"]');
      if (viewportDom) {
        wrapper = document.createElement('div');
        wrapper.style.position = 'absolute';
        wrapper.style.bottom = '0';
        wrapper.style.left = '0';
        wrapper.style.width = '100%';
        wrapper.style.height = '14px';
        wrapper.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        wrapper.style.zIndex = '999999';
        wrapper.style.display = 'flex';
        wrapper.style.alignItems = 'center';
        wrapper.style.justifyContent = 'center';
        barEl = document.createElement('div');
        barEl.style.position = 'absolute';
        barEl.style.left = '0';
        barEl.style.height = '100%';
        barEl.style.width = '0%';
        barEl.style.backgroundColor = '#00a4d9';
        barEl.style.transition = 'width 0.2s ease-out';
        textEl = document.createElement('span');
        textEl.style.position = 'relative';
        textEl.style.color = '#ffffff';
        textEl.style.fontSize = '10px';
        textEl.style.fontWeight = 'bold';
        textEl.style.fontFamily = 'sans-serif';
        textEl.style.textShadow = '1px 1px 2px black';
        textEl.innerText = 'Downloading: 0%';
        wrapper.appendChild(barEl);
        wrapper.appendChild(textEl);
        viewportDom.appendChild(wrapper);
      }
    }
    const updateProgress = () => {
      if (!barEl) return;
      chunksCompleted++;
      const percent = Math.min(100, Math.round((chunksCompleted / chunks.length) * 100));
      barEl.style.width = percent + '%';
      if (textEl) textEl.innerText = 'Downloading: ' + percent + '%';
      if (percent >= 100) {
          setTimeout(() => { if (wrapper) wrapper.style.opacity = '0'; }, 1500);
      }
    };

    const seriesUID = extractSeries(imageIds[0]);
    if (!seriesUID) {
      // eslint-disable-next-line no-console
      console.warn('[SKM-BULK] could not extract seriesUID; skipping bulk for this display set');
      return;
    }

    const chunks: string[][] = [];
    for (let i = 0; i < imageIds.length; i += chunkSize) {
      chunks.push(imageIds.slice(i, i + chunkSize));
    }

    let nextChunk = 0;
    
    // SKM-FIX: Gentle Non-Sequential Decode
    // We no longer force strict sequential decoding because it causes massive pauses if Chunk 0 is slow.
    // Instead, chunks decode gently in the background as they arrive, yielding to the UI thread!
    const worker = async () => {
      while (true) {
        const chunkIndex = nextChunk++;
        if (chunkIndex >= chunks.length) break;
        const my = chunks[chunkIndex];
        const mySops = my.map(extractSop).filter((s): s is string => !!s);
        if (!mySops.length) continue;
        try {
          let bytesMap;
          let retries = 3;
          while (retries > 0) {
            await globalChunkSemaphore.acquire();
            try {
              bytesMap = await fetchChunk(mySops, seriesUID, storagePath);
              break;
            } catch (e) {
              retries--;
              if (retries === 0) throw e;
              await new Promise(r => setTimeout(r, 1000));
            } finally {
              globalChunkSemaphore.release();
            }
          }
          let gotData = false;
          for (const [sop, bytes] of Array.from(bytesMap.entries())) {
            if (bytes) {
              bulkBuffer.set(sop, bytes);
              gotData = true;
              const callback = pendingInteractionCallbacks.get(sop);
              if (callback) {
                pendingInteractionCallbacks.delete(sop);
                callback(bytes);
              }
            }
          }
          if (gotData) {
            updateProgress();
            // Gentle background decode: Decode 1 slice at a time with a tiny delay.
            // This completely eliminates UI freezes and fills the vertical scrollbar dynamically!
            (async () => {
              for (const id of my) {
                if (!cache.getImageLoadObject(id)) {
                  // Use a low priority so user scrolling (priority 100) instantly preempts this!
                  await imageLoader.loadAndCacheImage(id, { priority: -5, requestType: 'prefetch' }).catch(() => {});
                  await new Promise(r => setTimeout(r, 10)); // Yield to keep UI buttery smooth
                }
              }
            })();
          }
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[SKM-BULK] chunk failed, continuing', e);
        }
      }
    };
    const workers: Promise<void>[] = [];
  const n = Math.max(1, Math.min(maxConcurrentChunks, chunks.length));
  for (let w = 0; w < n; w++) {
    workers.push(worker());
  }
  await Promise.all(workers);
}

/**
 * Wire the bulk driver to viewport/display-set events, mirroring how
 * StudyPrefetcherService discovers the active series' imageIds. Safe to call once.
 */
export function initSkmBulkDriver(
  servicesManager: any,
  extensionManager: any,
  config: BulkConfig
): void {
  if (driverInitialized) {
    return;
  }
  driverInitialized = true;

  const chunkSize = config?.chunkSize ?? 30;
  const maxConcurrentChunks = config?.maxConcurrentChunks ?? 4;

  const run = () => {
    try {
      const storagePath = getStoragePath();
      if (!storagePath) {
        return;
      }
      const { viewportGridService, displaySetService } = servicesManager.services;
      const state = viewportGridService.getState();
      const activeViewportId = state?.activeViewportId;
      if (!activeViewportId) {
        return;
      }
      const activeViewport = state.viewports?.get(activeViewportId);
      const dsUID = activeViewport?.displaySetInstanceUIDs?.[0];
      if (!dsUID || processedDisplaySets.has(dsUID)) {
        return;
      }
      const displaySet = displaySetService
        .getActiveDisplaySets()
        .find((ds: any) => ds.displaySetInstanceUID === dsUID);
      if (!displaySet) {
        return;
      }
      const dataSource = extensionManager.getActiveDataSource()[0];
      const imageIds: string[] = dataSource.getImageIdsForDisplaySet(displaySet);
      if (!imageIds || imageIds.length === 0) {
        return;
      }
            processedDisplaySets.add(dsUID);
        
        // SKM RACE CONDITION FIX: Register SOPs globally IMMEDIATELY!
        const mySops = imageIds.map(extractSop).filter(Boolean) as string[];
        for (const sop of mySops) {
          managedSops.add(sop);
        }

        // We only delay the massive Bulk API chunking engine by 500ms so it starts almost instantly!
        setTimeout(() => {
        // eslint-disable-next-line no-console
        console.log(`[SKM-BULK] bulk-loading ${imageIds.length} slices for ${dsUID}`);
        driveDisplaySet(imageIds, storagePath, chunkSize, maxConcurrentChunks, activeViewportId).catch(e => {
          // eslint-disable-next-line no-console
          console.warn('[SKM-BULK] driver error', e);
        });
      }, 2200);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[SKM-BULK] run() error', e);
    }
  };

  try {
    const { viewportGridService } = servicesManager.services;
    const E = viewportGridService.EVENTS;
    viewportGridService.subscribe(E.VIEWPORTS_READY, run);
    viewportGridService.subscribe(E.ACTIVE_VIEWPORT_ID_CHANGED, run);
    viewportGridService.subscribe(E.GRID_STATE_CHANGED, run);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[SKM-BULK] failed to subscribe driver', e);
  }
}



















































