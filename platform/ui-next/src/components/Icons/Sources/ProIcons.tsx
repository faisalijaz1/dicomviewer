import React from 'react';
import type { IconProps } from '../types';

const base = {
  viewBox: '0 0 64 64',
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 2.25,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export const ProVolumeRendering = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <path
      d="M13 38c-3-7 2-15 10-16 2-9 15-12 22-5 9-2 15 8 11 15 5 8-2 17-11 17H25c-6 0-10-4-12-11Z"
      fill="currentColor"
      fillOpacity=".12"
    />
    <path d="M21 38c5-9 15-13 25-10" />
    <path d="M25 44c7-7 15-8 23-4" strokeWidth="1.5" />
    <circle cx="31" cy="29" r="3" fill="currentColor" fillOpacity=".35" />
  </svg>
);

export const ProCheck = (props: IconProps) => (
  <svg width="21px" height="21px" {...base} {...props}>
    <polyline points="16,32 27,43 49,20" strokeWidth="3" />
  </svg>
);

export const ProToggleDicomOverlay = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <rect x="10" y="11" width="44" height="42" rx="4" />
    <line x1="15" y1="18" x2="30" y2="18" strokeWidth="1.5" />
    <line x1="15" y1="23" x2="26" y2="23" strokeWidth="1.5" />
    <line x1="38" y1="42" x2="49" y2="42" strokeWidth="1.5" />
    <line x1="41" y1="47" x2="49" y2="47" strokeWidth="1.5" />
    <circle cx="45" cy="20" r="4" />
    <line x1="16" y1="44" x2="25" y2="35" strokeWidth="1.5" />
  </svg>
);

export const ProTool3DRotate = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <polygon points="32.0,17 45,23.5 45,36.5 32.0,43 19,36.5 19,23.5" fill="none" />
    <line x1="32.0" y1="17" x2="32.0" y2="43" />
    <line x1="19" y1="23.5" x2="32.0" y2="30.0" />
    <line x1="45" y1="23.5" x2="32.0" y2="30.0" />
    <path d="M10 27c1-9 8-16 17-18" />
    <line x1="27" y1="9" x2="23.535898384862247" y2="11.0" />
    <line x1="27" y1="9" x2="23.535898384862247" y2="7.0" />
    <path d="M54 38c-2 9-9 15-18 17" />
    <line x1="36" y1="55" x2="39.46410161513776" y2="53.0" />
    <line x1="36" y1="55" x2="39.46410161513776" y2="57.0" />
  </svg>
);

export const ProToolAngle = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <line x1="14" y1="48" x2="31" y2="20" />
    <line x1="31" y1="20" x2="52" y2="44" />
    <path d="M25 31a13 13 0 0 1 15 1" />
    <circle cx="31" cy="20" r="2.2" fill="currentColor" stroke="none" />
  </svg>
);

export const ProToolBidirectional = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <line x1="13" y1="32" x2="51" y2="32" />
    <line x1="32" y1="13" x2="32" y2="51" />
    <line x1="13" y1="27" x2="13" y2="37" />
    <line x1="51" y1="27" x2="51" y2="37" />
    <line x1="27" y1="13" x2="37" y2="13" />
    <line x1="27" y1="51" x2="37" y2="51" />
    <circle cx="32" cy="32" r="2" fill="currentColor" stroke="none" />
  </svg>
);

export const ProToolFlipHorizontal = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <rect x="13" y="15" width="38" height="34" rx="4" />
    <line x1="32" y1="12" x2="32" y2="52" strokeDasharray="3 3" />
    <polygon points="18,32 27,24 27,40" />
    <polygon points="46,32 37,24 37,40" />
    <line x1="17" y1="45" x2="27" y2="45" />
    <line x1="17" y1="45" x2="20.464101615137757" y2="43.0" />
    <line x1="17" y1="45" x2="20.464101615137753" y2="47.0" />
    <line x1="47" y1="19" x2="37" y2="19" />
    <line x1="47" y1="19" x2="43.53589838486224" y2="21.0" />
    <line x1="47" y1="19" x2="43.53589838486224" y2="17.0" />
  </svg>
);

export const ProToolMagnify = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <circle cx="27" cy="27" r="15" />
    <line x1="38" y1="38" x2="53" y2="53" />
    <line x1="21" y1="27" x2="33" y2="27" />
    <line x1="27" y1="21" x2="27" y2="33" />
  </svg>
);

export const ProToolMove = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <circle cx="32" cy="32" r="4" />
    <line x1="32" y1="8" x2="32" y2="56" />
    <line x1="8" y1="32" x2="56" y2="32" />
    <line x1="32" y1="8" x2="34.5" y2="12.330127018922195" />
    <line x1="32" y1="8" x2="29.5" y2="12.330127018922195" />
    <line x1="32" y1="56" x2="29.5" y2="51.6698729810778" />
    <line x1="32" y1="56" x2="34.5" y2="51.66987298107781" />
    <line x1="8" y1="32" x2="12.330127018922195" y2="29.5" />
    <line x1="8" y1="32" x2="12.330127018922195" y2="34.5" />
    <line x1="56" y1="32" x2="51.66987298107781" y2="34.5" />
    <line x1="56" y1="32" x2="51.66987298107781" y2="29.5" />
  </svg>
);

export const ProToolProbe = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <line x1="32" y1="11" x2="32" y2="53" />
    <line x1="11" y1="32" x2="53" y2="32" />
    <circle cx="32" cy="32" r="9" />
    <circle cx="32" cy="32" r="2.8" fill="currentColor" stroke="none" />
    <path d="M45 17l7-7" />
    <circle cx="52" cy="10" r="2" fill="currentColor" stroke="none" />
  </svg>
);

export const ProToolWindowLevel = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <circle cx="32" cy="32" r="20" />
    <path d="M32 12a20 20 0 0 0 0 40Z" fill="currentColor" stroke="none" />
    <line x1="32" y1="12" x2="32" y2="52" />
  </svg>
);

export const ProArrowLeft = (props: IconProps) => (
  <svg width="25px" height="25px" {...base} {...props}>
    <line x1="53" y1="32" x2="12" y2="32" />
    <line x1="12" y1="32" x2="18.92820323027551" y2="28.000000000000004" />
    <line x1="12" y1="32" x2="18.92820323027551" y2="36.0" />
  </svg>
);

export const ProChevronRight = (props: IconProps) => (
  <svg width="21px" height="21px" {...base} {...props}>
    <polyline points="24,16 40,32 24,48" strokeWidth="3" />
  </svg>
);

export const ProChevronUp = (props: IconProps) => (
  <svg width="21px" height="21px" {...base} {...props}>
    <polyline points="16,40 32,24 48,40" strokeWidth="3" />
  </svg>
);

export const ProChevronDown = (props: IconProps) => (
  <svg width="21px" height="21px" {...base} {...props}>
    <polyline points="16,24 32,40 48,24" strokeWidth="3" />
  </svg>
);

export const ProCloseX = (props: IconProps) => (
  <svg width="17px" height="17px" {...base} {...props}>
    <line x1="22" y1="22" x2="42" y2="42" strokeWidth="2" />
    <line x1="42" y1="22" x2="22" y2="42" strokeWidth="2" />
  </svg>
);

export const ProCaretSort = (props: IconProps) => (
  <svg width="17px" height="17px" {...base} {...props}>
    <polyline points="23,27 32,18 41,27" />
    <polyline points="23,37 32,46 41,37" />
  </svg>
);

export const ProDotFilled = (props: IconProps) => (
  <svg width="17px" height="17px" {...base} {...props}>
    <circle cx="32" cy="32" r="8" fill="currentColor" stroke="none" />
  </svg>
);

export const ProIconToolCobbAngle = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <line x1="12" y1="22" x2="48" y2="14" />
    <line x1="16" y1="49" x2="52" y2="40" />
    <line x1="12" y1="17" x2="13" y2="27" />
    <line x1="47" y1="9" x2="49" y2="19" />
    <line x1="15" y1="44" x2="17" y2="54" />
    <line x1="51" y1="35" x2="53" y2="45" />
    <line x1="30" y1="18" x2="35" y2="45" strokeDasharray="3 3" />
  </svg>
);

export const ProIconToolFreehandRoi = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <path d="M13 36c2-11 8-18 17-16 6 1 8-5 15-2 8 4 7 12 4 18-4 8-12 13-21 11-9-1-17-4-15-11 1-4 0-8-2-12Z" />
  </svg>
);

export const ProIconToolWindowRegion = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <rect x="12" y="14" width="40" height="36" rx="3" strokeDasharray="5 4" />
    <path d="M16 46c7-14 16-24 32-28" strokeOpacity=".4" />
    <path d="M16 38c7-8 16-14 32-17" strokeOpacity=".65" />
    <circle cx="42" cy="22" r="4" fill="currentColor" fillOpacity=".18" />
  </svg>
);

export const ProLayoutAdvanced3DMain = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <rect x="9" y="9" width="30" height="46" rx="3" strokeWidth="3" />
    <rect x="42" y="9" width="13" height="13" rx="2" />
    <rect x="42" y="25.5" width="13" height="13" rx="2" />
    <rect x="42" y="42" width="13" height="13" rx="2" />
    <polygon points="24.0,20 33,24.5 33,33.5 24.0,38 15,33.5 15,24.5" fill="none" />
    <line x1="24.0" y1="20" x2="24.0" y2="38" />
    <line x1="15" y1="24.5" x2="24.0" y2="29.0" />
    <line x1="33" y1="24.5" x2="24.0" y2="29.0" />
  </svg>
);

export const ProLayoutAdvancedSagittal = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <rect x="10" y="10" width="26" height="26" rx="2" />
    <ellipse cx="23.0" cy="23.0" rx="7.280000000000001" ry="9.36" strokeWidth="1.5" />
    <circle cx="20.92" cy="23.0" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="25.08" cy="23.0" r="1.3" fill="currentColor" stroke="none" />
    <rect x="39" y="10" width="15" height="44" rx="2" strokeWidth="3" />
    <path
      d="M45.3 18.8c4.2 3.52 3.9000000000000004 11.0 1.2 14.96c-2.4 3.52 -3.0 9.68 -0.6 13.2"
      strokeWidth="1.5"
    />
    <rect x="10" y="39" width="26" height="15" rx="2" />
    <path
      d="M16.759999999999998 49.8c1.56 -6.3 5.2 -7.5 6.24 -7.5s4.68 1.2 6.24 7.5"
      strokeWidth="1.5"
    />
  </svg>
);

export const ProLayoutAdvancedCoronal = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <rect x="10" y="10" width="26" height="26" rx="2" />
    <ellipse cx="23.0" cy="23.0" rx="7.280000000000001" ry="9.36" strokeWidth="1.5" />
    <circle cx="20.92" cy="23.0" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="25.08" cy="23.0" r="1.3" fill="currentColor" stroke="none" />
    <rect x="39" y="10" width="15" height="44" rx="2" />
    <path
      d="M45.3 18.8c4.2 3.52 3.9000000000000004 11.0 1.2 14.96c-2.4 3.52 -3.0 9.68 -0.6 13.2"
      strokeWidth="1.5"
    />
    <rect x="10" y="39" width="26" height="15" rx="2" strokeWidth="3" />
    <path
      d="M16.759999999999998 49.8c1.56 -6.3 5.2 -7.5 6.24 -7.5s4.68 1.2 6.24 7.5"
      strokeWidth="1.5"
    />
  </svg>
);

export const ProLayoutAdvancedMPR = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <rect x="10" y="10" width="26" height="26" rx="2" strokeWidth="3" />
    <ellipse cx="23.0" cy="23.0" rx="7.280000000000001" ry="9.36" strokeWidth="1.5" />
    <circle cx="20.92" cy="23.0" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="25.08" cy="23.0" r="1.3" fill="currentColor" stroke="none" />
    <rect x="39" y="10" width="15" height="44" rx="2" />
    <path
      d="M45.3 18.8c4.2 3.52 3.9000000000000004 11.0 1.2 14.96c-2.4 3.52 -3.0 9.68 -0.6 13.2"
      strokeWidth="1.5"
    />
    <rect x="10" y="39" width="26" height="15" rx="2" />
    <path
      d="M16.759999999999998 49.8c1.56 -6.3 5.2 -7.5 6.24 -7.5s4.68 1.2 6.24 7.5"
      strokeWidth="1.5"
    />
  </svg>
);

export const ProLayoutAdvancedAxialPrimary = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <rect x="10" y="10" width="26" height="26" rx="2" strokeWidth="3" />
    <ellipse cx="23.0" cy="23.0" rx="7.280000000000001" ry="9.36" strokeWidth="1.5" />
    <circle cx="20.92" cy="23.0" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="25.08" cy="23.0" r="1.3" fill="currentColor" stroke="none" />
    <rect x="39" y="10" width="15" height="44" rx="2" />
    <path
      d="M45.3 18.8c4.2 3.52 3.9000000000000004 11.0 1.2 14.96c-2.4 3.52 -3.0 9.68 -0.6 13.2"
      strokeWidth="1.5"
    />
    <rect x="10" y="39" width="26" height="15" rx="2" />
    <path
      d="M16.759999999999998 49.8c1.56 -6.3 5.2 -7.5 6.24 -7.5s4.68 1.2 6.24 7.5"
      strokeWidth="1.5"
    />
    <rect x="8" y="8" width="30" height="30" rx="3" strokeWidth="3" />
  </svg>
);

export const ProLayoutAdvancedFusion = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <circle cx="25" cy="32" r="16" fill="currentColor" fillOpacity=".08" />
    <circle cx="39" cy="32" r="16" fill="currentColor" fillOpacity=".22" />
    <path
      d="M32 18c-7 5-9 22 0 28 9-6 7-23 0-28Z"
      fill="currentColor"
      fillOpacity=".32"
      stroke="none"
    />
    <line x1="32" y1="18" x2="32" y2="46" strokeWidth="1.5" />
  </svg>
);

export const ProLayout1x1 = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <rect x="10.0" y="10.0" width="44.0" height="44.0" rx="2" />
  </svg>
);

export const ProLayout1x2 = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <rect x="10.0" y="13.0" width="20.0" height="38.0" rx="2" />
    <rect x="34.0" y="13.0" width="20.0" height="38.0" rx="2" />
  </svg>
);

export const ProLayout2x2 = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <rect x="10.0" y="10.0" width="20.0" height="20.0" rx="2" />
    <rect x="34.0" y="10.0" width="20.0" height="20.0" rx="2" />
    <rect x="10.0" y="34.0" width="20.0" height="20.0" rx="2" />
    <rect x="34.0" y="34.0" width="20.0" height="20.0" rx="2" />
  </svg>
);

export const ProLayout2x3 = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <rect x="8.0" y="13.0" width="14.0" height="17.5" rx="2" />
    <rect x="25.0" y="13.0" width="14.0" height="17.5" rx="2" />
    <rect x="42.0" y="13.0" width="14.0" height="17.5" rx="2" />
    <rect x="8.0" y="33.5" width="14.0" height="17.5" rx="2" />
    <rect x="25.0" y="33.5" width="14.0" height="17.5" rx="2" />
    <rect x="42.0" y="33.5" width="14.0" height="17.5" rx="2" />
  </svg>
);

export const ProNavigation = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <path d="M18 50 31 14l5 14 14 5-32 17Z" />
    <line x1="36" y1="20" x2="48" y2="16" />
    <circle cx="50" cy="16" r="2.2" fill="currentColor" stroke="none" />
    <line x1="39" y1="29" x2="50" y2="29" />
    <circle cx="53" cy="29" r="2.2" fill="currentColor" stroke="none" />
    <line x1="32" y1="39" x2="47" y2="43" />
    <circle cx="50" cy="44" r="2.2" fill="currentColor" stroke="none" />
  </svg>
);

export const ProToolCapture = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <rect x="10" y="19" width="44" height="30" rx="5" />
    <path d="M22 19l4-6h12l4 6" />
    <circle cx="32" cy="34" r="9" />
    <circle cx="48" cy="25" r="1.5" fill="currentColor" stroke="none" />
  </svg>
);

export const ProToolCrosshair = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <circle cx="32" cy="32" r="17" />
    <line x1="9" y1="32" x2="55" y2="32" />
    <line x1="32" y1="9" x2="32" y2="55" />
    <circle cx="32" cy="32" r="2.5" fill="currentColor" stroke="none" />
  </svg>
);

export const ProToolInvert = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <circle cx="32" cy="32" r="21" />
    <path d="M17 47 47 17" />
    <path d="M17 47a21 21 0 0 0 30-30c-8 1-17 8-30 30Z" fill="currentColor" stroke="none" />
  </svg>
);

export const ProToolLength = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <line x1="14" y1="46" x2="50" y2="18" />
    <line x1="11" y1="42" x2="17" y2="50" />
    <line x1="47" y1="14" x2="53" y2="22" />
    <line x1="22" y1="39" x2="25" y2="43" strokeWidth="1.4" />
    <line x1="29" y1="33" x2="32" y2="37" strokeWidth="1.4" />
    <line x1="36" y1="28" x2="39" y2="32" strokeWidth="1.4" />
  </svg>
);

export const ProToolRectangle = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <rect x="12" y="17" width="40" height="30" rx="3" strokeDasharray="5 4" />
  </svg>
);

export const ProToolSegmentLabel = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <path
      d="M12 41c0-9 6-17 15-18 5-8 18-5 19 4 8 2 8 15 0 18-8 4-29 4-34-4Z"
      fill="currentColor"
      fillOpacity=".14"
    />
    <path d="M30 14h19l7 8-7 8H30Z" />
    <circle cx="48" cy="22" r="2" fill="currentColor" stroke="none" />
  </svg>
);

export const ProToolStackImageSync = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <rect x="9" y="13" width="23" height="18" rx="3" />
    <rect x="32" y="33" width="23" height="18" rx="3" />
    <path d="M25 35c2 7 10 10 17 7" />
    <line x1="42" y1="42" x2="38.53589838486224" y2="44.0" />
    <line x1="42" y1="42" x2="38.53589838486224" y2="40.0" />
    <path d="M39 29c-2-7-10-10-17-7" />
    <line x1="22" y1="22" x2="25.464101615137757" y2="20.0" />
    <line x1="22" y1="22" x2="25.464101615137753" y2="24.0" />
    <path d="M27 30l10 10" />
    <path d="M24 35a5 5 0 0 1 7-7l3 3" />
    <path d="M40 36a5 5 0 0 1-7 7l-3-3" />
  </svg>
);

export const ProToolZoom = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <circle cx="28" cy="28" r="15" />
    <line x1="39" y1="39" x2="53" y2="53" />
    <line x1="22" y1="28" x2="34" y2="28" />
    <line x1="28" y1="22" x2="28" y2="34" />
  </svg>
);

export const ProIconToolSplineRoi = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <path d="M14 39c2-13 9-21 19-20 9 1 17 6 18 15 1 10-8 17-20 16-11-1-19-4-17-11Z" />
    <circle cx="14" cy="39" r="2.3" fill="currentColor" stroke="none" />
    <circle cx="33" cy="19" r="2.3" fill="currentColor" stroke="none" />
    <circle cx="51" cy="34" r="2.3" fill="currentColor" stroke="none" />
    <circle cx="31" cy="50" r="2.3" fill="currentColor" stroke="none" />
  </svg>
);

export const ProIconToolUltrasoundBidirectional = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <path d="M32 11 11 51h42L32 11Z" fill="currentColor" fillOpacity=".06" />
    <path d="M24 43c4-6 12-6 16 0" strokeWidth="1.5" />
    <line x1="18" y1="34" x2="46" y2="34" />
    <line x1="18" y1="34" x2="21.464101615137757" y2="32.0" />
    <line x1="18" y1="34" x2="21.464101615137753" y2="36.0" />
    <line x1="46" y1="34" x2="42.53589838486224" y2="36.0" />
    <line x1="46" y1="34" x2="42.53589838486224" y2="32.0" />
    <line x1="32" y1="19" x2="32" y2="49" strokeDasharray="3 3" />
  </svg>
);

export const ProLayoutAdvanced3DFourUp = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <rect x="8.0" y="8.0" width="22.0" height="22.0" rx="2" />
    <polygon
      points="19.0,12.95 25.05,15.975 25.05,22.025 19.0,25.05 12.95,22.025 12.95,15.975"
      strokeWidth="1.4"
    />
    <line x1="19.0" y1="12.95" x2="19.0" y2="25.05" strokeWidth="1.4" />
    <line x1="12.95" y1="15.975" x2="19.0" y2="19.0" strokeWidth="1.4" />
    <line x1="25.05" y1="15.975" x2="19.0" y2="19.0" strokeWidth="1.4" />
    <rect x="34.0" y="8.0" width="22.0" height="22.0" rx="2" />
    <polygon
      points="45.0,12.95 51.05,15.975 51.05,22.025 45.0,25.05 38.95,22.025 38.95,15.975"
      strokeWidth="1.4"
    />
    <line x1="45.0" y1="12.95" x2="45.0" y2="25.05" strokeWidth="1.4" />
    <line x1="38.95" y1="15.975" x2="45.0" y2="19.0" strokeWidth="1.4" />
    <line x1="51.05" y1="15.975" x2="45.0" y2="19.0" strokeWidth="1.4" />
    <rect x="8.0" y="34.0" width="22.0" height="22.0" rx="2" />
    <polygon
      points="19.0,38.95 25.05,41.975 25.05,48.025 19.0,51.05 12.95,48.025 12.95,41.975"
      strokeWidth="1.4"
    />
    <line x1="19.0" y1="38.95" x2="19.0" y2="51.05" strokeWidth="1.4" />
    <line x1="12.95" y1="41.975" x2="19.0" y2="45.0" strokeWidth="1.4" />
    <line x1="25.05" y1="41.975" x2="19.0" y2="45.0" strokeWidth="1.4" />
    <rect x="34.0" y="34.0" width="22.0" height="22.0" rx="2" />
    <polygon
      points="45.0,38.95 51.05,41.975 51.05,48.025 45.0,51.05 38.95,48.025 38.95,41.975"
      strokeWidth="1.4"
    />
    <line x1="45.0" y1="38.95" x2="45.0" y2="51.05" strokeWidth="1.4" />
    <line x1="38.95" y1="41.975" x2="45.0" y2="45.0" strokeWidth="1.4" />
    <line x1="51.05" y1="41.975" x2="45.0" y2="45.0" strokeWidth="1.4" />
  </svg>
);

export const ProStatus = (props: IconProps) => (
  <svg width="21px" height="21px" {...base} {...props}>
    <circle cx="32" cy="32" r="20" strokeOpacity=".28" />
    <path d="M32 12a20 20 0 0 1 18 11" strokeWidth="4" />
    <circle cx="32" cy="32" r="3" fill="currentColor" stroke="none" />
  </svg>
);

export const ProToolAnnotate = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <line x1="11" y1="49" x2="34" y2="26" />
    <line x1="11" y1="49" x2="12.294095225512601" y2="44.170370868554656" />
    <line x1="11" y1="49" x2="15.82962913144534" y2="47.705904774487394" />
    <rect x="34" y="13" width="20" height="16" rx="3" />
    <line x1="39" y1="19" x2="49" y2="19" strokeWidth="1.5" />
    <line x1="39" y1="24" x2="46" y2="24" strokeWidth="1.5" />
  </svg>
);

export const ProToolCalibration = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <line x1="13" y1="42" x2="48" y2="17" />
    <line x1="10" y1="38" x2="16" y2="46" />
    <line x1="45" y1="13" x2="51" y2="21" />
    <line x1="24" y1="34" x2="27" y2="38" strokeWidth="1.4" />
    <line x1="34" y1="27" x2="37" y2="31" strokeWidth="1.4" />
    <polyline points="36,45 41,50 53,34" />
  </svg>
);

export const ProToolCine = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <rect x="10" y="17" width="44" height="30" rx="3" />
    <circle cx="15" cy="22" r="1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="32.0" r="1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="42" r="1" fill="currentColor" stroke="none" />
    <circle cx="49" cy="22" r="1" fill="currentColor" stroke="none" />
    <circle cx="49" cy="32.0" r="1" fill="currentColor" stroke="none" />
    <circle cx="49" cy="42" r="1" fill="currentColor" stroke="none" />
    <polygon points="27,24 27,40 42,32" fill="currentColor" stroke="none" />
  </svg>
);

export const ProToolReset = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <rect x="14" y="15" width="36" height="34" rx="4" />
    <path d="M18 18a22 22 0 1 1-5 23" />
    <line x1="13" y1="41" x2="11.289899283371657" y2="36.30153689607046" />
    <line x1="13" y1="41" x2="16.213938048432695" y2="37.16977778440511" />
    <line x1="21" y1="32" x2="43" y2="32" strokeWidth="1.5" />
    <line x1="32" y1="21" x2="32" y2="43" strokeWidth="1.5" />
  </svg>
);

export const ProToolRotate180 = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <rect x="21" y="20" width="22" height="24" rx="4" />
    <path d="M13 27c2-10 10-16 19-16s17 6 19 16" />
    <line x1="51" y1="27" x2="47.46446609406726" y2="23.464466094067262" />
    <line x1="51" y1="27" x2="52.294095225512606" y2="22.17037086855466" />
    <path d="M51 37c-2 10-10 16-19 16s-17-6-19-16" />
    <line x1="13" y1="37" x2="16.535533905932734" y2="40.53553390593274" />
    <line x1="13" y1="37" x2="11.705904774487395" y2="41.829629131445344" />
    <circle cx="32" cy="32" r="2.2" fill="currentColor" stroke="none" />
  </svg>
);

export const ProToolStackScroll = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <rect x="16.0" y="16" width="28" height="5" rx="1.5" />
    <rect x="13.0" y="23" width="34" height="5" rx="1.5" />
    <rect x="10.0" y="30" width="40" height="5" rx="1.5" />
    <rect x="13.0" y="37" width="34" height="5" rx="1.5" />
    <rect x="16.0" y="44" width="28" height="5" rx="1.5" />
    <line x1="52" y1="17" x2="52" y2="47" />
    <line x1="52" y1="17" x2="54.0" y2="20.464101615137753" />
    <line x1="52" y1="17" x2="50.0" y2="20.464101615137757" />
    <line x1="52" y1="47" x2="50.0" y2="43.53589838486224" />
    <line x1="52" y1="47" x2="54.0" y2="43.53589838486224" />
  </svg>
);

export const ProIconClear = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <path d="M17 40 36 17c2-2 5-2 7 0l5 5c2 2 2 5 0 7L29 48H18c-3 0-5-2-5-5 0-1 .4-2 1-3Z" />
    <line x1="25" y1="31" x2="36" y2="42" />
    <line x1="29" y1="48" x2="51" y2="48" />
  </svg>
);

export const ProIconToolLivewire = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <path
      d="M12 43c6-2 8-12 15-12 8 0 10-10 18-9 5 1 8 6 7 13-1 9-9 15-19 15-9 0-16-2-21-7Z"
      strokeDasharray="2 4"
    />
    <path d="M49 16l-4 5 4 5 4-5-4-5Z" />
    <line x1="49" y1="12" x2="49" y2="16" />
    <line x1="49" y1="26" x2="49" y2="30" />
  </svg>
);

export const ProLayoutAdvanced3DOnly = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <rect x="8" y="8" width="48" height="48" rx="4" />
    <polygon points="32.0,15 46,22.0 46,36.0 32.0,43 18,36.0 18,22.0" fill="none" />
    <line x1="32.0" y1="15" x2="32.0" y2="43" />
    <line x1="18" y1="22.0" x2="32.0" y2="29.0" />
    <line x1="46" y1="22.0" x2="32.0" y2="29.0" />
  </svg>
);

export const ProLayoutAdvanced3DPrimary = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <rect x="9" y="9" width="46" height="31" rx="3" strokeWidth="3" />
    <polygon points="32.0,13 42,18.0 42,28.0 32.0,33 22,28.0 22,18.0" fill="none" />
    <line x1="32.0" y1="13" x2="32.0" y2="33" />
    <line x1="22" y1="18.0" x2="32.0" y2="23.0" />
    <line x1="42" y1="18.0" x2="32.0" y2="23.0" />
    <rect x="9" y="43" width="13" height="12" rx="2" />
    <rect x="25.5" y="43" width="13" height="12" rx="2" />
    <rect x="42" y="43" width="13" height="12" rx="2" />
  </svg>
);

export const ProLayoutAdvancedFrameView = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <rect x="7.0" y="10.0" width="8.4" height="9.5" rx="2" />
    <rect x="17.4" y="10.0" width="8.4" height="9.5" rx="2" />
    <rect x="27.8" y="10.0" width="8.4" height="9.5" rx="2" />
    <rect x="38.2" y="10.0" width="8.4" height="9.5" rx="2" />
    <rect x="48.6" y="10.0" width="8.4" height="9.5" rx="2" />
    <rect x="7.0" y="21.5" width="8.4" height="9.5" rx="2" />
    <rect x="17.4" y="21.5" width="8.4" height="9.5" rx="2" />
    <rect x="27.8" y="21.5" width="8.4" height="9.5" rx="2" />
    <rect x="38.2" y="21.5" width="8.4" height="9.5" rx="2" />
    <rect x="48.6" y="21.5" width="8.4" height="9.5" rx="2" />
    <rect x="7.0" y="33.0" width="8.4" height="9.5" rx="2" />
    <rect x="17.4" y="33.0" width="8.4" height="9.5" rx="2" />
    <rect x="27.8" y="33.0" width="8.4" height="9.5" rx="2" />
    <rect x="38.2" y="33.0" width="8.4" height="9.5" rx="2" />
    <rect x="48.6" y="33.0" width="8.4" height="9.5" rx="2" />
    <rect x="7.0" y="44.5" width="8.4" height="9.5" rx="2" />
    <rect x="17.4" y="44.5" width="8.4" height="9.5" rx="2" />
    <rect x="27.8" y="44.5" width="8.4" height="9.5" rx="2" />
    <rect x="38.2" y="44.5" width="8.4" height="9.5" rx="2" />
    <rect x="48.6" y="44.5" width="8.4" height="9.5" rx="2" />
  </svg>
);

export const ProToolCircle = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <circle cx="32" cy="32" r="19" strokeDasharray="5 4" />
  </svg>
);

export const ProToolCrosshairChecked = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <circle cx="32" cy="32" r="17" />
    <line x1="9" y1="32" x2="55" y2="32" />
    <line x1="32" y1="9" x2="32" y2="55" />
    <circle cx="32" cy="32" r="2.5" fill="currentColor" stroke="none" />
    <circle cx="48" cy="48" r="10" fill="currentColor" fillOpacity=".14" />
    <polyline points="43,48 47,52 54,44" strokeWidth="2.6" />
  </svg>
);

export const ProToolEllipse = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <ellipse cx="32" cy="32" rx="21" ry="14" strokeDasharray="5 4" />
  </svg>
);

export const ProToolLayout = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <rect x="10.0" y="10.0" width="20.0" height="20.0" rx="2" />
    <rect x="34.0" y="10.0" width="20.0" height="20.0" rx="2" />
    <rect x="10.0" y="34.0" width="20.0" height="20.0" rx="2" />
    <rect x="34.0" y="34.0" width="20.0" height="20.0" rx="2" />
  </svg>
);

export const ProToolQuickMagnify = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <rect x="10" y="13" width="28" height="28" rx="3" strokeDasharray="4 3" />
    <path d="M15 34l8-8 6 5 7-8" />
    <circle cx="39" cy="34" r="13" fill="currentColor" fillOpacity=".08" />
    <line x1="48" y1="43" x2="55" y2="50" />
    <path d="M34 35l5-5 4 3 5-6" strokeWidth="1.6" />
  </svg>
);

export const ProToolReferenceLines = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <rect x="10" y="10" width="44" height="44" rx="4" />
    <line x1="10" y1="25" x2="54" y2="25" />
    <line x1="10" y1="39" x2="54" y2="39" />
    <line x1="24" y1="10" x2="24" y2="54" />
    <line x1="40" y1="10" x2="40" y2="54" />
    <circle cx="32" cy="32" r="3" fill="currentColor" stroke="none" />
  </svg>
);

export const ProIconToolExpand = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <rect x="12" y="12" width="40" height="40" rx="4" />
    <line x1="23" y1="23" x2="15" y2="15" />
    <line x1="15" y1="15" x2="18.86370330515627" y2="16.035276180410083" />
    <line x1="15" y1="15" x2="16.03527618041008" y2="18.863703305156275" />
    <line x1="41" y1="23" x2="49" y2="15" />
    <line x1="49" y1="15" x2="47.96472381958991" y2="18.863703305156275" />
    <line x1="49" y1="15" x2="45.13629669484373" y2="16.035276180410083" />
    <line x1="23" y1="41" x2="15" y2="49" />
    <line x1="15" y1="49" x2="16.03527618041008" y2="45.13629669484373" />
    <line x1="15" y1="49" x2="18.86370330515627" y2="47.96472381958991" />
    <line x1="41" y1="41" x2="49" y2="49" />
    <line x1="49" y1="49" x2="45.13629669484373" y2="47.96472381958991" />
    <line x1="49" y1="49" x2="47.96472381958991" y2="45.13629669484373" />
  </svg>
);

export const ProToolRotateRight = (props: IconProps) => (
  <svg width="29px" height="29px" {...base} {...props}>
    <rect x="20" y="20" width="24" height="24" rx="4" />
    <path d="M15 30a18 18 0 0 1 30-11" />
    <line x1="45" y1="19" x2="40.0" y2="19.0" />
    <line x1="45" y1="19" x2="42.5" y2="14.669872981077807" />
    <path d="M49 35a18 18 0 0 1-30 11" />
    <line x1="19" y1="46" x2="24.0" y2="46.0" />
    <line x1="19" y1="46" x2="21.5" y2="50.33012701892219" />
    <line x1="27" y1="27" x2="37" y2="27" strokeWidth="1.4" />
  </svg>
);
