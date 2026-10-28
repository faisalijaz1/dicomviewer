/**
 * SKM eviction-diagnostics freshness helpers (pure, no Cornerstone imports).
 *
 * Separates LIVE decoded-cache accounting from LAST-PASS pass-record counts so
 * reports cannot silently mix a refreshed ageMs/valid with stale outside-keep totals.
 */

import type { SnapshotAgeResult } from './skmEvictionDiagnosticsClock';

export type CacheEntryAccount = {
  imageId: string;
  sizeInBytes: number;
};

export type LiveOutsideKeepStatus =
  | 'ok'
  | 'keep-set-unavailable'
  | 'keep-set-stale'
  | 'invalid-entries';

export type LiveOutsideKeepMeasurement = {
  status: LiveOutsideKeepStatus;
  measuredAtNote: string;
  cacheEntriesTotal: number | null;
  cacheEntriesOutsideKeep: number | null;
  cacheBytesOutsideKeep: number | null;
  cacheBytesInsideKeep: number | null;
  /** True when outside-keep entry count exceeds live total (should never happen for live scan). */
  inconsistentOutsideExceedsTotal: boolean;
  keepSetKnown: boolean;
  keepSetValid: boolean;
  keepSetAgeMs: number | null;
  keepSetValidityReason: string | null;
};

/**
 * Read-only: count live cache entries inside/outside a keep-set snapshot.
 * Does not mutate the cache. Live totals are always from `entries`. Outside-keep
 * requires a keep-set; if the keep-set is aged, numbers are still returned but
 * status is `keep-set-stale` so callers must not treat keep bounds as freshly scrolled.
 */
export function measureLiveOutsideKeep(input: {
  keepSet: Set<string> | null | undefined;
  keepSetAge: SnapshotAgeResult;
  entries: CacheEntryAccount[];
  /**
   * When true, withhold outside-keep counts if keep-set is not fresh (totals still returned).
   * Default false: return outside-keep vs last known keep-set and label staleness via status.
   */
  withholdOutsideWhenKeepSetStale?: boolean;
}): LiveOutsideKeepMeasurement {
  const keepSetKnown = !!input.keepSet && typeof input.keepSet.has === 'function';
  const keepSetValid = !!input.keepSetAge?.valid;
  const keepSetAgeMs = Number.isFinite(input.keepSetAge?.ageMs)
    ? input.keepSetAge.ageMs
    : null;
  const keepSetValidityReason = input.keepSetAge?.reason ?? 'missing';

  if (!Array.isArray(input.entries)) {
    return {
      status: 'invalid-entries',
      measuredAtNote: 'live-cache-scan-unavailable',
      cacheEntriesTotal: null,
      cacheEntriesOutsideKeep: null,
      cacheBytesOutsideKeep: null,
      cacheBytesInsideKeep: null,
      inconsistentOutsideExceedsTotal: false,
      keepSetKnown,
      keepSetValid,
      keepSetAgeMs: keepSetAgeMs != null ? Math.round(keepSetAgeMs) : null,
      keepSetValidityReason,
    };
  }

  let total = 0;
  let outside = 0;
  let bytesOut = 0;
  let bytesIn = 0;
  for (const e of input.entries) {
    if (!e || typeof e.imageId !== 'string' || !e.imageId) {
      continue;
    }
    const sz =
      typeof e.sizeInBytes === 'number' && Number.isFinite(e.sizeInBytes) ? e.sizeInBytes : 0;
    total++;
    if (keepSetKnown && input.keepSet!.has(e.imageId)) {
      bytesIn += sz;
    } else if (keepSetKnown) {
      outside++;
      bytesOut += sz;
    }
  }

  if (!keepSetKnown) {
    return {
      status: 'keep-set-unavailable',
      measuredAtNote: 'live-cache-totals-only; outside-keep unavailable (no keep-set snapshot)',
      cacheEntriesTotal: total,
      cacheEntriesOutsideKeep: null,
      cacheBytesOutsideKeep: null,
      cacheBytesInsideKeep: null,
      inconsistentOutsideExceedsTotal: false,
      keepSetKnown: false,
      keepSetValid: false,
      keepSetAgeMs: null,
      keepSetValidityReason: 'missing',
    };
  }

  if (input.withholdOutsideWhenKeepSetStale && !keepSetValid) {
    return {
      status: 'keep-set-stale',
      measuredAtNote:
        'live-cache-totals available; outside-keep withheld because keep-set snapshot is stale/invalid',
      cacheEntriesTotal: total,
      cacheEntriesOutsideKeep: null,
      cacheBytesOutsideKeep: null,
      cacheBytesInsideKeep: null,
      inconsistentOutsideExceedsTotal: false,
      keepSetKnown: true,
      keepSetValid: false,
      keepSetAgeMs: keepSetAgeMs != null ? Math.round(keepSetAgeMs) : null,
      keepSetValidityReason,
    };
  }

  return {
    status: keepSetValid ? 'ok' : 'keep-set-stale',
    measuredAtNote: keepSetValid
      ? 'live-cache-scan vs last-pass keep-set (keep-set fresh)'
      : 'live-cache-scan vs last-pass keep-set (keep-set aged; membership applied — verify center still current)',
    cacheEntriesTotal: total,
    cacheEntriesOutsideKeep: outside,
    cacheBytesOutsideKeep: bytesOut,
    cacheBytesInsideKeep: bytesIn,
    inconsistentOutsideExceedsTotal: outside > total,
    keepSetKnown: true,
    keepSetValid,
    keepSetAgeMs: keepSetAgeMs != null ? Math.round(keepSetAgeMs) : null,
    keepSetValidityReason,
  };
}

export type LastPassVsLiveWarning = {
  /** Last-pass outside-keep entry count exceeds live decoded entry count. */
  outsideKeepExceedsLiveEntries: boolean;
  /** Live cache entry count differs from last-pass cacheEntriesTotal. */
  liveEntriesDifferFromLastPass: boolean;
  /** Human-readable warning; null when consistent. */
  warning: string | null;
};

/**
 * Detect silent mix-ups: stale last-pass outside-keep next to a newer live entry total.
 */
export function evaluateLastPassVsLiveConsistency(input: {
  lastPassCacheEntriesTotal: number | null | undefined;
  lastPassCacheEntriesOutsideKeep: number | null | undefined;
  liveCacheEntriesTotal: number | null | undefined;
}): LastPassVsLiveWarning {
  const lastTotal =
    typeof input.lastPassCacheEntriesTotal === 'number' &&
    Number.isFinite(input.lastPassCacheEntriesTotal)
      ? input.lastPassCacheEntriesTotal
      : null;
  const lastOutside =
    typeof input.lastPassCacheEntriesOutsideKeep === 'number' &&
    Number.isFinite(input.lastPassCacheEntriesOutsideKeep)
      ? input.lastPassCacheEntriesOutsideKeep
      : null;
  const liveTotal =
    typeof input.liveCacheEntriesTotal === 'number' && Number.isFinite(input.liveCacheEntriesTotal)
      ? input.liveCacheEntriesTotal
      : null;

  const outsideKeepExceedsLiveEntries =
    lastOutside != null && liveTotal != null && lastOutside > liveTotal;
  const liveEntriesDifferFromLastPass =
    lastTotal != null && liveTotal != null && lastTotal !== liveTotal;

  let warning: string | null = null;
  if (outsideKeepExceedsLiveEntries) {
    warning =
      `STALE/MISMATCH: lastPass.cacheEntriesOutsideKeep (${lastOutside}) > live.cacheEntriesTotal (${liveTotal}). ` +
      `Do not treat last-pass outside-keep as a live cache count.`;
  } else if (liveEntriesDifferFromLastPass) {
    warning =
      `Cache changed since last eviction pass (lastPass.entries=${lastTotal}, live.entries=${liveTotal}). ` +
      `Use live.* for current residency; lastPass.* is frozen at pass time.`;
  }

  return { outsideKeepExceedsLiveEntries, liveEntriesDifferFromLastPass, warning };
}
