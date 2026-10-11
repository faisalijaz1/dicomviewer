/**
 * Runnable without Jest:
 *   node --experimental-strip-types extensions/cornerstone/src/skmEvictionDiagnosticsFreshness.test.ts
 */
import assert from 'node:assert/strict';
import {
  evaluateLastPassVsLiveConsistency,
  measureLiveOutsideKeep,
} from './skmEvictionDiagnosticsFreshness.ts';

const freshAge = { ageMs: 100, valid: true, reason: 'ok' as const };
const staleAge = { ageMs: 9000, valid: false, reason: 'stale' as const };
const missingAge = { ageMs: Number.POSITIVE_INFINITY, valid: false, reason: 'missing' as const };

// Live vs last-pass: outside-keep from last pass exceeds live entry count (the reported bug shape)
{
  const w = evaluateLastPassVsLiveConsistency({
    lastPassCacheEntriesTotal: 3000,
    lastPassCacheEntriesOutsideKeep: 2783,
    liveCacheEntriesTotal: 1024,
  });
  assert.equal(w.outsideKeepExceedsLiveEntries, true);
  assert.equal(w.liveEntriesDifferFromLastPass, true);
  assert.ok(w.warning && w.warning.indexOf('STALE/MISMATCH') !== -1);
}

// Cache changed after eviction pass (entries differ, outside still plausible)
{
  const w = evaluateLastPassVsLiveConsistency({
    lastPassCacheEntriesTotal: 2274,
    lastPassCacheEntriesOutsideKeep: 800,
    liveCacheEntriesTotal: 1024,
  });
  assert.equal(w.outsideKeepExceedsLiveEntries, false);
  assert.equal(w.liveEntriesDifferFromLastPass, true);
  assert.ok(w.warning && w.warning.indexOf('Cache changed') !== -1);
}

// Consistent last-pass vs live
{
  const w = evaluateLastPassVsLiveConsistency({
    lastPassCacheEntriesTotal: 1024,
    lastPassCacheEntriesOutsideKeep: 400,
    liveCacheEntriesTotal: 1024,
  });
  assert.equal(w.outsideKeepExceedsLiveEntries, false);
  assert.equal(w.liveEntriesDifferFromLastPass, false);
  assert.equal(w.warning, null);
}

// Invalid / missing diagnostic data
{
  const w = evaluateLastPassVsLiveConsistency({
    lastPassCacheEntriesTotal: null,
    lastPassCacheEntriesOutsideKeep: null,
    liveCacheEntriesTotal: null,
  });
  assert.equal(w.outsideKeepExceedsLiveEntries, false);
  assert.equal(w.warning, null);
}

// Live outside-keep: keep-set unavailable → totals only
{
  const m = measureLiveOutsideKeep({
    keepSet: null,
    keepSetAge: missingAge,
    entries: [
      { imageId: 'a', sizeInBytes: 100 },
      { imageId: 'b', sizeInBytes: 200 },
    ],
  });
  assert.equal(m.status, 'keep-set-unavailable');
  assert.equal(m.cacheEntriesTotal, 2);
  assert.equal(m.cacheEntriesOutsideKeep, null);
  assert.equal(m.cacheBytesOutsideKeep, null);
}

// Live outside-keep vs keep-set
{
  const keep = new Set(['a', 'c']);
  const m = measureLiveOutsideKeep({
    keepSet: keep,
    keepSetAge: freshAge,
    entries: [
      { imageId: 'a', sizeInBytes: 10 },
      { imageId: 'b', sizeInBytes: 20 },
      { imageId: 'c', sizeInBytes: 30 },
      { imageId: 'd', sizeInBytes: 40 },
    ],
  });
  assert.equal(m.status, 'ok');
  assert.equal(m.cacheEntriesTotal, 4);
  assert.equal(m.cacheEntriesOutsideKeep, 2);
  assert.equal(m.cacheBytesOutsideKeep, 60);
  assert.equal(m.cacheBytesInsideKeep, 40);
  assert.equal(m.inconsistentOutsideExceedsTotal, false);
  assert.equal(m.keepSetValid, true);
}

// Stale keep-set still measures but labels status (default withhold=false)
{
  const keep = new Set(['a']);
  const m = measureLiveOutsideKeep({
    keepSet: keep,
    keepSetAge: staleAge,
    entries: [
      { imageId: 'a', sizeInBytes: 10 },
      { imageId: 'b', sizeInBytes: 20 },
    ],
  });
  assert.equal(m.status, 'keep-set-stale');
  assert.equal(m.cacheEntriesOutsideKeep, 1);
  assert.equal(m.keepSetValid, false);
}

// Stale keep-set with withhold → outside null, totals present
{
  const keep = new Set(['a']);
  const m = measureLiveOutsideKeep({
    keepSet: keep,
    keepSetAge: staleAge,
    withholdOutsideWhenKeepSetStale: true,
    entries: [
      { imageId: 'a', sizeInBytes: 10 },
      { imageId: 'b', sizeInBytes: 20 },
    ],
  });
  assert.equal(m.status, 'keep-set-stale');
  assert.equal(m.cacheEntriesTotal, 2);
  assert.equal(m.cacheEntriesOutsideKeep, null);
}

// Invalid entries array
{
  const m = measureLiveOutsideKeep({
    keepSet: new Set(['a']),
    keepSetAge: freshAge,
    entries: null as any,
  });
  assert.equal(m.status, 'invalid-entries');
  assert.equal(m.cacheEntriesTotal, null);
}

console.log('skmEvictionDiagnosticsFreshness.test.ts: OK');
