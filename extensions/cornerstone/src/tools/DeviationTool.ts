import { LengthTool } from '@cornerstonejs/tools';
import { utils } from '@ohif/core';

/**
 * RadiAnt's Deviation tool (User Manual v2021.2 sec. 2.7.7): draw a segment,
 * and instead of just its length, show (a) the perpendicular distance from
 * one endpoint to a horizontal-or-vertical reference line through the other
 * endpoint (whichever axis the segment is closer to), and (b) the angle
 * between the segment and that reference line.
 *
 * Reuses LengthTool's own handle-placement/dragging/hit-testing/rendering
 * machinery unmodified (same pattern as CalibrationLineTool), and - more
 * importantly - reuses LengthTool's own `_calculateCachedStats` for the
 * physical segment length, which already goes through Cornerstone3D's full
 * calibration pipeline (DICOM pixel spacing, ERMF, manual/User calibration,
 * ultrasound regions, etc. - see getCalibratedLengthUnitsAndScale). Rather
 * than re-deriving that calibration logic here (a real risk of getting a
 * DICOM geometry edge case subtly wrong - see CLAUDE project rules on not
 * guessing at DICOM math), this only adds the horizontal/vertical
 * decomposition on top of that already-correct total length, using the
 * segment's on-screen (canvas) angle - which is orientation-preserving and
 * zoom-invariant, and reflects the CURRENT calibration state at calculation
 * time (canvas coordinates are recomputed from world coordinates via the
 * viewport's live transform, so a manual recalibration - which rescales
 * rendering, not the underlying world coordinates - is correctly picked up).
 *
 * Caveat, documented rather than hidden: this decomposition assumes
 * isotropic (square, or near-square) pixel spacing, matching the assumption
 * this codebase's own manual calibration (CalibrationLineTool) already makes
 * (a single scalar `scale`, not independent row/column factors). For the
 * large majority of real DICOM images (and always for manually-calibrated
 * ones in this app) that assumption holds exactly; for the rare case of a
 * genuinely anisotropic, DICOM-pixel-spacing-calibrated image, the angle
 * could be marginally off from true physical angle.
 */
class DeviationTool extends LengthTool {
  static toolName = 'Deviation';

  constructor(toolProps = {}, defaultToolProps = {}) {
    super(toolProps, defaultToolProps);
    // LengthTool's renderAnnotation calls `this.configuration.getTextLines`,
    // a per-instance config property (defaulting to a module-level
    // function) - NOT an overridable `_getTextLines` method lookup. It must
    // be reassigned explicitly for a subclass override to actually take
    // effect during rendering.
    this.configuration.getTextLines = this._getTextLines.bind(this);
  }

  _calculateCachedStats(annotation, renderingEngine, enabledElement) {
    const cachedStats = super._calculateCachedStats(annotation, renderingEngine, enabledElement);
    const { data } = annotation;
    const { viewport } = enabledElement;
    const [p1, p2] = data.handles.points || [];

    if (!p1 || !p2 || !cachedStats) {
      return cachedStats;
    }

    const canvasPoint1 = viewport.worldToCanvas(p1);
    const canvasPoint2 = viewport.worldToCanvas(p2);
    const dx = Math.abs(canvasPoint2[0] - canvasPoint1[0]);
    const dy = Math.abs(canvasPoint2[1] - canvasPoint1[1]);

    Object.keys(cachedStats).forEach(targetId => {
      const stats = cachedStats[targetId];
      const { length, unit } = stats;

      if (!Number.isFinite(length) || (dx === 0 && dy === 0)) {
        return;
      }

      // Segment is "closer to" whichever axis has the larger canvas delta;
      // the reference line runs along that same axis, so the perpendicular
      // deviation is the *other* (minor) axis's share of the total angle.
      const minor = Math.min(dx, dy);
      const major = Math.max(dx, dy);
      const angleRad = Math.atan2(minor, major);

      stats.deviationValue = length * Math.sin(angleRad);
      stats.deviationAngle = (angleRad * 180) / Math.PI;
      stats.deviationUnit = unit;
    });

    return cachedStats;
  }

  _getTextLines(data, targetId) {
    const stats = data.cachedStats[targetId];
    if (!stats) {
      return;
    }

    const { deviationValue, deviationAngle, deviationUnit } = stats;
    if (!Number.isFinite(deviationValue) || !Number.isFinite(deviationAngle)) {
      return;
    }

    return [
      `${utils.roundNumber(deviationValue, 2)} ${deviationUnit}`,
      `${utils.roundNumber(deviationAngle, 2)}°`,
    ];
  }
}

export default DeviationTool;
