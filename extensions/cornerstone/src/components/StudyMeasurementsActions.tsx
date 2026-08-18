import React from 'react';
import { Button, Icons } from '@ohif/ui-next';
import { useSystem } from '@ohif/core';
import { useTranslation } from 'react-i18next';

export function StudyMeasurementsActions({ items, StudyInstanceUID, measurementFilter }) {
  const { commandsManager, servicesManager, extensionManager } = useSystem();
  const { t } = useTranslation('MeasurementTable');
  const sessionService = servicesManager?.services?.sessionService;

  const canSave = sessionService ? sessionService.hasPermission('SAVE_SR') : true;

  const disabled = !items?.length;

  if (disabled) {
    return null;
  }

  return (
    <div className="bg-background flex h-9 w-full items-center rounded pr-0.5">
      <div className="flex space-x-1">
        <Button
          size="sm"
          variant="ghost"
          className="pl-1.5"
          onClick={() => {
            commandsManager.runCommand('downloadCSVMeasurementsReport', {
              StudyInstanceUID,
              measurementFilter,
            });
          }}
        >
          <Icons.Download className="h-5 w-5" />
          <span className="pl-1">CSV</span>
        </Button>

        <Button
          size="sm"
          variant="ghost"
          className="pl-0.5"
          disabled={!canSave}
          title={!canSave ? "Login required to save measurements." : undefined}
          onClick={async e => {
            e.stopPropagation();

            try {
              // Builds a real TID 1500 DICOM SR from the actual Cornerstone tool
              // state (via @cornerstonejs/adapters) and STOWs it to the configured
              // data source — the same path OHIF's own "Create Report" flow uses.
              // This is what lets another radiologist reopen the study later and
              // see these measurements rehydrated onto the images, not just a
              // text dump: the previous custom /api/dicom/sr endpoint produced a
              // minimal SR with no real graphic coordinates or image references,
              // which OHIF's SR viewport can't rehydrate from.
              let doctorName = sessionService?.getFullName() || sessionService?.getUserId() || 'Unknown';
              // Remove Dtr. or Dr. prefix as requested by user
              doctorName = doctorName.replace(/^(Dtr\.|Dr\.)\s*/i, '');
              const dateStr = new Date().toLocaleDateString('en-GB');
              // "|" separates author from date so the Study Browser thumbnail (Thumbnail.tsx)
              // can render them as a proper two-line "who + when" layout instead of one
              // truncated blob. The modality badge already shows "SR" next to this, so the
              // old "SR: " prefix was redundant.
              const dynamicSeriesDesc = `${doctorName}|${dateStr}`;

              await commandsManager.runCommand(
                'storeMeasurements',
                {
                  measurementData: items,
                  dataSource: extensionManager.defaultDataSourceName,
                  additionalFindingTypes: ['ArrowAnnotate'],
                  options: {
                    SeriesDescription: dynamicSeriesDesc,
                  },
                },
                'CORNERSTONE_STRUCTURED_REPORT'
              );

              servicesManager?.services?.uiNotificationService?.show({
                title: 'SR Created',
                message: 'Successfully saved DICOM SR. Reloading study...',
                type: 'success',
              });

              // Force a reload of the study to guarantee the new SR is fetched and displayed
              setTimeout(() => {
                window.location.reload();
              }, 1500);
            } catch (err) {
              console.error('Failed to create SR:', err);
              servicesManager?.services?.uiNotificationService?.show({
                title: 'Save Failed',
                message: err?.message || 'Failed to create DICOM SR.',
                type: 'error',
              });
            }
          }}
        >
          <Icons.Add />
          {t('Create SR')}
        </Button>
      </div>
    </div>
  );
}

export default StudyMeasurementsActions;
