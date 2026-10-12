# SKM Bulk API vs WADO-URI — Plan Execution Findings

**Executes the to-dos in** `bulk_api_vs_wado-uri_review_80c1e8e3.plan.md` (not edited by this document).
**Scope:** measurement/verification only, as scoped by that plan. **No source, config, or deploy changes were made.** Where a to-do required *live* browser telemetry (`skmThroughput.*` during an actual office session) that this environment cannot drive, that gap is called out explicitly rather than invented.

---

## Tier 0 — Reconcile the 65s-vs-100s / 27s-vs-33.7s discrepancies

**What was achievable without a live browser session:** git-history archaeology on `platform/app/public/app-config.js`, since the "27s vs bulk 33.7s" number lives in a dated comment, not just prose.

### Finding: the 27s/33.7s comparison and the double-fetch incident are the SAME commit, and predate most of Bulk's own hardening

```
git log --all -S "27s vs bulk" --format="%H %ad %s" --date=short -- platform/app/public/app-config.js
→ 90fde307f101e77c289abe20e6d927df4d1c1cb6 2026-09-30 testng
```

That single commit (`90fde30`, 2026-09-30) introduces **both** the double-fetch incident text (*"Network tab showed 1,594 MB moved for a ~1,054 MB study (~1.5x), which is why the load took 36s"*) **and** the comparison (*"27s vs bulk 33.7s"*), at the exact moment `skmBulkLoader.enabled` was flipped `true → false`.

Reconstructing the **exact Bulk config in effect immediately before that disable** (by walking every commit that touched the `skmBulkLoader` block, oldest→newest, 2026-09-28 → 2026-10-04):

| Date | Commit | `enabled` | `chunkSize` | `maxConcurrentChunks` | Notes |
|---|---|---|---|---|---|
| 09-28 | `055ffb6` | true | 50 | 4 | first version |
| 09-28→09-30 | several | flips true/false | 20 | 4→6 | rapid iteration |
| **09-29 (last before disable)** | **`0061def`** | **true** | **20** | **6** | config in place when 33.7s/1,594MB was measured |
| **09-30** | **`90fde30`** | **false** | 20 | 6 | **disable + the 27s/33.7s + double-fetch comment** |
| 10-02 | `f098249`/`9a3eeb4` | true (re-enabled for continued dev) | **40** | **5** (`maxGlobalConcurrentChunks: 20`) | chunkSize/concurrency **changed** from the 33.7s config; P1.1 (`flushOnStudyClose`), P2 (`boundedDecode`), P2.2 (`maxBulkBufferMB`) added |
| 10-04 | `f4cf72b` (and all commits since) | **false** (current) | 40 | 5 | P2.3 (`bulkMaxDisplaySets`) added same day; **this is the config checked in today** |

**Conclusion:** the only documented head-to-head timing (33.7s for Bulk) was measured at `chunkSize:20 / maxConcurrentChunks:6`, **before** per-series ES metadata caching was proven out, before `flushOnStudyClose`, before `boundedDecode`, before `maxBulkBufferMB`, and before `bulkMaxDisplaySets` existed. The config **currently sitting disabled in `app-config.js`** (`chunkSize:40 / maxConcurrentChunks:5 / maxGlobalConcurrentChunks:20`) was never itself timed against the per-slice prefetcher — it was hardened for 4 more days (10-02 → 10-04) and then disabled without a fresh head-to-head measurement. **Neither "Bulk was faster" nor "Bulk is still 33.7s" can be asserted for the current Bulk implementation from this history alone.**

**What remains a genuine live-measurement gap (not resolvable from code/history):** the 65-66s vs ~100s cold 2VP byte-warm discrepancy from the *prefetch-concurrency* review this session is a **separate** data point (adaptive-prefetch A/B, not Bulk) and still requires a live, protocol-matched re-run with `skmThroughput` to reconcile — this review did not have browser/Testing-Agent access to execute that live. Recommended next step unchanged from the plan: do not re-run broad A/B matrices until a single matched-protocol run reconciles it.

---

## Tier 1 — Warmer/prefetcher duplicate-fetch check across >2 open series

**Code-verified (not just inferred from comments):**

```17:extensions/cornerstone/src/skmBackgroundWarmer.ts
  const nearSkipPreferredOnly = config?.nearSkipPreferredOnly !== false;
```

`shouldApplyNearSkip({ nearSkipPreferredOnly, seriesKey, preferredKey })` (`skmWarmerFairnessMath.ts`) is a pure function of `(seriesKey, preferredKey)` only — it has **no dependency on how many series are open**. In `fairSync()` ([extensions/cornerstone/src/skmBackgroundWarmer.ts](extensions/cornerstone/src/skmBackgroundWarmer.ts) lines 951-986), the loop `for (const s of open)` iterates **every** open series symmetrically:

```951:986:extensions/cornerstone/src/skmBackgroundWarmer.ts
    for (const s of open) {
      const center = mwGetCenter(s.viewportId);
      const existing = fairJobs.get(s.dsUID);
      // Prefetch owns the near band only for the preferred series (sequential panes).
      const applyNearSkip = shouldApplyNearSkip({
        nearSkipPreferredOnly,
        seriesKey: s.dsUID,
        preferredKey: fairPreferredDsUID,
      });
      ...
      if (preferredChanged || Math.abs(delta) >= mwFarJumpThreshold) {
        ...
        // Preferred change rebuilds so nearSkip ownership follows focus.
        existing.queue = mwOrderedWindow(s.imageIds, center, existing.direction, {
          applyNearSkip,
        });
      }
```

For **N open series** (N≥2): exactly **one** `dsUID` equals `fairPreferredDsUID` at any time → exactly one series gets `applyNearSkip:true` (near band deferred to the per-slice prefetcher, which per `skmConcurrentPanes:false` only ever drives the active series). **Every other** series — whether there are 1, 2, or 3 of them — gets `applyNearSkip:false`, i.e. the warmer owns its *entire* window (near+far). Because `fairJobs` is keyed per-`dsUID` and `imageIds` are globally unique (series UID + SOP embedded), there is no cross-series key collision. **This generalizes correctly to 3+ panes with no new duplicate-fetch pathway introduced by the series count.**

On focus change (`preferredChanged`), the queue for **both** the old and new preferred series is **rebuilt** with the updated `applyNearSkip` (confirmed above) — so near-band ownership correctly transfers in both directions regardless of how many *other* series are open. This is the mechanism the `722b80e` fix ("Close inactive multi-viewport Ready-bar hole after fair warmer") put in place, and it is not pane-count-limited.

**Residual gap:** this is a **static code-correctness** finding, not a live measurement. A live 3-pane run (`skmThroughput.lanes()` repeat/fromCache counters, or `skmTelemetry.wadoReport()`) was not executed — no browser session was available in this environment — and remains the recommended confirmation step before treating this as fully validated in production conditions.

---

## Tier 1 — Warmer drain-reconcile cost near completion

**Code-verified finding: the reconcile scan is O(total imageIds across all open series) and CAN repeat multiple times per warm — it is NOT bounded by `FAIR_RECONCILE_CHUNK`.**

```862:924:extensions/cornerstone/src/skmBackgroundWarmer.ts
    let hasWork = Array.from(fairJobs.values()).some(
      j => !j.controller.signal.aborted && j.queue.length > 0
    );
    if (!hasWork && fairNeedsReconcile) {
      let cacheEmitted = 0;
      const toEnqueue: Array<{ job: FairJob; imageId: string }> = [];
      for (const s of mwGetOpenSeries()) {
        const job = fairJobs.get(s.dsUID);
        if (!job || job.controller.signal.aborted) {
          continue;
        }
        for (const id of s.imageIds) {
          if (!id || warmedImageIds.has(id)) {
            continue;
          }
          ...
          toEnqueue.push({ job, imageId: id });
        }
      }
      const plan = planFairDrainReconcile({
        missingUncachedCount: toEnqueue.length,
        chunkSize: FAIR_RECONCILE_CHUNK,  // = 256
      });
```

and in `skmWarmerFairnessMath.ts`:

```99:118:extensions/cornerstone/src/skmWarmerFairnessMath.ts
  const enqueueCount = Math.min(missing, chunk);
  return {
    action: 'enqueue-chunk',
    enqueueCount,
    continueReconcile: missing > chunk,
  };
```

`FAIR_RECONCILE_CHUNK` (256) only bounds how many **newly-discovered holes get enqueued per pass** — it does **not** bound the outer scan (`for (const s of mwGetOpenSeries()) { for (const id of s.imageIds) ... }`), which re-walks **every** imageId of **every** open series from scratch on every pass, relying on `warmedImageIds.has(id)` to skip the already-done ones. When `continueReconcile` is `true` (missing count > 256), `fairNeedsReconcile` stays `true` and `fairPumpLoop()` is re-invoked (`if (hasWork) { void fairPumpLoop(); }`), which on its **next** empty-queue drain repeats the **entire** O(n) scan again, even though only ≤256 fewer ids remain missing. For a 2×3674-slice session this is up to ~7,348 `Set`/cache lookups **per reconcile pass**, and the number of passes scales with `missingCount / 256` — i.e. **not bounded**, confirming the plan's suspicion rather than ruling it out.

**Severity (live-measurement gap):** this finding establishes the mechanism is architecturally capable of adding main-thread cost near completion; it does **not** by itself prove the wall-clock `longTaskTotalMs` impact is significant in practice (that depends on how large `missingCount` typically is at drain time, which requires a live `skmThroughput` capture this environment could not run). **Recommended, still-undone step:** capture `longTaskTotalMs` before/after a completed 2×3674 warm with `skmThroughput.reset()/report()`, specifically isolating samples during the tail of the warm (last ~10% of `warmedImageIdCount`).

**Low-risk fix candidate for later (not implemented — out of scope for this review):** track a `remaining`/dirty working set incrementally (e.g. a `Set` of not-yet-warmed ids per series, shrunk as items complete) instead of re-scanning the full `imageIds` array every pass.

---

## Tier 2 — Per-series prefetch fairness (evidence-gated)

The plan requires this **only if** Tier 0 shows prefetch is request-count-bound. Live telemetry to establish that was not available in this environment, so the gate for a code change remains **unmet** — no change to `StudyPrefetcherService._effectiveMaxPrefetchRequests` is proposed.

**However, one of the two stated preconditions for even testing higher concurrency can now be answered directly from infrastructure config** (not inferred from browser telemetry):

```47:50:D:\SKMPACS\nginx-ohif\nginx.conf
        server {
            listen      443 ssl;
            http2       on;                  # nginx 1.26+ style
            server_name 192.192.8.173;
```

The public-facing nginx listener (443, and also 8443/8444) has **`http2 on`**. This resolves Open Question #3 (below) and the plan's own Tier 2 caveat ("only worth testing if the WADO server is HTTP/2 — no 6-connection limit"): **the browser↔nginx edge is HTTP/2**, so the historical HTTP/1.1 6-connections-per-origin ceiling that gated earlier concurrency decisions **does not apply at this edge** today. (nginx→Tomcat upstream uses `proxy_http_version 1.1`, but that is an internal hop invisible to the browser's own per-origin connection limit and is not the constraint those historical comments were about.)

**Net status: still gated.** The HTTP/2 precondition is now satisfied, but the "request-count-bound, not NAS/decode-bound" precondition from Tier 0 is still unproven without a live run. **No concurrency change is recommended or made.**

---

## Tier 3 — WADO-URI server transfer tuning: verify, don't re-implement

**Source-confirmed** (re-read directly from `D:\SKMPACS\pacs-services\pacs-dicom-service\src\main\java\skm\pacs\dicom\wado\WadoController.java`, `wadoUri()`):
- `response.setBufferSize(1024 * 1024)` — 1 MB response buffer.
- `response.setContentLengthLong(size)` — disables chunked transfer-encoding.
- `response.setHeader(HttpHeaders.CACHE_CONTROL, "public, max-age=604800, immutable")` + `ETag` — browser-cacheable for 7 days.
- Retry-on-open guard (`Files.readAttributes` + `Files.newInputStream`, one retry, 15 ms backoff) before any byte is written.

**Build-freshness check (best available evidence that this source matches what's compiled):**

```
WadoController.java  LastWriteTime: 10/8/2026 10:27:14 PM
WadoController.class LastWriteTime: 10/8/2026 10:27:26 PM   (12s later — same build event)
```

The compiled class is 12 seconds newer than the source file, consistent with `target/classes` having been built directly from the exact source reviewed — i.e. not a stale artifact from an earlier version. This is filesystem evidence, not a live-reload proof that the **running Tomcat process** was restarted after that build; that would require a server-side introspection endpoint or a service restart log, neither of which is available from this environment.

**Live probe attempted:**
```
curl -sk -D - "https://192.192.8.173/wado/uri?storagePath=...&requestType=WADO&objectUID=test"
→ HTTP/1.1 404 (JSON error body)
```
The cache-control/ETag/buffer-size behavior is only set on the **success** path (after file resolution), so a deliberately-invalid probe cannot observe it; the office server is reachable and running the expected error-handling shape (JSON 404, standard security headers), consistent with the reviewed source. **Conclusion: no gap to close here — the tuning exists in source and is consistent with the active build. No re-implementation needed.**

---

## Open questions — resolved to the extent evidence allows

**1. Was Bulk ever faster under the current server code and current config values?**
**Answered (negatively), with new precision:** No head-to-head measurement exists for the config checked into `app-config.js` today (`chunkSize:40/maxConcurrentChunks:5`). The only measurement (33.7s) used `chunkSize:20/maxConcurrentChunks:6`, two days before most RAM-bounding hardening existed, and is **not representative of the final committed-but-disabled implementation.** A fresh, matched-protocol re-test (not a production re-enable) would be required to answer this for the current code — not run here.

**2. Did the backend's removal of the parallel chunk-read pool happen before or after the RAM-heavy complaints?**
**Partially answered via frontend timeline (backend has no git history on this machine — confirmed: `D:\SKMPACS\pacs-services` is not a git repository).** The frontend RAM-bounding knobs (`maxBulkBufferMB` 10-02, `bulkMaxDisplaySets` 10-04) were added **after** Bulk was first disabled (09-30) — i.e. hardening continued on a module that was already turned off in production, suggesting these were defensive/proactive engineering (possibly from internal dev-mode testing with Bulk temporarily re-enabled, confirmed by the 10-02 commits showing `enabled:true` again) rather than a single discrete "production RAM incident" tied 1:1 to the backend's own `BULK_READ_POOL` removal, whose timing cannot be dated without backend git history.

**3. Is the office NAS/server currently HTTP/1.1 or HTTP/2?**
**Resolved:** `http2 on;` is set on nginx's public 443/8443/8444 listeners (`D:\SKMPACS\nginx-ohif\nginx.conf`). The browser-facing edge supports HTTP/2. (Could not independently confirm live ALPN negotiation from this machine — the installed `curl` 8.21.0/Schannel build has no HTTP/2 support to test with — but the config file is unambiguous.)

**4. What specific "excessive RAM" was observed, under which Bulk mode/config?**
**Still not fully resolvable** — no dated incident report tying a specific `boundedDecode`/`maxBulkBufferMB`/`bulkMaxDisplaySets` value combination to an observed RAM number was found beyond the one 1,594 MB double-fetch (which is a *different* mechanism — double-loader, not Bulk's own raw-buffer retention). The "multi-viewport freeze" language is in Bulk's own source comments as the stated motivation for `bulkMaxDisplaySets`, but no measurement artifact (heap snapshot, timestamped report) for that specific incident was located in `D:\SKMPACS` or this repo's docs.

**5. Is there a captured trace of the original "~2001 requests / ~40 MB/s / everything idle" measurement?**
**Not found.** No raw capture file matching that description exists in `D:\SKMPACS\docs` or elsewhere searched; the only record is the prose restatement in `skmBulkImageLoader.ts`'s own header comment. Re-running that same class of probe against today's WADO-URI server code (which has since gained the buffering/content-length fixes) remains a valid, not-yet-executed way to check whether that original bottleneck still exists — recommended, not performed here.

---

## Summary of what changed vs what's still open

**Resolved by this pass (code/git/config evidence, no live browser needed):**
- Exact Bulk config in effect at the only existing speed/RAM measurement, and that it predates most of Bulk's hardening (Tier 0 / Open Q1, Q2).
- Warmer near-skip ownership transfer is architecturally correct for N≥2 panes, not just 2 (Tier 1a).
- Warmer drain-reconcile is a confirmed O(n)-per-pass, non-chunk-bounded scan — a real, quantifiable (not just suspected) low-risk optimization candidate for later (Tier 1b).
- Office nginx edge is HTTP/2 — resolves one of Tier 2's two gating preconditions (Open Q3).
- WADO-URI server tuning is confirmed in source and consistent with the active build (Tier 3).

**Still open, requires live browser/Testing-Agent access this environment did not have:**
- A matched-protocol re-run reconciling the 65s-vs-100s adaptive-prefetch discrepancy (Tier 0, unresolved half).
- Live `skmThroughput.lanes()` confirmation of zero duplicate fetches in a real 3-pane session (Tier 1a residual).
- Live `longTaskTotalMs` quantification of the drain-reconcile cost (Tier 1b residual).
- The second Tier 2 gating precondition (request-count-bound evidence) — still unmet, so **no prefetch-fairness code change is proposed**.
- Open Questions 4 and 5 (specific historical RAM incident, original plateau trace) — no artifact found; cannot be resolved further from available sources.

**No source, configuration, or deployment changes were made while producing these findings.**
