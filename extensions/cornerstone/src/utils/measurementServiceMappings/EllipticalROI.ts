import SUPPORTED_TOOLS from './constants/supportedTools';
import { getDisplayUnit, toCmArea, getStatsArrayValue, getCalibrationLabel } from './utils';
import { getIsLocked } from './utils/getIsLocked';
import { getIsVisible } from './utils/getIsVisible';
import getSOPInstanceAttributes from './utils/getSOPInstanceAttributes';
import { utils } from '@ohif/core';
import { getStatisticDisplayString } from './utils/getValueDisplayString';

const EllipticalROI = {
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
      console.warn('Length tool: Missing metadata or data');
      return null;
    }

    const { toolName, referencedImageId, FrameOfReferenceUID } = metadata;
    const validToolType = SUPPORTED_TOOLS.includes(toolName);

    if (!validToolType) {
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

    const displayText = getDisplayText(mappedAnnotations, displaySet, customizationService);
    const getReport = () =>
      _getReport(mappedAnnotations, points, FrameOfReferenceUID, customizationService);

    return {
      uid: annotationUID,
      SOPInstanceUID,
      FrameOfReferenceUID,
      points,
      textBox,
      metadata,
      isLocked,
      isVisible,
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
  const targets = Object.keys(cachedStats);

  if (!targets.length) {
    return [];
  }

  const annotations = [];
  const addedModalities = new Set();

  Object.keys(cachedStats).forEach(targetId => {
    const targetStats = cachedStats[targetId];

    const { SOPInstanceUID, SeriesInstanceUID, frameNumber } = getSOPInstanceAttributes(
      referencedImageId,
      displaySetService,
      annotation
    );

    const displaySet = displaySetService.getDisplaySetsForSeries(SeriesInstanceUID)[0];

    const { SeriesNumber } = displaySet;
    const { mean, stdDev, max, min, area, Modality, areaUnit, modalityUnit, statsArray } =
      targetStats;

    // Skip if we've already added this modality
    if (Modality && addedModalities.has(Modality)) {
      return;
    }

    // Add modality to the set if it exists
    if (Modality) {
      addedModalities.add(Modality);
    }

    annotations.push({
      SeriesInstanceUID,
      SOPInstanceUID,
      SeriesNumber,
      frameNumber,
      Modality,
      unit: modalityUnit,
      areaUnit,
      mean,
      stdDev,
      max,
      min,
      area,
      count: getStatsArrayValue(statsArray, 'count'),
    });
  });

  return annotations;
}

/*
This function is used to convert the measurement data to a format that is
suitable for the report generation (e.g. for the csv report). The report
returns a list of columns and corresponding values.
*/
function _getReport(mappedAnnotations, points, FrameOfReferenceUID, customizationService) {
  const columns = [];
  const values = [];

  // Add Type
  columns.push('AnnotationType');
  values.push('Cornerstone:EllipticalROI');

  mappedAnnotations.forEach(annotation => {
    const { mean, stdDev, max, min, area, unit, areaUnit } = annotation;

    if (!Number.isFinite(mean) || !unit || !Number.isFinite(max) || !Number.isFinite(area)) {
      return;
    }

    columns.push(`max (${unit})`, `mean (${unit})`, `std (${unit})`, `min (${unit})`, 'Area', 'Unit');
    values.push(max, mean, stdDev, min, area, areaUnit);
  });

  if (FrameOfReferenceUID) {
    columns.push('FrameOfReferenceUID');
    values.push(FrameOfReferenceUID);
  }

  if (points) {
    columns.push('points');
    // points has the form of [[x1, y1, z1], [x2, y2, z2], ...]
    // convert it to string of [[x1 y1 z1];[x2 y2 z2];...]
    // so that it can be used in the csv report
    values.push(points.map(p => p.join(' ')).join(';'));
  }

  return {
    columns,
    values,
  };
}

function getDisplayText(mappedAnnotations, displaySet, customizationService) {
  const displayText = {
    primary: [],
    secondary: [],
  };

  if (!mappedAnnotations || !mappedAnnotations.length) {
    return displayText;
  }

  // Area is the same for all series
  const { area, SOPInstanceUID, frameNumber, areaUnit, count } = mappedAnnotations[0];

  const instance = displaySet.instances.find(image => image.SOPInstanceUID === SOPInstanceUID);

  let InstanceNumber;
  if (instance) {
    InstanceNumber = instance.InstanceNumber;
  }

  const instanceText = InstanceNumber ? ` I: ${InstanceNumber}` : '';
  const frameText = displaySet.isMultiFrame ? ` F: ${frameNumber}` : '';

  const { value: cmArea, unit: cmAreaUnit } = toCmArea(area, areaUnit);
  const roundedArea = utils.roundNumber(cmArea, 2);
  // RadiAnt shows both the physical area AND the raw pixel count used for
  // the calculation side by side (User Manual v2021.2 sec. 2.7.2: "Area
  // (px) - Area in square centimeters and the number of pixels used for
  // calculations").
  const areaText = Number.isFinite(count)
    ? `${roundedArea} ${getDisplayUnit(cmAreaUnit)} (${count}px)`
    : `${roundedArea} ${getDisplayUnit(cmAreaUnit)}`;
  displayText.primary.push(areaText);

  // Todo: we need a better UI for displaying all these information
  mappedAnnotations.forEach(mappedAnnotation => {
    const { unit, mean, stdDev, max, min, SeriesNumber } = mappedAnnotation;

    // RadiAnt-parity ROI stats (User Manual v2021.2 sec. 2.7.2: Mean/SD/Max/Min).
    // Previously only Max was surfaced here even though mean/stdDev/min were
    // already computed and passed through - this panel is the persistent,
    // reviewable stats view, so it should show the same set the on-canvas
    // annotation label already does.
    if (Number.isFinite(max)) {
      displayText.primary.push(getStatisticDisplayString(max, unit, 'max'));
    }
    if (Number.isFinite(mean)) {
      displayText.primary.push(getStatisticDisplayString(mean, unit, 'mean'));
    }
    if (Number.isFinite(stdDev)) {
      displayText.primary.push(getStatisticDisplayString(stdDev, unit, 'SD'));
    }
    if (Number.isFinite(min)) {
      displayText.primary.push(getStatisticDisplayString(min, unit, 'min'));
    }
    displayText.secondary.push(`S: ${SeriesNumber}${instanceText}${frameText}`);
  });

  // RadiAnt-parity calibration provenance indicator (sec. 2.7.1) - only
  // shown for non-default calibration sources; see getCalibrationLabel.
  const calibrationLabel = getCalibrationLabel(areaUnit);
  if (calibrationLabel) {
    displayText.secondary.push(calibrationLabel);
  }

  return displayText;
}

export default EllipticalROI;
