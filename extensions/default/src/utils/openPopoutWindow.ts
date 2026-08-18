/**
 * Opens a URL in a new browser window with as little Chrome UI as
 * window.open() can actually suppress, sized to fill an entire monitor -
 * used for "pop out this view into its own window" affordances (opening a
 * study from the worklist, a thumbnail Ctrl+click, a mode-launch link, a
 * "full window" toolbar button). Each pop-out is a fresh browser context:
 * it re-fetches and re-decodes its own data rather than sharing the
 * opener's cache - heavier on the PACS/network and slower to open than a
 * true shared-cache secondary view would be, but far simpler, and accepted
 * as a tradeoff.
 *
 * Ceiling of what's achievable here: Chrome always keeps its address bar
 * and a minimal title bar on a window.open() popup, regardless of the
 * `toolbar`/`location`/`menubar` features below - that's a deliberate
 * anti-phishing restriction, not something any feature string can turn
 * off. A fully chrome-less window (no address bar at all) requires either
 * launching Chrome with a `--app=<url>` shortcut or installing the app as
 * a PWA - both explicitly out of scope for this helper. What this DOES
 * reliably achieve is a window sized to cover the full monitor (not just a
 * large centered box), which is what actually reads as "full screen" to a
 * user glancing at it.
 *
 * Second-monitor targeting: if the OS reports an extended desktop
 * (`window.screen.isExtended`), this opens on the second monitor by
 * default rather than the one showing the worklist. The window is first
 * opened synchronously (inside the click's user-gesture window, so popup
 * blockers don't intervene) using a same-size-second-monitor guess derived
 * from `window.screen`, then - if the browser supports the Window
 * Management API and the user has granted (or grants, via the resulting
 * one-time prompt) permission - corrected to the real second screen's
 * exact bounds via getScreenDetails(). If that API is unavailable or
 * denied, the synchronous guess (which already handles the common
 * same-size-side-by-side-monitors case) is what sticks.
 */
export function openPopoutWindow(
  url: string,
  windowName = '_blank',
  { targetSecondScreen = true } = {}
): Window | null {
  const { screen } = window;
  const isExtended = targetSecondScreen && screen.isExtended;

  // Marks the popup's URL so the app's own bootstrap (platform/app/src/index.js)
  // can tell "this tab is one of our pop-outs" apart from unrelated
  // window.open() usages that share the same window.opener relationship
  // (the OIDC login popup, the "About OHIF" external link, etc.) and must
  // NOT be resized to full screen.
  const markedUrl = new URL(url, window.location.origin);
  markedUrl.searchParams.set('_ohifPopout', '1');
  url = markedUrl.toString();

  // Best-effort synchronous guess, refined below if getScreenDetails() is
  // available - kept synchronous so window.open() below still runs inside
  // the triggering click's user-gesture window (awaiting a promise first
  // can cause the popup to be blocked).
  //
  // Deliberately uses availWidth/availHeight (the usable desktop area,
  // excluding the taskbar), not width/height (the full physical
  // resolution) - sizing to the raw resolution leaves part of the window
  // hidden behind the taskbar and reads as "not actually full screen",
  // needing a manual maximize to fix.
  const guess = isExtended
    ? { left: screen.width, top: 0, width: screen.availWidth, height: screen.availHeight }
    : {
        left: screen.availLeft ?? 0,
        top: screen.availTop ?? 0,
        width: screen.availWidth,
        height: screen.availHeight,
      };

  const features = [
    // Signals Chrome to render this as a popup window (no tab strip,
    // bookmarks bar, or extensions toolbar) rather than a plain new tab.
    'popup=yes',
    // Suppresses the back/forward/reload button row Chrome would otherwise
    // show. location/menubar/status are legacy features Chrome no longer
    // honors for the address bar itself, but are harmless to keep.
    'toolbar=no',
    'menubar=no',
    'location=no',
    'status=no',
    'resizable=yes',
    'scrollbars=yes',
    `width=${guess.width}`,
    `height=${guess.height}`,
    `left=${guess.left}`,
    `top=${guess.top}`,
  ].join(',');

  const popout = window.open(url, windowName, features);
  popout?.focus();

  if (popout) {
    // window.open()'s size/position features are only honored when it
    // creates a brand-new window - if a window with this name is already
    // open (e.g. re-opening a study whose popup the user previously
    // resized, or that was left over from an earlier click), the browser
    // just reuses and focuses it as-is, silently ignoring the features
    // string above. Force the size/position explicitly every time so a
    // reused window still ends up full screen instead of stuck at
    // whatever size it was last left at.
    //
    // Applied more than once (now, shortly after, on load, and shortly
    // after load) because Chrome has been observed to silently ignore a
    // resizeTo/moveTo call made before the popup has finished its initial
    // layout - one immediate call isn't reliable on its own.
    const applySize = () => {
      if (popout.closed) {
        return;
      }
      popout.moveTo(guess.left, guess.top);
      popout.resizeTo(guess.width, guess.height);
    };
    applySize();
    setTimeout(applySize, 150);
    setTimeout(applySize, 800);
    popout.addEventListener('load', () => {
      applySize();
      setTimeout(applySize, 150);
    });
  }

  if (popout && targetSecondScreen && typeof window.getScreenDetails === 'function') {
    // Fire-and-forget refinement - corrects the guess above to the real
    // second screen's bounds (different-sized monitors, ones stacked
    // vertically, etc.) once/if the browser resolves it. Silently keeps
    // the synchronous guess if this is denied or unsupported.
    window
      .getScreenDetails()
      .then(({ screens, currentScreen }) => {
        if (popout.closed || screens.length < 2) {
          return;
        }
        const targetScreen = screens.find(s => s !== currentScreen) ?? screens[1];
        popout.moveTo(targetScreen.availLeft, targetScreen.availTop);
        popout.resizeTo(targetScreen.availWidth, targetScreen.availHeight);
      })
      .catch(() => {
        // Permission denied or unsupported - keep the synchronous guess.
      });
  }

  return popout;
}

export default openPopoutWindow;
