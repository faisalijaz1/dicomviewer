import { PubSubService } from '../_shared/pubSubServiceInterface';
import { ExtensionManager } from '../../extensions';
import ServicesManager from '../ServicesManager';
import ViewportGridService from '../ViewportGridService';
import { DisplaySet } from '../../types';

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
    const viewportGridActiveViewportIdSubscription = viewportGridService.subscribe(
      ViewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED,
      ({ viewportId }) => this._syncWithActiveViewport({ activeViewportId: viewportId })
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
    this._restartPrefetching();

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

  // Scroll-driven re-window: Cornerstone fires a new-image event as the doctor
  // scrolls; the extension forwards it here (see initStudyPrefetcherService). We
  // throttle, then rebuild the prefetch window around the new centre. Cheap no-op
  // unless windowedPrefetch is on and the service is running.
  public onActiveSliceChanged(): void {
    if (!this.config.windowedPrefetch || !this._isRunning) {
      return;
    }
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
    const { displaySets, displaySetsToPrefetch } = this._getDisplaySets();

    displaySets.forEach(displaySet => this._addDisplaySetLoadingState(displaySet));

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
  }

  // ── SKM 2026-09-28: round-robin enqueue across open series (see _loadDisplaySets).
  // Delete this whole method when removing the concurrent-panes feature.
  private _enqueueDisplaySetImagesInterleaved(displaySets: DisplaySet[]) {
    const perSet = displaySets.map(ds => ({
      displaySetInstanceUID: ds.displaySetInstanceUID,
      // SKM 2026-10-03 (W2-full): window each pane's series around its current slice.
      imageIds: this._windowImageIds(ds, this._getImageIdsForDisplaySet(ds)),
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
  }

  private _enqueueDisplaySetImagesRequests(displaySet: DisplaySet) {
    const { displaySetInstanceUID } = displaySet;
    // SKM 2026-10-03 (W2-full): only the window around the current slice when
    // windowedPrefetch is on (otherwise the full series, as before).
    const imageIds = this._windowImageIds(displaySet, this._getImageIdsForDisplaySet(displaySet));

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

    // Mark all inflight requests as aborted before clearing the map.
    this._inflightRequests.forEach(inflightRequest => (inflightRequest.aborted = true));

    this._pendingRequests = [];
    this._displaySetLoadingStates.clear();
    this._imageIdsToDisplaySetsMap.clear();
    this._inflightRequests.clear();
    this.imageLoadPoolManager.clearRequestStack(this.requestType);

    this._broadcastEvent(this.EVENTS.SERVICE_STOPPED, {});
  }

  /**
   * Restart prefetching in case it is already running.
   */
  private _restartPrefetching(): void {
    if (this._isRunning) {
      this._stopPrefetching();
      this._startPrefetching();
    }
  }
}

export { StudyPrefetcherService as default, StudyPrefetcherService };
