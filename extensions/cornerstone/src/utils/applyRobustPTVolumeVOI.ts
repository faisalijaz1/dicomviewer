import * as cornerstone from '@cornerstonejs/core';
import { metaData } from '@cornerstonejs/core';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import computeRobustVOIRange from './computeRobustVOIRange';

/**
 * Whether this PT image has real SUV scaling metadata (PatientWeight,
 * RadionuclideTotalDose, etc.) - Cornerstone3D's preScale step already
 * converts pixel values to SUVbw when this is true, so a fixed SUV-range
 * VOI/colormap (see hps/fusion.ts's PT_VOI/PT_COLORMAP) is appropriate.
 * When false, the pixel data is raw scanner counts (can run into the tens
 * of thousands) and a fixed SUV-0-5-calibrated range is meaningless for it
 * - callers should use applyRobustPTVolumeVOI's percentile-based fallback
 * instead of a static range.
 */
export function hasRealSUVData(imageId: string): boolean {
  const scalingFactor = metaData.get('scalingModule', imageId);
  return Boolean(scalingFactor?.suvbw);
}

/**
 * Computes and applies a percentile-based VOI (grayscale windowing) and a
 * separate, stricter percentile-based opacity ramp for a PT volume that
 * lacks real SUV metadata - a fixed SUV-0-5-calibrated range/ramp (this
 * app's default for genuinely SUV-scaled data) is meaningless for raw
 * scanner counts, and applying it anyway pushes essentially every real
 * pixel past the ramp's last point, rendering at uniformly high opacity -
 * seen live as a solid color wash across the whole image ("blurry"/
 * low-contrast fused view) rather than focal hot-spots.
 *
 * Every viewport currently holding this volume's actor gets the same
 * correction applied (a volume can be shared across a PT-only viewport and
 * one or more fusion viewports at once). Retries a few times if the
 * volume's images haven't decoded far enough yet to sample from - this can
 * be called before the volume has fully loaded (e.g. right after
 * `addVolumes`), not only from the VOLUME_LOADED event.
 */
export function applyRobustPTVolumeVOI(volume: any, attemptsLeft: number): void {
  const imageIds: string[] = volume?.imageIds || [];
  if (!imageIds.length) {
    return;
  }

  // The volume's own aggregate voxelManager (getCompleteScalarDataArray)
  // depends on ALL of its per-slice images having already been decoded
  // into the volume's internal slice map - under this app's interleaved
  // ('nth') load strategy, images load out of sequential order, so slice
  // 0 specifically (what that method probes to determine array length)
  // can remain unloaded far longer than other slices, leaving it stuck
  // reporting a 0-length array indefinitely. Sampling directly from the
  // plain image cache instead - the same cache.getImage() +
  // image.voxelManager.getScalarData() pattern already used successfully
  // elsewhere in this codebase (generateTimeIntensityCurve.ts) - only
  // needs SOME slices to be individually cached already, not the whole
  // volume assembled, and is far more likely to have data ready soon.
  const sampleCount = Math.min(12, imageIds.length);
  const step = Math.max(1, Math.floor(imageIds.length / sampleCount));
  const samples: ArrayLike<number>[] = [];
  for (let i = 0; i < imageIds.length; i += step) {
    const cachedImage = cornerstone.cache.getImage(imageIds[i]);
    let scalarData;
    try {
      scalarData = cachedImage?.voxelManager?.getScalarData?.();
    } catch (e) {
      continue;
    }
    if (scalarData?.length) {
      samples.push(scalarData);
    }
  }

  if (!samples.length) {
    if (attemptsLeft > 0) {
      setTimeout(() => applyRobustPTVolumeVOI(volume, attemptsLeft - 1), 800);
    }
    return;
  }

  const totalLength = samples.reduce((sum, arr) => sum + arr.length, 0);
  const merged = new Float32Array(totalLength);
  let offset = 0;
  samples.forEach(arr => {
    merged.set(arr as ArrayLike<number>, offset);
    offset += arr.length;
  });

  const range = computeRobustVOIRange(merged, 90, 99.9);
  if (!range) {
    return;
  }

  // RadiAnt-style: only genuinely elevated/focal uptake should show any
  // color. This range was previously reused as the OPACITY ramp's domain
  // too - but a whole-body scan's normal physiologic uptake (brain,
  // myocardium, bladder, liver) occupies real anatomical volume, so a
  // 90th-percentile-based opacity start colored those normal organs as
  // well, not just disease foci - visible as color smeared across most
  // of the body instead of focal hot-spots (and, since that soft color
  // blends over the sharp CT everywhere it appears, as an overall
  // "blurry" look to the whole fused image, not just the PET layer).
  // A separate, much stricter percentile range - only the top ~2% of
  // voxel values - keeps ordinary organ-level uptake transparent while
  // still showing real focal findings. Falls back to the grayscale
  // range if this stricter one can't be computed (e.g. too few samples).
  const opacityRange = computeRobustVOIRange(merged, 98, 99.9) ?? range;

  // cornerstone3D's colormap opacity ramp ({value, opacity} points) feeds
  // a VTK piecewise function using ABSOLUTE raw pixel values, not a 0-1
  // fraction of the VOI window (see BaseVolumeViewport.js setOpacity():
  // `ofun.addPoint(value, opacity)`) - fusion.ts's static PT_COLORMAP
  // assumes true SUV-scaled data (values 0-10ish), so for this raw-count
  // fallback (values in the tens of thousands) essentially every real
  // pixel falls past the ramp's last point, rendering at uniformly high
  // opacity ("solid red speckle across the whole image"). Scaling the
  // ramp to the real data range fixes that, but going through
  // cornerstone3D's own setOpacity()/setProperties({colormap}) wrapper -
  // even opacity alone, colormap.name omitted - was observed to also
  // blank out the OTHER volume sharing this viewport (the CT layer went
  // fully flat/gray). That wrapper's only extra behavior beyond the raw
  // VTK call is dispatching a COLORMAP_MODIFIED event and updating some
  // viewportProperties bookkeeping, neither of which should touch a
  // different actor - but empirically, going through it did. Setting the
  // piecewise function directly on the volume's own VTK actor instead
  // sidesteps that wrapper (and whatever in it was responsible)
  // entirely, while still only ever touching this one actor.
  let applied = 0;
  cornerstone.getRenderingEngines().forEach(renderingEngine => {
    renderingEngine.getViewports().forEach(viewport => {
      if (viewport.getAllVolumeIds?.()?.includes(volume.volumeId)) {
        viewport.setProperties({ voiRange: range }, volume.volumeId);

        try {
          const actorEntry = viewport
            .getActors?.()
            ?.find((entry: any) => entry.referencedId === volume.volumeId);
          const volumeActor = actorEntry?.actor;
          if (volumeActor?.getProperty) {
            const { lower, upper } = opacityRange;
            const span = upper - lower || 1;
            const ofun = vtkPiecewiseFunction.newInstance();
            ofun.addPoint(lower, 0);
            ofun.addPoint(lower + span * 0.7, 0);
            ofun.addPoint(lower + span * 0.85, 0.25);
            ofun.addPoint(upper, 0.6);
            volumeActor.getProperty().setScalarOpacity(0, ofun);
          }
        } catch (e) {
          // Best-effort - the grayscale windowing above already applied
          // is the safe fallback if this fails for any reason.
        }

        viewport.render();
        applied++;
      }
    });
  });
  // The viewport actor for this volume may not have been created yet
  // even though the volume itself has loaded enough slices to sample -
  // retry so the correction still lands once it exists.
  if (!applied && attemptsLeft > 0) {
    setTimeout(() => applyRobustPTVolumeVOI(volume, attemptsLeft - 1), 800);
  }
}
