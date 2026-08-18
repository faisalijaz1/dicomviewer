export default {
  'viewportOverlay.topLeft': [
    {
      id: 'PatientName',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Patient Name',
      condition: ({ referenceInstance }) => referenceInstance?.PatientName,
      contentF: ({ referenceInstance, formatters: { formatPN } }) =>
        formatPN(referenceInstance.PatientName),
    },
    {
      id: 'PatientID',
      inheritsFrom: 'ohif.overlayItem',
      label: 'MRN',
      title: 'Patient ID',
      condition: ({ referenceInstance }) => referenceInstance?.PatientID,
      contentF: ({ referenceInstance }) => referenceInstance.PatientID,
    },
    {
      id: 'StudyDate',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Study date',
      condition: ({ referenceInstance }) => referenceInstance?.StudyDate,
      contentF: ({ referenceInstance, formatters: { formatDate } }) =>
        formatDate(referenceInstance.StudyDate),
    },
    {
      id: 'SeriesDescription',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Series description',
      condition: ({ referenceInstance }) => {
        return referenceInstance && referenceInstance.SeriesDescription;
      },
      contentF: ({ referenceInstance }) => referenceInstance.SeriesDescription,
    },
  ],
  'viewportOverlay.topRight': [
    {
      id: 'Modality',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Modality',
      condition: ({ referenceInstance }) => referenceInstance?.Modality,
      contentF: ({ referenceInstance }) => referenceInstance.Modality,
    },
    {
      // No single canonical DICOM tag for "performed location" - best-effort,
      // falls through several plausible tags. Only renders if the PACS
      // actually populates one of them.
      id: 'PerformedLocation',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Performed Location',
      condition: ({ referenceInstance }) =>
        referenceInstance?.InstitutionalDepartmentName || referenceInstance?.PerformedStationName,
      contentF: ({ referenceInstance }) =>
        referenceInstance.InstitutionalDepartmentName || referenceInstance.PerformedStationName,
    },
    {
      // CPT isn't a native DICOM element either - carried (if present) as a
      // procedure code sequence's CodeValue. Best-effort, same as above.
      id: 'ProcedureCode',
      inheritsFrom: 'ohif.overlayItem',
      label: 'CPT:',
      title: 'Procedure Code',
      condition: ({ referenceInstance }) => {
        const seq =
          referenceInstance?.RequestedProcedureCodeSequence ||
          referenceInstance?.ProcedureCodeSequence;
        const first = Array.isArray(seq) ? seq[0] : seq;
        return !!first?.CodeValue;
      },
      contentF: ({ referenceInstance }) => {
        const seq =
          referenceInstance.RequestedProcedureCodeSequence ||
          referenceInstance.ProcedureCodeSequence;
        const first = Array.isArray(seq) ? seq[0] : seq;
        return first.CodeValue;
      },
    },
  ],
  'viewportOverlay.bottomLeft': [
    {
      id: 'WindowLevelPresetLabel',
      inheritsFrom: 'ohif.overlayItem.windowLevelPresetLabel',
      title: 'Window Level Preset',
    },
    {
      id: 'WindowLevel',
      inheritsFrom: 'ohif.overlayItem.windowLevel',
      title: 'Window Level',
    },
    {
      id: 'ZoomLevel',
      inheritsFrom: 'ohif.overlayItem.zoomLevel',
      condition: props => {
        const activeToolName = props.toolGroupService.getActiveToolForViewport(props.viewportId);
        return activeToolName === 'Zoom';
      },
    },
  ],
  'viewportOverlay.bottomRight': [
    {
      id: 'InstanceNumber',
      inheritsFrom: 'ohif.overlayItem.instanceNumber',
      title: 'Instance Number',
    },
  ],
};
