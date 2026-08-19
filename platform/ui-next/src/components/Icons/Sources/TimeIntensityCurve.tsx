import React from 'react';
import type { IconProps } from '../types';

export const TimeIntensityCurve = (props: IconProps) => (
  <svg
    width="25px"
    height="25px"
    viewBox="0 0 64 64"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.25"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <line x1="11" y1="51" x2="54" y2="51" />
    <line x1="11" y1="51" x2="11" y2="12" />
    <path d="M15 46c6-1 9-3 13-10 4-8 7-15 13-15 7 0 8 12 12 20" />
    <circle cx="16" cy="45" r="2.5" fill="currentColor" stroke="none" />
    <circle cx="28" cy="36" r="2.5" fill="currentColor" stroke="none" />
    <circle cx="41" cy="21" r="2.5" fill="currentColor" stroke="none" />
    <circle cx="52" cy="41" r="2.5" fill="currentColor" stroke="none" />
  </svg>
);

export default TimeIntensityCurve;
