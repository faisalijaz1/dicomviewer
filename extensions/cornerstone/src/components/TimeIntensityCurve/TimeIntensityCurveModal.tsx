import React from 'react';
import { LineChart } from '@ohif/ui-next';
import type { TimeIntensityPoint } from '../../utils/generateTimeIntensityCurve';

/**
 * Plots signal intensity across a perfusion/DCE-MRI acquisition's
 * time-phase series - averaged over a drawn Elliptical ROI when one exists
 * (the clinically standard way to generate a TIC, matching RadiAnt: mean
 * signal over the region, not a single probed pixel), or at the 3D
 * Cursor/current point otherwise.
 */
function TimeIntensityCurveModal({
  points,
  seriesDescription,
  sampleCount,
  usesRealTime,
}: {
  points: TimeIntensityPoint[];
  seriesDescription: string;
  sampleCount?: number;
  usesRealTime?: boolean;
}) {
  const series = [
    {
      label: seriesDescription,
      points: points.map(p => [p.time, p.value]),
      color: '#5acce6',
    },
  ];

  const axis = {
    x: {
      label: usesRealTime ? 'Time (s)' : 'Time phase',
      indexRef: 0,
      type: 'x',
      range: { min: 0 },
    },
    y: { label: 'Signal intensity', indexRef: 1, type: 'y' },
  };

  const isRoiMean = sampleCount != null && sampleCount > 1;
  const hasThumbnails = points.some(p => p.thumbnailDataUrl);

  return (
    <div className="flex h-[560px] w-[640px] flex-col gap-2">
      <p className="text-muted-foreground text-sm">
        {isRoiMean
          ? `Mean signal intensity across the drawn ROI (~${sampleCount} pixels)`
          : 'Signal intensity at the placed point'}{' '}
        across {points.length} time phases of{' '}
        <span className="text-foreground font-semibold">{seriesDescription}</span>.
        {!isRoiMean &&
          ' Draw an Elliptical ROI over the finding before generating the curve for a more accurate, less noise-sensitive result.'}
      </p>
      <div className="min-h-0 flex-[2]">
        <LineChart
          series={series}
          axis={axis}
          showAxisLabels
          showAxisGrid
        />
      </div>
      {hasThumbnails && (
        <div className="flex-1 min-h-0">
          {/* RadiAnt TIC manual step 7: "It contains the time-intensity
              curve and screen captures of the region in dynamic series
              used for calculations." One capture per time phase, in the
              same left-to-right time order as the curve above. */}
          <p className="text-muted-foreground mb-1 text-xs">
            Region captured per time phase
          </p>
          <div className="flex h-[calc(100%-1.25rem)] gap-2 overflow-x-auto pb-1">
            {points.map((p, i) => (
              <div
                key={i}
                className="flex flex-shrink-0 flex-col items-center gap-0.5"
              >
                {p.thumbnailDataUrl ? (
                  <img
                    src={p.thumbnailDataUrl}
                    alt={`Phase ${i + 1} capture`}
                    className="border-border h-16 w-16 rounded border object-contain"
                  />
                ) : (
                  <div className="border-border bg-muted h-16 w-16 rounded border" />
                )}
                <span className="text-muted-foreground text-[10px]">{i + 1}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default TimeIntensityCurveModal;
