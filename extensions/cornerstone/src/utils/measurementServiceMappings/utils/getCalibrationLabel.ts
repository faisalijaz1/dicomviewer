/**
 * RadiAnt-parity calibration provenance indicator (User Manual v2021.2 sec.
 * 2.7.1 "Calibration of measurements") - RadiAnt color-codes a measurement's
 * label by where its pixel spacing came from (DICOM pixel spacing, estimated
 * magnification factor, detector plane, ultrasound region, manual, or none
 * at all). This fork has no visual color-coding system for annotations, so
 * this surfaces the same information as a plain-text tag instead - shown
 * only for the non-default cases, matching RadiAnt's convention of leaving
 * ordinary DICOM-calibrated measurements unmarked.
 *
 * Cornerstone3D's getCalibratedLengthUnitsAndScale (@cornerstonejs/tools)
 * already resolves this per-annotation and bakes it into the `unit`/
 * `areaUnit` string it returns (e.g. "mm User", "mm ERMF", "px", "cm US
 * Region") - see its CalibrationTypes suffixes - rather than duplicating
 * that resolution, this just reads the same string OHIF already stores in
 * cachedStats[targetId].unit / .areaUnit.
 */
export default function getCalibrationLabel(unit: string | undefined): string | null {
  if (!unit) {
    return null;
  }

  // UNCALIBRATED (or no pixel spacing at all) resolves to a bare 'px'/'px²'
  // unit with no suffix - RadiAnt's "no calibration data available" case.
  if (unit === 'px' || unit === 'px\xb2' || unit.startsWith('px ')) {
    return 'Uncalibrated (pixel values only)';
  }

  if (/ User$/.test(unit)) {
    return 'Manually calibrated';
  }
  if (/ ERMF$/.test(unit)) {
    return 'Estimated (radiographic magnification factor)';
  }
  if (/ Proj$/.test(unit)) {
    return 'Detector plane';
  }
  if (unit.includes('US Region')) {
    return 'Ultrasound region calibration';
  }
  if (unit.includes('ECG Region')) {
    return 'ECG waveform region';
  }
  if (/ Error$/.test(unit)) {
    return 'Calibration error';
  }
  if (/ Unknown$/.test(unit)) {
    return 'Calibration status unknown';
  }

  // Plain DICOM pixel spacing (CalibrationTypes.NOT_APPLICABLE / Calibrated)
  // - RadiAnt's default case, left unmarked.
  return null;
}
