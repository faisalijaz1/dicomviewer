import React from 'react';
import type { IconProps } from '../types';

export const Copy = (props: IconProps) => (
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
    <rect x="19" y="13" width="30" height="36" rx="4" />
    <rect x="13" y="19" width="30" height="36" rx="4" />
    <line x1="23" y1="29" x2="35" y2="29" strokeWidth="1.5" />
    <line x1="23" y1="35" x2="37" y2="35" strokeWidth="1.5" />
  </svg>
);

export default Copy;
