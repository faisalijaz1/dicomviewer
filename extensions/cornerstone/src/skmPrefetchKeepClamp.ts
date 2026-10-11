/**
 * ────────────────────────────────────────────────────────────────────────────
 *  SKM-PREFETCH-KEEP-CLAMP 2026-10-11 — Experiment C (TEST-ONLY)
 *
 *  WHY
 *  Experiments A+B reduced keep and engaged windowed eviction, but the governor still
 *  wrote a large prefetch decode window → prefetch decoded outside keep → evict →
 *  reload churn. This module clamps studyPrefetcher windowAhead/windowBehind to the
 *  effective keep window published by the evictor, with a configurable navigation lead
 *  that adapts to recent scroll velocity (direction-aware) without exceeding keep.
 *
 *  WHEN DISABLED (default): zero work — no timers, no config writes, production path.
 *  Does NOT change workingSetFraction, cache caps, reactiveHighWater, eviction guards,
 *  or StudyPrefetcherService / governor math.
 *
 *  ADAPTIVE SCOPE (honest): lead boosts from STACK_NEW_IMAGE scroll velocity EMA +
 *  direction. Observed load/decode latency is NOT wired into lead sizing in this scoped
 *  change (no reliable per-slice latency feed without broader StudyPrefetcher changes);
 *  use skmTelemetry / scroll-follow for latency evidence. If lead > keep → leadCappedToKeep.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { subscribeStackNewImage } from './utils/skmStackNewImage';
import { computePrefetchKeepClamp } from './skmPrefetchKeepClampMath';

export type SkmPrefetchKeepClampConfig = {
  enabled?: boolean;
  /** Minimum ahead/behind lead slices (≤ keep). Default 40. */
  navigationLeadSlices?: number;
  /** Align warmer nearSkip to the clamped decode window. Default true. */
  alignWarmerNearSkip?: boolean;
  /** Clamp re-apply cadence (ms). Default 250. */
  evalMs?: number;
  /** Velocity → lead look-ahead (ms). Default 500. */
  velocityLookAheadMs?: number;
  /** Cap on velocity-boosted lead (still ≤ keep). Default 200. */
  maxVelocityLeadSlices?: number;
};

let initialized = false;

function nowMs(): number {
  try {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  } catch (e) {
    return Date.now();
  }
}

export function initSkmPrefetchKeepClamp(
  servicesManager: any,
  config: SkmPrefetchKeepClampConfig = {}
): void {
  if (config?.enabled !== true) {
    return; // fully inert when off
  }
  if (initialized) {
    return;
  }
  initialized = true;

  const baseLead = Math.max(1, config.navigationLeadSlices ?? 40);
  const alignWarmer = config.alignWarmerNearSkip !== false;
  const evalMs = Math.max(100, config.evalMs ?? 250);
  const velocityLookAheadMs = Math.max(0, config.velocityLookAheadMs ?? 500);
  const maxVelocityLeadSlices = Math.max(baseLead, config.maxVelocityLeadSlices ?? 200);

  // Velocity / direction from STACK_NEW_IMAGE (per-element; non-bubbling).
  let lastIndex: number | null = null;
  let lastT = 0;
  let direction = 1;
  let velocityEma = 0; // slices/sec
  const onImage = (evt?: any) => {
    try {
      const detail = evt?.detail || {};
      const idx =
        typeof detail.newImageIdIndex === 'number'
          ? detail.newImageIdIndex
          : typeof detail.imageIdIndex === 'number'
            ? detail.imageIdIndex
            : null;
      const t = nowMs();
      if (typeof idx === 'number' && lastIndex != null && lastT > 0) {
        const dtSec = Math.max(0.001, (t - lastT) / 1000);
        const dIdx = idx - lastIndex;
        if (dIdx !== 0) {
          direction = dIdx > 0 ? 1 : -1;
        }
        const inst = Math.abs(dIdx) / dtSec;
        // EMA — responsive but not twitchy
        velocityEma = velocityEma === 0 ? inst : velocityEma * 0.7 + inst * 0.3;
      }
      if (typeof idx === 'number') {
        lastIndex = idx;
        lastT = t;
      }
    } catch (e) {
      /* never break scroll */
    }
  };
  subscribeStackNewImage(onImage);

  const readKeep = () => {
    const w = (globalThis as any).__skmKeepWindow;
    if (w && typeof w.ahead === 'number' && typeof w.behind === 'number') {
      return w;
    }
    // Fallback: diagnostics current pass
    const c = (globalThis as any).__skmEvictionDiagnostics?.current;
    if (c && typeof c.keepAhead === 'number' && typeof c.keepBehind === 'number') {
      return {
        ahead: c.keepAhead,
        behind: c.keepBehind,
        margin: null,
        nStack: c.stackViewports,
        budgetBytes: c.effectiveKeepBudgetBytes,
        testKeepWindowActive: c.testKeepWindowActive,
        ts: c.ts,
      };
    }
    return null;
  };

  const apply = () => {
    try {
      const keep = readKeep();
      const sp = servicesManager?.services?.studyPrefetcherService;
      if (!keep || !sp || !(sp as any).config) {
        return;
      }
      const cfg = (sp as any).config;
      // Prefer governor intent from __skmBudget (unclamped). Reading cfg.window* after our
      // own writes would freeze the clamp at the previous keep if keep later grows.
      const budget = (globalThis as any).__skmBudget;
      const govAhead =
        typeof budget?.windowAhead === 'number' && budget.windowAhead > 0
          ? budget.windowAhead
          : typeof cfg.windowAhead === 'number' && cfg.windowAhead > 0
            ? cfg.windowAhead
            : 1100;
      const govBehind =
        typeof budget?.windowBehind === 'number' && budget.windowBehind > 0
          ? budget.windowBehind
          : typeof cfg.windowBehind === 'number' && cfg.windowBehind > 0
            ? cfg.windowBehind
            : 580;

      const result = computePrefetchKeepClamp({
        keepAhead: keep.ahead,
        keepBehind: keep.behind,
        governorAhead: govAhead,
        governorBehind: govBehind,
        navigationLeadSlices: baseLead,
        direction,
        velocitySlicesPerSec: velocityEma,
        velocityLookAheadMs,
        maxVelocityLeadSlices,
      });

      cfg.windowAhead = result.clampedAhead;
      cfg.windowBehind = result.clampedBehind;
      cfg.windowRadius = Math.max(
        1,
        Math.round((result.clampedAhead + result.clampedBehind) / 2)
      );

      const nearSkip = Math.max(result.clampedAhead, result.clampedBehind);
      const state = {
        clampActive: true,
        keepAhead: keep.ahead,
        keepBehind: keep.behind,
        keepBudgetBytes: keep.budgetBytes ?? null,
        testKeepWindowActive: !!keep.testKeepWindowActive,
        governorWindowAhead: govAhead,
        governorWindowBehind: govBehind,
        clampedWindowAhead: result.clampedAhead,
        clampedWindowBehind: result.clampedBehind,
        navigationLeadSlices: baseLead,
        direction,
        velocitySlicesPerSec: Math.round(velocityEma * 10) / 10,
        adaptedLeadForward: result.adaptedLeadForward,
        adaptedLeadBehind: result.adaptedLeadBehind,
        grantedLeadForward: result.grantedLeadForward,
        grantedLeadBehind: result.grantedLeadBehind,
        leadCappedToKeep: result.leadCappedToKeep,
        leadTradeOffNote: result.leadCappedToKeep
          ? 'Requested velocity/base lead exceeded keep window; granted lead was capped to keep (decoded-cache budget respected; may reduce fast-scroll readiness).'
          : null,
        latencyAdaptive: false,
        latencyAdaptiveNote:
          'Load/decode latency is not used for lead sizing in this scoped Experiment C build; ' +
          'velocity+direction only. Measure spinner/display via skmTelemetry / skmScrollFollowReport.',
        nearSkip: alignWarmer ? nearSkip : null,
        alignWarmerNearSkip: alignWarmer,
        ts: nowMs(),
      };
      (globalThis as any).__skmPrefetchKeepClamp = state;

      if (alignWarmer) {
        // Warmer reads this before __skmBudget.nearSkip (see skmBackgroundWarmer.ts).
        (globalThis as any).__skmPrefetchKeepClampNearSkip = nearSkip;
      }
    } catch (e) {
      /* never break viewer */
    }
  };

  apply();
  setInterval(apply, evalMs);

  (window as any).skmReportPrefetchKeepClamp = () => {
    apply();
    const state = (globalThis as any).__skmPrefetchKeepClamp || null;
    const diag = (globalThis as any).__skmEvictionDiagnostics?.current;
    const report = {
      ...state,
      cacheBytes: diag?.cacheBytes ?? null,
      cacheEntriesTotal: diag?.cacheEntriesTotal ?? null,
      cacheEntriesOutsideKeep: diag?.cacheEntriesOutsideKeep ?? null,
      cacheBytesOutsideKeep: diag?.cacheBytesOutsideKeep ?? null,
      fillPct: diag?.fillPct ?? null,
      windowedCandidates: diag?.windowedCandidates ?? null,
      totalEvictions: (globalThis as any).__skmEvictions || 0,
      reactivePathReason: diag?.reactivePathReason ?? null,
      // Churn / network evidence (best-effort from telemetry counters if present)
      telemetryHint:
        'Call skmTelemetry.report() / skmTelemetry.wadoReport() for reDecodes, evictionsPerMin, wadoFromNetwork.',
      likelyPrefetchOutsideKeep:
        typeof diag?.cacheEntriesOutsideKeep === 'number' &&
        typeof diag?.cacheEntriesTotal === 'number' &&
        diag.cacheEntriesTotal > 0 &&
        diag.cacheEntriesOutsideKeep / diag.cacheEntriesTotal > 0.1,
      acceptanceNote:
        'Success requires (1) stable residency over ≥3 full traversals materially below 1.926 GB AND ' +
        '(2) responsive rapid forward/reverse scroll. Memory alone is not success.',
    };
    // eslint-disable-next-line no-console
    console.log('[SKM-PREFETCH-KEEP-CLAMP]', report);
    return report;
  };

  // eslint-disable-next-line no-console
  console.log(
    `[SKM-PREFETCH-KEEP-CLAMP] Experiment C ACTIVE — clamp prefetch to keep; ` +
      `navigationLeadSlices=${baseLead}, velocityLookAheadMs=${velocityLookAheadMs}, ` +
      `alignWarmerNearSkip=${alignWarmer}. Call skmReportPrefetchKeepClamp().`
  );
}

export default initSkmPrefetchKeepClamp;
