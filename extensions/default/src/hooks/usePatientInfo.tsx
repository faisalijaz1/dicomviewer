import { useState, useEffect } from 'react';
import { utils } from '@ohif/core';

const { formatPN } = utils;

function usePatientInfo(servicesManager) {
  const { displaySetService } = servicesManager.services;

  const [patientInfo, setPatientInfo] = useState({
    PatientName: '',
    PatientID: '',
    PatientSex: '',
    PatientDOB: '',
  });
  const [studyDescription, setStudyDescription] = useState('');
  const [modalities, setModalities] = useState('');
  const [isMixedPatients, setIsMixedPatients] = useState(false);

  const checkMixedPatients = (PatientID: string) => {
    const displaySets = displaySetService.getActiveDisplaySets();
    let mixed = false;
    displaySets.forEach(displaySet => {
      const instance = displaySet?.instances?.[0] || displaySet?.instance;
      if (!instance) return;
      if (instance.PatientID !== PatientID) mixed = true;
    });
    setIsMixedPatients(mixed);
  };

  const collectModalities = displaySets => {
    const mods = new Set<string>();
    displaySets.forEach(ds => {
      const inst = ds?.instances?.[0] || ds?.instance;
      if (inst?.Modality) mods.add(inst.Modality);
    });
    return Array.from(mods).join('/');
  };

  const updatePatientInfo = ({ displaySetsAdded }) => {
    if (!displaySetsAdded.length) return;

    const displaySet = displaySetsAdded[0];
    const instance = displaySet?.instances?.[0] || displaySet?.instance;
    if (!instance) return;

    setPatientInfo({
      PatientID: instance.PatientID || '',
      PatientName: instance.PatientName ? formatPN(instance.PatientName) : '',
      PatientSex: instance.PatientSex || '',
      PatientDOB: instance.PatientBirthDate || '',
    });
    setStudyDescription(instance.StudyDescription || '');
    setModalities(collectModalities(displaySetService.getActiveDisplaySets()));
    checkMixedPatients(instance.PatientID || '');
  };

  useEffect(() => {
    const subscription = displaySetService.subscribe(
      displaySetService.EVENTS.DISPLAY_SETS_ADDED,
      props => updatePatientInfo(props)
    );
    return () => subscription.unsubscribe();
  }, []);

  return { patientInfo, isMixedPatients, studyDescription, modalities };
}

export default usePatientInfo;
