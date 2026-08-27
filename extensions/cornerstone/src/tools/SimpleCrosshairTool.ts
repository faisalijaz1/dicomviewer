import { getEnabledElement, utilities as csUtils } from '@cornerstonejs/core';
import { ProbeTool, drawing, annotation as csAnnotation } from '@cornerstonejs/tools';

const { getAnnotations } = csAnnotation.state;
const { isAnnotationVisible } = csAnnotation.visibility;

// How close (in mm, along the viewport's current view-plane normal) another
// viewport's current slice/image has to be to the crosshair's actual 3D
// position before it's considered "showing the same location" and gets an
// indicator drawn on it too - mirrors cornerstone3D's own ReferenceCursors
// tool's default threshold for the same kind of check.
const DISPLAY_THRESHOLD_MM = 5;

// RadiAnt's 3D Cursor manual: "The cursor turns red if it sits at a
// distance from the active image plane." Anything closer than this counts
// as genuinely "on" the plane (a stack viewport snapped to its nearest
// discrete slice will rarely land EXACTLY on the point - a small residual
// gap up to roughly half a typical slice thickness is normal/expected, not
// a meaningful "you're off-plane" warning).
const ON_PLANE_EPSILON_MM = 1.5;

// RadiAnt's 3D Cursor manual: "appears as a blue crosshair marker" - default
// (on-plane) color; RED only when off-plane (see ON_PLANE_EPSILON_MM above).
// Saturated/bright on purpose - a duller blue disappeared against the mid-
// grey soft-tissue windowing typical of CT, which is exactly the "too light
// to see" complaint.
const BLUE_COLOR = 'rgb(0, 170, 255)';
const RED_COLOR = 'rgb(255, 40, 40)';
const OUTLINE_COLOR = 'rgba(0, 0, 0, 0.85)';

// Fixed pixel size for the marker's arms/gap - this is a small target
// reticle at the cursor's exact position, NOT a full-viewport reference
// line. Deliberately not scaled by zoom (canvas-space, drawn fresh every
// render) so it stays a small, precise marker at any zoom level, matching
// RadiAnt's crosshair marker rather than this app's own separate
// full-viewport ReferenceLines tool.
const ARM_LENGTH = 16;
const ARM_GAP = 5;
const CENTER_DOT_RADIUS = 2.5;
const MIN_STROKE_WIDTH = 2.5;
// A slightly thicker dark line drawn first, directly under the colored one -
// gives the marker a halo/outline so it stays visible against both bright
// and dark image backgrounds instead of blending in.
const OUTLINE_EXTRA_WIDTH = 2;

/**
 * RadiAnt-style 3D Cursor: a small blue crosshair marker (NOT a pair of
 * full-viewport reference lines - those are a separate, distinct RadiAnt
 * concept that this tool deliberately hides while active) placed at a
 * clicked/dragged 3D point. Subclasses ProbeTool to reuse its already-correct
 * click-to-place/drag-to-reposition/hit-testing behavior, replacing the
 * rendering (a small dot+text box by default) with the small crosshair
 * marker, and replacing the default same-image-only visibility filter with a
 * same-frame-of-reference, near-this-slice check (borrowed from
 * cornerstone3D's own ReferenceCursors tool) so the marker also shows -
 * dimmer, home viewport still bold - in sibling viewports/series that share
 * the same patient position.
 */
class SimpleCrosshairTool extends ProbeTool {
  static toolName = 'SimpleCrosshair';

  filterInteractableAnnotationsForElement(element, annotations) {
    if (!(annotations instanceof Array) || annotations.length === 0) {
      return [];
    }

    const viewport = getEnabledElement(element)?.viewport;
    if (!viewport) {
      return [];
    }

    const camera = viewport.getCamera();
    const { viewPlaneNormal, focalPoint } = camera;
    if (!viewPlaneNormal || !focalPoint) {
      return [];
    }

    const plane = csUtils.planar.planeEquation(viewPlaneNormal, focalPoint);

    return annotations.filter(annotation => {
      const worldPos = annotation.data?.handles?.points?.[0];
      if (!worldPos) {
        return false;
      }
      const distance = csUtils.planar.planeDistanceToPoint(plane, worldPos);
      return Math.abs(distance) < DISPLAY_THRESHOLD_MM;
    });
  }

  renderAnnotation = (enabledElement, svgDrawingHelper) => {
    let renderStatus = false;
    const { viewport } = enabledElement;
    const { element } = viewport;

    let annotations = getAnnotations(this.getToolName(), element);
    if (!annotations?.length) {
      return renderStatus;
    }

    annotations = this.filterInteractableAnnotationsForElement(element, annotations);
    if (!annotations?.length) {
      return renderStatus;
    }

    // RadiAnt: "The cursor turns red if it sits at a distance from the
    // active image plane" - compute how far the CURRENT viewport's actual
    // displayed slice is from the crosshair's real 3D position, in this
    // viewport's own view-plane-normal direction (independent of the
    // filtering distance already computed for visibility above).
    const camera = viewport.getCamera?.();
    const plane =
      camera?.viewPlaneNormal && camera?.focalPoint
        ? csUtils.planar.planeEquation(camera.viewPlaneNormal, camera.focalPoint)
        : null;

    for (let i = 0; i < annotations.length; i++) {
      const currentAnnotation = annotations[i];
      const annotationUID = currentAnnotation.annotationUID;

      if (!isAnnotationVisible(annotationUID)) {
        continue;
      }

      // The annotation is drawn on the image it was placed on ("home"); on
      // any other viewport/slice within the display threshold it's just an
      // indicator of where that point is, so it's rendered thinner/dashed to
      // stay visually secondary to whatever the radiologist is actually
      // measuring/looking at in that other viewport.
      const isHomeViewport = viewport.getCurrentImageId?.() === currentAnnotation.metadata?.referencedImageId;

      const point = currentAnnotation.data.handles.points[0];
      const [x, y] = viewport.worldToCanvas(point);

      const styleSpecifier = {
        toolGroupId: this.toolGroupId,
        toolName: this.getToolName(),
        viewportId: enabledElement.viewport.id,
        annotationUID,
      };
      const { lineWidth } = this.getAnnotationStyle({
        annotation: currentAnnotation,
        styleSpecifier,
      });

      const offPlaneDistance = plane
        ? Math.abs(csUtils.planar.planeDistanceToPoint(plane, point))
        : 0;
      const isOffPlane = offPlaneDistance > ON_PLANE_EPSILON_MM;

      const width = Math.max(MIN_STROKE_WIDTH, isHomeViewport ? lineWidth : lineWidth - 1);
      const outlineWidth = width + OUTLINE_EXTRA_WIDTH;
      const resolvedColor = isOffPlane ? RED_COLOR : BLUE_COLOR;
      const dash = isHomeViewport ? undefined : [2, 2];
      const outlineOptions = { color: OUTLINE_COLOR, width: outlineWidth, lineDash: dash };
      const options = { color: resolvedColor, width, lineDash: dash };

      const arms: [string, [number, number], [number, number]][] = [
        ['top', [x, y - ARM_GAP - ARM_LENGTH], [x, y - ARM_GAP]],
        ['bottom', [x, y + ARM_GAP], [x, y + ARM_GAP + ARM_LENGTH]],
        ['left', [x - ARM_GAP - ARM_LENGTH, y], [x - ARM_GAP, y]],
        ['right', [x + ARM_GAP, y], [x + ARM_GAP + ARM_LENGTH, y]],
      ];

      // Small fixed-size target reticle at the exact point - top/bottom/
      // left/right arms with a gap at the center (so the underlying pixel
      // stays visible), plus a small center dot. NOT full-viewport lines.
      // Each arm is drawn twice: a wider dark outline first, then the
      // colored line on top - keeps the marker visible against both bright
      // and dark image content instead of blending into mid-grey tissue.
      arms.forEach(([name, start, end]) => {
        drawing.drawLine(
          svgDrawingHelper,
          annotationUID,
          `${annotationUID}-${name}-outline`,
          start,
          end,
          outlineOptions
        );
      });
      arms.forEach(([name, start, end]) => {
        drawing.drawLine(svgDrawingHelper, annotationUID, `${annotationUID}-${name}`, start, end, options);
      });
      drawing.drawCircle(
        svgDrawingHelper,
        annotationUID,
        `${annotationUID}-center-outline`,
        [x, y],
        CENTER_DOT_RADIUS + 1,
        { color: OUTLINE_COLOR, fill: OUTLINE_COLOR, width: 1 }
      );
      drawing.drawCircle(
        svgDrawingHelper,
        annotationUID,
        `${annotationUID}-center`,
        [x, y],
        CENTER_DOT_RADIUS,
        { color: resolvedColor, fill: resolvedColor, width: 1 }
      );

      // RadiAnt 3D Cursor manual: while active, shows the world coordinate
      // in mm. Only on the "home" viewport - the one the point is actually
      // being placed/dragged in - not on every viewport it's echoed into,
      // which would be visual noise and (for off-plane viewports) a
      // coordinate that doesn't correspond to anything currently on screen
      // there.
      if (isHomeViewport) {
        drawing.drawTextBox(
          svgDrawingHelper,
          annotationUID,
          `${annotationUID}-coords`,
          [
            `X: ${point[0].toFixed(2)} mm`,
            `Y: ${point[1].toFixed(2)} mm`,
            `Z: ${point[2].toFixed(2)} mm`,
          ],
          [x + ARM_GAP + ARM_LENGTH + 6, y - ARM_GAP - ARM_LENGTH],
          { color: resolvedColor, background: 'rgba(0, 0, 0, 0.65)' }
        );
      }

      renderStatus = true;
    }

    return renderStatus;
  };
}

export default SimpleCrosshairTool;
