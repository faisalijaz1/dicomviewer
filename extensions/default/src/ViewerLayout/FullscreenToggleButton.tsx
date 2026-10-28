import React from 'react';
import { Button } from '@ohif/ui-next';
import { useFullscreenToggle } from '../hooks/useChromelessFullscreen';

/**
 * Persistent header toggle for the browser Fullscreen API. Exists mainly so
 * a doctor can re-enter fullscreen after pressing Esc, which always exits it
 * and cannot be intercepted/prevented by application code - without this
 * button there would be no way back into fullscreen except reloading the
 * page. Icon and aria-label track the real document.fullscreenElement state
 * (via useFullscreenToggle's fullscreenchange listener), not just the last
 * click, so it stays correct regardless of how fullscreen was exited.
 */
function FullscreenToggleButton(): React.ReactElement {
  const { isFullscreen, toggle } = useFullscreenToggle();
  const label = isFullscreen ? 'Exit full screen' : 'Full screen';

  return (
    <Button
      variant="ghost"
      size="icon"
      className="text-primary hover:bg-muted h-full w-full"
      aria-label={label}
      title={label}
      data-cy="fullscreen-toggle-btn"
      onClick={toggle}
    >
      {isFullscreen ? (
        // "minimize" glyph (corner arrows pointing inward)
        <svg
          viewBox="0 0 24 24"
          className="h-[17px] w-[17px]"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
        </svg>
      ) : (
        // "maximize" glyph (corner arrows pointing outward)
        <svg
          viewBox="0 0 24 24"
          className="h-[17px] w-[17px]"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
        </svg>
      )}
    </Button>
  );
}

export default FullscreenToggleButton;
