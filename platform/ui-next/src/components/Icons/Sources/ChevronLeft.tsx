import React from 'react';
import type { IconProps } from '../types';

export const ChevronLeft = (props: IconProps) => (
  <svg
    width="21px"
    height="21px"
    viewBox="0 0 64 64"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.25"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <polyline points="40,16 24,32 40,48" strokeWidth="3" />
  </svg>
);

export default ChevronLeft;
