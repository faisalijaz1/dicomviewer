import React from 'react';
import type { IconProps } from '../types';

export const WindowLevelAdvanced = (props: IconProps) => (
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
    <circle cx="26" cy="31" r="17" />
    <path d="M26 14a17 17 0 0 0 0 34Z" fill="currentColor" stroke="none" />
    <line x1="26" y1="14" x2="26" y2="48" />
    <line x1="47" y1="16" x2="47" y2="46" />
    <line x1="42" y1="23" x2="52" y2="23" />
    <circle cx="47" cy="23" r="2.5" fill="currentColor" stroke="none" />
    <line x1="42" y1="38" x2="52" y2="38" />
    <circle cx="47" cy="38" r="2.5" fill="currentColor" stroke="none" />
  </svg>
);

export default WindowLevelAdvanced;
