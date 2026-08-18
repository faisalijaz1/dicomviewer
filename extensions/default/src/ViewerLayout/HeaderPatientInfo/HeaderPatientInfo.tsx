import React from 'react';
import usePatientInfo from '../../hooks/usePatientInfo';
import { Icons } from '@ohif/ui-next';

export enum PatientInfoVisibility {
  VISIBLE = 'visible',
  VISIBLE_COLLAPSED = 'visibleCollapsed',
  DISABLED = 'disabled',
  VISIBLE_READONLY = 'visibleReadOnly',
}

const formatWithEllipsis = (str: string, maxLength: number) => {
  if (str?.length > maxLength) {
    return str.substring(0, maxLength) + '...';
  }
  return str;
};

function getInitials(name: string): string {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatAge(dob: string): string {
  if (!dob) return '';
  const digits = dob.replace(/\D/g, '');
  if (digits.length < 8) return '';
  const year = parseInt(digits.slice(0, 4), 10);
  const month = parseInt(digits.slice(4, 6), 10) - 1;
  const day = parseInt(digits.slice(6, 8), 10);
  const birth = new Date(year, month, day);
  if (isNaN(birth.getTime())) return '';
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age >= 0 ? `${age}y` : '';
}

function HeaderPatientInfo({ servicesManager, appConfig }: withAppTypes) {
  const { patientInfo, isMixedPatients, studyDescription, modalities } =
    usePatientInfo(servicesManager);

  if (appConfig.showPatientInfo === PatientInfoVisibility.DISABLED) {
    return null;
  }

  if (isMixedPatients) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#0b1120]/80 px-3 py-1.5 backdrop-blur-sm">
        <Icons.MultiplePatients className="text-primary h-5 w-5" />
        <span className="text-foreground text-[13px] font-semibold">Multiple Patients</span>
      </div>
    );
  }

  const formattedPatientName = formatWithEllipsis(patientInfo.PatientName, 32);
  const formattedPatientID = formatWithEllipsis(patientInfo.PatientID, 18);
  const age = formatAge(patientInfo.PatientDOB);
  const studyLine = [studyDescription, modalities].filter(Boolean).join(' · ');

  return (
    <div className="flex min-w-0 items-center gap-1.5 rounded-lg border border-white/10 bg-[#0b1120]/80 px-2 py-1.5 backdrop-blur-sm sm:gap-2.5 sm:px-3">
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#2563eb] text-[11px] font-bold text-white shadow-[0_0_8px_rgba(37,99,235,0.4)]">
        {getInitials(patientInfo.PatientName)}
      </div>
      <div className="flex min-w-0 flex-col justify-center">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="text-foreground max-w-[110px] truncate text-[13px] font-bold leading-tight sm:max-w-[220px]">
            {formattedPatientName || 'Unknown Patient'}
          </span>
          {formattedPatientID && (
            <span className="hidden rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white/80 sm:inline-block">
              MRN {formattedPatientID}
            </span>
          )}
          {patientInfo.PatientSex && (
            <span className="hidden rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white/80 md:inline-block">
              {patientInfo.PatientSex}
            </span>
          )}
          {age && (
            <span className="hidden rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white/80 md:inline-block">
              {age}
            </span>
          )}
        </div>
        {studyLine && (
          <div className="text-muted-foreground mt-0.5 hidden max-w-[220px] truncate text-[10px] leading-tight lg:block">
            {studyLine}
          </div>
        )}
      </div>
    </div>
  );
}

export default HeaderPatientInfo;
