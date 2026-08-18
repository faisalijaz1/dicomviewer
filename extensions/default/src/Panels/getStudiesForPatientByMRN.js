function getModalityFilterFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const key = [...params.keys()].find(k => k.toLowerCase() === 'modality');
  return key ? params.get(key) : null;
}

async function getStudiesForPatientByMRN(dataSource, qidoForStudyUID) {
  if (!qidoForStudyUID?.length) {
    return [];
  }

  // Opened from PACS workstation with a modality filter — show only the requested study.
  const modalityFilter = getModalityFilterFromUrl();
  if (modalityFilter) {
    return qidoForStudyUID;
  }

  const mrn = qidoForStudyUID[0].mrn;

  // if not defined or empty, return the original qidoForStudyUID
  if (!mrn) {
    return qidoForStudyUID;
  }

  return dataSource.query.studies.search({
    patientId: mrn,
    disableWildcard: true,
  });
}

export default getStudiesForPatientByMRN;
