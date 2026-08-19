import React from 'react';
import type { IconProps } from '../types';

export const Close = (props: IconProps) => (
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
    <rect x="12" y="12" width="40" height="40" rx="5" />
    <line x1="22" y1="22" x2="42" y2="42" />
    <line x1="42" y1="22" x2="22" y2="42" />
  </svg>
);

export default Close;
