import { PubSubService } from '../_shared/pubSubServiceInterface';
import { ExtensionManager } from '../../extensions';
import ServicesManager from '../ServicesManager';
import ViewportGridService from '../ViewportGridService';
import { DisplaySet } from '../../types';

// SKM 2026-10-09 (QA fix — Priority 2 instrumentation): read-only performance.mark() calls at
// the key stages of a restart (study/series switch), so the actual time breakdown can be
// measured instead of assumed. See skmStudySwitchTelemetry.ts (extensions/cornerstone) for the
// companion module that turns these marks + first-WADO/decode/display events into a report.
// Never throws; a no-op if the Performance API is unavailable (e.g. non-browser test context).
function skmMark(name: string): void {
  try {
    if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
      if (typeof performance.clearMarks === 'function') {
        performance.clearMarks(name);
      }
      performance.mark(name);
    }
  } catch (e) {
    /* never break */
  }
}

enum RequestType {
  /** Highest priority for loading*/
  Interaction = 'interaction',
  /** Second highest priority for loading*/
  Thumbnail = 'thumbnail',
  /** Third highest priority for loading, usually used for image loading in the background*/
  Prefetch = 'prefetch',
  /** Lower priority, often used for background computations in the worker */
  Compute = 'compute',
}

export const EVENTS = {
  SERVICE_STARTED: 'event::studyPrefetcherService:started',
  SERVICE_STOPPED: 'event::studyPrefetcherService:stopped',
  DISPLAYSET_LOAD_PROGRESS: 'event::studyPrefetcherService:displaySetLoadProgress',
  DISPLAYSET_LOAD_COMPLETE: 'event::studyPrefetcherService:displaySetLoadComplete',
};

/**
 * Order used for prefetching display set
 */
enum StudyPrefetchOrder {
  closest = 'closest',
  downward = 'downward',
  upward = 'upward',
}

/**
 * Study Prefetcher configuration
 */
type StudyPrefetcherConfig = {
  /* Enable/disable study prefetching service */
  enabled: boolean;
  /* Number of displaysets to be prefetched */
  displaySetsCount: number;
  /**
   * Max number of concurrent prefetch requests
   * High numbers may impact on the time to load a new dropped series because
   * the browser will be busy with all prefetching requests. As soon as the
   * prefetch requests get fulfilled the new ones from the new dropped series
   * are sent to the server.
   *
   * TODO: abort all prefetch requests when a new series is loaded on a viewport.
   * (need to add support for `AbortController` on Cornerstone)
   * */
  maxNumPrefetchRequests: number;
  /* Display sets prefetching order (closest, downward and upward) */
  order: StudyPrefetchOrder;
  /**
   * Delay (ms) before the initial background prefetch flood starts after the
   * viewer opens (VIEWPORTS_READY). Gives the viewport's first image — loaded at
   * higher 'interaction' priority — a clear run at the network so time-to-first-
   * image stays low, instead of competing with maxNumPrefetchRequests concurrent
   * prefetch downloads over the shared HTTP/2 connection. 0 = original behaviour
   * (start immediately). Only the initial open is delayed; series switches still
   * restart prefetch immediately.
   */
  prefetchStartDelayMs?: number;
  /**
   * SKM 2026-10-03 (W2): bounded prefetch. When true (default), the background
   * prefetcher PAUSES once the decoded cache passes `boundedPrefetchHighWater`
   * (fraction, default 0.9) instead of flooding it — which is what overflowed a
   * cache smaller than the series and threw Cornerstone's CACHE_SIZE_EXCEEDED. The
   * slices beyond that point load on-demand as the doctor scrolls (Cornerstone
   * evicts LRU to fit each one). Bounds decoded RAM to ~the cache cap regardless of
   * study size. Set false to restore the old flood-the-whole-series behaviour.
   */
  boundedPrefetch?: boolean;
  /** Cache fill fraction (0..1) at which bounded prefetch pauses. Default 0.9. */
  boundedPrefetchHighWater?: number;
  /**
   * SKM 2026-10-03 (W2-full): windowed (working-set) decode, RadiAnt-style. When
   * true, the prefetcher only loads a WINDOW of slices around each visible
   * viewport's CURRENT index (± windowRadius) instead of the whole series, and
   * re-windows as the doctor scrolls (far slices are evicted by the LRU). This
   * bounds decoded RAM to ~2·windowRadius slices PER VIEWPORT regardless of study
   * size, so several big series across viewports/tabs fit a modest cache without
   * CACHE_SIZE_EXCEEDED / thrash / freeze. Set false to restore full-series
   * prefetch (previous behaviour).
   */
  windowedPrefetch?: boolean;
  /** Half-size of the windowed-prefetch window, in slices. Default 250. */
  windowRadius?: number;
  /**
   * ── SKM 2026-10-04 (Option B — skmPriorityPrefetch) ─────────────────────
   * Priority-aware, direction-adaptive scheduling. When true, the DECODE window
   * is ordered center-out with an ahead-bias in the scroll direction (nearest +
   * ahead slices load first), and a FAR JUMP (|Δindex| > farJumpThreshold)
   * cancels stale queued/in-flight prefetch and rebuilds the window around the new
   * centre — so background work around slice 80 never competes with a jump to 1500.
   * The currently-displayed slice is still loaded by the viewport at 'interaction'
   * priority (untouched); this only reorders the background 'prefetch' lane.
   * Set false to restore the previous index-order windowed prefetch.
   */
  priorityPrefetch?: boolean;
  /** Priority-2 immediate neighbourhood half-size (loaded first, center-out). Default 15. */
  immediateRadius?: number;
  /** Ahead-biased DECODE window: slices ahead of the doctor (scroll direction). Default = windowRadius. */
  windowAhead?: number;
  /** Ahead-biased DECODE window: slices behind the doctor. Default = windowRadius. */
  windowBehind?: number;
  /** |Δindex| beyond which a move is treated as a far jump (cancel stale work). Default 120. */
  farJumpThreshold?: number;
  /**
   * ── SKM 2026-09-28: concurrent multi-viewport prefetch ──────────────────
   * When multiple panes/studies are open (Ctrl+click), interleave every open
   * series' image requests (round-robin) so all viewport progress bars advance
   * together, and scale the in-flight request cap by the number of open panes so
   * the focused study is not slowed by sharing a fixed 48-slot budget. Only helps
   * to the extent the storage/network has spare capacity.
   * Default false = ORIGINAL behaviour (one series fully, then the next).
   * TO REMOVE THIS FEATURE: delete these two fields, the SKM blocks in
   * _loadDisplaySets and _sendNextRequests, and the _enqueueDisplaySetImagesInterleaved
   * and _effectiveMaxPrefetchRequests methods.
   */
  skmConcurrentPanes?: boolean;
  /* Hard ceiling for the pane-scaled cap. Default = maxNumPrefetchRequests * 2. */
  skmConcurrentPanesMaxRequests?: number;
};

type DisplaySetLoadingState = {
  displaySetInstanceUID: string;
  numInstances: number;
  pendingImageIds: Set<string>;
  loadedImageIds: Set<string>;
  failedImageIds: Set<string>;
  loadingProgress: number;
};

type ImageRequest = {
  displaySetInstanceUID: string;
  imageId: string;
  aborted: boolean;
};

type PubSubServiceSubscription = { unsubscribe: () => any };

interface ICache {
  isImageCached(imageId: string): boolean;
  /** SKM 2026-10-03 (W2): decoded-cache fill fraction (0..1); optional/best-effort. */
  getFillFraction?(): number;
}

interface IImageLoadPoolManager {
  addRequest(
    requestFn: () => Promise<any>,
    type: string,
    additionalDetails: Record<string, unknown>,
    priority?: number
  );
  clearRequestStack(type: string): void;
}

interface IImageLoader {
  loadAndCacheImage(imageId: string, options: any): Promise<any>;
  /**
   * SKM 2026-10-09 (QA fix — Priority 2 round 4): Cornerstone3D's own cancellation
   * primitive (imageLoadObject.cancelFn under the hood) — dequeues not-yet-sent
   * requests AND aborts ones already in flight. CornerstoneViewportService already
   * uses this for the viewport's own native stack prefetch; this service previously
   * had no equivalent for its OWN windowed-prefetch queue (see the clearRequestStack
   * TODO below, which only ever removed not-yet-dispatched pool entries). Optional
   * because older/narrower IImageLoader test doubles may not provide it — callers
   * must feature-check before calling.
   */
  cancelLoadImages?(imageIds: string[]): void;
}

type EventSubscription = {
  unsubscribe: () => void;
};

interface IImageLoadEventsManager {
  addEventListeners(
    onImageLoaded: (evt: any) => void,
    onImageLoadFailed: (evt: any) => void
  ): EventSubscription[];
}

class StudyPrefetcherService extends PubSubService {
  private _extensionManager: ExtensionManager;
  private _servicesManager: ServicesManager;
  private _subscriptions: PubSubServiceSubscription[];
  private _activeDisplaySetsInstanceUIDs: string[] = [];
  private _pendingRequests: ImageRequest[] = [];
  private _inflightRequests = new Map<string, ImageRequest>();
  // SKM 2026-10-03 (W2-full): throttle timer for scroll-driven re-windowing.
  private _rewindowTimer: ReturnType<typeof setTimeout> | null = null;
  // SKM 2026-10-04 (Option B): last known centre index + inferred scroll direction
  // (+1 forward / -1 backward) of the active series, for ahead-biased ordering and
  // far-jump detection. _schedulerStats is a read-only snapshot for skmTelemetry.
  private _lastCenter: number | null = null;
  private _direction = 1;
  // SKM 2026-10-09 (Phase 0 diagnostics — READ-ONLY): prove/measure the two-viewport
  // scheduler-center flip-flop + far-jump cancel storm. None of this changes behaviour.
  private _lastActiveViewportId: string | null = null;
  // SKM 2026-10-09 (QA fix — per-viewport center ownership): each viewport's OWN last known
  // centre index, keyed by viewportId. _lastCenter is a SINGLE global value and was the root
  // cause of cross-viewport "centerBefore" contamination — when focus moved A→B, prevCenter
  // read whatever _lastCenter happened to hold from A's last call, not B's own true prior
  // position. This map makes "this viewport's previous centre" an explicit, owned fact, never
  // borrowed from whichever pane last ran through onActiveSliceChanged().
  private _viewportCenters = new Map<string, number>();
  private _schedulerEventLog: any[] = [];
  private _schedulerEventLogMax = 120;
  private _requestCounts = new Map<string, number>();
  private _schedulerStats = {
    requestedCenterIndex: 0,
    prefetchCenterIndex: 0,
    direction: 1,
    prefetchAhead: 0,
    prefetchBehind: 0,
    queueSize: 0,
    inflight: 0,
    lastJumpDelta: 0,
    farJumps: 0,
    cancelledRequests: 0,
    p2Immediate: 0,
    p3Directional: 0,
    // Phase 0 additions (read-only diagnostics):
    activeViewportChanges: 0,
    reEnqueues: 0, // imageIds re-enqueued after a far-jump cancel (NOT duplicate network requests)
    maxEnqueuesPerImage: 0, // highest enqueue count for any single imageId (same session)
    activeViewportId: '',
  };
  // SKM 2026-10-09 (QA fix — Priority 2 round 4): read-only diagnostics for the
  // imageLoader.cancelLoadImages() cancellation path (see _cancelStaleImageLoads).
  // Proves the cancellation CALL happened and what it was given — it does NOT by
  // itself prove old-series network traffic stopped; that requires the runtime/
  // network-level check (see getPrefetchCancelDiagnostics() / skmPrefetchCancelReport()).
  private _cancelDiagnostics = {
    stalePendingCount: 0,
    staleInflightCount: 0,
    cancelLoadImagesCount: 0,
    cancelLoadImagesImageCount: 0,
    cancelledOldSeriesCount: 0,
    lastCancelAt: 0,
    lastPrevDsUID: null as string | null,
    lastNewDsUID: null as string | null,
    lastReason: '',
  };
  private _isRunning = false;
  private _startDelayTimer: ReturnType<typeof setTimeout> | null = null;
  private _displaySetLoadingStates = new Map<string, DisplaySetLoadingState>();
  private _imageIdsToDisplaySetsMap = new Map<string, Set<string>>();
  private config: StudyPrefetcherConfig = {
    /* Enable/disable study prefetching service */
    enabled: false,
    /* Number of displaysets to be prefetched */
    displaySetsCount: 1,
    /**
     * Max number of concurrent prefetch requests
     * High numbers may impact on the time to load a new dropped series because
     * the browser will be busy with all prefetching requests. As soon as the
     * prefetch requests get fulfilled the new ones from the new dropped series
     * are sent to the server.
     *
     * TODO: abort all prefetch requests when a new series is loaded on a viewport.
     * (need to add support for `AbortController` on Cornerstone)
     * */
    maxNumPrefetchRequests: 10,
    /* Display sets prefetching order (closest, downward and upward) */
    order: StudyPrefetchOrder.downward,
    /* Delay (ms) before the initial prefetch flood — 0 = original behaviour */
    prefetchStartDelayMs: 0,
    /* SKM 2026-09-28: concurrent multi-viewport prefetch — off by default. */
    skmConcurrentPanes: false,
    skmConcurrentPanesMaxRequests: undefined,
  };

  // Properties set by Cornerstone extension (initStudyPrefetcherService)
  public requestType: string = RequestType.Prefetch;
  public cache: ICache;
  public imageLoadPoolManager: IImageLoadPoolManager;
  public imageLoader: IImageLoader;
  public imageLoadEventsManager: IImageLoadEventsManager;

  public static REGISTRATION = {
    name: 'studyPrefetcherService',
    altName: 'StudyPrefetcherService',
    create: ({ configuration, servicesManager, extensionManager }): StudyPrefetcherService => {
      return new StudyPrefetcherService({
        servicesManager,
        extensionManager,
        configuration,
      });
    },
  };

  constructor({
    servicesManager,
    extensionManager,
    configuration,
  }: {
    servicesManager: ServicesManager;
    extensionManager: ExtensionManager;
    configuration: StudyPrefetcherConfig;
  }) {
    super(EVENTS);

    this._servicesManager = servicesManager;
    this._extensionManager = extensionManager;
    this._subscriptions = [];

    Object.assign(this.config, configuration);
  }

  public onModeEnter(): void {
    this._addEventListeners();
  }

  /**
   * The onModeExit returns the service to the initial state.
   */
  public onModeExit(): void {
    this._removeEventListeners();
    // Cancel a pending initial-prefetch delay timer (it may still be waiting if
    // the user navigated away during the delay window, before _isRunning=true).
    if (this._startDelayTimer) {
      clearTimeout(this._startDelayTimer);
      this._startDelayTimer = null;
    }
    // SKM 2026-10-03 (W2-full): cancel a pending scroll re-window.
    if (this._rewindowTimer) {
      clearTimeout(this._rewindowTimer);
      this._rewindowTimer = null;
    }
    this._stopPrefetching();
  }

  private _addImageLoadingEventsListeners() {
    const fnOnImageLoadCompleted = (imageId: string) => {
      // `sendNextRequests` must be called after image loaded/failed events
      // to make sure prefetch requests shall be sent as soon as the active
      // displaySets (active viewport) are loaded.
      //
      // PS: active display sets are not loaded by this service and that is why
      // the requests shall not be in the inflight queue.
      if (!this._inflightRequests.get(imageId)) {
        this._sendNextRequests();
      }
      // SKM 2026-10-03 (W2-full): a load completing after the doctor scrolls (an
      // on-demand slice) is our cue to re-centre the prefetch window on the new
      // position. Throttled + no-op unless windowedPrefetch is on.
      this.onActiveSliceChanged();
    };

    const fnImageLoadedEventListener = evt => {
      const { image } = evt.detail;
      const { imageId } = image;

      this._moveImageIdToLoadedSet(imageId);
      fnOnImageLoadCompleted(imageId);
    };

    const fnImageLoadFailedEventListener = evt => {
      const { imageId } = evt.detail;

      this._moveImageIdToFailedSet(imageId);
      fnOnImageLoadCompleted(imageId);
    };

    return this.imageLoadEventsManager.addEventListeners(
      fnImageLoadedEventListener,
      fnImageLoadFailedEventListener
    );
  }

  private _addServicesListeners() {
    const { displaySetService, viewportGridService } = this._servicesManager.services;

    // Restart the prefetcher after any change to the displaySets
    // (eg: sorting the displaySets on StudyBrowser)
    const displaySetsChangedSubscription = displaySetService.subscribe(
      displaySetService.EVENTS.DISPLAY_SETS_CHANGED,
      () => this._syncWithActiveViewport({ forceRestart: true })
    );

    // Loads new datasets when making a new viewport active
    // SKM 2026-10-09 (QA fix): previously, focus-change jump classification lived ONLY
    // inside onActiveSliceChanged(), which fires on image-load events — so it ran whenever
    // the NEXT background image happened to complete, not synchronously when focus actually
    // changed. A focus change with no immediately-following image event went undetected
    // entirely (dormant-pane silent drop); one racing against an unrelated pane's image
    // load could read a stale/wrong "current" viewport. onActiveViewportChanged() now runs
    // SYNCHRONOUSLY, directly off this event, so identity + per-viewport jump attribution can
    // never race against prefetch/decode traffic from any other pane.
    const viewportGridActiveViewportIdSubscription = viewportGridService.subscribe(
      ViewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED,
      ({ viewportId }) => {
        this._syncWithActiveViewport({ activeViewportId: viewportId });
        this.onActiveViewportChanged(viewportId);
      }
    );

    // Continue loading datasets after changing the layout (eg: from 1x1 to 2x1)
    const viewportGridLayoutChangedSubscription = viewportGridService.subscribe(
      ViewportGridService.EVENTS.LAYOUT_CHANGED,
      () => this._syncWithActiveViewport()
    );

    // Loads new datasets after loading a new display set on a viewport
    const viewportGridStateChangedSubscription = viewportGridService.subscribe(
      ViewportGridService.EVENTS.GRID_STATE_CHANGED,
      () => this._syncWithActiveViewport()
    );

    // Loads the first datasets right after opening the viewer
    const viewportGridViewportreadySubscription = viewportGridService.subscribe(
      ViewportGridService.EVENTS.VIEWPORTS_READY,
      () => {
        this._syncWithActiveViewport();
        // Delay the initial prefetch flood so the viewport's first image (higher
        // 'interaction' priority) gets a clear run at the shared HTTP/2 connection
        // instead of competing with maxNumPrefetchRequests concurrent prefetch
        // downloads — keeps time-to-first-image low. 0 = start immediately.
        const delay = this.config.prefetchStartDelayMs ?? 0;
        if (delay > 0) {
          if (this._startDelayTimer) {
            clearTimeout(this._startDelayTimer);
          }
          this._startDelayTimer = setTimeout(() => {
            this._startDelayTimer = null;
            this._startPrefetching();
          }, delay);
        } else {
          this._startPrefetching();
        }
      }
    );

    return [
      displaySetsChangedSubscription,
      viewportGridActiveViewportIdSubscription,
      viewportGridLayoutChangedSubscription,
      viewportGridStateChangedSubscription,
      viewportGridViewportreadySubscription,
    ];
  }

  private _addEventListeners() {
    const imageLoadingEventsSubscriptions = this._addImageLoadingEventsListeners();
    const servicesSubscriptions = this._addServicesListeners();

    this._subscriptions.push(...imageLoadingEventsSubscriptions);
    this._subscriptions.push(...servicesSubscriptions);
  }

  private _removeEventListeners() {
    this._subscriptions.forEach(subscription => subscription.unsubscribe());
    this._subscriptions = [];
  }

  private _syncWithActiveViewport({
    activeViewportId,
    forceRestart,
  }: {
    activeViewportId?: string;
    forceRestart?: boolean;
  } = {}) {
    const { viewportGridService } = this._servicesManager.services;
    const viewportGridServiceState = viewportGridService.getState();
    const { viewports } = viewportGridServiceState;

    activeViewportId = activeViewportId ?? viewportGridServiceState.activeViewportId;

    // If may be null when the viewer is loaded
    if (!activeViewportId) {
      return;
    }

    const activeViewport = viewports.get(activeViewportId);

    if (!activeViewport) {
      return;
    }

    // A viewport can exist in the grid state before hanging-protocol
    // application has assigned it any display sets yet (a transient state
    // that shows up more often on large, many-series studies where grid/
    // layout events fire mid-load) - displaySetInstanceUIDs is undefined in
    // that window, not an empty array, which crashed the .length check
    // below.
    // Collect the display sets currently DISPLAYED across all viewports (panes),
    // focused viewport FIRST, then every other visible pane. This is what lets a
    // Ctrl+click side-by-side comparison prefetch the focused series first (full
    // speed) and then automatically fill the other visible pane — while still never
    // prefetching series that are only sitting in the thumbnail list (not displayed).
    // (displaySetInstanceUIDs can be undefined for a viewport that exists in the grid
    // before the hanging protocol assigns it a display set — guard it.)
    const orderedDisplaySetUIDs: string[] = [];
    const seenDisplaySetUIDs = new Set<string>();
    const addDisplaySetUIDs = (uids?: string[]) => {
      (uids ?? []).forEach(uid => {
        if (uid && !seenDisplaySetUIDs.has(uid)) {
          seenDisplaySetUIDs.add(uid);
          orderedDisplaySetUIDs.push(uid);
        }
      });
    };

    addDisplaySetUIDs(activeViewport.displaySetInstanceUIDs);
    for (const [viewportId, viewport] of viewports) {
      if (viewportId !== activeViewportId) {
        addDisplaySetUIDs(viewport.displaySetInstanceUIDs);
      }
    }

    const displaySetUpdated = this._setActiveDisplaySetsUIDs(orderedDisplaySetUIDs);

    if (forceRestart || displaySetUpdated) {
      this._restartPrefetching();
    }
  }

  private _setActiveDisplaySetsUIDs(newActiveDisplaySetInstanceUIDs: string[]): boolean {
    const sameDisplaySets =
      newActiveDisplaySetInstanceUIDs.length === this._activeDisplaySetsInstanceUIDs.length &&
      newActiveDisplaySetInstanceUIDs.every(uid =>
        this._activeDisplaySetsInstanceUIDs.includes(uid)
      );

    if (sameDisplaySets) {
      return false;
    }

    this._activeDisplaySetsInstanceUIDs = [...newActiveDisplaySetInstanceUIDs];
    // SKM 2026-10-09 (QA fix — Priority 2, study-switch double-restart): do NOT restart here.
    // The ONLY caller, _syncWithActiveViewport(), already restarts when this method returns
    // true (displaySetUpdated) — restarting here TOO meant every real series/study switch ran
    // the full _stopPrefetching()+_startPrefetching()+_loadDisplaySets() sequence (which iterates
    // EVERY active display set in the whole study, not just the one being shown) TWICE back to
    // back, doubling that main-thread synchronous cost and discarding the first restart's
    // just-dispatched prefetch batch immediately. Let the caller be the single restart authority.

    return true;
  }

  private _getClosestDisplaySets(displaySets: DisplaySet[], activeDisplaySetIndex: number) {
    const sortedDisplaySets = [];
    let previousIndex = activeDisplaySetIndex - 1;
    let nextIndex = activeDisplaySetIndex + 1;

    while (previousIndex >= 0 || nextIndex < displaySets.length) {
      if (previousIndex >= 0) {
        sortedDisplaySets.push(displaySets[previousIndex]);
        previousIndex--;
      }

      if (nextIndex < displaySets.length) {
        sortedDisplaySets.push(displaySets[nextIndex]);
        nextIndex++;
      }
    }

    return sortedDisplaySets;
  }

  private _getDownwardDisplaySets(displaySets: DisplaySet[], activeDisplaySetIndex: number) {
    const sortedDisplaySets = [];

    for (let i = activeDisplaySetIndex + 1; i < displaySets.length; i++) {
      sortedDisplaySets.push(displaySets[i]);
    }

    return sortedDisplaySets;
  }

  private _getUpwardDisplaySets(displaySets: DisplaySet[], activeDisplaySetIndex: number) {
    const sortedDisplaySets = [];

    for (let i = activeDisplaySetIndex - 1; i >= 0 && i !== activeDisplaySetIndex; i--) {
      sortedDisplaySets.push(displaySets[i]);
    }

    return sortedDisplaySets;
  }

  private _getSortedDisplaySetsToPrefetch(displaySets: DisplaySet[]): DisplaySet[] {
    if (!this._activeDisplaySetsInstanceUIDs?.length) {
      return [];
    }

    const { displaySetsCount } = this.config;
    const activeDisplaySetsInstanceUIDs = this._activeDisplaySetsInstanceUIDs;
    const [activeDisplaySetUID] = activeDisplaySetsInstanceUIDs;
    const activeDisplaySetIndex = displaySets.findIndex(
      ds => ds.displaySetInstanceUID === activeDisplaySetUID
    );
    const getDisplaySetsFunctionsMap = {
      [StudyPrefetchOrder.closest]: this._getClosestDisplaySets,
      [StudyPrefetchOrder.downward]: this._getDownwardDisplaySets,
      [StudyPrefetchOrder.upward]: this._getUpwardDisplaySets,
    };
    const { order } = this.config;
    const fnGetDisplaySets = getDisplaySetsFunctionsMap[order];

    if (!fnGetDisplaySets) {
      throw new Error(`Invalid order (${order})`);
    }

    // Creates a `Set` to look for UIDs in O(1) instead of O(n)
    const uidsSet = new Set(activeDisplaySetsInstanceUIDs);

    // Include the active display set(s) FIRST, then the neighbouring series in the
    // configured order. The active series MUST be in the prefetch queue: the viewport's
    // own stack prefetch loads only part of it and then stops, and nothing else drives
    // it to 100%. Previously the active set was excluded here AND _sendNextRequests
    // refused to load other series until the active set was fully loaded — so the active
    // series never completed and the whole study stalled partway (~51%). Loading the
    // active series first preserves the original prioritisation (current series before
    // others) without needing that hard gate.
    // Build the active/displayed series in focused-first order (the order of
    // _activeDisplaySetsInstanceUIDs), NOT the study's display-set order, so the
    // focused pane's series is prefetched before the other visible pane(s).
    const displaySetByUID = new Map(displaySets.map(ds => [ds.displaySetInstanceUID, ds]));
    const activeDisplaySets = activeDisplaySetsInstanceUIDs
      .map(uid => displaySetByUID.get(uid))
      .filter((ds): ds is DisplaySet => !!ds);

    const neighbourDisplaySets = fnGetDisplaySets
      .call(this, displaySets, activeDisplaySetIndex)
      .filter(ds => !uidsSet.has(ds.displaySetInstanceUID));

    // ALL displayed (active) series are always prefetched — displaySetsCount must never
    // slice a visible pane off (that would leave a side-by-side comparison pane unloaded).
    // displaySetsCount limits only EXTRA, non-displayed neighbouring series. So with
    // displaySetsCount:1 -> displayed series only (0 extra neighbours): one open pane =
    // just that series; two open panes (Ctrl+click) = both, focused-first, loaded
    // sequentially (focused fills first, then the other pane).
    const extraNeighbourCount = Math.max(0, displaySetsCount - activeDisplaySets.length);

    return [...activeDisplaySets, ...neighbourDisplaySets.slice(0, extraNeighbourCount)];
  }

  private _getDisplaySets() {
    const { displaySetService } = this._servicesManager.services;
    const displaySets = [...displaySetService.getActiveDisplaySets()];
    const displaySetsToPrefetch = this._getSortedDisplaySetsToPrefetch(displaySets);

    return { displaySets, displaySetsToPrefetch };
  }

  private _updateImageIdsDisplaySetMap(displaySetInstanceUID: string, imageIds: string[]): void {
    for (const imageId of imageIds) {
      let displaySetsInstanceUIDsMap = this._imageIdsToDisplaySetsMap.get(imageId);

      if (!displaySetsInstanceUIDsMap) {
        displaySetsInstanceUIDsMap = new Set();
        this._imageIdsToDisplaySetsMap.set(imageId, displaySetsInstanceUIDsMap);
      }

      displaySetsInstanceUIDsMap.add(displaySetInstanceUID);
    }
  }

  private _getImageIdsForDisplaySet(displaySet: DisplaySet): string[] {
    const dataSource = this._extensionManager.getActiveDataSource()[0];

    return dataSource.getImageIdsForDisplaySet(displaySet);
  }

  // ── SKM 2026-10-03 (W2-full): windowed decode helpers ─────────────────────
  // The current image index of whatever viewport is showing this display set
  // (0 if we can't determine it). Used to centre the prefetch window.
  // ── SKM 2026-10-09 (Phase 0 diagnostics — READ-ONLY) ───────────────────────
  // Snapshot every open stack viewport's current index + series UID + active flag,
  // so we can prove whether two viewports on the SAME series share one scheduler
  // center and whether switching focus is mis-detected as a far jump.
  private _perViewportSnapshot(): Array<{
    viewportId: string;
    idx: number;
    seriesUID?: string;
    active: boolean;
  }> {
    const out: Array<{ viewportId: string; idx: number; seriesUID?: string; active: boolean }> = [];
    try {
      const services: any = this._servicesManager.services;
      const viewportGridService = services?.viewportGridService;
      const cornerstoneViewportService = services?.cornerstoneViewportService;
      if (!viewportGridService || !cornerstoneViewportService) {
        return out;
      }
      const state = viewportGridService.getState();
      const activeViewportId = state?.activeViewportId;
      const viewports = state?.viewports;
      if (!viewports || typeof viewports.forEach !== 'function') {
        return out;
      }
      viewports.forEach((vp: any, viewportId: string) => {
        const csVp = cornerstoneViewportService.getCornerstoneViewport?.(viewportId);
        const idx = csVp?.getCurrentImageIdIndex?.();
        if (typeof idx !== 'number') {
          return;
        }
        out.push({
          viewportId,
          idx,
          seriesUID: vp?.displaySetInstanceUIDs?.[0],
          active: viewportId === activeViewportId,
        });
      });
    } catch (e) {
      /* best-effort */
    }
    return out;
  }

  private _logSchedulerEvent(type: string, extra: Record<string, unknown>): void {
    try {
      const services: any = this._servicesManager.services;
      const activeViewportId = services?.viewportGridService?.getState?.()?.activeViewportId ?? null;
      this._schedulerEventLog.push({
        t: Date.now(),
        type,
        activeViewportId,
        perViewport: this._perViewportSnapshot(),
        ...extra,
      });
      if (this._schedulerEventLog.length > this._schedulerEventLogMax) {
        this._schedulerEventLog.splice(0, this._schedulerEventLog.length - this._schedulerEventLogMax);
      }
      (globalThis as any).__skmSchedulerLog = this._schedulerEventLog;
    } catch (e) {
      /* never break */
    }
  }

  /** SKM 2026-10-09 (Phase 3): imageIds currently being fetched by the prefetcher.
   *  The evictor uses this to protect in-flight images from eviction while they decode. */
  public getInflightImageIds(): Set<string> {
    return new Set(this._inflightRequests.keys());
  }

  /**
   * SKM 2026-10-09 (QA fix — Priority 2 round 4): read-only diagnostics for the
   * imageLoader.cancelLoadImages() cancellation path added to _stopPrefetching()/
   * _cancelPendingPrefetch(). Lets Playwright check HOW MANY stale pending/in-flight
   * imageIds existed at cancel time and how many were actually handed to
   * cancelLoadImages() — it is NOT itself proof that old-series network traffic
   * stopped; that still requires a network-level (performance.getEntriesByType)
   * check correlated against these counts/timestamps.
   */
  public getPrefetchCancelDiagnostics(): Record<string, unknown> {
    return { ...this._cancelDiagnostics };
  }

  /**
   * SKM 2026-10-09 (QA fix — Priority 2 round 4): the single place that actually asks
   * Cornerstone to cancel stale prefetch work at the network level, instead of only
   * dropping it from this service's own bookkeeping. `imageIds` is always a subset of
   * what THIS service itself previously handed to imageLoadPoolManager for the window
   * being discarded (see call sites in _stopPrefetching/_cancelPendingPrefetch) — it
   * can never reach the viewport's own current/interaction-priority load or another
   * service's requests. Mirrors the imageLoader.cancelLoadImages() call already used
   * by CornerstoneViewportService for the viewport's native stack prefetch — reuses
   * the existing Cornerstone3D cancellation primitive, no new AbortController wiring.
   */
  private _cancelStaleImageLoads(imageIds: string[], reason: string): void {
    if (!imageIds.length) {
      return;
    }
    try {
      if (typeof this.imageLoader?.cancelLoadImages === 'function') {
        this.imageLoader.cancelLoadImages(imageIds);
        this._cancelDiagnostics.cancelLoadImagesCount++;
        this._cancelDiagnostics.cancelLoadImagesImageCount += imageIds.length;
        this._cancelDiagnostics.lastCancelAt = Date.now();
        this._cancelDiagnostics.lastReason = reason;
      }
    } catch (e) {
      /* best-effort — never let cancellation break stop/restart */
    }
  }

  /** Read-only diagnostics for skmTelemetry / console (Phase 0). */
  public getSchedulerDiagnostics(): Record<string, unknown> {
    return {
      stats: { ...this._schedulerStats },
      perViewport: this._perViewportSnapshot(),
      activeDisplaySetUIDs: [...this._activeDisplaySetsInstanceUIDs],
      lastCenter: this._lastCenter,
      pending: this._pendingRequests.length,
      inflight: this._inflightRequests.size,
      recentEvents: this._schedulerEventLog.slice(-40),
    };
  }

  private _getCenterIndexForDisplaySet(displaySetInstanceUID: string): number {
    try {
      const services: any = this._servicesManager.services;
      const viewportGridService = services?.viewportGridService;
      const cornerstoneViewportService = services?.cornerstoneViewportService;
      if (!viewportGridService || !cornerstoneViewportService) {
        return 0;
      }
      const state = viewportGridService.getState();
      const viewports = state?.viewports;
      if (!viewports || typeof viewports.forEach !== 'function') {
        return 0;
      }
      let center = 0;
      viewports.forEach((vp: any, viewportId: string) => {
        if (vp?.displaySetInstanceUIDs?.includes?.(displaySetInstanceUID)) {
          const csVp = cornerstoneViewportService.getCornerstoneViewport?.(viewportId);
          const idx = csVp?.getCurrentImageIdIndex?.();
          if (typeof idx === 'number' && idx >= 0) {
            center = idx;
          }
        }
      });
      return center;
    } catch (e) {
      return 0;
    }
  }

  // Trim a display set's imageIds to a window around the viewport's current slice
  // when windowedPrefetch is on; otherwise return them unchanged. Returns the
  // windowed slice PLUS the absolute start offset (so callers can map back if needed).
  private _windowImageIds(displaySet: DisplaySet, imageIds: string[]): string[] {
    if (!this.config.windowedPrefetch || imageIds.length <= 1) {
      return imageIds;
    }
    const radius =
      typeof this.config.windowRadius === 'number' && this.config.windowRadius > 0
        ? this.config.windowRadius
        : 250;
    const center = this._getCenterIndexForDisplaySet(displaySet.displaySetInstanceUID);
    const start = Math.max(0, center - radius);
    const end = Math.min(imageIds.length, center + radius + 1);
    return imageIds.slice(start, end);
  }

  // SKM 2026-10-09 (Phase 1): the ACTIVE/focused viewport's own index + the series it shows.
  // Fixes the two-viewport bug where _getCenterIndexForDisplaySet (last-writer-wins across
  // viewports) returned the WRONG viewport's index for a series shown in two panes.
  private _getActiveViewportInfo(): { viewportId: string; uid?: string; idx: number } | null {
    try {
      const services: any = this._servicesManager.services;
      const vgs = services?.viewportGridService;
      const csvs = services?.cornerstoneViewportService;
      if (!vgs || !csvs) {
        return null;
      }
      const state = vgs.getState();
      const activeId = state?.activeViewportId;
      if (!activeId) {
        return null;
      }
      const vp = state.viewports?.get?.(activeId);
      const csVp = csvs.getCornerstoneViewport?.(activeId);
      const idx = csVp?.getCurrentImageIdIndex?.();
      if (typeof idx !== 'number' || idx < 0) {
        return null;
      }
      return { viewportId: activeId, uid: vp?.displaySetInstanceUIDs?.[0], idx };
    } catch (e) {
      return null;
    }
  }

  // SKM 2026-10-09 (Phase 1/2): ALL viewport indices currently showing a series (deduped),
  // so prefetch can prioritise the union of both panes' positions instead of a single
  // (last-writer) centre, and size each pane's window as a share (never starving one pane).
  private _getViewportCentersForDisplaySet(displaySetInstanceUID: string): number[] {
    const centers: number[] = [];
    try {
      const services: any = this._servicesManager.services;
      const vgs = services?.viewportGridService;
      const csvs = services?.cornerstoneViewportService;
      if (!vgs || !csvs) {
        return centers;
      }
      const state = vgs.getState();
      const viewports = state?.viewports;
      if (!viewports || typeof viewports.forEach !== 'function') {
        return centers;
      }
      const seen = new Set<number>();
      viewports.forEach((vp: any, viewportId: string) => {
        if (!vp?.displaySetInstanceUIDs?.includes?.(displaySetInstanceUID)) {
          return;
        }
        const csVp = csvs.getCornerstoneViewport?.(viewportId);
        const idx = csVp?.getCurrentImageIdIndex?.();
        if (typeof idx === 'number' && idx >= 0 && !seen.has(idx)) {
          seen.add(idx);
          centers.push(idx);
        }
      });
    } catch (e) {
      /* best-effort */
    }
    return centers;
  }

  // The centre index of the ACTIVE (focused) viewport; falls back to the per-series
  // (last-writer) centre only when no active viewport is resolvable.
  private _getActiveCenter(): number {
    const info = this._getActiveViewportInfo();
    if (info) {
      return info.idx;
    }
    const activeUID = this._activeDisplaySetsInstanceUIDs?.[0];
    if (!activeUID) {
      return 0;
    }
    return this._getCenterIndexForDisplaySet(activeUID);
  }

  // Resolve a SPECIFIC viewport's own current image index directly from Cornerstone — never
  // via "whichever viewport is active right now" — so a caller can always ask for a named
  // viewport's position regardless of which pane is currently focused.
  private _getIndexForViewportId(viewportId: string): number | null {
    try {
      const csvs = (this._servicesManager.services as any)?.cornerstoneViewportService;
      const csVp = csvs?.getCornerstoneViewport?.(viewportId);
      const idx = csVp?.getCurrentImageIdIndex?.();
      return typeof idx === 'number' && idx >= 0 ? idx : null;
    } catch (e) {
      return null;
    }
  }

  // SKM 2026-10-09 (QA fix): cancel stale prefetch + rebuild the window around `center`,
  // logging a farJump attributed to `viewportId` with that viewport's OWN previous centre.
  // Shared by both the focus-change path (onActiveViewportChanged) and the same-pane
  // scroll path (onActiveSliceChanged) so the two can never diverge in behaviour.
  private _fireFarJump(
    viewportId: string | null,
    prevCenter: number,
    center: number,
    trigger: string
  ): void {
    const delta = center - prevCenter;
    this._logSchedulerEvent('farJump', {
      viewportId,
      centerBefore: prevCenter,
      centerAfter: center,
      delta,
      trigger,
      willCancel: this._pendingRequests.length + this._inflightRequests.size,
    });
    this._schedulerStats.lastJumpDelta = delta;
    this._schedulerStats.farJumps++;
    this._publishStats();
    this._cancelPendingPrefetch();
    if (this._rewindowTimer) {
      clearTimeout(this._rewindowTimer);
      this._rewindowTimer = null;
    }
    try {
      this._loadDisplaySets();
      this._sendNextRequests();
    } catch (e) {
      /* best-effort far-jump re-window */
    }
  }

  private _scheduleSoftRewindow(): void {
    if (this._rewindowTimer) {
      return;
    }
    this._rewindowTimer = setTimeout(() => {
      this._rewindowTimer = null;
      try {
        this._loadDisplaySets();
        this._sendNextRequests();
      } catch (e) {
        /* best-effort re-window */
      }
    }, 200);
  }

  // SKM 2026-10-09 (QA fix — root cause of cross-viewport "centerBefore" contamination):
  // called SYNCHRONOUSLY, directly off ViewportGridService.ACTIVE_VIEWPORT_ID_CHANGED (see
  // _addServicesListeners), NOT deferred to the next image-load event. The previous design
  // detected focus changes lazily inside onActiveSliceChanged(), which only runs when SOME
  // image finishes loading (any viewport, any series) — so (a) a focus change with no
  // immediately-following image event went completely undetected (dormant-pane silent drop),
  // and (b) when an unrelated pane's background image happened to complete first, its call
  // could consume the "active changed" transition using the WRONG pane's stored centre.
  // Running this directly off the grid event removes that race entirely: identity updates the
  // instant focus changes, and the previous-centre lookup is keyed by THIS viewport's own id in
  // _viewportCenters, never a shared/global value.
  public onActiveViewportChanged(viewportId: string | null): void {
    if (!viewportId || viewportId === this._lastActiveViewportId) {
      if (viewportId) {
        this._schedulerStats.activeViewportId = viewportId;
      }
      return;
    }

    const fromViewportId = this._lastActiveViewportId;
    this._lastActiveViewportId = viewportId;
    this._schedulerStats.activeViewportId = viewportId;
    this._schedulerStats.activeViewportChanges++;

    if (!this.config.windowedPrefetch || !this.config.priorityPrefetch || !this._isRunning) {
      this._logSchedulerEvent('activeChange', { from: fromViewportId, to: viewportId });
      return;
    }

    const center = this._getIndexForViewportId(viewportId);
    if (center === null) {
      // Viewport has no stack / isn't ready yet — identity still updated above; the window
      // will be (re)built once a real index is available (next onActiveSliceChanged call).
      this._logSchedulerEvent('activeChange', { from: fromViewportId, to: viewportId });
      return;
    }

    // Per-viewport ownership: a pane we've never tracked returns null (no false jump on first
    // sight of a dormant pane); a pane we HAVE tracked returns ITS OWN true last position,
    // never another pane's — this is what makes centerBefore correct for Case C/D below.
    const prevCenter = this._viewportCenters.has(viewportId)
      ? (this._viewportCenters.get(viewportId) as number)
      : null;
    this._viewportCenters.set(viewportId, center);
    this._lastCenter = center;

    this._logSchedulerEvent('activeChange', {
      from: fromViewportId,
      to: viewportId,
      centerBefore: prevCenter,
      centerAfter: center,
    });
    this._publishStats();

    const farJumpThreshold =
      typeof this.config.farJumpThreshold === 'number' ? this.config.farJumpThreshold : 120;
    const delta = prevCenter !== null ? center - prevCenter : 0;

    if (prevCenter !== null && Math.abs(delta) > farJumpThreshold) {
      // Focus landed on a pane whose OWN position also moved a long way since we last saw it
      // (focus + immediate jump, or a dormant pane that moved while unfocused) — cancel stale
      // work and re-window now, attributed to the correct viewport with its own true delta.
      this._fireFarJump(viewportId, prevCenter, center, 'activeChange+farJump');
      return;
    }

    // Pure focus change (no material movement in the newly-focused pane): soft rebase only,
    // never a cancel storm — this preserves the original false-far-jump fix.
    this._scheduleSoftRewindow();
  }

  // Scroll-driven re-window: Cornerstone fires STACK_NEW_IMAGE / IMAGE_LOADED as the
  // doctor scrolls; the extension forwards it here (see initStudyPrefetcherService).
  // We infer scroll direction, detect FAR JUMPS (cancel stale work immediately), and
  // rebuild the window around the new centre. Cheap no-op unless windowedPrefetch is
  // on and the service is running.
  public onActiveSliceChanged(): void {
    if (!this.config.windowedPrefetch || !this._isRunning) {
      return;
    }

    // SKM 2026-10-09 (QA fix): focus-change IDENTITY + jump classification is now handled
    // synchronously by onActiveViewportChanged() (wired directly to ACTIVE_VIEWPORT_ID_CHANGED
    // — see _addServicesListeners). This function only tracks movement WITHIN whichever
    // viewport is currently active (scroll / on-demand decode), using that viewport's OWN
    // centre history — it no longer does its own activeChanged detection, which removed the
    // race against image-load events that caused cross-viewport contamination. The catch-up
    // below is a defensive fallback only (e.g. if the grid event was somehow missed) and simply
    // delegates to the same, single, correctly-attributed code path.
    let activeVpId: string | null = null;
    try {
      activeVpId =
        this._servicesManager.services?.viewportGridService?.getState?.()?.activeViewportId ?? null;
      this._schedulerStats.activeViewportId = activeVpId ?? '';
      if (activeVpId && activeVpId !== this._lastActiveViewportId) {
        this.onActiveViewportChanged(activeVpId);
        return;
      }
    } catch (e) {
      /* never break */
    }

    if (this.config.priorityPrefetch) {
      const viewportId = activeVpId ?? this._lastActiveViewportId;
      const center = viewportId ? this._getIndexForViewportId(viewportId) : this._getActiveCenter();
      const resolvedCenter = center ?? this._getActiveCenter();

      if (viewportId) {
        const prevCenter = this._viewportCenters.has(viewportId)
          ? (this._viewportCenters.get(viewportId) as number)
          : null;
        this._viewportCenters.set(viewportId, resolvedCenter);
        this._lastCenter = resolvedCenter;

        if (prevCenter !== null) {
          const delta = resolvedCenter - prevCenter;
          if (delta !== 0) {
            this._direction = delta > 0 ? 1 : -1;
          }
          const farJumpThreshold =
            typeof this.config.farJumpThreshold === 'number' ? this.config.farJumpThreshold : 120;
          if (Math.abs(delta) > farJumpThreshold) {
            // FAR JUMP in the already-active pane: cancel stale queued + in-flight prefetch so
            // background work around the OLD position can't compete with the new target.
            this._fireFarJump(viewportId, prevCenter, resolvedCenter, 'sameViewport');
            return;
          }
        }
      } else {
        this._lastCenter = resolvedCenter;
      }
    }

    this._scheduleSoftRewindow();
  }

  // SKM 2026-10-04 (Option B): drop queued prefetch and abort in-flight so a far jump
  // isn't held behind stale work. In-flight requests are marked aborted (their
  // completion handlers no-op); the pool's queued (not-yet-dispatched) prefetch stack
  // is cleared too. Pending-request state is rebuilt by the caller.
  // SKM 2026-10-09 (QA fix — Priority 2 round 4): additionally hand the stale
  // pending+in-flight imageIds to imageLoader.cancelLoadImages() BEFORE this
  // bookkeeping is thrown away, so the underlying network requests are actually
  // cancelled, not just dropped from this service's own tracking. This is the SAME
  // set this method already discarded unconditionally before this change (a far
  // jump within the same series already re-enqueues/re-requests anything still
  // valid for the new centre fresh via _loadDisplaySets()+_sendNextRequests() right
  // after — see reEnqueues/maxEnqueuesPerImage — so no new "still valid" image is
  // being newly cancelled here that wasn't already being thrown away before.
  private _cancelPendingPrefetch(): void {
    this._schedulerStats.cancelledRequests +=
      this._pendingRequests.length + this._inflightRequests.size;

    const stalePendingImageIds = this._pendingRequests.map(r => r.imageId);
    const staleInflightImageIds = Array.from(this._inflightRequests.keys());
    const staleImageIds = Array.from(new Set([...stalePendingImageIds, ...staleInflightImageIds]));
    this._cancelDiagnostics.stalePendingCount = stalePendingImageIds.length;
    this._cancelDiagnostics.staleInflightCount = staleInflightImageIds.length;
    this._cancelStaleImageLoads(staleImageIds, 'farJump');

    this._pendingRequests = [];
    this._inflightRequests.forEach(req => (req.aborted = true));
    this._inflightRequests.clear();
    try {
      this.imageLoadPoolManager.clearRequestStack(this.requestType);
    } catch (e) {
      /* best-effort */
    }
  }

  // SKM 2026-10-04 (Option B): order a display set's windowed imageIds center-out with
  // an ahead-bias in the current scroll direction — the Priority 2 (immediate
  // neighbourhood) slices first, then Priority 3 (directional) outward. Returns the
  // ordered subset to enqueue. Falls back to the plain contiguous window when
  // priorityPrefetch is off.
  // SKM 2026-10-09 (Phase 1/2): order a single centre's window center-out, ahead-biased,
  // immediate-neighbourhood first. ahead/behind are the per-centre (already viewport-shared)
  // extents; everything is clamped to [0, last] so a window can never exceed the series.
  private _orderCenterOut(
    imageIds: string[],
    center: number,
    ahead: number,
    behind: number,
    immediate: number,
    dir: number
  ): string[] {
    const last = imageIds.length - 1;
    const aheadEnd = Math.min(last, center + (dir > 0 ? ahead : behind));
    const behindEnd = Math.max(0, center - (dir > 0 ? behind : ahead));
    const start = Math.min(center, behindEnd);
    const end = Math.max(center, aheadEnd);
    const ordered: string[] = [];
    const push = (idx: number) => {
      if (idx >= 0 && idx <= last && imageIds[idx]) {
        ordered.push(imageIds[idx]);
      }
    };
    push(center);
    for (let d = 1; d <= immediate; d++) {
      push(center + d * dir);
      push(center - d * dir);
    }
    let a = center + immediate * dir + dir;
    let b = center - immediate * dir - dir;
    const aStep = dir;
    const bStep = -dir;
    while (a >= start && a <= end) {
      push(a);
      push(a + aStep);
      a += aStep * 2;
      if (b >= start && b <= end) {
        push(b);
        b += bStep;
      }
    }
    return ordered;
  }

  private _orderedWindowImageIds(displaySet: DisplaySet, imageIds: string[]): string[] {
    if (!this.config.priorityPrefetch || !this.config.windowedPrefetch || imageIds.length <= 1) {
      return this._windowImageIds(displaySet, imageIds);
    }
    const immediate =
      typeof this.config.immediateRadius === 'number' ? this.config.immediateRadius : 15;
    const radius =
      typeof this.config.windowRadius === 'number' && this.config.windowRadius > 0
        ? this.config.windowRadius
        : 250;
    const cfgAhead = typeof this.config.windowAhead === 'number' ? this.config.windowAhead : radius;
    const cfgBehind =
      typeof this.config.windowBehind === 'number' ? this.config.windowBehind : radius;
    const dir = this._direction >= 0 ? 1 : -1;
    const last = imageIds.length - 1;

    // Phase 1: prioritise the UNION of every pane showing this series (active pane first), not a
    // single last-writer centre. Phase 2: divide the decode window by the number of panes so the
    // prefetch window per pane matches the evictor's per-viewport keep (budget ÷ nStack) — this
    // removes the prefetch>evict mismatch that caused the decode→evict→re-decode treadmill. Also
    // intrinsically clamps the per-series window to the series length (Req 1).
    let centers = this._getViewportCentersForDisplaySet(displaySet.displaySetInstanceUID);
    if (!centers.length) {
      centers = [this._getCenterIndexForDisplaySet(displaySet.displaySetInstanceUID)];
    }
    // Active pane's centre first so its neighbourhood wins the earliest slots.
    const activeInfo = this._getActiveViewportInfo();
    if (
      activeInfo &&
      activeInfo.uid === displaySet.displaySetInstanceUID &&
      centers.includes(activeInfo.idx)
    ) {
      centers = [activeInfo.idx, ...centers.filter(c => c !== activeInfo.idx)];
    }
    const nPanes = Math.max(1, centers.length);
    const effAhead = Math.max(immediate + 1, Math.floor(cfgAhead / nPanes));
    const effBehind = Math.max(immediate + 1, Math.floor(cfgBehind / nPanes));

    // Build each pane's ordered window, then round-robin merge so no pane starves the other.
    const perCenter = centers.map(c =>
      this._orderCenterOut(imageIds, c, effAhead, effBehind, immediate, dir)
    );
    const merged: string[] = [];
    const maxLen = perCenter.reduce((m, arr) => Math.max(m, arr.length), 0);
    for (let i = 0; i < maxLen; i++) {
      for (let p = 0; p < perCenter.length; p++) {
        if (i < perCenter[p].length) {
          merged.push(perCenter[p][i]);
        }
      }
    }

    // De-dupe while preserving order.
    const seen = new Set<string>();
    const result: string[] = [];
    for (const id of merged) {
      if (!seen.has(id)) {
        seen.add(id);
        result.push(id);
      }
    }
    // Telemetry (active/first centre).
    this._schedulerStats.prefetchCenterIndex = centers[0];
    this._schedulerStats.direction = dir;
    this._schedulerStats.prefetchAhead = Math.min(effAhead, last - centers[0]);
    this._schedulerStats.prefetchBehind = Math.min(effBehind, centers[0]);
    return result;
  }

  // SKM 2026-10-04 (Option B): publish a read-only scheduler snapshot for skmTelemetry
  // (no behaviour change; the extension's telemetry reads window.__skmScheduler).
  private _publishStats(): void {
    try {
      this._schedulerStats.requestedCenterIndex = this._getActiveCenter();
      this._schedulerStats.queueSize = this._pendingRequests.length;
      this._schedulerStats.inflight = this._inflightRequests.size;
      (globalThis as any).__skmScheduler = { ...this._schedulerStats };
    } catch (e) {
      /* noop */
    }
  }

  private _updateDisplaySetLoadingProgress(displaySetLoadingState: DisplaySetLoadingState) {
    const { numInstances, loadedImageIds, failedImageIds } = displaySetLoadingState;
    const loadingProgress = (loadedImageIds.size + failedImageIds.size) / numInstances;

    displaySetLoadingState.loadingProgress = loadingProgress;
  }

  private _addDisplaySetLoadingState(displaySet: DisplaySet): void {
    const { displaySetInstanceUID } = displaySet;
    const imageIds = this._getImageIdsForDisplaySet(displaySet);
    let displaySetLoadingState = this._displaySetLoadingStates.get(displaySetInstanceUID);

    if (displaySetLoadingState) {
      return;
    }

    const pendingImageIds = new Set<string>(imageIds);
    const loadedImageIds = new Set<string>();

    // Needs to check which image is already loaded to update the progress properly
    // because some images may already be loaded (thumbnails and viewports).
    for (const imageId of imageIds) {
      if (this.cache.isImageCached(imageId)) {
        loadedImageIds.add(imageId);
      } else {
        pendingImageIds.add(imageId);
      }
    }

    displaySetLoadingState = {
      displaySetInstanceUID,
      numInstances: imageIds.length,
      pendingImageIds,
      loadedImageIds,
      failedImageIds: new Set(),
      loadingProgress: 0,
    };

    this._updateDisplaySetLoadingProgress(displaySetLoadingState);
    this._displaySetLoadingStates.set(displaySetInstanceUID, displaySetLoadingState);
    this._updateImageIdsDisplaySetMap(displaySetInstanceUID, imageIds);

    // Notify the UI that something is already loaded (eg: update StudyBrowser)
    if (loadedImageIds.size) {
      this._triggerDisplaySetEvents(displaySetInstanceUID);
    }
  }

  private _loadDisplaySets() {
    skmMark('skm-switch:loadDisplaySets-begin');
    const { displaySets, displaySetsToPrefetch } = this._getDisplaySets();

    // SKM 2026-10-09 (QA fix — Priority 2 instrumentation): this loop runs over EVERY active
    // display set in the WHOLE STUDY (displaySetService.getActiveDisplaySets()), not just the
    // one(s) being shown — isolate its cost with its own mark so a study-switch breakdown can
    // show whether this (suspected O(total_study_instances), unmemoized getImageIdsForDisplaySet
    // + cache.isImageCached per instance) is the dominant synchronous cost, independent of the
    // bounded-by-window prefetch-enqueue step below.
    displaySets.forEach(displaySet => this._addDisplaySetLoadingState(displaySet));
    skmMark('skm-switch:addLoadingState-end');

    // ── SKM 2026-09-28: concurrent multi-viewport prefetch ──────────────────
    // With >1 open series, interleave their image requests (round-robin) so the
    // in-flight slots span ALL open series and every viewport's progress advances
    // together, instead of loading one series fully before the next starts.
    // Guarded by config.skmConcurrentPanes (default false = original behaviour).
    // TO REMOVE: delete this if/else and keep only the original forEach line below.
    // SKM 2026-10-03 (W2-full): on each (re)window, drop stale queued requests so
    // the window is rebuilt around the CURRENT centre. In-flight requests continue;
    // already-cached/in-flight slices are skipped by the enqueue methods, so no
    // duplicate work. Only when windowedPrefetch is on.
    if (this.config.windowedPrefetch) {
      this._pendingRequests = [];
    }
    if (this.config.skmConcurrentPanes && displaySetsToPrefetch.length > 1) {
      this._enqueueDisplaySetImagesInterleaved(displaySetsToPrefetch);
    } else {
      displaySetsToPrefetch.forEach(displaySet => this._enqueueDisplaySetImagesRequests(displaySet));
    }
    // ── end SKM ─────────────────────────────────────────────────────────────
    skmMark('skm-switch:enqueue-end');
  }

  // ── SKM 2026-09-28: round-robin enqueue across open series (see _loadDisplaySets).
  // Delete this whole method when removing the concurrent-panes feature.
  private _enqueueDisplaySetImagesInterleaved(displaySets: DisplaySet[]) {
    const perSet = displaySets.map(ds => ({
      displaySetInstanceUID: ds.displaySetInstanceUID,
      // SKM 2026-10-03 (W2-full): window each pane's series around its current slice.
      // SKM 2026-10-04 (Option B): center-out ahead-biased order when priorityPrefetch on.
      imageIds: this._orderedWindowImageIds(ds, this._getImageIdsForDisplaySet(ds)),
    }));
    const maxLen = perSet.reduce((m, s) => Math.max(m, s.imageIds.length), 0);
    for (let i = 0; i < maxLen; i++) {
      for (const set of perSet) {
        const imageId = set.imageIds[i];
        if (imageId === undefined) {
          continue;
        }
        if (this.cache.isImageCached(imageId)) {
          this._moveImageIdToLoadedSet(imageId);
          continue;
        }
        if (this._inflightRequests.has(imageId)) {
          continue;
        }
        this._pendingRequests.push({
          displaySetInstanceUID: set.displaySetInstanceUID,
          imageId,
          aborted: false,
        });
      }
    }
  }

  // ── SKM 2026-09-28: effective in-flight cap. When skmConcurrentPanes is on it
  // scales maxNumPrefetchRequests by the number of open (displayed) series so a
  // second pane uses spare bandwidth rather than halving the focused study's
  // budget, bounded by skmConcurrentPanesMaxRequests (default = base * 2).
  // When off it returns exactly config.maxNumPrefetchRequests (original behaviour).
  // Delete this method (and revert its call site in _sendNextRequests to
  // this.config.maxNumPrefetchRequests) to remove the feature.
  private _effectiveMaxPrefetchRequests(): number {
    const base = this.config.maxNumPrefetchRequests;
    if (!this.config.skmConcurrentPanes) {
      return base;
    }
    const panes = Math.max(1, this._activeDisplaySetsInstanceUIDs?.length || 1);
    const ceiling = this.config.skmConcurrentPanesMaxRequests || base * 2;
    return Math.min(base * panes, ceiling);
  }

  private _moveImageIdToLoadedSet(imageId: string): boolean {
    const displaySetsInstanceUIDs = this._imageIdsToDisplaySetsMap.get(imageId);

    if (!displaySetsInstanceUIDs) {
      return;
    }

    for (const displaySetInstanceUID of Array.from(displaySetsInstanceUIDs.values())) {
      const displaySetLoadingState = this._displaySetLoadingStates.get(displaySetInstanceUID);
      const { pendingImageIds, loadedImageIds } = displaySetLoadingState;

      pendingImageIds.delete(imageId);
      loadedImageIds.add(imageId);

      this._updateDisplaySetLoadingProgress(displaySetLoadingState);
      this._triggerDisplaySetEvents(displaySetInstanceUID);
    }

    return true;
  }

  private _moveImageIdToFailedSet(imageId: string): boolean {
    const displaySetsInstanceUIDs = this._imageIdsToDisplaySetsMap.get(imageId);

    if (!displaySetsInstanceUIDs) {
      return;
    }

    for (const displaySetInstanceUID of Array.from(displaySetsInstanceUIDs.values())) {
      const displaySetLoadingState = this._displaySetLoadingStates.get(displaySetInstanceUID);
      const { pendingImageIds, failedImageIds } = displaySetLoadingState;

      pendingImageIds.delete(imageId);
      failedImageIds.add(imageId);

      this._updateDisplaySetLoadingProgress(displaySetLoadingState);
      this._triggerDisplaySetEvents(displaySetInstanceUID);
    }

    return true;
  }

  private _triggerDisplaySetEvents(displaySetInstanceUID: string) {
    const displaySetLoadingState = this._displaySetLoadingStates.get(displaySetInstanceUID);
    const { loadingProgress, numInstances } = displaySetLoadingState;

    this._broadcastEvent(this.EVENTS.DISPLAYSET_LOAD_PROGRESS, {
      displaySetInstanceUID,
      numInstances,
      loadingProgress,
    });

    if (loadingProgress >= 1) {
      this._broadcastEvent(this.EVENTS.DISPLAYSET_LOAD_COMPLETE, {
        displaySetInstanceUID,
      });
    }
  }

  private _onImagePrefetchSuccess(imageRequest: ImageRequest) {
    if (imageRequest.aborted) {
      return;
    }

    const { imageId } = imageRequest;

    this._inflightRequests.delete(imageId);
    this._moveImageIdToLoadedSet(imageId);

    // `sendNextRequests` must be called after removing the request from the inflight
    // queue otherwise it shall not be able to send the request (maxNumPrefetchRequests)
    this._sendNextRequests();
  }

  private _onImagePrefetchFailed(imageRequest, error) {
    if (imageRequest.aborted) {
      return;
    }

    console.warn(`An error ocurred when trying to load "${imageRequest.imageId}"`, error);

    const { imageId } = imageRequest;

    this._inflightRequests.delete(imageId);
    this._moveImageIdToFailedSet(imageId);

    // `sendNextRequests` must be called after removing the request from the inflight
    // queue otherwise it shall not be able to send the request (maxNumPrefetchRequests)
    this._sendNextRequests();
  }

  private async _sendNextRequests() {
    // If the service has stopped with async requests in progress this method may
    // get called again when each of those requests are fulfilled.
    if (!this._isRunning) {
      return;
    }

    // SKM 2026-10-03 (W2): bounded prefetch. If the decoded cache is near its cap,
    // STOP feeding the prefetch queue — flooding a cache smaller than the series is
    // exactly what makes Cornerstone throw CACHE_SIZE_EXCEEDED (the popup). The
    // remaining slices load on-demand as the doctor scrolls (interaction priority;
    // Cornerstone evicts an old prefetched slice to fit each one). Pending requests
    // stay queued and resume automatically if the cache frees. Best-effort: if the
    // cache can't report its fill, this is a no-op and behaviour is unchanged.
    if (this.config.boundedPrefetch !== false && typeof this.cache.getFillFraction === 'function') {
      const highWater =
        typeof this.config.boundedPrefetchHighWater === 'number'
          ? this.config.boundedPrefetchHighWater
          : 0.9;
      if (this.cache.getFillFraction() >= highWater) {
        return;
      }
    }

    // NOTE: previously this returned early until the active display set was 100% loaded.
    // Combined with the active series being excluded from the queue and only partially
    // loaded by the viewport's stack prefetch, that gate caused a permanent stall (study
    // stuck ~51%). The active series is now enqueued FIRST (see
    // _getSortedDisplaySetsToPrefetch), so "closest" ordering already prioritises it and
    // the gate is unnecessary — removing it lets the entire study load eagerly without
    // deadlocking.

    const { _pendingRequests: pendingRequests, _inflightRequests: inflightRequests } = this;
    // SKM 2026-09-28: pane-scaled cap when skmConcurrentPanes is on; otherwise
    // === this.config.maxNumPrefetchRequests (original). See _effectiveMaxPrefetchRequests.
    const maxNumPrefetchRequests = this._effectiveMaxPrefetchRequests();

    if (!pendingRequests.length || inflightRequests.size >= maxNumPrefetchRequests) {
      return;
    }

    const numImageRequests = Math.min(
      pendingRequests.length,
      maxNumPrefetchRequests - inflightRequests.size
    );
    const imageRequests = this._pendingRequests.splice(0, numImageRequests);

    imageRequests.forEach(imageRequest => {
      const { imageId } = imageRequest;
      const options = {
        priority: -5,
        requestType: this.requestType,
        additionalDetails: { imageId },
        preScale: {
          enabled: true,
        },
      };

      this.imageLoadPoolManager.addRequest(
        async () =>
          this.imageLoader.loadAndCacheImage(imageId, options).then(
            _image => this._onImagePrefetchSuccess(imageRequest),
            error => this._onImagePrefetchFailed(imageRequest, error)
          ),
        this.requestType,
        { imageId }
      );

      inflightRequests.set(imageId, imageRequest);
    });

    // SKM 2026-10-04 (Option B): publish a read-only scheduler snapshot for telemetry.
    if (this.config.priorityPrefetch) {
      this._publishStats();
    }
  }

  private _enqueueDisplaySetImagesRequests(displaySet: DisplaySet) {
    const { displaySetInstanceUID } = displaySet;
    // SKM 2026-10-03 (W2-full): only the window around the current slice when
    // windowedPrefetch is on (otherwise the full series, as before).
    // SKM 2026-10-04 (Option B): when priorityPrefetch is on, the window is ordered
    // center-out with an ahead-bias so the nearest + scroll-ahead slices load first.
    const imageIds = this._orderedWindowImageIds(
      displaySet,
      this._getImageIdsForDisplaySet(displaySet)
    );

    imageIds.forEach(imageId => {
      if (this.cache.isImageCached(imageId)) {
        this._moveImageIdToLoadedSet(imageId);
        return;
      }
      // Skip already in-flight so scroll-driven re-windowing can't double-dispatch.
      if (this._inflightRequests.has(imageId)) {
        return;
      }
      this._pendingRequests.push({
        displaySetInstanceUID,
        imageId,
        aborted: false,
      });
      // SKM 2026-10-09 (Phase 0 diagnostics — READ-ONLY): count how often each imageId is
      // re-enqueued after a far-jump cancel. Count > 1 = re-queued after cancel (not a
      // duplicate network request — Cornerstone deduplicates at the pool level).
      const n = (this._requestCounts.get(imageId) || 0) + 1;
      this._requestCounts.set(imageId, n);
      if (n === 2) {
        this._schedulerStats.reEnqueues++;
      }
      if (n > this._schedulerStats.maxEnqueuesPerImage) {
        this._schedulerStats.maxEnqueuesPerImage = n;
      }
    });
  }

  /**
   * Start prefetching the display sets based on the active viewport and app configuration.
   */
  private _startPrefetching(): void {
    if (this._isRunning) {
      return;
    }

    if (!this.config.enabled) {
      console.log('StudyPrefetcher is not enabled');
      return;
    }

    this._isRunning = true;

    this._loadDisplaySets();
    this._sendNextRequests();
    skmMark('skm-switch:sendNext-end');
    this._broadcastEvent(this.EVENTS.SERVICE_STARTED, {});
  }

  /**
   * Stop prefetching the display sets.
   * All internal variables are cleared but activeDisplaySetsInstanceUIDs otherwise restart would not work.
   */
  private _stopPrefetching(): void {
    if (!this._isRunning) {
      return;
    }
    this._isRunning = false;

    // SKM 2026-10-09 (QA fix — Priority 2 round 4): snapshot the stale pending/
    // in-flight imageIds BEFORE any bookkeeping below is cleared, and hand them to
    // imageLoader.cancelLoadImages() — the same Cornerstone3D cancellation primitive
    // CornerstoneViewportService already uses for the viewport's native stack
    // prefetch. clearRequestStack() further below is unchanged and still removes
    // NOT-YET-DISPATCHED pool entries (see the class-level TODO on IImageLoadPoolManager
    // usage); it never touched a request whose requestFn had already been invoked and
    // was awaiting the network response — this closes that gap for THIS service's own
    // windowed-prefetch queue. _stopPrefetching() only ever runs for an actual series/
    // displaySet switch or onModeExit, so staleImageIds here belongs exclusively to the
    // OLD window this service itself enqueued — it can never include the new series'
    // imageIds (different SeriesInstanceUID/SOPInstanceUID, by construction) or the
    // viewport's own current/interaction-priority load.
    const stalePendingImageIds = this._pendingRequests.map(r => r.imageId);
    const staleInflightImageIds = Array.from(this._inflightRequests.keys());
    const staleImageIds = Array.from(new Set([...stalePendingImageIds, ...staleInflightImageIds]));
    const staleDisplaySetUIDs = Array.from(this._displaySetLoadingStates.keys());
    this._cancelDiagnostics.stalePendingCount = stalePendingImageIds.length;
    this._cancelDiagnostics.staleInflightCount = staleInflightImageIds.length;
    this._cancelDiagnostics.cancelledOldSeriesCount = staleDisplaySetUIDs.length;
    this._cancelDiagnostics.lastPrevDsUID = staleDisplaySetUIDs[0] ?? null;
    this._cancelDiagnostics.lastNewDsUID = this._activeDisplaySetsInstanceUIDs[0] ?? null;
    this._cancelStaleImageLoads(staleImageIds, 'stopPrefetching');

    // SKM 2026-10-04 (Option B): reset direction tracking so the next series doesn't
    // read the previous centre as a far jump.
    this._lastCenter = null;
    this._direction = 1;
    // SKM 2026-10-09 (QA fix): clear per-viewport centre ownership too — a slice index is only
    // meaningful within ITS series, so a stale index from the series that just unloaded must
    // never be compared against a new series on the same viewportId (restart => fresh history).
    this._viewportCenters.clear();

    // Mark all inflight requests as aborted before clearing the map.
    this._inflightRequests.forEach(inflightRequest => (inflightRequest.aborted = true));

    this._pendingRequests = [];
    this._displaySetLoadingStates.clear();
    this._imageIdsToDisplaySetsMap.clear();
    this._inflightRequests.clear();
    // SKM 2026-10-09 (Phase 0 fix): clear per-imageId enqueue counts so memory grows
    // O(study_size) not O(session_lifetime); also reset per-session stats.
    this._requestCounts.clear();
    this._schedulerStats.reEnqueues = 0;
    this._schedulerStats.maxEnqueuesPerImage = 0;
    this.imageLoadPoolManager.clearRequestStack(this.requestType);

    this._broadcastEvent(this.EVENTS.SERVICE_STOPPED, {});
  }

  /**
   * Restart prefetching in case it is already running.
   */
  private _restartPrefetching(): void {
    if (this._isRunning) {
      skmMark('skm-switch:restart-begin');
      this._stopPrefetching();
      skmMark('skm-switch:stop-end');
      this._startPrefetching();
      skmMark('skm-switch:restart-end');
    }
  }
}

export { StudyPrefetcherService as default, StudyPrefetcherService };
