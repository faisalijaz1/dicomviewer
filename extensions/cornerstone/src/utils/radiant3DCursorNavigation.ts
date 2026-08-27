/**
 * Pure geometry helpers for the RadiAnt-style 3D Cursor (see
 * extensions/cornerstone/src/tools/SimpleCrosshairTool.ts for the
 * rendering/interaction tool itself, and init.tsx's
 * handleSimpleCrosshairMovedOrPlaced for the cross-viewport navigation this
 * module supports). Extracted out of init.tsx's closures - which had this
 * math inlined and untestable - so it can be covered by real unit tests
 * independent of a live Cornerstone3D rendering engine, and reused for both
 * the initial placement and subsequent drag updates.
 */

export type Point3 = [number, number, number];

export interface StackPlaneCandidate {
  /** Index into the stack viewport's imageIds array. */
  index: number;
  /** ImagePositionPatient for this image. */
  origin: Point3;
  /** Unit normal of this image's plane (row cosine x column cosine). */
  normal: Point3;
}

export interface NearestPlaneResult {
  index: number;
  /** Perpendicular distance (mm) from worldPoint to the matched plane. */
  distance: number;
}

export interface VolumeCameraLike {
  focalPoint: Point3;
  position: Point3;
  viewPlaneNormal: Point3;
}

function dot(a: Point3, b: Point3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function subtract(a: Point3, b: Point3): Point3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/**
 * Perpendicular distance (mm) from `worldPoint` to the plane passing
 * through `planeOrigin` with unit normal `planeNormal`.
 *
 * `distance = abs(dot(P - O, N))`
 */
export function planeDistance(worldPoint: Point3, planeOrigin: Point3, planeNormal: Point3): number {
  return Math.abs(dot(subtract(worldPoint, planeOrigin), planeNormal));
}

/**
 * Finds the candidate stack image plane closest to `worldPoint`. Returns
 * null for an empty candidate list (e.g. a stack viewport with no
 * geometry-bearing images, or an empty display set) rather than throwing -
 * callers should treat that as "can't navigate this viewport", not an
 * error.
 */
export function findNearestPlaneIndex(
  worldPoint: Point3,
  candidates: StackPlaneCandidate[]
): NearestPlaneResult | null {
  if (!candidates.length) {
    return null;
  }

  let best = candidates[0];
  let bestDistance = planeDistance(worldPoint, best.origin, best.normal);

  for (let i = 1; i < candidates.length; i++) {
    const distance = planeDistance(worldPoint, candidates[i].origin, candidates[i].normal);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidates[i];
    }
  }

  return { index: best.index, distance: bestDistance };
}

/**
 * Computes the new focalPoint/position for a volume viewport's camera so
 * its displayed slice passes through `worldPoint`, moving ONLY along the
 * camera's current viewPlaneNormal - preserving orientation, zoom, pan and
 * slab thickness (unlike a full re-center, which would also shift the
 * in-plane framing). Matches cornerstone-tools' own CrosshairsTool
 * (_applyDeltaShiftToViewportCamera).
 */
export function computeVolumeFocalPointShift(
  worldPoint: Point3,
  camera: VolumeCameraLike
): { focalPoint: Point3; position: Point3 } {
  const { focalPoint, position, viewPlaneNormal } = camera;
  const offset = dot(subtract(worldPoint, focalPoint), viewPlaneNormal);
  const delta: Point3 = [
    viewPlaneNormal[0] * offset,
    viewPlaneNormal[1] * offset,
    viewPlaneNormal[2] * offset,
  ];

  return {
    focalPoint: [focalPoint[0] + delta[0], focalPoint[1] + delta[1], focalPoint[2] + delta[2]],
    position: [position[0] + delta[0], position[1] + delta[1], position[2] + delta[2]],
  };
}
