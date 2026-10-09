/**
 * ────────────────────────────────────────────────────────────────────────────
 *  SKM-WADO-RS-TRANSCODING 2026-10-09 — Priority 3E
 *
 *  WHY
 *  Independent source investigation (Priority 3B) proved the dominant fresh first-touch
 *  cost is CPU-bound JPEG Lossless SV1 (1.2.840.10008.1.2.4.70) entropy decoding, done
 *  client-side in pure JS (jpeg-lossless-decoder-js@2.1.2, pinned inside
 *  @cornerstonejs/dicom-image-loader@4.22.10) - confirmed inherent work, not a decoder
 *  bug, with no faster drop-in client-side decoder available.
 *
 *  Independent Playwright QA then proved this PACS's WADO-RS INSTANCE endpoint
 *  (.../studies/{study}/series/{series}/instances/{sop}) genuinely transcodes that same
 *  SOP to uncompressed Explicit VR Little Endian (1.2.840.10008.1.2.1) when asked via
 *  Accept header - pixel-identical to the original, verified for multiple real CT SOPs.
 *  WADO-URI (this app's current imageRendering setting) ignores the transferSyntax query
 *  parameter and always returns the original compressed bytes.
 *
 *  Why the stock Cornerstone 'wadors' loader (imageRendering: 'wadors') CANNOT be used to
 *  reach this, confirmed from the exact pinned source
 *  (imageLoader/wadors/loadImage.js):
 *    - It only ever retrieves per-FRAME (.../frames/{n}), never the INSTANCE resource QA
 *      validated.
 *    - Its Accept header's transfer-syntax parameter is a HARDCODED wildcard
 *      ('multipart/related; type=application/octet-stream; transfer-syntax=*'), with no
 *      option anywhere to request a specific transfer syntax. This exactly matches this
 *      project's own prior A/B test note in app-config.js ("wadors measured slightly
 *      SLOWER than wadouri") - that test exercised the untranscoded, wildcard frame path,
 *      not transcoding, so it is not evidence against this change.
 *  Simply flipping imageRendering to 'wadors' therefore would NOT engage the validated
 *  transcoding capability at all.
 *
 *  WHAT THIS DOES
 *  Registers a replacement loader for the exact 'dicomweb'/'wadouri' imageId schemes this
 *  app's DicomWebDataSource already produces - the imageId STRING FORMAT is completely
 *  unchanged (still wadouri-style, still carrying studyUID/seriesUID/objectUID in its
 *  query string). For each image load, it:
 *    1. Derives Study/Series/SOPInstanceUID from the imageId via the EXISTING,
 *       already-memoized metadataProvider.getUIDsFromImageID() (Priority 2) - no new
 *       parsing logic, and a cache hit for any imageId already queried elsewhere.
 *    2. Fetches the WADO-RS INSTANCE resource with an Accept header requesting the
 *       configured target transfer syntax (default: Explicit VR LE, the exact syntax
 *       independent QA validated this PACS transcodes to).
 *    3. Unwraps the resulting multipart/related response to the single DICOM Part10
 *       payload (this app always requests ONE instance, i.e. exactly one part).
 *    4. Hands those bytes into Cornerstone's OWN stock, UNCHANGED
 *       dataSetCacheManager/loadImageFromPromise pipeline (dicomImageLoader.wadouri.*,
 *       all public exports). Everything downstream - dicom-parser, pixel extraction,
 *       decode dispatch, image construction, caching - runs exactly as it does today,
 *       driven by the ACTUAL transfer-syntax tag now present in the retrieved file.
 *       Because Explicit VR LE is uncompressed, decodeImageFrame.js's existing dispatch
 *       (unchanged) automatically routes to the trivial decodeLittleEndian path instead
 *       of decodeJPEGLossless - with zero changes to any decode-dispatch code.
 *
 *  ON ANY FAILURE (missing UIDs, network error, non-2xx response, multipart parse
 *  failure): falls back to the STOCK loader for that single image, fetching the
 *  original WADO-URI bytes exactly as happens today with this feature disabled. A
 *  failure on one image can never block, corrupt, or retry-storm another.
 *
 *  WHY IT IS SAFE
 *   - imageId scheme/format is 100% unchanged - MetadataProvider's UID cache,
 *     DicomMetadataStore, StudyPrefetcherService's inflight/pending bookkeeping, cache
 *     keys, and the two-viewport scheduler all key off the imageId string, which this
 *     change never touches. Only the bytes actually fetched for a given imageId change.
 *   - dataSetCacheManager's cache key (parsedImageId.url, the embedded WADO-URI query
 *     string) is unchanged, so duplicate-request suppression and multi-frame dataset
 *     sharing keep working exactly as before - this module only replaces WHICH bytes
 *     get stored under that same key.
 *   - Uses the same sanctioned extension point (registerImageLoader) and the same
 *     capture-the-original-by-direct-module-reference technique already proven safe in
 *     this codebase by skmPurgeableStackImages.ts - not a Cornerstone core modification.
 *   - Only wraps 'dicomweb' and 'wadouri' (the two schemes this app's DicomWebDataSource
 *     actually produces). 'dicomfile' (local blob files, no study/series/instance UIDs
 *     to transcode) is deliberately left untouched.
 *   - Issues its OWN fetch rather than reusing the shared xhrRequest, specifically
 *     because the shared beforeSend callback (initWADOImageLoader.js) recomputes and
 *     OVERRIDES the Accept header on every request via
 *     Object.assign({}, defaultHeaders, beforeSendHeaders) - reusing xhrRequest would
 *     make a custom transcoding Accept header unreachable. This module instead reuses
 *     the SAME auth-header source (userAuthenticationService.getAuthorizationHeader())
 *     directly, so authenticated PACS access is preserved.
 *   - Frame selection and multiframe handling are unaffected: this module fetches the
 *     WHOLE instance (exactly as WADO-URI already does today), and the stock
 *     loadImageFromPromise(dataSetPromise, imageId, parsedImageId.pixelDataFrame, ...)
 *     call - unchanged - still extracts the specific requested frame from the parsed
 *     dataset exactly as it does today.
 *
 *  SAFETY / REVERSIBILITY
 *   - Gated by appConfig.skmWadoRsTranscoding.enabled (DEFAULT OFF/undefined).
 *   - To roll back: set the flag false (or omit it entirely) - instant revert to stock
 *     WADO-URI behaviour, no other changes needed.
 *   - Idempotent: wraps once; captures the ORIGINAL stock loader by direct module
 *     reference, so it can never recursively wrap itself.
 *   - MUST run AFTER initWADOImageLoader (which registers the stock loaders this module
 *     captures and wraps), same ordering requirement as skmPurgeableStackImages.
 *
 *  NOT YET RUNTIME-VALIDATED.
 *  This module has not been exercised against the live PACS. The exact byte-level
 *  shape of this PACS's multipart/related response (boundary quoting, header casing,
 *  presence of a preamble) is assumed to follow the DICOMweb/MIME multipart standard but
 *  has not been confirmed against a live response by this implementation. Independent
 *  Playwright QA must verify the 8 stated acceptance criteria before this flag is
 *  enabled in any deployed configuration. Do not claim a performance improvement until
 *  that validation has run.
 * ────────────────────────────────────────────────────────────────────────────
 */

// eslint-disable-next-line
import { registerImageLoader } from '@cornerstonejs/core';
// eslint-disable-next-line
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';
// eslint-disable-next-line
import OHIF from '@ohif/core';

const DEFAULT_TARGET_TRANSFER_SYNTAX_UID = '1.2.840.10008.1.2.1'; // Explicit VR Little Endian

let initialized = false;

/**
 * Finds the boundary of the first MIME part in a multipart/related response and
 * returns just that part's body bytes (this app always requests exactly one DICOM
 * instance, i.e. exactly one part). Works on raw bytes throughout - only a
 * Latin1/binary-safe text VIEW of the buffer is used to locate ASCII markers
 * (boundary, blank-line separator); the returned body is always a byte-exact slice
 * of the original buffer, never a re-encoded string, so binary pixel data cannot be
 * corrupted by this step.
 */
function extractFirstMultipartBody(contentType: string, buffer: ArrayBuffer): ArrayBuffer {
  const boundaryMatch = /boundary="?([^";]+)"?/i.exec(contentType || '');
  if (!boundaryMatch) {
    throw new Error('WADO-RS transcoding response has no multipart boundary');
  }
  const boundary = boundaryMatch[1];
  const bytes = new Uint8Array(buffer);
  // Latin1 is byte-for-byte: charCode === byte value, safe for locating ASCII markers
  // without touching/transcoding the underlying binary data.
  let text = '';
  const chunkSize = 65536;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    text += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
  }

  const boundaryMarker = `--${boundary}`;
  const firstBoundaryIndex = text.indexOf(boundaryMarker);
  if (firstBoundaryIndex === -1) {
    throw new Error('WADO-RS transcoding response: boundary marker not found in body');
  }

  const headerStart = firstBoundaryIndex + boundaryMarker.length;
  const headerEnd = text.indexOf('\r\n\r\n', headerStart);
  const bodyStart = headerEnd !== -1 ? headerEnd + 4 : text.indexOf('\n\n', headerStart) + 2;
  if (bodyStart <= 0) {
    throw new Error('WADO-RS transcoding response: part header/body separator not found');
  }

  const nextBoundaryIndex = text.indexOf(`--${boundary}`, bodyStart);
  const bodyEnd = nextBoundaryIndex === -1 ? bytes.length : nextBoundaryIndex;

  // Trim a single trailing CRLF/LF that MIME multipart requires immediately before
  // the next boundary delimiter - it is part separator syntax, not part of the body.
  let trimmedEnd = bodyEnd;
  if (trimmedEnd >= 2 && text[trimmedEnd - 2] === '\r' && text[trimmedEnd - 1] === '\n') {
    trimmedEnd -= 2;
  } else if (trimmedEnd >= 1 && text[trimmedEnd - 1] === '\n') {
    trimmedEnd -= 1;
  }

  return bytes.buffer.slice(bodyStart, trimmedEnd);
}

export function initSkmWadoRsTranscodedLoader(
  userAuthenticationService: any,
  appConfig: any,
  extensionManager: any
): void {
  if (initialized) {
    return;
  }
  const config = appConfig?.skmWadoRsTranscoding;
  if (!config?.enabled) {
    return;
  }
  initialized = true;

  const targetTransferSyntaxUID: string =
    config.transferSyntaxUID || DEFAULT_TARGET_TRANSFER_SYNTAX_UID;
  const acceptHeader = `multipart/related; type="application/dicom"; transfer-syntax=${targetTransferSyntaxUID}`;
  const metadataProvider = OHIF.classes.MetadataProvider;

  const stats: any = {
    calls: 0,
    transcoded: 0,
    fallbacks: 0,
    lastError: null as any,
  };
  (globalThis as any).__skmWadoRsTranscodeStats = stats;

  try {
    // Capture the ORIGINAL stock loader by direct module reference (NOT the registry),
    // so this wrapper's own fallback path can never recurse into itself.
    const originalLoadImage = (dicomImageLoader as any)?.wadouri?.loadImage;
    const { dataSetCacheManager, loadImageFromPromise, parseImageId } =
      (dicomImageLoader as any).wadouri;
    if (
      typeof originalLoadImage !== 'function' ||
      typeof dataSetCacheManager?.load !== 'function' ||
      typeof loadImageFromPromise !== 'function' ||
      typeof parseImageId !== 'function'
    ) {
      // eslint-disable-next-line no-console
      console.warn(
        '[SKM-WADO-RS-TRANSCODE] required dicomImageLoader.wadouri exports not found — leaving stock loader in place'
      );
      return;
    }

    const getWadoRoot = (): string | undefined => {
      try {
        return extensionManager?.getActiveDataSource?.()?.[0]?.getConfig?.()?.wadoRoot;
      } catch (e) {
        return undefined;
      }
    };

    const fetchTranscodedInstance = async (imageId: string): Promise<ArrayBuffer> => {
      const uids = metadataProvider?.getUIDsFromImageID?.(imageId);
      const { StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID } = uids || {};
      if (!StudyInstanceUID || !SeriesInstanceUID || !SOPInstanceUID) {
        throw new Error('WADO-RS transcoding: could not resolve Study/Series/SOPInstanceUID from imageId');
      }

      const wadoRoot = getWadoRoot();
      if (!wadoRoot) {
        throw new Error('WADO-RS transcoding: active data source has no wadoRoot configured');
      }

      const instanceUrl =
        `${wadoRoot}/studies/${StudyInstanceUID}/series/${SeriesInstanceUID}` +
        `/instances/${SOPInstanceUID}`;

      const headers: Record<string, string> = { Accept: acceptHeader };
      try {
        const authHeaders = userAuthenticationService?.getAuthorizationHeader?.();
        if (authHeaders) {
          Object.assign(headers, authHeaders);
        }
      } catch (e) {
        /* best-effort auth header reuse; proceed unauthenticated if unavailable */
      }

      const response = await fetch(instanceUrl, { headers });
      if (!response.ok) {
        throw new Error(`WADO-RS transcoding fetch failed: HTTP ${response.status}`);
      }
      const contentType = response.headers.get('Content-Type') || '';
      const buffer = await response.arrayBuffer();
      return extractFirstMultipartBody(contentType, buffer);
    };

    // dataSetCacheManager.load(uri, loadRequest, imageId) treats `uri` purely as an
    // opaque cache key (the SAME embedded WADO-URI query string used today) and calls
    // loadRequest(uri, imageId) to obtain the bytes - it never uses `uri` itself to
    // build a request. That is exactly the seam this module uses: `uri` keeps its
    // existing role as the cache key (so duplicate-request suppression and
    // multi-frame dataset sharing are unaffected), while the ACTUAL network target is
    // derived from `imageId` via fetchTranscodedInstance, independent of `uri`.
    const transcodingLoadRequest = (uri: string, imageId: string): Promise<ArrayBuffer> => {
      stats.calls++;
      return fetchTranscodedInstance(imageId)
        .then(dicomBytes => {
          stats.transcoded++;
          return dicomBytes;
        })
        .catch(error => {
          stats.fallbacks++;
          stats.lastError = { imageId, message: error?.message };
          // eslint-disable-next-line no-console
          console.warn(
            '[SKM-WADO-RS-TRANSCODE] falling back to stock WADO-URI fetch for',
            imageId,
            error
          );
          return (dicomImageLoader as any).internal.xhrRequest(uri, imageId);
        });
    };

    const wrappedLoadImage = (imageId: string, options: any) => {
      let parsedImageId;
      try {
        parsedImageId = parseImageId(imageId);
      } catch (e) {
        return originalLoadImage(imageId, options);
      }

      if (dataSetCacheManager.isLoaded(parsedImageId.url)) {
        // Already cached under the existing key (by either path) - reuse unchanged,
        // exactly as the stock loader's own fast path does.
        return originalLoadImage(imageId, options);
      }

      const dataSetPromise = dataSetCacheManager.load(
        parsedImageId.url,
        transcodingLoadRequest,
        imageId
      );
      return loadImageFromPromise(
        dataSetPromise,
        imageId,
        parsedImageId.pixelDataFrame,
        parsedImageId.url,
        options
      );
    };

    // Only the two schemes this app's DicomWebDataSource actually produces. 'dicomfile'
    // (local blob files, no study/series/instance UIDs) is deliberately excluded.
    ['dicomweb', 'wadouri'].forEach(scheme => registerImageLoader(scheme, wrappedLoadImage));

    // eslint-disable-next-line no-console
    console.log(
      '[SKM-WADO-RS-TRANSCODE] dicomweb/wadouri images now requested via WADO-RS instance ' +
        `transcoding (target transfer syntax ${targetTransferSyntaxUID}), with automatic ` +
        'per-image fallback to stock WADO-URI on any error (inspect window.__skmWadoRsTranscodeStats)'
    );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[SKM-WADO-RS-TRANSCODE] init failed — stock loader remains active', e);
  }
}

export default initSkmWadoRsTranscodedLoader;
