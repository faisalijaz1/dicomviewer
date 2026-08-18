const LENGTH_UNIT_TO_CM: Record<string, string> = {
  mm: 'cm',
};

const AREA_UNIT_TO_CM2: Record<string, string> = {
  mm2: 'cm2',
  'mm²': 'cm²',
};

/**
 * Converts a calibrated mm length measurement to cm for display.
 * Uncalibrated units (e.g. px) are left unchanged since there is no
 * physical unit to convert.
 */
export function toCmLength(
  value: number,
  unit: string
): { value: number; unit: string } {
  const cmUnit = unit && LENGTH_UNIT_TO_CM[unit];
  if (!cmUnit) {
    return { value, unit };
  }
  return { value: value / 10, unit: cmUnit };
}

/**
 * Converts a calibrated mm^2 area measurement to cm^2 for display.
 * Uncalibrated units (e.g. px2) are left unchanged since there is no
 * physical unit to convert.
 */
export function toCmArea(
  value: number,
  unit: string
): { value: number; unit: string } {
  const cmUnit = unit && AREA_UNIT_TO_CM2[unit];
  if (!cmUnit) {
    return { value, unit };
  }
  return { value: value / 100, unit: cmUnit };
}
