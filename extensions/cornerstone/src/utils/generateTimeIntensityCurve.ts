import { cache, imageLoader } from '@cornerstonejs/core';

/**
 * Parses a DICOM TM (Time) value - "HHMMSS.FFFFFF", or any shorter prefix
 * of it ("HH", "HHMM", "HHMMSS") per the DICOM standard - into seconds
 * since midnight. Returns null for anything that doesn't match, so callers
 * can fall back cleanly rather than plot a nonsense time axis.
 */
function parseDicomTimeToSeconds(time?: string): number | null {
  if (!time) {
    return null;
  }
  const match = /^(\d{2})(\d{2})?(\d{2})?(?:\.(\d+))?$/.exec(time.trim());
  if (!match) {
    return null;
  }
  const hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const seconds = match[3] ? parseInt(match[3], 10) : 0;
  const fraction = match[4] ? parseFloat(`0.${match[4]}`) : 0;
  return hours * 3600 + minutes * 60 + seconds + fraction;
}

export interface TimeIntensityPoint {
  /**
   * The x-axis value actually used for plotting: elapsed SECONDS since the
   * first phase when every phase has a parseable acquisition time (the
   * clinically meaningful axis - RadiAnt's manual: don't just treat "image
   * 1 = time 1, image 2 = time 2"), falling back to a plain sequential
   * phase index (0, 1, 2...) when time metadata is missing or unparseable
   * on any phase. Check `usesRealTime` on the parent result to know which.
   */
  time: number;
  seriesTime?: string;
  seriesNumber?: number;
  /** Identifies which sibling series this point came from - used to resolve
   * a user-chosen baseline (from the series-selection dialog) back to its
   * position in `points`, since a phase that fails to load/read is skipped
   * and would otherwise desync a raw index into the sibling list. */
  displaySetInstanceUID?: string;
  value: number;
  /**
   * RadiAnt TIC manual step 7: "A new panel will be added. It contains the
   * time-intensity curve AND screen captures of the region in dynamic
   * series used for calculations." A small auto-windowed PNG data URL
   * crop of the sampled region on this phase, with the ROI outline drawn
   * on top - undefined if a canvas couldn't be produced (e.g. no browser
   * canvas available), in which case the caller just omits the thumbnail
   * for that phase rather than failing the whole curve.
   */
  thumbnailDataUrl?: string;
}

export interface TimeIntensityRoi {
  /** ROI center, world coordinates (mm). */
  center: [number, number, number];
  /** Radius along the drawing viewport's row (horizontal) axis, mm. */
  radiusAlongRow: number;
  /** Radius along the drawing viewport's column (vertical) axis, mm. */
  radiusAlongColumn: number;
}

/**
 * Finds the "sibling" series RadiAnt would show in its TIC series-
 * confirmation dialog (Ctrl+Shift+E, "Review the automatically selected
 * series in the dialog box, click OK") - every display set in the same
 * study sharing this series' Modality and SeriesDescription, sorted into
 * time-phase order. Exported separately from generateTimeIntensityCurve()
 * so the confirmation step and the actual curve generation both use
 * exactly the same detection/ordering logic.
 */
export function findDynamicSiblingSeries(
  displaySetService: AppTypes.DisplaySetService,
  currentDisplaySet: any
): any[] {
  const allDisplaySets = displaySetService.getActiveDisplaySets();

  const siblings = allDisplaySets.filter(
    ds =>
      ds.StudyInstanceUID === currentDisplaySet.StudyInstanceUID &&
      ds.Modality === currentDisplaySet.Modality &&
      ds.SeriesDescription === currentDisplaySet.SeriesDescription &&
      ds.instances?.length
  );

  siblings.sort((a, b) => {
    const timeA = a.instances?.[0]?.SeriesTime;
    const timeB = b.instances?.[0]?.SeriesTime;
    if (timeA && timeB && timeA !== timeB) {
      return timeA < timeB ? -1 : 1;
    }
    return (a.SeriesNumber || 0) - (b.SeriesNumber || 0);
  });

  return siblings;
}

// Rendered thumbnail size in CSS pixels - upscaled from whatever the actual
// crop's pixel dimensions are (typically much smaller than this for a
// modest ROI) so the capture is actually legible in the result panel.
const THUMBNAIL_DISPLAY_SIZE = 96;
// Extra margin around the sampled region itself, in source pixels, so the
// capture shows a bit of surrounding anatomy for context - matching what
// RadiAnt's own per-phase captures look like - rather than being a tight
// crop of only the ROI fill.
const CAPTURE_PADDING_PX = 6;

/**
 * RadiAnt TIC manual step 7: the result panel shows "screen captures of the
 * region in dynamic series used for calculations" alongside the curve, one
 * per time phase. Crops a small region around the sampled point/ROI out of
 * the already-loaded phase image, auto-windows it to that crop's own
 * min/max (robust regardless of modality or calibration - this is a
 * thumbnail, not a diagnostic rendering), draws the ROI boundary on top
 * when one was used, and returns it as a PNG data URL.
 *
 * Returns undefined (rather than throwing) if no document/canvas is
 * available - this always runs in a browser tool-command context in
 * practice, but the curve itself is still useful without thumbnails, so a
 * missing canvas API shouldn't fail curve generation entirely.
 */
function renderCropThumbnail(
  image: any,
  centerCol: number,
  centerRow: number,
  radiusCols: number,
  radiusRows: number,
  drawRoiOutline: boolean
): string | undefined {
  if (typeof document === 'undefined') {
    return undefined;
  }

  const colStart = Math.max(0, Math.floor(centerCol - radiusCols - CAPTURE_PADDING_PX));
  const colEnd = Math.min(image.columns - 1, Math.ceil(centerCol + radiusCols + CAPTURE_PADDING_PX));
  const rowStart = Math.max(0, Math.floor(centerRow - radiusRows - CAPTURE_PADDING_PX));
  const rowEnd = Math.min(image.rows - 1, Math.ceil(centerRow + radiusRows + CAPTURE_PADDING_PX));

  const cropWidth = colEnd - colStart + 1;
  const cropHeight = rowEnd - rowStart + 1;
  if (cropWidth <= 0 || cropHeight <= 0) {
    return undefined;
  }

  // Auto-window: this crop's own min/max, not the image's full-frame VOI -
  // a small region of interest often has a much narrower real range than
  // the whole image, so using the image's own WW/WL would frequently wash
  // the capture out to flat grey.
  let min = Infinity;
  let max = -Infinity;
  const raw = new Float32Array(cropWidth * cropHeight);
  for (let r = rowStart; r <= rowEnd; r++) {
    for (let c = colStart; c <= colEnd; c++) {
      const v = image.voxelManager.getAtIJKPoint([c, r, 0]);
      const numeric = typeof v === 'number' && !Number.isNaN(v) ? v : 0;
      raw[(r - rowStart) * cropWidth + (c - colStart)] = numeric;
      if (numeric < min) {
        min = numeric;
      }
      if (numeric > max) {
        max = numeric;
      }
    }
  }
  const range = max - min || 1;

  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = cropWidth;
  cropCanvas.height = cropHeight;
  const cropCtx = cropCanvas.getContext('2d');
  if (!cropCtx) {
    return undefined;
  }
  const imageData = cropCtx.createImageData(cropWidth, cropHeight);
  for (let i = 0; i < raw.length; i++) {
    const gray = Math.round(((raw[i] - min) / range) * 255);
    imageData.data[i * 4] = gray;
    imageData.data[i * 4 + 1] = gray;
    imageData.data[i * 4 + 2] = gray;
    imageData.data[i * 4 + 3] = 255;
  }
  cropCtx.putImageData(imageData, 0, 0);

  // Upscale (nearest-neighbor source, smoothed on draw) to a legible
  // on-screen size, then draw the ROI outline in display-space so it stays
  // a crisp 1.5px line regardless of the crop's native resolution.
  const displayCanvas = document.createElement('canvas');
  displayCanvas.width = THUMBNAIL_DISPLAY_SIZE;
  displayCanvas.height = THUMBNAIL_DISPLAY_SIZE;
  const displayCtx = displayCanvas.getContext('2d');
  if (!displayCtx) {
    return undefined;
  }
  displayCtx.imageSmoothingEnabled = true;
  displayCtx.drawImage(cropCanvas, 0, 0, THUMBNAIL_DISPLAY_SIZE, THUMBNAIL_DISPLAY_SIZE);

  if (drawRoiOutline) {
    const scaleX = THUMBNAIL_DISPLAY_SIZE / cropWidth;
    const scaleY = THUMBNAIL_DISPLAY_SIZE / cropHeight;
    const ellipseCenterX = (centerCol - colStart) * scaleX;
    const ellipseCenterY = (centerRow - rowStart) * scaleY;
    displayCtx.strokeStyle = '#5acce6';
    displayCtx.lineWidth = 1.5;
    displayCtx.beginPath();
    displayCtx.ellipse(
      ellipseCenterX,
      ellipseCenterY,
      radiusCols * scaleX,
      radiusRows * scaleY,
      0,
      0,
      2 * Math.PI
    );
    displayCtx.stroke();
  }

  return displayCanvas.toDataURL('image/png');
}

/**
 * Time-Intensity Curve (TIC) data for a DCE/perfusion MRI acquisition where
 * each time-phase was stored as its OWN series (SeriesInstanceUID) rather
 * than a single multi-frame/dynamic-volume series with an embedded temporal
 * tag - the pattern seen in this hospital's PACS perfusion studies
 * ("Perfusion ep2d", ~60 separate series, one per time point). For each
 * "sibling" series (same study, same modality/series description as the
 * one the ROI/point was placed on), finds the slice whose
 * ImagePositionPatient is spatially closest to the ROI's center (assumes
 * the patient didn't move between phases, standard for a perfusion
 * acquisition), loads that image if it isn't already cached, and reads the
 * signal at that location.
 *
 * When `roi` is provided (an elliptical ROI the radiologist drew), this
 * averages every pixel that falls inside the ellipse on each phase's
 * matched slice - the clinically standard way to generate a TIC (RadiAnt
 * and other viewers do the same: mean signal over the drawn ROI, not a
 * single probed pixel, which is far more sensitive to a single noisy
 * voxel). Falls back to a single-point read at `worldPoint` when no ROI
 * was drawn - the ellipse is assumed to keep the SAME in-plane geometry
 * (position/orientation/spacing) across sibling series, which holds for a
 * standard perfusion/DCE acquisition (only signal varies between phases).
 *
 * Returns null if fewer than 2 sibling series exist (not a real dynamic
 * series - nothing to plot).
 */
export default async function generateTimeIntensityCurve({
  displaySetService,
  currentDisplaySet,
  worldPoint,
  roi,
  series,
  baselineDisplaySetInstanceUID,
}: {
  displaySetService: AppTypes.DisplaySetService;
  currentDisplaySet: any;
  worldPoint: [number, number, number];
  roi?: TimeIntensityRoi;
  /**
   * Pre-selected/ordered dynamic-phase series - e.g. the subset the user
   * kept checked in the series-selection dialog (RadiAnt: "Allow the user
   * to include or exclude a series"). When provided, used directly instead
   * of re-running findDynamicSiblingSeries, so an excluded series actually
   * stays excluded from the generated curve rather than silently
   * reappearing because the confirm step and the generation step each
   * independently re-derived the "same" sibling list.
   */
  series?: any[];
  /**
   * The series the user picked as the temporal baseline (elapsed time = 0)
   * in the selection dialog. Falls back to the first phase actually
   * present in `points` (not necessarily index 0 of the input series list,
   * since an earlier phase can fail to load/read and get skipped).
   */
  baselineDisplaySetInstanceUID?: string;
}): Promise<{
  points: TimeIntensityPoint[];
  seriesDescription: string;
  sampleCount: number;
  usesRealTime: boolean;
} | null> {
  const siblings = series ?? findDynamicSiblingSeries(displaySetService, currentDisplaySet);

  if (siblings.length < 2) {
    return null;
  }

  const roiCenter = roi?.center ?? worldPoint;
  const points: TimeIntensityPoint[] = [];
  // Parallel to `points` (same index) - each phase's parsed acquisition
  // time in seconds-since-midnight, or null if AcquisitionTime/SeriesTime
  // was missing/unparseable for that phase. Used after the loop to decide
  // whether a real elapsed-time x-axis can be used for every point, or
  // whether to fall back to the plain phase-index axis.
  const acquisitionSecondsByPoint: (number | null)[] = [];
  let sampleCount = 0;

  for (let siblingIndex = 0; siblingIndex < siblings.length; siblingIndex++) {
    const ds = siblings[siblingIndex];
    const instances = ds.instances || [];

    let bestInstance = null;
    let bestDistance = Infinity;
    for (const instance of instances) {
      const ipp = instance.ImagePositionPatient;
      if (!ipp) {
        continue;
      }
      const distance = Math.hypot(
        ipp[0] - roiCenter[0],
        ipp[1] - roiCenter[1],
        ipp[2] - roiCenter[2]
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        bestInstance = instance;
      }
    }

    if (!bestInstance?.imageId) {
      continue;
    }

    const imageId = bestInstance.imageId;
    let image = cache.getImage(imageId);
    if (!image) {
      try {
        image = await imageLoader.loadAndCacheImage(imageId);
      } catch (e) {
        continue;
      }
    }
    if (!image?.voxelManager) {
      continue;
    }

    // The raw cached Image (as opposed to a viewport's own VTK-wrapped
    // imageData) has no indexToWorld helper - compute pixel indices
    // directly from this instance's own DICOM geometry (ImagePositionPatient
    // / ImageOrientationPatient / pixel spacing) instead.
    const iop = bestInstance.ImageOrientationPatient;
    if (!iop) {
      continue;
    }
    const rowCosine = [iop[0], iop[1], iop[2]];
    const columnCosine = [iop[3], iop[4], iop[5]];
    const ipp = bestInstance.ImagePositionPatient;
    const columnPixelSpacing = image.columnPixelSpacing || 1;
    const rowPixelSpacing = image.rowPixelSpacing || 1;

    const toPixelCoords = (worldPos: [number, number, number]) => {
      const delta = [
        worldPos[0] - ipp[0],
        worldPos[1] - ipp[1],
        worldPos[2] - ipp[2],
      ];
      const alongRow =
        delta[0] * rowCosine[0] + delta[1] * rowCosine[1] + delta[2] * rowCosine[2];
      const alongColumn =
        delta[0] * columnCosine[0] + delta[1] * columnCosine[1] + delta[2] * columnCosine[2];
      return {
        column: alongRow / columnPixelSpacing,
        row: alongColumn / rowPixelSpacing,
      };
    };

    const center = toPixelCoords(roiCenter);

    let value: number;
    let phaseSampleCount = 0;

    if (roi) {
      const radiusColumns = Math.max(roi.radiusAlongRow / columnPixelSpacing, 0.5);
      const radiusRows = Math.max(roi.radiusAlongColumn / rowPixelSpacing, 0.5);

      const colStart = Math.max(0, Math.floor(center.column - radiusColumns));
      const colEnd = Math.min(image.columns - 1, Math.ceil(center.column + radiusColumns));
      const rowStart = Math.max(0, Math.floor(center.row - radiusRows));
      const rowEnd = Math.min(image.rows - 1, Math.ceil(center.row + radiusRows));

      let sum = 0;
      let count = 0;
      for (let r = rowStart; r <= rowEnd; r++) {
        const normalizedRow = (r - center.row) / radiusRows;
        for (let c = colStart; c <= colEnd; c++) {
          const normalizedCol = (c - center.column) / radiusColumns;
          if (normalizedCol * normalizedCol + normalizedRow * normalizedRow > 1) {
            continue;
          }
          const pixelValue = image.voxelManager.getAtIJKPoint([c, r, 0]);
          if (typeof pixelValue === 'number' && !Number.isNaN(pixelValue)) {
            sum += pixelValue;
            count++;
          }
        }
      }

      if (count === 0) {
        continue;
      }
      value = sum / count;
      phaseSampleCount = count;
    } else {
      const columnIndex = Math.round(center.column);
      const rowIndex = Math.round(center.row);
      if (
        columnIndex < 0 ||
        columnIndex >= image.columns ||
        rowIndex < 0 ||
        rowIndex >= image.rows
      ) {
        continue;
      }
      const pixelValue = image.voxelManager.getAtIJKPoint([columnIndex, rowIndex, 0]);
      if (typeof pixelValue !== 'number' || Number.isNaN(pixelValue)) {
        continue;
      }
      value = pixelValue;
      phaseSampleCount = 1;
    }

    sampleCount = Math.max(sampleCount, phaseSampleCount);

    const captureRadiusColumns = roi
      ? Math.max(roi.radiusAlongRow / columnPixelSpacing, 0.5)
      : 15;
    const captureRadiusRows = roi
      ? Math.max(roi.radiusAlongColumn / rowPixelSpacing, 0.5)
      : 15;

    // AcquisitionTime (0008,0032) is when THIS specific image was actually
    // captured - more precise than SeriesTime (which the sort in
    // findDynamicSiblingSeries already uses as a series-level fallback) -
    // falling back to SeriesTime here only if this instance has no
    // AcquisitionTime of its own.
    acquisitionSecondsByPoint.push(
      parseDicomTimeToSeconds(bestInstance.AcquisitionTime ?? bestInstance.SeriesTime)
    );

    points.push({
      // Placeholder - overwritten below once every phase has been read,
      // either with real elapsed seconds (if every phase has a parseable
      // acquisition time) or with this same sequential index as a fallback.
      // Using points.length (not siblingIndex) here means a phase that
      // fails to load/read (missing image, ROI entirely out of bounds,
      // etc. - skipped via `continue` above) doesn't leave a gap in the
      // fallback sequence (e.g. 0, 1, 3, 4).
      time: points.length,
      seriesTime: bestInstance.SeriesTime,
      seriesNumber: ds.SeriesNumber,
      displaySetInstanceUID: ds.displaySetInstanceUID,
      value,
      thumbnailDataUrl: renderCropThumbnail(
        image,
        center.column,
        center.row,
        captureRadiusColumns,
        captureRadiusRows,
        !!roi
      ),
    });
  }

  if (points.length < 2) {
    return null;
  }

  // RadiAnt TIC manual point: "the curve isn't simply image 1 = time 1,
  // image 2 = time 2" - use real elapsed seconds (relative to the first
  // phase) as the x-axis when every phase has a parseable acquisition
  // time, since phases in a real dynamic/perfusion acquisition are rarely
  // evenly spaced. Falls back to the plain phase-index axis already in
  // `time` if even one phase is missing that metadata - a partially-real
  // axis (some points in seconds, others just an index) would be more
  // misleading than a consistent index axis for all of them.
  const usesRealTime = acquisitionSecondsByPoint.every(seconds => seconds != null);
  if (usesRealTime) {
    // Resolve the user's chosen baseline (from the series-selection dialog)
    // to its actual position in `points` by displaySetInstanceUID, not a
    // raw index into the input series list - a phase that failed to
    // load/read is skipped above, which would otherwise desync a plain
    // index. Falls back to the first phase actually present when no
    // baseline was specified, or the specified one didn't make it into
    // `points` (e.g. it was the phase that failed to load).
    const baselineIndex = baselineDisplaySetInstanceUID
      ? Math.max(
          0,
          points.findIndex(p => p.displaySetInstanceUID === baselineDisplaySetInstanceUID)
        )
      : 0;
    const baselineSeconds = acquisitionSecondsByPoint[baselineIndex] as number;
    points.forEach((point, index) => {
      point.time = (acquisitionSecondsByPoint[index] as number) - baselineSeconds;
    });
  }

  return {
    points,
    seriesDescription: currentDisplaySet.SeriesDescription,
    sampleCount,
    usesRealTime,
  };
}
