import React from 'react';
import type { IconProps } from '../types';

// This file bundles a matched set of 3D-styled icons (consistent dark
// rounded-tile background, cyan/teal line-art accents) supplied to replace
// or newly cover a batch of toolbar and hanging-protocol icons at once -
// see the registration comments in Icons.tsx for exactly which existing
// icon keys each one replaces vs. which are brand new.

export const RadiantLayoutAdvanced3DFourUp = (props: IconProps) => (
  <svg width="29px" height="29px" viewBox="0 0 64 64" {...props}>
    <g fill="none" stroke="#E8EDF5" strokeWidth="3">
      <rect x="8" y="8" width="22" height="22" rx="2" />
      <rect x="34" y="8" width="22" height="22" rx="2" />
      <rect x="8" y="34" width="22" height="22" rx="2" />
      <rect x="34" y="34" width="22" height="22" rx="2" />
    </g>
    <path
      d="M19 13v12M13 19h12M45 13l8 8-8 8M13 45l12-8M39 39h14v14H39z"
      stroke="currentColor"
      strokeWidth="2"
    />
  </svg>
);

export const RadiantLayoutAdvanced3DMain = (props: IconProps) => (
  <svg width="29px" height="29px" viewBox="0 0 64 64" {...props}>
    <path d="M32 6 53 18v28L32 58 11 46V18z" fill="#1E2A3A" stroke="#E8EDF5" strokeWidth="3" />
    <path d="M32 6v28l21 12M32 34 11 18" fill="none" stroke="currentColor" strokeWidth="3" />
    <path d="M32 22l8 5v10l-8 5-8-5V27z" fill="currentColor" opacity=".85" />
  </svg>
);

export const RadiantLayoutAdvanced3DOnly = (props: IconProps) => (
  <svg width="29px" height="29px" viewBox="0 0 64 64" {...props}>
    <path d="M32 6 54 19v26L32 58 10 45V19z" fill="#1E2A3A" stroke="#E8EDF5" strokeWidth="3" />
    <path d="M32 6v27l22 12M32 33 10 19" fill="none" stroke="currentColor" strokeWidth="3" />
    <path d="M32 25l10 6v12l-10 6-10-6V31z" fill="currentColor" opacity=".8" />
  </svg>
);

export const RadiantLayoutAdvanced3DPrimary = (props: IconProps) => (
  <svg width="29px" height="29px" viewBox="0 0 64 64" {...props}>
    <path d="M32 6 54 19v26L32 58 10 45V19z" fill="#1E2A3A" stroke="#E8EDF5" strokeWidth="3" />
    <path d="M32 6v27l22 12M32 33 10 19" fill="none" stroke="currentColor" strokeWidth="3" />
    <path d="M39 30h10v15H39z" fill="currentColor" />
    <path d="M32 33h7v25" stroke="currentColor" strokeWidth="2" />
  </svg>
);

export const RadiantLayoutAdvancedAxialPrimary = (props: IconProps) => (
  <svg width="29px" height="29px" viewBox="0 0 64 64" {...props}>
    <ellipse cx="32" cy="32" rx="24" ry="15" fill="#1E2A3A" stroke="#E8EDF5" strokeWidth="3" />
    <ellipse cx="32" cy="32" rx="16" ry="9" fill="none" stroke="currentColor" strokeWidth="3" />
    <path d="M19 32h26" stroke="currentColor" strokeWidth="2" />
  </svg>
);

export const RadiantCoronal = (props: IconProps) => (
  <svg width="29px" height="29px" viewBox="0 0 64 64" {...props}>
    <g fill="none" stroke="#E8EDF5" strokeWidth="3">
      <rect x="10" y="7" width="44" height="50" rx="4" />
      <path d="M32 10v44" />
    </g>
    <path
      d="M32 15c-8 2-13 8-13 16 0 7 4 13 9 17l4 4 4-4c5-4 9-10 9-17 0-8-5-14-13-16z"
      fill="#273446"
      stroke="currentColor"
      strokeWidth="2"
    />
    <path d="M32 16v35" stroke="currentColor" strokeWidth="2" />
  </svg>
);

export const RadiantFrameView = (props: IconProps) => (
  <svg width="29px" height="29px" viewBox="0 0 64 64" {...props}>
    <rect x="10" y="7" width="44" height="50" rx="4" fill="#1E2A3A" stroke="#E8EDF5" strokeWidth="3" />
    <path d="M18 7v50M46 7v50" stroke="#E8EDF5" strokeWidth="2" />
    <path d="M29 24l10 8-10 8z" fill="currentColor" />
    <path d="M15 16h4M45 16h4M15 48h4M45 48h4" stroke="currentColor" strokeWidth="2" />
  </svg>
);

export const RadiantMPR = (props: IconProps) => (
  <svg width="29px" height="29px" viewBox="0 0 64 64" {...props}>
    <g fill="none" stroke="#E8EDF5" strokeWidth="3">
      <rect x="9" y="8" width="46" height="48" rx="4" />
      <path d="M32 8v48M9 32h46" />
    </g>
    <path
      d="M32 18v28M22 27h20M25 44h14"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
    />
    <circle cx="32" cy="32" r="3" fill="currentColor" />
  </svg>
);

export const RadiantPetCtFusion = (props: IconProps) => (
  <svg width="29px" height="29px" viewBox="0 0 64 64" {...props}>
    <circle cx="25" cy="32" r="17" fill="#243246" stroke="currentColor" strokeWidth="3" />
    <circle cx="39" cy="32" r="17" fill="#243246" stroke="#FF9D2E" strokeWidth="3" />
    <path
      d="M24 23c5 4 8 7 8 12s-3 8-8 9"
      stroke="#A24CFF"
      strokeWidth="4"
      strokeLinecap="round"
    />
    <circle cx="42" cy="27" r="4" fill="#FF4D7D" />
    <circle cx="45" cy="38" r="3" fill="#FFD23F" />
  </svg>
);

export const RadiantSagittal = (props: IconProps) => (
  <svg width="29px" height="29px" viewBox="0 0 64 64" {...props}>
    <g fill="none" stroke="#E8EDF5" strokeWidth="3">
      <rect x="10" y="7" width="44" height="50" rx="4" />
      <path d="M32 10v44" />
    </g>
    <path
      d="M31 16c-6 2-10 8-9 15 1 4 0 8-3 12 5 0 9 3 12 7 3-5 7-8 11-9-3-3-5-7-5-12 0-6-2-10-6-13z"
      fill="#273446"
      stroke="currentColor"
      strokeWidth="2"
    />
  </svg>
);

export const RadiantTool3DRotate = (props: IconProps) => (
  <svg width="29px" height="29px" viewBox="0 0 64 64" {...props}>
    <path d="M32 17 49 27v20L32 57 15 47V27z" fill="#1E2A3A" stroke="#E8EDF5" strokeWidth="3" />
    <path d="M32 17v20l17 10M32 37 15 27" fill="none" stroke="currentColor" strokeWidth="2" />
    <path
      d="M11 25c2-10 10-16 20-17M53 39c-2 10-10 16-20 17"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
    />
    <path d="m25 8 7 0-4 6M39 56l-7 0 4-6" fill="none" stroke="currentColor" strokeWidth="3" />
  </svg>
);

export const RadiantCine = (props: IconProps) => (
  <svg width="29px" height="29px" viewBox="0 0 64 64" {...props}>
    <circle cx="29" cy="32" r="21" fill="#1E2A3A" stroke="#E8EDF5" strokeWidth="3" />
    <circle cx="29" cy="32" r="5" fill="currentColor" />
    <g fill="currentColor">
      <circle cx="29" cy="18" r="5" />
      <circle cx="41" cy="25" r="5" />
      <circle cx="41" cy="39" r="5" />
      <circle cx="29" cy="46" r="5" />
      <circle cx="17" cy="39" r="5" />
      <circle cx="17" cy="25" r="5" />
    </g>
    <circle cx="49" cy="48" r="11" fill="#1E2A3A" stroke="currentColor" strokeWidth="3" />
    <path d="m46 42 8 6-8 6z" fill="#E8EDF5" />
  </svg>
);

export const RadiantClearTransformations = (props: IconProps) => (
  <svg width="29px" height="29px" viewBox="0 0 64 64" {...props}>
    <path d="M12 19 39 12l13 13-27 7z" fill="#273446" stroke="#E8EDF5" strokeWidth="2.5" />
    <path d="m24 32 13 13-14 7-13-13z" fill="#1E2A3A" stroke="#E8EDF5" strokeWidth="2.5" />
    <path d="m39 27 11 11-8 8-11-11z" fill="currentColor" stroke="#E8EDF5" strokeWidth="2" />
    <path d="m27 35 8 8" stroke="#1E2A3A" strokeWidth="2" />
  </svg>
);

export const RadiantFitToWindow = (props: IconProps) => (
  <svg width="29px" height="29px" viewBox="0 0 64 64" {...props}>
    <rect x="8" y="8" width="48" height="48" rx="3" fill="none" stroke="#E8EDF5" strokeWidth="3" />
    <path
      d="M20 12h-8v8M44 12h8v8M12 44v8h8M52 44v8h-8"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
    />
    <path d="m26 26-9-9M38 26l9-9M26 38l-9 9M38 38l9 9" stroke="currentColor" strokeWidth="2.5" />
  </svg>
);

export const RadiantFlipHorizontal = (props: IconProps) => (
  <svg width="29px" height="29px" viewBox="0 0 64 64" {...props}>
    <path d="M10 15h44v34H10z" fill="#1E2A3A" stroke="#E8EDF5" strokeWidth="3" />
    <path d="M32 11v42" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" />
    <path
      d="M28 32H14M36 32h14M14 32l7-7M14 32l7 7M50 32l-7-7M50 32l-7 7"
      stroke="currentColor"
      strokeWidth="3"
      fill="none"
      strokeLinecap="round"
    />
  </svg>
);

export const RadiantInvert = (props: IconProps) => (
  <svg width="29px" height="29px" viewBox="0 0 64 64" {...props}>
    <circle cx="32" cy="32" r="23" fill="#1E2A3A" stroke="#E8EDF5" strokeWidth="3" />
    <path d="M32 9a23 23 0 0 1 0 46z" fill="#E8EDF5" />
    <path d="M32 9v46" stroke="currentColor" strokeWidth="2" />
  </svg>
);

export const RadiantPan = (props: IconProps) => (
  <svg width="29px" height="29px" viewBox="0 0 64 64" {...props}>
    <path
      d="M32 5v15M32 59V44M5 32h15M59 32H44"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
    />
    <path
      d="m28 10 4-5 4 5M28 54l4 5 4-5M10 28l-5 4 5 4M54 28l5 4-5 4"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
    />
    <path
      d="M26 29V17c0-2 3-3 4-1v9-15c0-2 3-3 4 0v14-12c0-2 3-2 4 0v13-9c0-2 3-2 4 0v15c0 7-3 12-10 12-6 0-9-5-9-10v-6c0-2 2-3 3-1z"
      fill="#E8EDF5"
      stroke="#E8EDF5"
      strokeWidth="2"
      strokeLinejoin="round"
    />
  </svg>
);

export const RadiantResetView = (props: IconProps) => (
  <svg width="29px" height="29px" viewBox="0 0 64 64" {...props}>
    <path
      d="M50 27a20 20 0 1 0 1 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="4"
      strokeLinecap="round"
    />
    <path d="m49 14 2 13-13-2" fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
    <circle cx="32" cy="32" r="8" fill="#1E2A3A" stroke="#E8EDF5" strokeWidth="2" />
    <path d="M32 27v10M27 32h10" stroke="#E8EDF5" strokeWidth="2" />
  </svg>
);

export const RadiantRotate180 = (props: IconProps) => (
  <svg width="29px" height="29px" viewBox="0 0 64 64" {...props}>
    <rect x="17" y="17" width="30" height="30" rx="2" fill="#1E2A3A" stroke="#E8EDF5" strokeWidth="3" />
    <path
      d="M20 31a12 12 0 0 1 20-8M44 33a12 12 0 0 1-20 8"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
    />
    <path d="m39 17 1 7-7-2M25 47l-1-7 7 2" fill="none" stroke="currentColor" strokeWidth="3" />
  </svg>
);

export const RadiantRotateRight90 = (props: IconProps) => (
  <svg width="29px" height="29px" viewBox="0 0 64 64" {...props}>
    <rect x="14" y="14" width="32" height="36" rx="2" fill="#1E2A3A" stroke="#E8EDF5" strokeWidth="3" />
    <path
      d="M48 20a17 17 0 1 1-4-8"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.5"
      strokeLinecap="round"
    />
    <path d="m43 8 5 4-6 3" fill="none" stroke="currentColor" strokeWidth="3" />
  </svg>
);

export const RadiantStackScroll = (props: IconProps) => (
  <svg width="29px" height="29px" viewBox="0 0 64 64" {...props}>
    <g fill="#1E2A3A" stroke="#E8EDF5" strokeWidth="2.5" strokeLinejoin="round">
      <path d="M10 16 32 9l22 7-22 7z" />
      <path d="M10 25l22 7 22-7v8l-22 7-22-7z" />
      <path d="M10 38l22 7 22-7v8l-22 7-22-7z" />
    </g>
    <path d="M32 12v38" stroke="currentColor" strokeWidth="2" strokeDasharray="3 3" />
    <path d="m47 16 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="3" />
    <path d="M53 22H43" stroke="currentColor" strokeWidth="3" />
  </svg>
);

export const RadiantWindowLevel = (props: IconProps) => (
  <svg width="29px" height="29px" viewBox="0 0 64 64" {...props}>
    <circle cx="32" cy="32" r="23" fill="#1E2A3A" stroke="#E8EDF5" strokeWidth="3" />
    <path d="M32 9a23 23 0 0 1 0 46z" fill="#E8EDF5" />
    <path d="M32 9v46" stroke="currentColor" strokeWidth="2" />
    <path
      d="M32 5v5M32 54v5M5 32h5M54 32h5M13 13l4 4M47 47l4 4M51 13l-4 4M17 47l-4 4"
      stroke="currentColor"
      strokeWidth="2"
    />
  </svg>
);

export const RadiantZoom = (props: IconProps) => (
  <svg width="29px" height="29px" viewBox="0 0 64 64" {...props}>
    <circle cx="28" cy="28" r="19" fill="#1E2A3A" stroke="#E8EDF5" strokeWidth="3" />
    <path d="m42 42 14 14" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
    <circle cx="28" cy="28" r="13" fill="none" stroke="currentColor" strokeWidth="2" />
    <path d="M28 21v14M21 28h14" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

export const RadiantSplineRoi = (props: IconProps) => (
  <svg width="29px" height="29px" viewBox="0 0 64 64" fill="none" {...props}>
    <rect x="3" y="3" width="58" height="58" rx="5" fill="#102B3A" stroke="#E8EDF5" strokeWidth="2" />
    <path
      d="M15 43
           C14 35 17 23 24 19
           C31 15 40 19 47 25
           C52 30 49 40 43 44
           C35 49 22 49 15 43Z"
      stroke="currentColor"
      strokeWidth="2.5"
      fill="none"
      strokeLinejoin="round"
    />
    <path
      d="M15 43L24 19L47 25L43 44L15 43"
      stroke="#E8EDF5"
      strokeWidth="1"
      opacity=".5"
      strokeDasharray="2 3"
    />
    <circle cx="15" cy="43" r="3" fill="currentColor" stroke="#E8EDF5" strokeWidth="1" />
    <circle cx="24" cy="19" r="3" fill="currentColor" stroke="#E8EDF5" strokeWidth="1" />
    <circle cx="47" cy="25" r="3" fill="currentColor" stroke="#E8EDF5" strokeWidth="1" />
    <circle cx="43" cy="44" r="3" fill="currentColor" stroke="#E8EDF5" strokeWidth="1" />
  </svg>
);

export const RadiantAngle = (props: IconProps) => (
  <svg width="29px" height="29px" viewBox="0 0 64 64" fill="none" {...props}>
    <rect x="3" y="3" width="58" height="58" rx="5" fill="#102B3A" stroke="#E8EDF5" strokeWidth="2" />
    <path
      d="M17 46L32 23L51 46"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M24 43A11 11 0 0 1 41 43" stroke="#E8EDF5" strokeWidth="2.2" fill="none" strokeLinecap="round" />
    <circle cx="32" cy="23" r="4" fill="currentColor" stroke="#E8EDF5" strokeWidth="1.5" />
    <circle cx="17" cy="46" r="3" fill="currentColor" />
    <circle cx="51" cy="46" r="3" fill="currentColor" />
  </svg>
);

export const RadiantBidirectional = (props: IconProps) => (
  <svg width="29px" height="29px" viewBox="0 0 64 64" fill="none" {...props}>
    <rect x="3" y="3" width="58" height="58" rx="5" fill="#102B3A" stroke="#E8EDF5" strokeWidth="2" />
    <path d="M12 32H52M32 12V52" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    <path
      d="M12 32L19 27V37L12 32ZM52 32L45 27V37L52 32ZM32 12L27 19H37L32 12ZM32 52L27 45H37L32 52Z"
      fill="currentColor"
    />
    <circle cx="32" cy="32" r="4" fill="#102B3A" stroke="#E8EDF5" strokeWidth="2" />
  </svg>
);

export const RadiantCircleRoi = (props: IconProps) => (
  <svg width="29px" height="29px" viewBox="0 0 64 64" fill="none" {...props}>
    <rect x="3" y="3" width="58" height="58" rx="5" fill="#102B3A" stroke="#E8EDF5" strokeWidth="2" />
    <circle cx="32" cy="32" r="19" stroke="currentColor" strokeWidth="2.5" strokeDasharray="4 3" strokeLinejoin="round" />
    <circle cx="32" cy="32" r="14" stroke="#E8EDF5" strokeWidth="1" opacity=".45" />
    <circle cx="32" cy="13" r="2.5" fill="currentColor" />
    <circle cx="51" cy="32" r="2.5" fill="currentColor" />
    <circle cx="32" cy="51" r="2.5" fill="currentColor" />
    <circle cx="13" cy="32" r="2.5" fill="currentColor" />
  </svg>
);

export const RadiantEllipseRoi = (props: IconProps) => (
  <svg width="29px" height="29px" viewBox="0 0 64 64" fill="none" {...props}>
    <rect x="3" y="3" width="58" height="58" rx="5" fill="#102B3A" stroke="#E8EDF5" strokeWidth="2" />
    <ellipse cx="32" cy="32" rx="20" ry="13" stroke="currentColor" strokeWidth="2.5" strokeDasharray="4 3" strokeLinejoin="round" />
    <ellipse cx="32" cy="32" rx="16" ry="9" stroke="#E8EDF5" strokeWidth="1" opacity=".55" />
    <circle cx="12" cy="32" r="2.5" fill="currentColor" />
    <circle cx="52" cy="32" r="2.5" fill="currentColor" />
    <circle cx="32" cy="19" r="2.5" fill="currentColor" />
    <circle cx="32" cy="45" r="2.5" fill="currentColor" />
  </svg>
);

export const RadiantFreehandRoi = (props: IconProps) => (
  <svg width="29px" height="29px" viewBox="0 0 64 64" fill="none" {...props}>
    <rect x="3" y="3" width="58" height="58" rx="5" fill="#102B3A" stroke="#E8EDF5" strokeWidth="2" />
    <path
      d="M19 22
           C12 26 13 37 20 42
           C27 48 38 47 44 42
           C51 36 49 27 42 23
           C35 19 27 18 22 23
           C18 27 19 34 24 36
           C30 39 39 35 42 29"
      stroke="currentColor"
      strokeWidth="2.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M42 29L47 25L45 32Z" fill="currentColor" />
    <path d="M17 18L25 26" stroke="#E8EDF5" strokeWidth="3" strokeLinecap="round" />
    <path d="M15 16L19 14L28 23L25 26L15 16Z" fill="#E8EDF5" />
    <path d="M15 16L19 14L21 16L17 19Z" fill="currentColor" />
  </svg>
);

export const RadiantLength = (props: IconProps) => (
  <svg width="29px" height="29px" viewBox="0 0 64 64" fill="none" {...props}>
    <rect x="3" y="3" width="58" height="58" rx="5" fill="#102B3A" stroke="#E8EDF5" strokeWidth="2" />
    <path d="M14 46L50 18" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    <path
      d="M20 46L16 41M27 41L23 36M34 36L30 31M41 31L37 26M48 25L44 20"
      stroke="#E8EDF5"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <circle cx="14" cy="46" r="4" fill="currentColor" stroke="#E8EDF5" strokeWidth="1.5" />
    <circle cx="50" cy="18" r="4" fill="currentColor" stroke="#E8EDF5" strokeWidth="1.5" />
  </svg>
);

export const RadiantLivewire = (props: IconProps) => (
  <svg width="29px" height="29px" viewBox="0 0 64 64" fill="none" {...props}>
    <rect x="3" y="3" width="58" height="58" rx="5" fill="#102B3A" stroke="#E8EDF5" strokeWidth="2" />
    <path
      d="M14 43
           C20 36 19 26 26 24
           C32 22 35 29 39 27
           C44 25 44 20 50 18"
      stroke="currentColor"
      strokeWidth="2.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M14 43
           C21 48 31 46 37 41
           C43 36 47 31 50 18"
      stroke="#E8EDF5"
      strokeWidth="1.5"
      strokeDasharray="3 3"
      opacity=".75"
    />
    <path d="M45 14L51 17L48 23L42 20Z" fill="currentColor" stroke="#E8EDF5" strokeWidth="1.2" />
    <path d="M44 15L48 13M47 18L52 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <circle cx="14" cy="43" r="3" fill="currentColor" stroke="#E8EDF5" strokeWidth="1" />
  </svg>
);

export const RadiantRectangleRoi = (props: IconProps) => (
  <svg width="29px" height="29px" viewBox="0 0 64 64" fill="none" {...props}>
    <rect x="3" y="3" width="58" height="58" rx="5" fill="#102B3A" stroke="#E8EDF5" strokeWidth="2" />
    <path d="M15 18H49V46H15Z" stroke="currentColor" strokeWidth="2.5" strokeDasharray="4 3" strokeLinejoin="round" />
    <path d="M19 22H45V42H19Z" stroke="#E8EDF5" strokeWidth="1" opacity=".45" />
    <circle cx="15" cy="18" r="2.5" fill="currentColor" />
    <circle cx="49" cy="18" r="2.5" fill="currentColor" />
    <circle cx="15" cy="46" r="2.5" fill="currentColor" />
    <circle cx="49" cy="46" r="2.5" fill="currentColor" />
  </svg>
);
