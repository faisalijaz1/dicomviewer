import React from 'react';
import type { IconProps } from '../types';

export const Add = (props: IconProps) => (
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
    <circle cx="32" cy="32" r="20" />
    <line x1="23" y1="32" x2="41" y2="32" />
    <line x1="32" y1="23" x2="32" y2="41" />
  </svg>
);

export default Add;
