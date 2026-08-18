// Global (not per-viewport) show/hide toggle for patient/study-identifying
// viewport overlay text (name, MRN, DOB/sex/age, study date, institution,
// study/series description, procedure code - the top-left and top-right
// overlay corners) - a quick way to hide PHI from the screen (e.g. before
// screen-sharing) without closing the study. Plain module state + a DOM
// event, rather than a service, since this is a simple boolean with no
// persistence/other requirements.
const EVENT_NAME = 'OHIF_PATIENT_INFO_VISIBILITY_CHANGED';

let isVisible = true;

export function getPatientInfoVisible(): boolean {
  return isVisible;
}

export function togglePatientInfoVisible(): void {
  isVisible = !isVisible;
  document.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { isVisible } }));
}

export function subscribePatientInfoVisible(callback: (isVisible: boolean) => void): () => void {
  const handler = (evt: CustomEvent) => callback(evt.detail.isVisible);
  document.addEventListener(EVENT_NAME, handler as EventListener);
  return () => document.removeEventListener(EVENT_NAME, handler as EventListener);
}
