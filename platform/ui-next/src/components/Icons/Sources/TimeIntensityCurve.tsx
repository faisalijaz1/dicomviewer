import React from 'react';
import type { IconProps } from '../types';

export const TimeIntensityCurve = (props: IconProps) => (
  <svg
    width="24px"
    height="24px"
    viewBox="0 0 24 24"
    version="1.1"
    {...props}
  >
    <g
      id="icon-time-intensity-curve"
      stroke="none"
      strokeWidth="1"
      fill="none"
      fillRule="evenodd"
    >
      <rect
        id="Rectangle"
        x="0"
        y="0"
        width="24"
        height="24"
      ></rect>
      <g
        id="time-intensity-curve"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline
          id="axes"
          points="4 3 4 20 21 20"
        ></polyline>
        <polyline
          id="curve"
          points="5.5 17 9 10 13 8 16.5 9.5 20 6.5"
        ></polyline>
        <circle
          id="p1"
          cx="5.5"
          cy="17"
          r="1"
          fill="currentColor"
        ></circle>
        <circle
          id="p2"
          cx="9"
          cy="10"
          r="1"
          fill="currentColor"
        ></circle>
        <circle
          id="p3"
          cx="13"
          cy="8"
          r="1"
          fill="currentColor"
        ></circle>
        <circle
          id="p4"
          cx="16.5"
          cy="9.5"
          r="1"
          fill="currentColor"
        ></circle>
        <circle
          id="p5"
          cx="20"
          cy="6.5"
          r="1"
          fill="currentColor"
        ></circle>
      </g>
    </g>
  </svg>
);

export default TimeIntensityCurve;
