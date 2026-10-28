import { useCallback, useEffect, useState } from 'react';

/**
 * True when the current URL's query string has chromeless=1. Read-only and
 * additive - never mutates the URL, so it cannot interfere with any other
 * query parameter (StudyInstanceUIDs, token, requestId, storagePath,
 * Modality, ...).
 */
export function isChromelessRequested(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('chromeless') === '1';
  } catch (e) {
    return false;
  }
}

/**
 * Requests fullscreen on the root <html> element. Browsers reject (and some
 * older ones throw) requestFullscreen() when it isn't called synchronously
 * from a user gesture, or when the Fullscreen API is unavailable/blocked by
 * permissions policy - both are handled quietly here (logged, never thrown),
 * per the feature's requirement to never crash the viewer over this.
 */
function requestFullscreenQuietly(): void {
  const el = document.documentElement;
  if (typeof el.requestFullscreen !== 'function') {
    return;
  }
  try {
    el.requestFullscreen().catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.warn('[chromeless] requestFullscreen() was rejected:', error);
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[chromeless] requestFullscreen() threw synchronously:', error);
  }
}

/**
 * When `enabled` and the URL requests chromeless mode (?chromeless=1),
 * attaches a ONE-TIME click/keydown listener (capture-agnostic, `{ once:
 * true }`) that enters fullscreen on the doctor's very first interaction
 * with the page. Browsers refuse requestFullscreen() without an active user
 * gesture, so this intentionally does NOT call it eagerly on load - it waits
 * for that first click/keypress, which makes the transition feel automatic
 * without violating the browser's activation requirement.
 *
 * No-op - attaches nothing at all - when `enabled` is false or chromeless=1
 * is absent from the URL, leaving existing (non-chromeless) behavior
 * completely unchanged in both cases.
 */
export function useChromelessAutoFullscreen(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !isChromelessRequested()) {
      return;
    }

    const onFirstGesture = () => {
      requestFullscreenQuietly();
    };

    document.addEventListener('click', onFirstGesture, { once: true });
    document.addEventListener('keydown', onFirstGesture, { once: true });

    return () => {
      document.removeEventListener('click', onFirstGesture);
      document.removeEventListener('keydown', onFirstGesture);
    };
  }, [enabled]);
}

/**
 * Tracks document.fullscreenElement (via the fullscreenchange event) and
 * exposes a toggle() that requests or exits fullscreen as appropriate - the
 * persistent header button's state/icon source of truth. Pressing Esc always
 * exits fullscreen outside of any application code's control, so isFullscreen
 * is driven by the actual DOM state rather than by which action the button
 * last performed, keeping the button correct no matter how fullscreen was
 * exited (Esc, OS/browser chrome, this toggle, etc).
 */
export function useFullscreenToggle(): { isFullscreen: boolean; toggle: () => void } {
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => !!document.fullscreenElement);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  }, []);

  const toggle = useCallback(() => {
    if (document.fullscreenElement) {
      try {
        document.exitFullscreen().catch((error: unknown) => {
          // eslint-disable-next-line no-console
          console.warn('[chromeless] exitFullscreen() was rejected:', error);
        });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('[chromeless] exitFullscreen() threw synchronously:', error);
      }
      return;
    }
    requestFullscreenQuietly();
  }, []);

  return { isFullscreen, toggle };
}
