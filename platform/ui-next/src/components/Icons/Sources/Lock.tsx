import React from 'react';
import type { IconProps } from '../types';

export const Lock = (props: IconProps) => (
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
    <rect x="16" y="28" width="32" height="25" rx="4" />
    <path d="M22 28v-8a10 10 0 0 1 20 0v8" />
    <circle cx="32" cy="39" r="3" fill="currentColor" stroke="none" />
    <line x1="32" y1="42" x2="32" y2="47" />
  </svg>
);

export default Lock;
