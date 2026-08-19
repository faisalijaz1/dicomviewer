import React from 'react';
import type { IconProps } from '../types';

export const ViewportViews = (props: IconProps) => (
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
    <rect x="12" y="15" width="32" height="30" rx="3" />
    <rect x="20" y="22" width="32" height="30" rx="3" />
    <line x1="25" y1="29" x2="44" y2="29" strokeWidth="1.5" />
    <line x1="25" y1="35" x2="39" y2="35" strokeWidth="1.5" />
    <circle cx="45" cy="44" r="3" fill="currentColor" fillOpacity=".22" />
  </svg>
);

export default ViewportViews;
