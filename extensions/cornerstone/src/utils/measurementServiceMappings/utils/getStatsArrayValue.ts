/**
 * Cornerstone3D's BasicStatsCalculator computes a raw sample/pixel count
 * while iterating an ROI (name: 'count', see
 * @cornerstonejs/tools/utilities/math/basic/BasicStatsCalculator), but the
 * ROI tools (Elliptical/Circle/RectangleROI) only hoist it into
 * `cachedStats[targetId].statsArray`, not a top-level field - this pulls it
 * back out by name.
 */
export default function getStatsArrayValue(
  statsArray: Array<{ name: string; value: unknown }> | undefined,
  name: string
): number | undefined {
  const stat = statsArray?.find(entry => entry.name === name);
  return typeof stat?.value === 'number' ? stat.value : undefined;
}
