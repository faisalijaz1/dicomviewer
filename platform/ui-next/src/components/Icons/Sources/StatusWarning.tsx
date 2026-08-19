import React from 'react';
import type { IconProps } from '../types';

export const StatusWarning = (props: IconProps) => (
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
    <polygon points="32,9 56,52 8,52" />
    <line x1="32" y1="23" x2="32" y2="37" />
    <circle cx="32" cy="45" r="2" fill="currentColor" stroke="none" />
  </svg>
);

export default StatusWarning;
