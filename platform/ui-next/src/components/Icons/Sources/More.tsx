import React from 'react';
import type { IconProps } from '../types';

export const More = (props: IconProps) => (
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
    <circle cx="18" cy="32" r="3" fill="currentColor" stroke="none" />
    <circle cx="32" cy="32" r="3" fill="currentColor" stroke="none" />
    <circle cx="46" cy="32" r="3" fill="currentColor" stroke="none" />
  </svg>
);

export default More;
