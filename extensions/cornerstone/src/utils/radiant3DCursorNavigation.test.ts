import {
  planeDistance,
  findNearestPlaneIndex,
  computeVolumeFocalPointShift,
  type StackPlaneCandidate,
} from './radiant3DCursorNavigation';

describe('planeDistance', () => {
  it('returns 0 for a point lying exactly on the plane', () => {
    expect(planeDistance([0, 0, 5], [0, 0, 5], [0, 0, 1])).toBe(0);
  });

  it('returns the perpendicular distance along the normal', () => {
    expect(planeDistance([0, 0, 12], [0, 0, 5], [0, 0, 1])).toBeCloseTo(7);
  });

  it('is unaffected by in-plane offset - only the normal component matters', () => {
    // Point is far away in X/Y, but exactly on the Z=5 plane.
    expect(planeDistance([100, -50, 5], [0, 0, 5], [0, 0, 1])).toBeCloseTo(0);
  });

  it('always returns a non-negative distance regardless of which side of the plane the point is on', () => {
    expect(planeDistance([0, 0, -2], [0, 0, 5], [0, 0, 1])).toBeCloseTo(7);
  });

  it('works with a non-axis-aligned (oblique) normal', () => {
    // Normalized diagonal normal in the XY plane.
    const n: [number, number, number] = [Math.SQRT1_2, Math.SQRT1_2, 0];
    // Point offset by 10 along that same normal direction from the origin plane.
    const point: [number, number, number] = [10 * Math.SQRT1_2, 10 * Math.SQRT1_2, 0];
    expect(planeDistance(point, [0, 0, 0], n)).toBeCloseTo(10);
  });
});

describe('findNearestPlaneIndex', () => {
  const candidates: StackPlaneCandidate[] = [
    { index: 0, origin: [0, 0, 0], normal: [0, 0, 1] },
    { index: 1, origin: [0, 0, 5], normal: [0, 0, 1] },
    { index: 2, origin: [0, 0, 10], normal: [0, 0, 1] },
    { index: 3, origin: [0, 0, 15], normal: [0, 0, 1] },
  ];

  it('returns null for an empty candidate list rather than throwing', () => {
    expect(findNearestPlaneIndex([0, 0, 7], [])).toBeNull();
  });

  it('picks the exact matching plane when the point lies on it', () => {
    const result = findNearestPlaneIndex([1, -1, 10], candidates);
    expect(result).toEqual({ index: 2, distance: 0 });
  });

  it('picks the geometrically nearest plane when the point is between two planes', () => {
    // z=7 is 2mm from the z=5 plane (index 1) and 3mm from the z=10 plane (index 2).
    const result = findNearestPlaneIndex([0, 0, 7], candidates);
    expect(result?.index).toBe(1);
    expect(result?.distance).toBeCloseTo(2);
  });

  it('breaks exact ties by keeping the first candidate encountered', () => {
    // z=2.5 is exactly 2.5mm from both index 0 (z=0) and index 1 (z=5).
    const result = findNearestPlaneIndex([0, 0, 2.5], candidates);
    expect(result?.index).toBe(0);
  });

  it('is order-independent - the nearest plane wins regardless of array order', () => {
    const shuffled = [candidates[3], candidates[0], candidates[2], candidates[1]];
    const result = findNearestPlaneIndex([0, 0, 7], shuffled);
    expect(result?.index).toBe(1);
  });

  it('handles a single-candidate list', () => {
    const result = findNearestPlaneIndex([0, 0, 999], [candidates[0]]);
    expect(result).toEqual({ index: 0, distance: 999 });
  });
});

describe('computeVolumeFocalPointShift', () => {
  it('moves focalPoint and position by the same delta along the view plane normal', () => {
    const camera = {
      focalPoint: [0, 0, 0] as [number, number, number],
      position: [0, 0, -100] as [number, number, number],
      viewPlaneNormal: [0, 0, 1] as [number, number, number],
    };

    const result = computeVolumeFocalPointShift([5, -3, 8], camera);

    // Only the Z component (along the normal) should move - X/Y offsets in
    // the target point are irrelevant to slice navigation and must not pan
    // the view sideways.
    expect(result.focalPoint).toEqual([0, 0, 8]);
    // position shifts by the identical delta, preserving the camera's
    // distance-from-focal-point (zoom) and viewing direction.
    expect(result.position).toEqual([0, 0, -92]);
  });

  it('returns the same focalPoint/position when the point already lies on the current plane', () => {
    const camera = {
      focalPoint: [1, 2, 3] as [number, number, number],
      position: [1, 2, -50] as [number, number, number],
      viewPlaneNormal: [0, 0, 1] as [number, number, number],
    };

    // Same Z as the focal point (3), different X/Y - should produce zero shift.
    const result = computeVolumeFocalPointShift([99, -99, 3], camera);

    expect(result.focalPoint).toEqual(camera.focalPoint);
    expect(result.position).toEqual(camera.position);
  });

  it('works for an oblique (non-axis-aligned) view plane normal', () => {
    const n: [number, number, number] = [Math.SQRT1_2, Math.SQRT1_2, 0];
    const camera = {
      focalPoint: [0, 0, 0] as [number, number, number],
      position: [0, 0, -100] as [number, number, number],
      viewPlaneNormal: n,
    };

    // Point offset by 10mm along the oblique normal direction from the
    // focal point (which sits at the origin) - so the perpendicular
    // distance to travel along the normal is exactly 10mm.
    const point: [number, number, number] = [10 * Math.SQRT1_2, 10 * Math.SQRT1_2, 0];
    const result = computeVolumeFocalPointShift(point, camera);

    // delta = normal * offset = [SQRT1_2, SQRT1_2, 0] * 10
    expect(result.focalPoint[0]).toBeCloseTo(10 * Math.SQRT1_2);
    expect(result.focalPoint[1]).toBeCloseTo(10 * Math.SQRT1_2);
    expect(result.focalPoint[2]).toBeCloseTo(0);
    // Zoom/distance preserved: position shifts by the identical delta.
    expect(result.position[0] - camera.position[0]).toBeCloseTo(
      result.focalPoint[0] - camera.focalPoint[0]
    );
  });
});
