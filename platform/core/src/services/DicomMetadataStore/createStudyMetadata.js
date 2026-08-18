import createSeriesMetadata from './createSeriesMetadata';

function createStudyMetadata(StudyInstanceUID) {
  return {
    StudyInstanceUID,
    StudyDescription: '',
    ModalitiesInStudy: [],
    isLoaded: false,
    series: [],
    /**
     * @param {object} instance
     */
    addInstanceToSeries: function (instance) {
      this.addInstancesToSeries([instance]);
    },
    /**
     * @param {object[]} instances
     * @param {string} instances[].SeriesInstanceUID
     * @param {string} instances[].StudyDescription
     */
    addInstancesToSeries: function (instances) {
      const { SeriesInstanceUID } = instances[0];
      if (!this.StudyDescription) {
        this.StudyDescription = instances[0].StudyDescription;
      }
      let series = this.series.find(s => s.SeriesInstanceUID === SeriesInstanceUID);

      if (!series) {
        series = createSeriesMetadata(SeriesInstanceUID);
        this.series.push(series);
      }

      // Callers are expected to pass a single-series batch (using
      // instances[0]'s SeriesInstanceUID for all of them above), but a stray
      // instance from a different series occasionally slips into the batch
      // - seen in practice as a localizer/scout instance ending up attributed
      // to an otherwise-clean multi-slice series, with a completely
      // different ImageOrientationPatient, silently breaking that series'
      // reconstructability (MPR/Crosshairs) for no reason visible to the
      // radiologist. Guard against it here rather than trusting the batch.
      const matchingInstances = instances.filter(
        instance => instance.SeriesInstanceUID === SeriesInstanceUID
      );

      if (matchingInstances.length !== instances.length) {
        console.warn(
          `DicomMetadataStore: dropped ${instances.length - matchingInstances.length} instance(s) that didn't match the batch's SeriesInstanceUID (${SeriesInstanceUID})`,
          instances
            .filter(instance => instance.SeriesInstanceUID !== SeriesInstanceUID)
            .map(instance => ({
              SOPInstanceUID: instance.SOPInstanceUID,
              SeriesInstanceUID: instance.SeriesInstanceUID,
            }))
        );
      }

      series.addInstances(matchingInstances);
    },

    setSeriesMetadata: function (SeriesInstanceUID, seriesMetadata) {
      let existingSeries = this.series.find(s => s.SeriesInstanceUID === SeriesInstanceUID);

      if (existingSeries) {
        existingSeries = Object.assign(existingSeries, seriesMetadata);
      } else {
        const series = createSeriesMetadata(SeriesInstanceUID);
        this.series.push(Object.assign(series, seriesMetadata));
      }
    },
  };
}

export default createStudyMetadata;
