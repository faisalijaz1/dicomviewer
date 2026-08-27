import React, { useState } from 'react';
import { FooterAction } from '@ohif/ui-next';

/**
 * RadiAnt TIC workflow: "Confirm & View: Review the automatically selected
 * series in the dialog box, click OK". Lists the dynamic-phase series
 * `findDynamicSiblingSeries` detected (same study/modality/series
 * description as the series the ROI/point was placed on), in the same
 * time-phase order they'll be plotted in, and lets the radiologist adjust
 * that automatic selection before generating the curve:
 * - uncheck a series to exclude it (e.g. a bad/motion-corrupted phase)
 * - pick which series counts as the temporal baseline (elapsed time = 0)
 *
 * `onConfirm(selectedSeries, baselineDisplaySetInstanceUID)` receives
 * exactly the series the user left checked, in their original order, plus
 * which one they marked as baseline - the caller passes both straight
 * through to generateTimeIntensityCurve so an unchecked series actually
 * stays out of the generated curve.
 */
export function TimeIntensityCurveConfirmModal({ hide, onConfirm, series }) {
  const [checkedUIDs, setCheckedUIDs] = useState<Set<string>>(
    () => new Set(series.map(s => s.displaySetInstanceUID))
  );
  const [baselineUID, setBaselineUID] = useState<string>(series[0]?.displaySetInstanceUID);

  const checkedCount = series.filter(s => checkedUIDs.has(s.displaySetInstanceUID)).length;
  const canGenerate = checkedCount >= 2;

  const toggleSeries = (uid: string) => {
    setCheckedUIDs(prev => {
      const next = new Set(prev);
      if (next.has(uid)) {
        next.delete(uid);
      } else {
        next.add(uid);
      }
      return next;
    });
  };

  const handleConfirm = () => {
    const selectedSeries = series.filter(s => checkedUIDs.has(s.displaySetInstanceUID));
    // If the chosen baseline got unchecked, fall back to the first
    // remaining selected series rather than silently keeping a baseline
    // that's no longer part of the curve.
    const effectiveBaselineUID = checkedUIDs.has(baselineUID)
      ? baselineUID
      : selectedSeries[0]?.displaySetInstanceUID;
    onConfirm(selectedSeries, effectiveBaselineUID);
    hide();
  };

  return (
    <div className="text-foreground text-[13px]">
      <p className="text-muted-foreground">
        {series.length} dynamic-phase series were automatically detected for this curve. Uncheck
        any to exclude them, and pick which phase is the baseline (elapsed time = 0).
      </p>
      <div className="mt-2 max-h-60 overflow-y-auto rounded border border-input">
        <table className="w-full text-left">
          <thead>
            <tr className="text-muted-foreground border-b border-input text-xs">
              <th className="px-2 py-1">Include</th>
              <th className="px-2 py-1">Phase</th>
              <th className="px-2 py-1">Series #</th>
              <th className="px-2 py-1">Time</th>
              <th className="px-2 py-1">Description</th>
              <th className="px-2 py-1">Baseline</th>
            </tr>
          </thead>
          <tbody>
            {series.map((s, index) => {
              const uid = s.displaySetInstanceUID;
              const isChecked = checkedUIDs.has(uid);
              return (
                <tr
                  key={uid ?? index}
                  className="border-b border-input last:border-b-0"
                >
                  <td className="px-2 py-1">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleSeries(uid)}
                      aria-label={`Include ${s.SeriesDescription} in the curve`}
                    />
                  </td>
                  <td className="px-2 py-1">{index + 1}</td>
                  <td className="px-2 py-1">{s.SeriesNumber ?? '-'}</td>
                  <td className="px-2 py-1">{s.instances?.[0]?.SeriesTime ?? '-'}</td>
                  <td className="px-2 py-1">{s.SeriesDescription}</td>
                  <td className="px-2 py-1">
                    <input
                      type="radio"
                      name="tic-baseline"
                      checked={baselineUID === uid}
                      disabled={!isChecked}
                      onChange={() => setBaselineUID(uid)}
                      aria-label={`Use ${s.SeriesDescription} as the baseline`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!canGenerate && (
        <p
          className="mt-2 text-xs text-yellow-500"
          role="alert"
        >
          At least two series must stay checked to generate a curve.
        </p>
      )}
      <FooterAction className="mt-4">
        <FooterAction.Right>
          <FooterAction.Secondary
            dataCY="tic-confirm-modal-cancel-button"
            onClick={hide}
          >
            Cancel
          </FooterAction.Secondary>
          <FooterAction.Primary
            dataCY="tic-confirm-modal-ok-button"
            disabled={!canGenerate}
            onClick={handleConfirm}
          >
            OK
          </FooterAction.Primary>
        </FooterAction.Right>
      </FooterAction>
    </div>
  );
}

export default TimeIntensityCurveConfirmModal;
