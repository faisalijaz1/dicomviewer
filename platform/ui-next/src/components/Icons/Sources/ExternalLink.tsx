import React from 'react';
import type { IconProps } from '../types';

export const ExternalLink = (props: IconProps) => (
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
    <rect x="11" y="19" width="34" height="34" rx="4" />
    <line x1="31" y1="13" x2="53" y2="13" />
    <line x1="53" y1="13" x2="53" y2="35" />
    <line x1="53" y1="13" x2="29" y2="37" />
    <line x1="53" y1="13" x2="51.705904774487394" y2="17.82962913144534" />
    <line x1="53" y1="13" x2="48.170370868554656" y2="14.294095225512605" />
  </svg>
);

export default ExternalLink;
