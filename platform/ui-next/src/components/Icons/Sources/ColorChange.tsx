import React from 'react';
import type { IconProps } from '../types';

export const ColorChange = (props: IconProps) => (
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
    <path d="M17 14h19l13 13-19 19-13-13V14Z" />
    <circle cx="24" cy="22" r="3" />
    <path
      d="M43 39c5 0 9 4 9 9 0 4-3 7-7 7-5 0-8-4-7-8 1-3 3-5 5-8Z"
      fill="currentColor"
      fillOpacity=".18"
    />
  </svg>
);

export default ColorChange;
