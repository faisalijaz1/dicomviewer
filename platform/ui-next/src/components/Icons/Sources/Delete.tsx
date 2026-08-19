import React from 'react';
import type { IconProps } from '../types';

export const Delete = (props: IconProps) => (
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
    <path d="M17 20h30" />
    <path d="M25 14h14l2 6H23l2-6Z" />
    <path d="M21 20l2 34h18l2-34" />
    <line x1="28" y1="28" x2="29" y2="46" />
    <line x1="36" y1="28" x2="35" y2="46" />
  </svg>
);

export default Delete;
