import React from 'react';
import type { IconProps } from '../types';

export const OrientationSwitch = (props: IconProps) => (
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
    <polygon points="32.0,16 44,22.0 44,34.0 32.0,40 20,34.0 20,22.0" fill="none" />
    <line x1="32.0" y1="16" x2="32.0" y2="40" />
    <line x1="20" y1="22.0" x2="32.0" y2="28.0" />
    <line x1="44" y1="22.0" x2="32.0" y2="28.0" />
    <line x1="13" y1="50" x2="53" y2="50" />
    <line x1="32" y1="10" x2="32" y2="54" />
    <line x1="9" y1="32" x2="55" y2="32" strokeDasharray="3 3" />
    <circle cx="53" cy="50" r="2" fill="currentColor" stroke="none" />
    <circle cx="32" cy="10" r="2" fill="currentColor" stroke="none" />
  </svg>
);

export default OrientationSwitch;
