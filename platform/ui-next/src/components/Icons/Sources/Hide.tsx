import React from 'react';
import type { IconProps } from '../types';

export const Hide = (props: IconProps) => (
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
    <path d="M10 32c5.5-8 13-12 22-12s16.5 4 22 12c-5.5 8-13 12-22 12S15.5 40 10 32Z" />
    <circle cx="32" cy="32" r="5" />
    <line x1="13" y1="13" x2="51" y2="51" />
  </svg>
);

export default Hide;
