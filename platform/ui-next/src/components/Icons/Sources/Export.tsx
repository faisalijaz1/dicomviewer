import React from 'react';
import type { IconProps } from '../types';

export const Export = (props: IconProps) => (
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
    <rect x="11" y="30" width="42" height="23" rx="4" />
    <line x1="32" y1="44" x2="32" y2="11" />
    <line x1="32" y1="11" x2="35.5" y2="17.062177826491073" />
    <line x1="32" y1="11" x2="28.500000000000004" y2="17.062177826491073" />
    <line x1="21" y1="21" x2="32" y2="11" />
    <line x1="43" y1="21" x2="32" y2="11" />
  </svg>
);

export default Export;
