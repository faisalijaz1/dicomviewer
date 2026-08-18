import { getIsLocked } from './utils/getIsLocked';
import { getIsVisible } from './utils/getIsVisible';
import getSOPInstanceAttributes from './utils/getSOPInstanceAttributes';
import { utils } from '@ohif/core';

/**
 * Maps DeviationTool (extensions/cornerstone/src/tools/DeviationTool.ts)
 * annotations to the measurement service - modeled directly on Length.ts,
 * but reading the deviationValue/deviationAngle/deviationUnit fields
 * DeviationTool adds to cachedStats instead of the plain `length` field, so
 * the Measurements Panel shows the same RadiAnt-parity distance+angle pair
 * the on-canvas annotation label does (rather than a plain segment length,
 * which would be actively misleading for this tool).
 */
const Deviation = {
  toAnnotation: measurement => {},

  toMeasurement: (
    csToolsEventDetail,
    displaySetService,
    cornerstoneViewportService,
    getValueTypeFromToolType,
    customizationService
  ) => {
    const { annotation } = csToolsEventDetail;
    const { metadata, data, annotationUID } = annotation;

    const isLocked = getIsLocked(annotationUID);
    const isVisible = getIsVisible(annotationUID);

    if (!metadata || !data) {
      console.warn('Deviation tool: Missing metadata or data');
      return null;
    }

    const { toolName, referencedImageId, FrameOfReferenceUID } = metadata;

    if (toolName !== 'Deviation') {
      throw new Error('Tool not supported');
    }

    const { SOPInstanceUID, SeriesInstanceUID, StudyInstanceUID } = getSOPInstanceAttributes(
      referencedImageId,
      displaySetService,
      annotation
    );

    let displaySet;

    if (SOPInstanceUID) {
      displaySet = displaySetService.getDisplaySetForSOPInstanceUID(
        SOPInstanceUID,
        SeriesInstanceUID
      );
    } else {
      displaySet = displaySetService.getDisplaySetsForSeries(SeriesInstanceUID)[0];
    }

    const { points, textBox } = data.handles;

    const mappedAnnotations = getMappedAnnotations(annotation, displaySetService);

    const displayText = getDisplayText(mappedAnnotations, displaySet);
    const getReport = () => _getReport(mappedAnnotations, points, FrameOfReferenceUID);

    return {
      uid: annotationUID,
      SOPInstanceUID,
      FrameOfReferenceUID,
      points,
      textBox,
      isLocked,
      isVisible,
      metadata,
      referenceSeriesUID: SeriesInstanceUID,
      referenceStudyUID: StudyInstanceUID,
      referencedImageId,
      frameNumber: mappedAnnotations[0]?.frameNumber || 1,
      toolName: metadata.toolName,
      displaySetInstanceUID: displaySet.displaySetInstanceUID,
      label: data.label,
      displayText: displayText,
      data: data.cachedStats,
      type: getValueTypeFromToolType(toolName),
      getReport,
    };
  },
};

function getMappedAnnotations(annotation, displaySetService) {
  const { metadata, data } = annotation;
  const { cachedStats } = data;
  const { referencedImageId } = metadata;
  const targets = Object.keys(cachedStats || {});

  if (!targets.length) {
    return [];
  }

  const annotations = [];
  targets.forEach(targetId => {
    const targetStats = cachedStats[targetId];

    const { SOPInstanceUID, SeriesInstanceUID, frameNumber } = getSOPInstanceAttributes(
      referencedImageId,
      displaySetService,
      annotation
    );

    const displaySet = displaySetService.getDisplaySetsForSeries(SeriesInstanceUID)[0];

    const { SeriesNumber } = displaySet;
    const { length, unit, deviationValue, deviationAngle, deviationUnit } = targetStats;

    annotations.push({
      SeriesInstanceUID,
      SOPInstanceUID,
      SeriesNumber,
      frameNumber,
      length,
      unit,
      deviationValue,
      deviationAngle,
      deviationUnit,
    });
  });

  return annotations;
}

function _getReport(mappedAnnotations, points, FrameOfReferenceUID) {
  const columns = [];
  const values = [];

  columns.push('AnnotationType');
  values.push('Cornerstone:Deviation');

  mappedAnnotations.forEach(annotation => {
    const { length, unit, deviationValue, deviationAngle, deviationUnit } = annotation;

    if (!Number.isFinite(deviationValue) || !Number.isFinite(deviationAngle)) {
      return;
    }

    columns.push(`Deviation (${deviationUnit})`, 'Angle (deg)', `Length (${unit})`);
    values.push(deviationValue, deviationAngle, length);
  });

  if (FrameOfReferenceUID) {
    columns.push('FrameOfReferenceUID');
    values.push(FrameOfReferenceUID);
  }

  if (points) {
    columns.push('points');
    values.push(points.map(p => p.join(' ')).join(';'));
  }

  return { columns, values };
}

function getDisplayText(mappedAnnotations, displaySet) {
  const displayText = {
    primary: [],
    secondary: [],
  };

  if (!mappedAnnotations || !mappedAnnotations.length) {
    return displayText;
  }

  const {
    SeriesNumber,
    SOPInstanceUID,
    frameNumber,
    deviationValue,
    deviationAngle,
    deviationUnit,
  } = mappedAnnotations[0];

  if (!Number.isFinite(deviationValue) || !Number.isFinite(deviationAngle)) {
    return displayText;
  }

  const instance = displaySet.instances.find(image => image.SOPInstanceUID === SOPInstanceUID);

  let InstanceNumber;
  if (instance) {
    InstanceNumber = instance.InstanceNumber;
  }

  const instanceText = InstanceNumber ? ` I: ${InstanceNumber}` : '';
  const frameText = displaySet.isMultiFrame ? ` F: ${frameNumber}` : '';

  displayText.primary.push(`${utils.roundNumber(deviationValue, 2)} ${deviationUnit}`);
  displayText.primary.push(`${utils.roundNumber(deviationAngle, 2)}°`);
  displayText.secondary.push(`S: ${SeriesNumber}${instanceText}${frameText}`);

  return displayText;
}

export default Deviation;
