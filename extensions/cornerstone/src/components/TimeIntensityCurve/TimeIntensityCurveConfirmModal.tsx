import React from 'react';
import { FooterAction } from '@ohif/ui-next';

/**
 * RadiAnt TIC workflow: "Confirm & View: Review the automatically selected
 * series in the dialog box, click OK". Shown before the curve is actually
 * generated, listing the dynamic-phase series `findDynamicSiblingSeries`
 * detected (same study/modality/series description as the series the
 * ROI/point was placed on), in the same time-phase order they'll be
 * plotted in.
 */
export function TimeIntensityCurveConfirmModal({ hide, onConfirm, series }) {
  return (
    <div className="text-foreground text-[13px]">
      <p className="text-muted-foreground">
        {series.length} dynamic-phase series were automatically detected for this curve:
      </p>
      <div className="mt-2 max-h-60 overflow-y-auto rounded border border-input">
        <table className="w-full text-left">
          <thead>
            <tr className="text-muted-foreground border-b border-input text-xs">
              <th className="px-2 py-1">Phase</th>
              <th className="px-2 py-1">Series #</th>
              <th className="px-2 py-1">Time</th>
              <th className="px-2 py-1">Description</th>
            </tr>
          </thead>
          <tbody>
            {series.map((s, index) => (
              <tr
                key={s.displaySetInstanceUID ?? index}
                className="border-b border-input last:border-b-0"
              >
                <td className="px-2 py-1">{index + 1}</td>
                <td className="px-2 py-1">{s.SeriesNumber ?? '-'}</td>
                <td className="px-2 py-1">{s.instances?.[0]?.SeriesTime ?? '-'}</td>
                <td className="px-2 py-1">{s.SeriesDescription}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
            onClick={() => {
              onConfirm();
              hide();
            }}
          >
            OK
          </FooterAction.Primary>
        </FooterAction.Right>
      </FooterAction>
    </div>
  );
}

export default TimeIntensityCurveConfirmModal;
