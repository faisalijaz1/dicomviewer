import {
  findCompatiblePTOverlay,
  findActiveCTDisplaySet,
  type FusionCandidateDisplaySet,
} from './findCompatibleFusionOverlay';

const FOR_A = '1.2.3.FOR-A';
const FOR_B = '1.2.3.FOR-B';
const STUDY_1 = '1.2.3.STUDY-1';

function makeDisplaySet(overrides: Partial<FusionCandidateDisplaySet>): FusionCandidateDisplaySet {
  return {
    displaySetInstanceUID: 'default-uid',
    StudyInstanceUID: STUDY_1,
    Modality: 'CT',
    isReconstructable: true,
    instances: [{ FrameOfReferenceUID: FOR_A }],
    ...overrides,
  };
}

describe('findCompatiblePTOverlay', () => {
  const ct = makeDisplaySet({ displaySetInstanceUID: 'ct-1', Modality: 'CT' });

  it('returns null when there is no CT display set', () => {
    expect(findCompatiblePTOverlay(null as any, [])).toBeNull();
  });

  it('returns null when no PT series exist at all', () => {
    const result = findCompatiblePTOverlay(ct, [ct]);
    expect(result).toBeNull();
  });

  it('picks a compatible PT series sharing the same Frame of Reference and Study', () => {
    const pt = makeDisplaySet({
      displaySetInstanceUID: 'pt-1',
      Modality: 'PT',
      SeriesDescription: 'PET WB',
    });
    const result = findCompatiblePTOverlay(ct, [ct, pt]);
    expect(result?.displaySetInstanceUID).toBe('pt-1');
  });

  it('rejects a PT series with a different Frame of Reference UID', () => {
    const pt = makeDisplaySet({
      displaySetInstanceUID: 'pt-1',
      Modality: 'PT',
      instances: [{ FrameOfReferenceUID: FOR_B }],
    });
    expect(findCompatiblePTOverlay(ct, [ct, pt])).toBeNull();
  });

  it('rejects a PT series from a different study', () => {
    const pt = makeDisplaySet({
      displaySetInstanceUID: 'pt-1',
      Modality: 'PT',
      StudyInstanceUID: '1.2.3.OTHER-STUDY',
    });
    expect(findCompatiblePTOverlay(ct, [ct, pt])).toBeNull();
  });

  it('rejects a non-reconstructable PT series', () => {
    const pt = makeDisplaySet({
      displaySetInstanceUID: 'pt-1',
      Modality: 'PT',
      isReconstructable: false,
    });
    expect(findCompatiblePTOverlay(ct, [ct, pt])).toBeNull();
  });

  it('rejects a PET MIP series as the fusion overlay', () => {
    const mip = makeDisplaySet({
      displaySetInstanceUID: 'pt-mip',
      Modality: 'PT',
      SeriesDescription: 'PET MIP',
    });
    expect(findCompatiblePTOverlay(ct, [ct, mip])).toBeNull();
  });

  it('rejects scout/localizer/secondary-capture/report series', () => {
    const descriptions = ['CT Scout', 'AP Localizer', 'Secondary Capture', 'PT SR Report'];
    descriptions.forEach(SeriesDescription => {
      const bad = makeDisplaySet({ displaySetInstanceUID: 'bad', Modality: 'PT', SeriesDescription });
      expect(findCompatiblePTOverlay(ct, [ct, bad])).toBeNull();
    });
  });

  it('prefers an attenuation-corrected PET series over an Uncorrected one', () => {
    const uncorrected = makeDisplaySet({
      displaySetInstanceUID: 'pt-uncorrected',
      Modality: 'PT',
      SeriesDescription: 'PET WB Uncorrected',
    });
    const corrected = makeDisplaySet({
      displaySetInstanceUID: 'pt-corrected',
      Modality: 'PT',
      SeriesDescription: 'PET WB AC',
    });
    // Uncorrected listed first, to prove selection isn't just "first match".
    const result = findCompatiblePTOverlay(ct, [ct, uncorrected, corrected]);
    expect(result?.displaySetInstanceUID).toBe('pt-corrected');
  });

  it('falls back to an Uncorrected series when no attenuation-corrected candidate exists', () => {
    const uncorrected = makeDisplaySet({
      displaySetInstanceUID: 'pt-uncorrected',
      Modality: 'PT',
      SeriesDescription: 'PET WB Uncorrected',
    });
    const result = findCompatiblePTOverlay(ct, [ct, uncorrected]);
    expect(result?.displaySetInstanceUID).toBe('pt-uncorrected');
  });

  it('treats a missing FrameOfReferenceUID on either side as incompatible', () => {
    const ctNoFor = makeDisplaySet({ displaySetInstanceUID: 'ct-no-for', Modality: 'CT', instances: [{}] });
    const pt = makeDisplaySet({ displaySetInstanceUID: 'pt-1', Modality: 'PT' });
    expect(findCompatiblePTOverlay(ctNoFor, [ctNoFor, pt])).toBeNull();
  });
});

describe('findActiveCTDisplaySet', () => {
  it('returns null for an empty list', () => {
    expect(findActiveCTDisplaySet([])).toBeNull();
  });

  it('returns null when no CT display set is present', () => {
    expect(findActiveCTDisplaySet([{ Modality: 'PT' }, { Modality: 'MR' }])).toBeNull();
  });

  it('finds the CT display set among mixed modalities', () => {
    const ct = { Modality: 'CT', displaySetInstanceUID: 'ct-1' };
    expect(findActiveCTDisplaySet([{ Modality: 'PT' }, ct])).toEqual(ct);
  });

  it('skips undefined entries', () => {
    const ct = { Modality: 'CT', displaySetInstanceUID: 'ct-1' };
    expect(findActiveCTDisplaySet([undefined, ct])).toEqual(ct);
  });
});
