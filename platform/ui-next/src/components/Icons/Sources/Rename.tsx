import React from 'react';
import type { IconProps } from '../types';

export const Rename = (props: IconProps) => (
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
    <path d="M15 47l4-12 24-24 10 10-24 24-12 4Z" />
    <line x1="38" y1="16" x2="48" y2="26" />
    <line x1="19" y1="35" x2="29" y2="45" />
  </svg>
);

export default Rename;
