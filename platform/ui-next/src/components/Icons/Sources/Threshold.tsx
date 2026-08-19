import React from 'react';
import type { IconProps } from '../types';

export const Threshold = (props: IconProps) => (
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
    <line x1="10" y1="50" x2="54" y2="50" />
    <line x1="10" y1="50" x2="10" y2="14" />
    <rect x="15" y="42" width="5" height="8" rx="1" fill="currentColor" fillOpacity=".18" />
    <rect x="22" y="36" width="5" height="14" rx="1" fill="currentColor" fillOpacity=".18" />
    <rect x="29" y="26" width="5" height="24" rx="1" fill="currentColor" fillOpacity=".18" />
    <rect x="36" y="32" width="5" height="18" rx="1" fill="currentColor" fillOpacity=".18" />
    <rect x="43" y="20" width="5" height="30" rx="1" fill="currentColor" fillOpacity=".18" />
    <line x1="34" y1="12" x2="34" y2="53" />
    <polygon points="31,12 37,12 34,17" fill="currentColor" stroke="none" />
  </svg>
);

export default Threshold;
