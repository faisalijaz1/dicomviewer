/**
 * Computes a percentile-based window (default 0.5th-99.5th percentile)
 * from raw pixel/scalar data, instead of literal min/max. Needed as a
 * fallback whenever PET SUV scaling isn't available (this hospital's real
 * PACS data frequently lacks the DICOM tags SUV computation requires -
 * PatientWeight, RadionuclideTotalDose, etc. - `getPTImageIdInstanceMetadata`
 * logs "required PET SUV metadata are missing" for these series). Without
 * SUV scaling, pixel values are raw scanner counts (can run into the tens
 * of thousands) - windowing to their literal min/max lets a handful of
 * extreme outlier voxels wash out or invert the entire visible image, which
 * is what a plain min/max auto-window produces. A percentile-based window
 * is far more representative of the data most viewers (RadiAnt included)
 * would actually show.
 */
export function computeRobustVOIRange(
  pixelData: ArrayLike<number> | null | undefined,
  lowerPercentile = 0.5,
  upperPercentile = 99.5
): { lower: number; upper: number } | null {
  if (!pixelData || !pixelData.length) {
    return null;
  }

  // Sampling instead of sorting every voxel keeps this cheap even for a
  // full multi-hundred-slice PT volume (hundreds of thousands to millions
  // of voxels) - a few hundred thousand samples is plenty for a stable
  // percentile estimate.
  const maxSamples = 200000;
  const length = pixelData.length;
  const step = length > maxSamples ? Math.floor(length / maxSamples) : 1;

  const sampled: number[] = [];
  for (let i = 0; i < length; i += step) {
    const value = pixelData[i];
    if (Number.isFinite(value)) {
      sampled.push(value);
    }
  }

  if (!sampled.length) {
    return null;
  }

  sampled.sort((a, b) => a - b);

  const lowerIndex = Math.floor((lowerPercentile / 100) * (sampled.length - 1));
  const upperIndex = Math.ceil((upperPercentile / 100) * (sampled.length - 1));
  const lower = sampled[lowerIndex];
  const upper = sampled[upperIndex];

  if (!(upper > lower)) {
    return null;
  }

  return { lower, upper };
}

export default computeRobustVOIRange;
