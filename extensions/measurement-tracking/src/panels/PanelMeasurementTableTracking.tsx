import React from 'react';
import { useSystem, utils } from '@ohif/core';
import { AccordionTrigger, MeasurementTable, ScrollArea, useViewportGrid } from '@ohif/ui-next';
import {
  PanelMeasurement,
  StudyMeasurements,
  StudySummaryFromMetadata,
  AccordionGroup,
  StudyMeasurementsActions,
  MeasurementsOrAdditionalFindings,
} from '@ohif/extension-cornerstone';

import { useTrackedMeasurements } from '../getContextModule';

const { filterMeasurementsBySeriesUID, filterAny } = utils.MeasurementFilters;

function PanelMeasurementTableTracking(props) {
  const [viewportGrid] = useViewportGrid();
  const { servicesManager } = useSystem();
  const { measurementService } = servicesManager.services;

  const [trackedMeasurements, sendTrackedMeasurementsEvent] = useTrackedMeasurements();
  const { trackedStudy, trackedSeries } = trackedMeasurements.context;
  const measurementFilter = trackedStudy ? filterMeasurementsBySeriesUID(trackedSeries) : filterAny;



  const EmptyComponent = () => (
    <div data-cy="trackedMeasurements-panel">
      <MeasurementTable
        title="Measurements"
        isExpanded={false}
      >
        <MeasurementTable.Body />
      </MeasurementTable>
    </div>
  );

  const actions = {
    createSR: ({ StudyInstanceUID }) => {
      sendTrackedMeasurementsEvent('SAVE_REPORT', {
        viewportId: viewportGrid.activeViewportId,
        isBackupSave: true,
        StudyInstanceUID,
        measurementFilter,
      });
    },
  };

  const Header = props => (
    <AccordionTrigger
      asChild={true}
      className="px-0"
    >
      <div data-cy="TrackingHeader">
        <StudySummaryFromMetadata
          {...props}
          actions={actions}
        />
      </div>
    </AccordionTrigger>
  );

  return (
    <ScrollArea>
      <div data-cy="trackedMeasurements-panel">
        <PanelMeasurement
          measurementFilter={measurementFilter}
          emptyComponent={EmptyComponent}
          sourceChildren={props.children}
        >
          <StudyMeasurements grouping={props.grouping}>
            <AccordionGroup.Trigger
              key="trackingMeasurementsHeader"
              asChild={true}
            >
              <Header key="trackingHeadChild" />
            </AccordionGroup.Trigger>
            <MeasurementsOrAdditionalFindings
              key="measurementsOrAdditionalFindings"
              activeStudyUID={trackedStudy}
              customHeader={StudyMeasurementsActions}
              measurementFilter={measurementFilter}
              actions={actions}
            />
          </StudyMeasurements>
        </PanelMeasurement>
      </div>
    </ScrollArea>
  );
}

export default PanelMeasurementTableTracking;
