import React from 'react';
import type { IconProps } from '../types';

export const JumpToSlice = (props: IconProps) => (
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
    <line x1="10" y1="18" x2="28" y2="18" />
    <line x1="10" y1="29" x2="28" y2="29" />
    <line x1="10" y1="40" x2="28" y2="40" />
    <line x1="10" y1="51" x2="28" y2="51" />
    <line x1="38" y1="13" x2="55" y2="13" />
    <line x1="38" y1="24" x2="55" y2="24" />
    <line x1="38" y1="35" x2="55" y2="35" />
    <line x1="38" y1="46" x2="55" y2="46" />
    <path d="M27 45c7-1 9-17 16-18" />
    <line x1="43" y1="27" x2="41.705904774487394" y2="31.82962913144534" />
    <line x1="43" y1="27" x2="38.170370868554656" y2="28.294095225512603" />
  </svg>
);

export default JumpToSlice;
