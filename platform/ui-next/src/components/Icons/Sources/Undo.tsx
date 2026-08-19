import React from 'react';
import type { IconProps } from '../types';

export const Undo = (props: IconProps) => (
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
    <path d="M18 22H8l10-10" />
    <path d="M9 22h22c13 0 22 7 22 19 0 6-3 10-7 13" />
  </svg>
);

export default Undo;
