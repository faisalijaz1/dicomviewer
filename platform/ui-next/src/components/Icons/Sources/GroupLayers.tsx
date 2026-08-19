import React from 'react';
import type { IconProps } from '../types';

export const GroupLayers = (props: IconProps) => (
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
    <rect x="15.0" y="15" width="34" height="5" rx="1.2" />
    <rect x="12.0" y="23" width="40" height="5" rx="1.2" />
    <rect x="9.0" y="31" width="46" height="5" rx="1.2" />
    <rect x="12.0" y="39" width="40" height="5" rx="1.2" />
    <path d="M52 16v27" />
    <line x1="48" y1="16" x2="56" y2="16" />
    <line x1="48" y1="43" x2="56" y2="43" />
    <line x1="49" y1="29" x2="55" y2="29" strokeDasharray="2 2" />
  </svg>
);

export default GroupLayers;
