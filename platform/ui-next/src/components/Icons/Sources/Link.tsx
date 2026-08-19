import React from 'react';
import type { IconProps } from '../types';

export const Link = (props: IconProps) => (
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
    <path d="M23 39l-5 5a9 9 0 0 1-13-13l9-9a9 9 0 0 1 13 0" />
    <path d="M41 25l5-5a9 9 0 0 1 13 13l-9 9a9 9 0 0 1-13 0" />
    <line x1="22" y1="42" x2="42" y2="22" />
  </svg>
);

export default Link;
