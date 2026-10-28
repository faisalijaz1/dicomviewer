/**
 * ────────────────────────────────────────────────────────────────────────────
 *  SKM-STACK-NEW-IMAGE 2026-10-04 — Phase B shared event wiring
 *
 *  WHY
 *  Cornerstone's STACK_NEW_IMAGE is a CustomEvent dispatched on the viewport ELEMENT
 *  with NO `bubbles` (verified: core/utilities/triggerEvent.js). So it reaches neither
 *  `document` nor the core `eventTarget` singleton — only listeners attached directly to
 *  the element fire. Our evictor / warmer / prefetcher re-center all listened on
 *  document/eventTarget and were therefore DEAD during scrolling. ELEMENT_ENABLED and
 *  ELEMENT_DISABLED, however, DO fire on `eventTarget` (that is how skmTelemetry wires
 *  its per-element timers successfully). This helper attaches a STACK_NEW_IMAGE listener
 *  to every current and future viewport element, so scroll/jump actually drives the
 *  working-set evictor and the moving warmer.
 *
 *  Returns an unsubscribe function.
 * ────────────────────────────────────────────────────────────────────────────
 */

// eslint-disable-next-line
import { eventTarget, Enums, getEnabledElements } from '@cornerstonejs/core';

export function subscribeStackNewImage(handler: (evt?: any) => void): () => void {
  const E: any = Enums.Events as any;
  const STACK_NEW_IMAGE = E.STACK_NEW_IMAGE || 'CORNERSTONE_STACK_NEW_IMAGE';
  return subscribeViewportElementEvent(STACK_NEW_IMAGE, handler);
}

/** Same per-element wiring as STACK_NEW_IMAGE, for another non-bubbling viewport event. */
export function subscribeViewportElementEvent(
  eventName: string,
  handler: (evt?: any) => void
): () => void {
  const E: any = Enums.Events as any;
  const ELEMENT_ENABLED = E.ELEMENT_ENABLED || 'CORNERSTONE_ELEMENT_ENABLED';
  const ELEMENT_DISABLED = E.ELEMENT_DISABLED || 'CORNERSTONE_ELEMENT_DISABLED';

  const wired = new Set<any>();

  const wire = (element: any) => {
    if (!element || wired.has(element)) {
      return;
    }
    wired.add(element);
    try {
      element.addEventListener(eventName, handler);
    } catch (e) {
      wired.delete(element);
    }
  };

  try {
    (getEnabledElements() || []).forEach((en: any) => wire(en?.element || en?.viewport?.element));
  } catch (e) {
    /* best-effort */
  }

  const onEnabled = (evt: any) => wire(evt?.detail?.element);
  const onDisabled = (evt: any) => {
    const el = evt?.detail?.element;
    if (el && wired.has(el)) {
      try {
        el.removeEventListener(eventName, handler);
      } catch (e) {
        /* noop */
      }
      wired.delete(el);
    }
  };

  eventTarget.addEventListener(ELEMENT_ENABLED, onEnabled);
  eventTarget.addEventListener(ELEMENT_DISABLED, onDisabled);

  return () => {
    try {
      eventTarget.removeEventListener(ELEMENT_ENABLED, onEnabled);
      eventTarget.removeEventListener(ELEMENT_DISABLED, onDisabled);
    } catch (e) {
      /* noop */
    }
    wired.forEach(el => {
      try {
        el.removeEventListener(eventName, handler);
      } catch (e) {
        /* noop */
      }
    });
    wired.clear();
  };
}
