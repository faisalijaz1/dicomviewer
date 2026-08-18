import React from 'react';
import type { IconProps } from '../types';

/**
 * SKM brand lockup — circular white logo badge + single-line product title.
 */
export const OHIFLogo = (_props: IconProps) => (
  <div className="flex items-center gap-2.5 min-w-0">
    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-white shadow-[0_2px_10px_rgba(0,0,0,0.22)] ring-1 ring-white/30">
      <img
        src="./assets/skmlogo1.png"
        alt="SKM"
        className="h-[72%] w-[72%] translate-x-[0.5px] translate-y-[1px] object-contain"
      />
    </div>
    <div className="truncate whitespace-nowrap text-[13px] font-semibold tracking-[-0.01em] text-white">
      SKM DICOM Viewer
    </div>
  </div>
);

export default OHIFLogo;
