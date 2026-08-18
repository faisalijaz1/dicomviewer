function getModalityFilterFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const key = [...params.keys()].find(k => k.toLowerCase() === 'modality');
  return key ? params.get(key) : null;
}

function requestDisplaySetCreationForStudy(
  dataSource,
  displaySetService,
  StudyInstanceUID,
  madeInClient
) {
  // TODO: is this already short-circuited by the map of Retrieve promises?
  if (
    displaySetService.activeDisplaySets.some(
      displaySet => displaySet.StudyInstanceUID === StudyInstanceUID
    )
  ) {
    return;
  }

  const modality = getModalityFilterFromUrl();
  const filters = modality ? { Modality: [modality] } : {};

  return dataSource.retrieve.series.metadata({ StudyInstanceUID, madeInClient, filters });
}

export default requestDisplaySetCreationForStudy;
