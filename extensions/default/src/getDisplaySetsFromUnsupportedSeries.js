import ImageSet from '@ohif/core/src/classes/ImageSet';
import { DisplaySetMessage, DisplaySetMessageList, utils } from '@ohif/core';

const { sopClassDictionary } = utils;

// Reverse lookup (UID -> friendly DICOM name), built once - lets the
// "unsupported" message tell a radiologist WHAT was rejected (e.g. "MR
// Spectroscopy Storage", genuinely not a viewable 2D image) instead of just
// a bare UID nobody can read at a glance.
let sopClassNameByUid = null;
function getSopClassName(sopClassUid) {
  if (!sopClassNameByUid) {
    sopClassNameByUid = new Map(
      Object.entries(sopClassDictionary).map(([name, uid]) => [uid, name])
    );
  }
  return sopClassNameByUid.get(sopClassUid);
}
/**
 * Default handler for a instance list with an unsupported sopClassUID
 */
export default function getDisplaySetsFromUnsupportedSeries(instances) {
  const imageSet = new ImageSet(instances);
  const messages = new DisplaySetMessageList();
  const instance = instances[0];

  if (!instances.length) {
    messages.addMessage(DisplaySetMessage.CODES.NO_VALID_INSTANCES);
  } else {
    const sopClassUid = instance.SOPClassUID;
    if (sopClassUid) {
      const sopClassName = getSopClassName(sopClassUid);
      messages.addMessage(DisplaySetMessage.CODES.UNSUPPORTED_SOP_CLASS_UID, {
        sopClassUid,
        sopClassName: sopClassName || 'unrecognized',
      });
    } else {
      messages.addMessage(DisplaySetMessage.CODES.MISSING_SOP_CLASS_UID);
    }
  }

  imageSet.setAttributes({
    displaySetInstanceUID: imageSet.uid, // create a local alias for the imageSet UID
    SeriesDate: instance.SeriesDate,
    SeriesTime: instance.SeriesTime,
    SeriesInstanceUID: instance.SeriesInstanceUID,
    StudyInstanceUID: instance.StudyInstanceUID,
    SeriesNumber: instance.SeriesNumber || 0,
    FrameRate: instance.FrameTime,
    SOPClassUID: instance.SOPClassUID,
    SeriesDescription: instance.SeriesDescription || '',
    Modality: instance.Modality,
    instances,
    instance: instances[instance.length - 1],
    unsupported: true,
    SOPClassHandlerId: 'unsupported',
    isReconstructable: false,
    messages,
  });
  return [imageSet];
}
