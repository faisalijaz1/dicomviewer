import React from 'react';
import type { IconProps } from '../types';

export const GearSettings = (props: IconProps) => (
  <svg
    width="29px"
    height="29px"
    viewBox="0 0 64 64"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.25"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <circle cx="32" cy="32" r="9" />
    <line x1="49.0" y1="32.0" x2="55.0" y2="32.0" strokeWidth="4" />
    <line x1="44.02" y1="44.02" x2="48.26" y2="48.26" strokeWidth="4" />
    <line x1="32.0" y1="49.0" x2="32.0" y2="55.0" strokeWidth="4" />
    <line x1="19.98" y1="44.02" x2="15.74" y2="48.26" strokeWidth="4" />
    <line x1="15.0" y1="32.0" x2="9.0" y2="32.0" strokeWidth="4" />
    <line x1="19.98" y1="19.98" x2="15.74" y2="15.74" strokeWidth="4" />
    <line x1="32.0" y1="15.0" x2="32.0" y2="9.0" strokeWidth="4" />
    <line x1="44.02" y1="19.98" x2="48.26" y2="15.74" strokeWidth="4" />
    <circle cx="32" cy="32" r="20" />
  </svg>
);

export default GearSettings;
