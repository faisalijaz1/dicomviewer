import { useEffect, useRef, useState } from 'react';
import { imageLoadPoolManager, eventTarget, Enums } from '@cornerstonejs/core';

const ONE_SECOND = 1000;

export interface StudyImageLoadProgress {
  isLoading: boolean;
  total: number;
  loaded: number;
  remaining: number;
  percentComplete: number;
  secondsRemaining: number | null;
}

const IDLE: StudyImageLoadProgress = {
  isLoading: false,
  total: 0,
  loaded: 0,
  remaining: 0,
  percentComplete: 0,
  secondsRemaining: null,
};

// Module-level singleton: patched once regardless of how many components
// use this hook. Tracks cornerstone's REAL image-load queue directly
// (imageLoadPoolManager.addRequest = an image has been queued; the
// IMAGE_LOADED/IMAGE_LOAD_FAILED events = it settled) rather than trying to
// predict "how many images this study has" up front - that approach (an
// earlier version of this file) computed every imageId across all active
// display sets as the total, but OHIF loads images progressively/lazily as
// the user actually scrolls/views them, so the vast majority of a large
// study's images are never requested at all unless viewed - the bar either
// never moved or never appeared. Watching the actual queue instead means
// this naturally reflects only what's genuinely in flight right now, and
// naturally resets to a fresh 0-based session (bar reappears) the next
// time something new gets queued after being fully drained.
const queuedImageIds = new Set<string>();
let sessionTotal = 0;
let sessionLoaded = 0;
let patched = false;
const listeners = new Set<() => void>();

// SKM 2026-10-09 (QA fix — Priority 2 round 10): notify() used to call every
// listener synchronously on EVERY single addRequest()/IMAGE_LOADED/
// IMAGE_LOAD_FAILED event - during an old-series prefetch storm (hundreds of
// dispatches/completions in a few seconds) that forced a React re-render of
// every useStudyImageLoadProgress() consumer (StudyLoadingStatusBar, mounted
// app-wide in ViewerLayout) once per raw event. Investigation proved this
// self-inflicted re-render volume was what delayed React's processing of the
// user's own thumbnail click (and everything downstream of it, including the
// prefetcher's switch signal) during that same storm - not a deliberate
// scheduling boundary, but React's own commit capacity being continuously
// consumed by this hook's unthrottled notifications. Coalescing to at most one
// listener fan-out per animation frame fixes that without touching the
// tracked counters themselves (queuedImageIds/sessionTotal/sessionLoaded are
// still updated synchronously and immediately on every event, exactly as
// before - only the RENDER trigger is batched).
let rafHandle: number | null = null;

function notify() {
  if (rafHandle !== null) {
    // A frame is already scheduled - this event's effect on the tracked
    // counters already happened synchronously before notify() was called, so
    // the upcoming frame's single render will already reflect it.
    return;
  }
  rafHandle = requestAnimationFrame(() => {
    rafHandle = null;
    listeners.forEach(listener => listener());
  });
}

function ensurePatched() {
  if (patched) {
    return;
  }
  patched = true;

  const originalAddRequest = imageLoadPoolManager.addRequest.bind(imageLoadPoolManager);
  imageLoadPoolManager.addRequest = (requestFn, type, additionalDetails, priority) => {
    const imageId = (additionalDetails as { imageId?: string })?.imageId;
    if (imageId && !queuedImageIds.has(imageId)) {
      // Previous session fully drained - start a fresh 0-based count so
      // percent/remaining reflect only this new batch, not a stale total.
      if (queuedImageIds.size === 0 && sessionTotal > 0 && sessionLoaded >= sessionTotal) {
        sessionTotal = 0;
        sessionLoaded = 0;
      }
      queuedImageIds.add(imageId);
      sessionTotal++;
      notify();
    }
    return originalAddRequest(requestFn, type, additionalDetails, priority);
  };

  const handleSettled = (imageId?: string) => {
    if (imageId && queuedImageIds.has(imageId)) {
      queuedImageIds.delete(imageId);
      sessionLoaded++;
      notify();
    }
  };

  eventTarget.addEventListener(Enums.Events.IMAGE_LOADED, (evt: CustomEvent) => {
    handleSettled(evt.detail?.image?.imageId);
  });
  eventTarget.addEventListener(Enums.Events.IMAGE_LOAD_FAILED, (evt: CustomEvent) => {
    handleSettled(evt.detail?.imageId);
  });

  // Cancelling a stale series' queued-but-not-yet-sent loads (see
  // CornerstoneViewportService's series-switch handling, which calls
  // @cornerstonejs/core's imageLoader.cancelLoadImage(s) when a viewport's
  // displayed series changes mid-load) removes them from cornerstone's
  // request pool via imageLoadPoolManager.filterRequests(), WITHOUT ever
  // firing IMAGE_LOADED or IMAGE_LOAD_FAILED - so without this, those
  // imageIds stayed stuck in `queuedImageIds` forever: "remaining" never
  // dropped for them, and percentComplete's denominator kept counting
  // requests that could now never resolve. The network cancellation was
  // already correct; the progress bar just never found out, so it looked
  // like it was still loading the series the doctor had already navigated
  // away from.
  //
  // Hooked here (imageLoadPoolManager.filterRequests) rather than on
  // `imageLoader.cancelLoadImage(s)` directly - the imageLoader module's
  // named exports are read-only bindings in this build (reassigning one
  // throws "Cannot set property ... which has only a getter", confirmed
  // live), whereas imageLoadPoolManager is a plain mutable singleton
  // instance (already proven safe to patch by addRequest above).
  // cornerstone3D doesn't export its internal RequestDetailsInterface, so
  // this only declares the one field actually read here rather than
  // duplicating the library's full (non-exported) shape.
  type RequestDetails = { additionalDetails?: { imageId?: string } };
  const originalFilterRequests = imageLoadPoolManager.filterRequests.bind(imageLoadPoolManager);
  const wrappedFilterRequests = (filterFunction: (requestDetails: RequestDetails) => boolean): void => {
    let removedCount = 0;
    const wrappedFilter = (requestDetails: RequestDetails) => {
      const keep = filterFunction(requestDetails);
      if (!keep) {
        const imageId = requestDetails?.additionalDetails?.imageId;
        if (imageId && queuedImageIds.has(imageId)) {
          queuedImageIds.delete(imageId);
          removedCount++;
        }
      }
      return keep;
    };
    originalFilterRequests(wrappedFilter);
    if (removedCount) {
      // These never resolved - shrink the denominator by the same amount
      // rather than counting them as "loaded", so percentComplete reflects
      // only the series actually still being fetched.
      sessionTotal = Math.max(0, sessionTotal - removedCount);
      notify();
    }
  };
  imageLoadPoolManager.filterRequests = wrappedFilterRequests as typeof originalFilterRequests;
}

/**
 * RadiAnt-style "N files left" tracking, driven directly by cornerstone's
 * own image request queue (see module-level comment above) rather than a
 * speculative whole-study total.
 */
export function useStudyImageLoadProgress(): StudyImageLoadProgress {
  const [, forceRender] = useState(0);
  const recentCompletionsRef = useRef<number[]>([]);

  useEffect(() => {
    ensurePatched();

    const listener = () => {
      recentCompletionsRef.current.push(Date.now());
      forceRender(n => n + 1);
    };
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
      // SKM 2026-10-09 (QA fix — Priority 2 round 10): if this was the last
      // consumer, cancel any still-pending animation-frame fan-out instead of
      // leaving it scheduled against an now-empty listener set - avoids a
      // stale rAF callback surviving between hook instances (e.g. a viewport
      // unmount followed shortly by a fresh mount), and guarantees no
      // forceRender can ever fire after this instance has unmounted.
      if (listeners.size === 0 && rafHandle !== null) {
        cancelAnimationFrame(rafHandle);
        rafHandle = null;
      }
    };
  }, []);

  const remaining = queuedImageIds.size;
  const total = sessionTotal;
  const loaded = sessionLoaded;

  if (remaining === 0 || total === 0) {
    return IDLE;
  }

  const now = Date.now();
  const windowStart = now - 5 * ONE_SECOND;
  const recent = recentCompletionsRef.current.filter(t => t >= windowStart);
  recentCompletionsRef.current = recent;

  let secondsRemaining: number | null = null;
  if (recent.length >= 2) {
    const windowDurationSeconds = (now - recent[0]) / ONE_SECOND;
    const rate = recent.length / Math.max(windowDurationSeconds, 0.001);
    if (rate > 0) {
      secondsRemaining = Math.round(remaining / rate);
    }
  }

  return {
    isLoading: true,
    total,
    loaded,
    remaining,
    percentComplete: Math.round((loaded / total) * 100),
    secondsRemaining,
  };
}

export default useStudyImageLoadProgress;
