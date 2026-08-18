import dcmjs from 'dcmjs';
import { sortStudySeries } from '@ohif/core/src/utils/sortStudy';
import RetrieveMetadataLoader from './retrieveMetadataLoader';

// Series Date, Series Time, Series Description and Series Number to be included
// in the series metadata query result
const includeField = ['00080021', '00080031', '0008103E', '00200011'].join(',');

/**
 * Class for sync load of study metadata.
 * SKM PACS does not expose GET /studies/{uid}/metadata — load per-series instead.
 */
export default class RetrieveMetadataLoaderSync extends RetrieveMetadataLoader {
  *getPreLoaders() {
    const preLoaders = [];
    const { studyInstanceUID, filters: { seriesInstanceUID, Modality, modality } = {}, client } =
      this;

    const options = {
      studyInstanceUID,
      queryParams: {
        includefield: includeField,
      },
    };

    const modalityFilter = Modality?.[0] || modality?.[0];
    if (modalityFilter) {
      options.queryParams.Modality = modalityFilter;
    }

    if (seriesInstanceUID) {
      options.queryParams.SeriesInstanceUID = seriesInstanceUID;
      preLoaders.push(client.searchForSeries.bind(client, options));
    }
    preLoaders.push(client.searchForSeries.bind(client, options));

    yield* preLoaders;
  }

  async preLoad() {
    const preLoaders = this.getPreLoaders();
    const result = await this.runLoaders(preLoaders);
    const { naturalizeDataset } = dcmjs.data.DicomMetaDictionary;
    const naturalized = result.map(naturalizeDataset);

    return sortStudySeries(naturalized, this.sortCriteria, this.sortFunction);
  }

  async load(seriesList) {
    if (!seriesList?.length) {
      return [];
    }

    const { studyInstanceUID, client, filters: { seriesInstanceUID } = {} } = this;

    let seriesUIDs = seriesList.map(s => s.SeriesInstanceUID).filter(Boolean);

    if (seriesInstanceUID) {
      const filterSet = new Set(
        Array.isArray(seriesInstanceUID) ? seriesInstanceUID : [seriesInstanceUID]
      );
      seriesUIDs = seriesUIDs.filter(uid => filterSet.has(uid));
    }

    const allInstances = [];
    for (const uid of seriesUIDs) {
      try {
        const instances = await client.retrieveSeriesMetadata({
          studyInstanceUID,
          seriesInstanceUID: uid,
        });
        if (instances?.length) {
          allInstances.push(...instances);
        }
      } catch (err) {
        console.warn(`Failed to load metadata for series ${uid}`, err);
      }
    }

    return allInstances;
  }

  async posLoad(loadData) {
    return loadData;
  }
}
