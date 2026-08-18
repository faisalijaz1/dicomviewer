import React from 'react';
import { useSystem } from '@ohif/core';
import { Icons } from '@ohif/ui-next';
import useStudyImageLoadProgress from '../../hooks/useStudyImageLoadProgress';

/**
 * RadiAnt-style fixed footer bar, shown only while images are actually being
 * downloaded/decoded and hidden the instant loading catches up -
 * reappearing automatically next time (new series, new study, scroll-
 * triggered prefetch) causes more images to load. See
 * useStudyImageLoadProgress for the underlying tracking (including how a
 * cancelled series-switch is correctly reflected here, not just in the
 * network layer).
 *
 * Layout: label + numeric detail share one baseline-aligned row (so neither
 * competes for the reader's attention - the label answers "what's
 * happening", the numbers answer "how much longer"), with a full-width bar
 * underneath rather than a small fixed-width one - at a glance, the bar's
 * own fill level is the fastest way to gauge progress, and cramming it into
 * 160px made that harder to read than it needed to be.
 */
function StudyLoadingStatusBar() {
  const { servicesManager } = useSystem();
  const ProgressLoadingBar =
    servicesManager.services.customizationService.getCustomization('ui.progressLoadingBar');

  const { isLoading, loaded, total, remaining, percentComplete, secondsRemaining } =
    useStudyImageLoadProgress();

  if (!isLoading) {
    return null;
  }

  const formattedTimeRemaining =
    secondsRemaining == null
      ? null
      : secondsRemaining < 1
        ? 'almost done'
        : secondsRemaining < 60
          ? `~${secondsRemaining}s remaining`
          : `~${Math.ceil(secondsRemaining / 60)}m remaining`;

  return (
    <div className="bg-muted/95 text-foreground border-input fixed inset-x-0 bottom-0 z-[9999] flex h-11 items-center gap-3 border-t px-4 text-[13px] shadow-[0_-2px_8px_rgba(0,0,0,0.15)] backdrop-blur-sm">
      <Icons.LoadingSpinner className="text-highlight h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate font-medium">
            Loading {remaining} {remaining === 1 ? 'image' : 'images'}&hellip;
          </span>
          <span className="text-muted-foreground shrink-0 [font-variant-numeric:tabular-nums]">
            {loaded}/{total} &middot; {percentComplete}%
            {formattedTimeRemaining ? ` · ${formattedTimeRemaining}` : ''}
          </span>
        </div>
        <div className="mt-1.5">
          <ProgressLoadingBar progress={percentComplete} />
        </div>
      </div>
    </div>
  );
}

export default StudyLoadingStatusBar;
