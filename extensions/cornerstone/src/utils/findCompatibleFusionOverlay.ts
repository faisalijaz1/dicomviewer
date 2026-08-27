/**
 * Pure series-compatibility logic for RadiAnt-style PET/CT fusion (see
 * extensions/cornerstone/src/commandsModule.ts's toggleFusion command for
 * where this is actually used). Kept framework-agnostic - no Cornerstone3D
 * or OHIF service imports - so it can be unit tested against plain object
 * fixtures instead of a live rendering engine.
 */

/**
 * The minimal shape this module needs from an OHIF display set. Modality is
 * optional (matching @ohif/core's own DisplaySet type) so real
 * DisplaySetService results are assignable here without a cast at the call
 * site - a display set genuinely missing Modality metadata should just fail
 * the CT/PT checks below, not be a type error to pass in.
 */
export interface FusionCandidateDisplaySet {
  displaySetInstanceUID: string;
  StudyInstanceUID: string;
  Modality?: string;
  SeriesDescription?: string;
  isReconstructable?: boolean;
  // @ohif/core's real InstanceMetadata type doesn't statically declare
  // FrameOfReferenceUID (or most other DICOM tags) even though it's always
  // present at runtime on a loaded instance - an existing upstream typing
  // gap, not something specific to this module. `unknown` here (read via
  // an explicit cast in getFrameOfReferenceUID below) is the documented
  // exception for that third-party boundary, rather than typing the whole
  // interface loosely just to satisfy this one field.
  instances?: unknown[];
}

const EXCLUDED_SERIES_DESCRIPTION_PATTERN = /\b(MIP|SCOUT|LOCALIZER|SECONDARY|SR|REPORT)\b/i;
const UNCORRECTED_PATTERN = /uncorrected/i;

function getFrameOfReferenceUID(ds: FusionCandidateDisplaySet): string | undefined {
  const firstInstance = ds.instances?.[0] as { FrameOfReferenceUID?: string } | undefined;
  return firstInstance?.FrameOfReferenceUID;
}

/**
 * Finds the best PT display set to use as the fusion overlay for the given
 * CT display set, from the full list of currently-loaded display sets.
 * Returns null (never throws) when nothing safe to fuse exists - callers
 * are expected to show a specific, honest message rather than guessing.
 */
export function findCompatiblePTOverlay(
  ctDisplaySet: FusionCandidateDisplaySet,
  allDisplaySets: FusionCandidateDisplaySet[]
): FusionCandidateDisplaySet | null {
  if (!ctDisplaySet) {
    return null;
  }

  const ctFrameOfReferenceUID = getFrameOfReferenceUID(ctDisplaySet);

  const candidates = allDisplaySets.filter(ds => {
    if (ds.Modality !== 'PT') {
      return false;
    }
    if (ds.StudyInstanceUID !== ctDisplaySet.StudyInstanceUID) {
      return false;
    }
    // Not reconstructable (e.g. a 2D screen capture, or a series with
    // inconsistent geometry) can't be built into a volume actor at all.
    if (ds.isReconstructable === false) {
      return false;
    }
    // Excludes PET MIP, scout, localizer, secondary capture, and report
    // series from being silently selected as the overlay - these aren't
    // real cross-sectional volumes and would either fail to render as a
    // volume or produce a meaningless fused image.
    if (EXCLUDED_SERIES_DESCRIPTION_PATTERN.test(ds.SeriesDescription || '')) {
      return false;
    }
    // Frame of Reference must match the CT's - this is the actual spatial
    // compatibility check. No FOR on either side, or a mismatch, means we
    // cannot honestly claim these two volumes share a coordinate system.
    const ptFrameOfReferenceUID = getFrameOfReferenceUID(ds);
    if (!ctFrameOfReferenceUID || !ptFrameOfReferenceUID) {
      return false;
    }
    return ptFrameOfReferenceUID === ctFrameOfReferenceUID;
  });

  if (!candidates.length) {
    return null;
  }

  // Prefer attenuation-corrected PET over an "Uncorrected" series when both
  // exist - matches the same preference already used by the 'fusion'
  // hanging protocol's own PT display-set selector.
  const corrected = candidates.filter(ds => !UNCORRECTED_PATTERN.test(ds.SeriesDescription || ''));
  return (corrected.length ? corrected : candidates)[0];
}

/**
 * Finds the CT display set currently shown in a viewport, given the
 * viewport's own list of loaded display sets (looked up by the caller via
 * displaySetService, then passed in here already resolved to objects).
 */
export function findActiveCTDisplaySet<T extends { Modality?: string }>(
  displaySets: Array<T | undefined>
): T | null {
  return displaySets.find(ds => ds?.Modality === 'CT') ?? null;
}
