import React from 'react';
import type { IconProps } from '../types';

export const Redo = (props: IconProps) => (
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
    <path d="M46 22h10L46 12" />
    <path d="M55 22H33c-13 0-22 7-22 19 0 6 3 10 7 13" />
  </svg>
);

export default Redo;
