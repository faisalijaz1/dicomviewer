import React from 'react';
import type { IconProps } from '../types';

export const Info = (props: IconProps) => (
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
    <circle cx="32" cy="32" r="21" />
    <circle cx="32" cy="22" r="2.5" fill="currentColor" stroke="none" />
    <line x1="32" y1="30" x2="32" y2="43" />
    <line x1="27" y1="43" x2="37" y2="43" />
  </svg>
);

export default Info;
