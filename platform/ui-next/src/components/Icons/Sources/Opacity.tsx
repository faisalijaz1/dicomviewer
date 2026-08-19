import React from 'react';
import type { IconProps } from '../types';

export const Opacity = (props: IconProps) => (
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
    <rect x="12" y="19" width="28" height="28" rx="3" fill="currentColor" fillOpacity=".08" />
    <rect x="20" y="13" width="28" height="28" rx="3" fill="currentColor" fillOpacity=".16" />
    <rect x="28" y="21" width="24" height="24" rx="3" fill="currentColor" fillOpacity=".28" />
  </svg>
);

export default Opacity;
