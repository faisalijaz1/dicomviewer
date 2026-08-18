import React from 'react';
import HeaderPatientInfo from './HeaderPatientInfo';
import { PatientInfoVisibility } from './HeaderPatientInfo/HeaderPatientInfo';

/**
 * Renders the patient info card at the top of the left side panel, above the
 * panel's own tabs/content (e.g. "Studies"). Moved out of the top bar so the
 * toolbar has more width to work with.
 */
function LeftPanelPatientInfo({ servicesManager, appConfig }: withAppTypes) {
  if (appConfig.showPatientInfo === PatientInfoVisibility.DISABLED) {
    return null;
  }

  return (
    <div className="flex flex-shrink-0 flex-col gap-2 border-b border-white/10 px-2 pb-2.5 pt-2">
      <HeaderPatientInfo
        servicesManager={servicesManager}
        appConfig={appConfig}
      />
    </div>
  );
}

export default LeftPanelPatientInfo;
