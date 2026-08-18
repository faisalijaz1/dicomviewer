import { PubSubService } from '../_shared/pubSubServiceInterface';
import uuidv4 from '../../utils/uuidv4';

type PresentationIdProvider = (
  id: string,
  { viewport, viewports, isUpdatingSameViewport }
) => unknown;

type ReflowLayoutOption = { x: number; y: number; width: number; height: number };
type ReflowTarget = { numRows: number; numCols: number; layoutOptions: ReflowLayoutOption[] };

const TWO_BY_THREE_LAYOUT_OPTIONS: ReflowLayoutOption[] = [
  { x: 0, y: 0, width: 1 / 3, height: 0.5 },
  { x: 1 / 3, y: 0, width: 1 / 3, height: 0.5 },
  { x: 2 / 3, y: 0, width: 1 / 3, height: 0.5 },
  { x: 0, y: 0.5, width: 1 / 3, height: 0.5 },
  { x: 1 / 3, y: 0.5, width: 1 / 3, height: 0.5 },
  { x: 2 / 3, y: 0.5, width: 1 / 3, height: 0.5 },
];

/**
 * Grid shape to use for a given number of POPULATED (has a display set)
 * panes - hand-authored, covering only the shapes this app actually uses
 * (1-up through the 2x3 custom grid), not a generic bin-packing algorithm.
 *
 * Both growing (addBlankViewport) and shrinking (closeViewport) derive
 * their target shape from this single table, keyed by the RESULTING
 * populated-pane count. This matters: grid shape (numRows x numCols) alone
 * doesn't tell you how many panes are actually in use once you've grown or
 * shrunk away from a fully-populated grid (e.g. a 2x3 shape can hold
 * anywhere from 1 to 6 populated panes) - keying by shape string instead of
 * count was an earlier bug here, since repeatedly closing panes kept
 * re-applying the rule for the ORIGINAL full count instead of progressively
 * shrinking further, leaving dead space. Keying by count fixes that: every
 * close/grow step re-derives the correct shape from how many panes are
 * actually populated right now.
 */
const SHAPE_FOR_POPULATED_COUNT: Record<number, ReflowTarget> = {
  1: {
    numRows: 1,
    numCols: 1,
    layoutOptions: [{ x: 0, y: 0, width: 1, height: 1 }],
  },
  2: {
    numRows: 1,
    numCols: 2,
    layoutOptions: [
      { x: 0, y: 0, width: 0.5, height: 1 },
      { x: 0.5, y: 0, width: 0.5, height: 1 },
    ],
  },
  3: {
    numRows: 1,
    numCols: 3,
    layoutOptions: [
      { x: 0, y: 0, width: 1 / 3, height: 1 },
      { x: 1 / 3, y: 0, width: 1 / 3, height: 1 },
      { x: 2 / 3, y: 0, width: 1 / 3, height: 1 },
    ],
  },
  4: {
    numRows: 2,
    numCols: 2,
    layoutOptions: [
      { x: 0, y: 0, width: 0.5, height: 0.5 },
      { x: 0.5, y: 0, width: 0.5, height: 0.5 },
      { x: 0, y: 0.5, width: 0.5, height: 0.5 },
      { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
    ],
  },
  5: {
    numRows: 2,
    numCols: 3,
    layoutOptions: TWO_BY_THREE_LAYOUT_OPTIONS,
  },
  6: {
    numRows: 2,
    numCols: 3,
    layoutOptions: TWO_BY_THREE_LAYOUT_OPTIONS,
  },
};

/**
 * Grid shape for any populated-pane count: uses the hand-tuned table above
 * for the common small counts (1-6), and falls back to a computed
 * near-square grid for anything beyond that - there's no hard cap on how
 * many panes the grid itself can grow to. (In practice, opening many more
 * panes than that runs into real browser/GPU limits - each pane is its own
 * WebGL context, and browsers cap the total around a dozen or so across all
 * open windows combined - not an app-imposed limit.)
 */
function getReflowTarget(populatedCount: number): ReflowTarget | null {
  if (populatedCount < 1) {
    return null;
  }

  const handTuned = SHAPE_FOR_POPULATED_COUNT[populatedCount];
  if (handTuned) {
    return handTuned;
  }

  const numCols = Math.ceil(Math.sqrt(populatedCount));
  const numRows = Math.ceil(populatedCount / numCols);
  const width = 1 / numCols;
  const height = 1 / numRows;
  const layoutOptions: ReflowLayoutOption[] = [];

  for (let row = 0; row < numRows; row++) {
    for (let col = 0; col < numCols; col++) {
      layoutOptions.push({ x: col * width, y: row * height, width, height });
    }
  }

  return { numRows, numCols, layoutOptions };
}

class ViewportGridService extends PubSubService {
  public static readonly EVENTS = {
    ACTIVE_VIEWPORT_ID_CHANGED: 'event::activeviewportidchanged',
    LAYOUT_CHANGED: 'event::layoutChanged',
    GRID_STATE_CHANGED: 'event::gridStateChanged',
    GRID_SIZE_CHANGED: 'event::gridSizeChanged',
    VIEWPORTS_READY: 'event::viewportsReady',
    VIEWPORT_ONDROP_HANDLED: 'event::viewportOnDropHandled',
  };

  public static REGISTRATION = {
    name: 'viewportGridService',
    altName: 'ViewportGridService',
    create: ({ configuration = {}, servicesManager }) => {
      return new ViewportGridService({ servicesManager });
    },
  };

  serviceImplementation = {};
  servicesManager: AppTypes.ServicesManager;
  presentationIdProviders: Map<string, PresentationIdProvider>;

  constructor({ servicesManager }) {
    super(ViewportGridService.EVENTS);
    this.servicesManager = servicesManager;
    this.serviceImplementation = {};
    this.presentationIdProviders = new Map();
  }

  public addPresentationIdProvider(id: string, provider: PresentationIdProvider): void {
    this.presentationIdProviders.set(id, provider);
  }

  /**
   * Gets the presentation provider with the given id.
   */
  public getPresentationIdProvider(id: string): PresentationIdProvider {
    return this.presentationIdProviders.get(id);
  }

  public getPresentationId(id: string, viewportId: string): string | null {
    const state = this.getState();
    const viewport = state.viewports.get(viewportId);
    return this._getPresentationId(id, {
      viewport,
      viewports: state.viewports,
    });
  }

  private _getPresentationId(id, { viewport, viewports }) {
    const isUpdatingSameViewport = [...viewports.values()].some(
      v =>
        v.displaySetInstanceUIDs?.toString() === viewport.displaySetInstanceUIDs?.toString() &&
        v.viewportId === viewport.viewportId
    );

    const provider = this.presentationIdProviders.get(id);
    if (provider) {
      const result = provider(id, {
        viewport,
        viewports,
        isUpdatingSameViewport,
        servicesManager: this.servicesManager,
      });
      return result;
    }
    return null;
  }

  public getPresentationIds({ viewport, viewports }) {
    // Use the keys of the Map to get all registered provider IDs
    const registeredPresentationProviders = Array.from(this.presentationIdProviders.keys());

    return registeredPresentationProviders.reduce((acc, id) => {
      const value = this._getPresentationId(id, {
        viewport,
        viewports,
      });
      if (value !== null) {
        acc[id] = value;
      }
      return acc;
    }, {});
  }

  public setServiceImplementation({
    getState: getStateImplementation,
    setActiveViewportId: setActiveViewportIdImplementation,
    setDisplaySetsForViewports: setDisplaySetsForViewportsImplementation,
    setLayout: setLayoutImplementation,
    reset: resetImplementation,
    onModeExit: onModeExitImplementation,
    set: setImplementation,
    getNumViewportPanes: getNumViewportPanesImplementation,
    setViewportIsReady: setViewportIsReadyImplementation,
    getViewportState: getViewportStateImplementation,
  }): void {
    if (getViewportStateImplementation) {
      this.serviceImplementation._getViewportState = getViewportStateImplementation;
    }
    if (getStateImplementation) {
      this.serviceImplementation._getState = getStateImplementation;
    }
    if (setActiveViewportIdImplementation) {
      this.serviceImplementation._setActiveViewport = setActiveViewportIdImplementation;
    }
    if (setDisplaySetsForViewportsImplementation) {
      this.serviceImplementation._setDisplaySetsForViewports =
        setDisplaySetsForViewportsImplementation;
    }
    if (setLayoutImplementation) {
      this.serviceImplementation._setLayout = setLayoutImplementation;
    }
    if (resetImplementation) {
      this.serviceImplementation._reset = resetImplementation;
    }
    if (onModeExitImplementation) {
      this.serviceImplementation._onModeExit = onModeExitImplementation;
    }
    if (setImplementation) {
      this.serviceImplementation._set = setImplementation;
    }
    if (getNumViewportPanesImplementation) {
      this.serviceImplementation._getNumViewportPanes = getNumViewportPanesImplementation;
    }

    if (setViewportIsReadyImplementation) {
      this.serviceImplementation._setViewportIsReady = setViewportIsReadyImplementation;
    }
  }

  public publishViewportsReady() {
    this._broadcastEvent(this.EVENTS.VIEWPORTS_READY, {});
  }

  public publishViewportOnDropHandled(eventData) {
    this._broadcastEvent(this.EVENTS.VIEWPORT_ONDROP_HANDLED, { eventData });
  }

  public setActiveViewportId(id: string) {
    if (id === this.getActiveViewportId()) {
      return;
    }
    this.serviceImplementation._setActiveViewport(id);

    // Use queueMicrotask to delay the event broadcast
    setTimeout(() => {
      this._broadcastEvent(this.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED, {
        viewportId: id,
      });
    }, 0);
  }

  public getState(): AppTypes.ViewportGrid.State {
    return this.serviceImplementation._getState();
  }

  public getViewportState(viewportId: string) {
    return this.serviceImplementation._getViewportState(viewportId);
  }

  public setViewportIsReady(viewportId, callback) {
    this.serviceImplementation._setViewportIsReady(viewportId, callback);
  }

  public getActiveViewportId() {
    const state = this.getState();
    return state.activeViewportId;
  }

  public setViewportGridSizeChanged() {
    const state = this.getState();
    this._broadcastEvent(this.EVENTS.GRID_SIZE_CHANGED, {
      state,
    });
  }

  public setDisplaySetsForViewport(props) {
    // Just update a single viewport, but use the multi-viewport update for it.
    this.setDisplaySetsForViewports([props]);
  }

  public async setDisplaySetsForViewports(viewportsToUpdate) {
    await this.serviceImplementation._setDisplaySetsForViewports(viewportsToUpdate);
    const state = this.getState();
    const updatedViewports = [];

    const removedViewportIds = [];

    for (const viewport of viewportsToUpdate) {
      const updatedViewport = state.viewports.get(viewport.viewportId);

      if (updatedViewport) {
        updatedViewports.push(updatedViewport);

        const updatedDisplaySetUIDs = updatedViewport.displaySetInstanceUIDs || [];

        const isCleared = updatedDisplaySetUIDs.length === 0;

        if (isCleared) {
          removedViewportIds.push(viewport.viewportId);
        }
      } else {
        removedViewportIds.push(viewport.viewportId);
      }
    }

    setTimeout(() => {
      this._broadcastEvent(ViewportGridService.EVENTS.GRID_STATE_CHANGED, {
        state,
        viewports: updatedViewports,
        removedViewportIds,
      });
    });
  }

  /**
   * Retrieves the display set instance UIDs for a given viewport.
   * @param viewportId The ID of the viewport.
   * @returns An array of display set instance UIDs.
   */
  public getDisplaySetsUIDsForViewport(viewportId: string) {
    const state = this.getState();
    const viewport = state.viewports.get(viewportId);
    return viewport?.displaySetInstanceUIDs;
  }

  /**
   *
   * @param numCols, numRows - the number of columns and rows to apply
   * @param findOrCreateViewport is a function which takes the
   *    index position of the viewport, the position id, and a set of
   *    options that is initially provided as {} (eg to store intermediate state)
   *    The function returns a viewport object to use at the given position.
   */
  public async setLayout({
    numCols,
    numRows,
    layoutOptions,
    layoutType = 'grid',
    activeViewportId = undefined,
    findOrCreateViewport = undefined,
    isHangingProtocolLayout = false,
  }) {
    // Get the previous state before the layout change
    const prevState = this.getState();
    const prevViewportIds = new Set(prevState.viewports.keys());

    await this.serviceImplementation._setLayout({
      numCols,
      numRows,
      layoutOptions,
      layoutType,
      activeViewportId,
      findOrCreateViewport,
      isHangingProtocolLayout,
    });

    // Use queueMicrotask to ensure the layout changed event is published after
    setTimeout(() => {
      // Get the new state after the layout change
      const state = this.getState();
      const currentViewportIds = new Set(state.viewports.keys());

      // Determine which viewport IDs have been removed
      const removedViewportIds = [...prevViewportIds].filter(id => !currentViewportIds.has(id));

      this._broadcastEvent(this.EVENTS.LAYOUT_CHANGED, {
        numCols,
        numRows,
      });

      this._broadcastEvent(this.EVENTS.GRID_STATE_CHANGED, {
        state,
        removedViewportIds,
      });
    }, 0);
  }

  public reset() {
    this.serviceImplementation._reset();
  }

  /**
   * The onModeExit must set the state of the viewport grid to a standard/clean
   * state.  To implement store/recover of the viewport grid, perform
   * a state store in the mode or extension onModeExit, and recover that
   * data if appropriate in the onModeEnter of the mode or extension.
   */
  public onModeExit(): void {
    this.serviceImplementation._onModeExit();
  }

  public set(newState) {
    const prevState = this.getState();
    const prevViewportIds = new Set(prevState.viewports.keys());

    this.serviceImplementation._set(newState);

    const state = this.getState();
    const currentViewportIds = new Set(state.viewports.keys());

    const removedViewportIds = [...prevViewportIds].filter(id => !currentViewportIds.has(id));

    setTimeout(() => {
      this._broadcastEvent(this.EVENTS.GRID_STATE_CHANGED, {
        state,
        removedViewportIds,
      });
    }, 0);
  }

  public getNumViewportPanes() {
    return this.serviceImplementation._getNumViewportPanes();
  }

  public getLayoutOptionsFromState(
    state: any
  ): { x: number; y: number; width: number; height: number }[] {
    return Array.from(state.viewports.entries()).map(([_, viewport]) => {
      return {
        x: viewport.x,
        y: viewport.y,
        width: viewport.width,
        height: viewport.height,
      };
    });
  }

  /**
   * Counts panes that actually have a display set in them, in reading order
   * (top-to-bottom, left-to-right) - blank placeholder panes (created to
   * pad a grid shape out, e.g. the unfilled 6th cell of a 2x3 grid with
   * only 5 panes in use) don't count. This is what SHAPE_FOR_POPULATED_COUNT
   * is keyed by, not raw viewports.size or grid shape, since either of
   * those can stay the same across several grow/close steps while the
   * populated count keeps changing.
   */
  private _getPopulatedViewports(state: AppTypes.ViewportGrid.State) {
    return Array.from(state.viewports.values())
      .filter((v: any) => v.displaySetInstanceUIDs?.length > 0)
      .sort((a: any, b: any) => {
        if (Math.abs(a.y - b.y) > 0.001) {
          return a.y - b.y;
        }
        return a.x - b.x;
      });
  }

  /**
   * Whether closeViewport(viewportId) can currently do anything useful -
   * the viewport has to be a populated pane, there has to be more than one
   * populated pane, and a shape has to exist for the resulting count.
   */
  public canCloseViewport(viewportId: string): boolean {
    const state = this.getState();
    const populatedViewports = this._getPopulatedViewports(state);
    if (populatedViewports.length <= 1) {
      return false;
    }
    if (!populatedViewports.some((v: any) => v.viewportId === viewportId)) {
      return false;
    }
    return !!getReflowTarget(populatedViewports.length - 1);
  }

  /**
   * Closes a single populated viewport pane and reflows the remaining
   * populated panes into the shape SHAPE_FOR_POPULATED_COUNT says fits
   * their new count, padding any leftover grid cells with blank
   * placeholders. Surviving panes keep their existing
   * viewportId/displaySets/tool state - only the closed pane's viewport is
   * torn down (via the normal SET_LAYOUT/unmount path, same as any other
   * layout change).
   */
  public async closeViewport(viewportId: string): Promise<void> {
    const state = this.getState();
    const populatedViewports = this._getPopulatedViewports(state);

    if (populatedViewports.length <= 1) {
      return;
    }

    const survivors = populatedViewports.filter((v: any) => v.viewportId !== viewportId);
    if (survivors.length === populatedViewports.length) {
      // viewportId wasn't a populated pane - nothing to close.
      return;
    }

    const target = getReflowTarget(survivors.length);
    if (!target) {
      console.warn(`ViewportGridService.closeViewport: no reflow rule for ${survivors.length} panes`);
      return;
    }

    await this.setLayout({
      numRows: target.numRows,
      numCols: target.numCols,
      layoutOptions: target.layoutOptions,
      findOrCreateViewport: position => {
        const survivor = survivors[position];
        return survivor ? { ...survivor } : {};
      },
    });
  }

  /**
   * Whether addBlankViewport() can currently grow the grid - there has to
   * be a shape defined for one more than the current populated-pane count.
   */
  public canGrowLayout(): boolean {
    const state = this.getState();
    const populatedCount = this._getPopulatedViewports(state).length;
    return !!getReflowTarget(populatedCount + 1);
  }

  /**
   * Grows the grid by one pane (the inverse of closeViewport): reflows the
   * existing populated panes - unchanged - into the first N positions of
   * the next grid shape, adds one new blank pane for the caller to load a
   * display set into, and pads any further cells with blank placeholders.
   * Returns the new pane's viewportId (there's no hard cap on pane count -
   * see getReflowTarget), or null only if populatedCount was somehow < 0.
   */
  public async addBlankViewport(): Promise<string | null> {
    const state = this.getState();
    const populatedViewports = this._getPopulatedViewports(state);
    const target = getReflowTarget(populatedViewports.length + 1);

    if (!target) {
      console.warn(
        `ViewportGridService.addBlankViewport: no growth rule past ${populatedViewports.length} panes`
      );
      return null;
    }

    const newViewportId = `viewport-${uuidv4().substring(0, 8)}`;

    await this.setLayout({
      numRows: target.numRows,
      numCols: target.numCols,
      layoutOptions: target.layoutOptions,
      findOrCreateViewport: position => {
        if (position < populatedViewports.length) {
          return { ...populatedViewports[position] };
        }
        if (position === populatedViewports.length) {
          return { viewportOptions: { viewportId: newViewportId } };
        }
        // Any cells beyond the new one stay blank, ready for a later grow.
        return {};
      },
    });

    return newViewportId;
  }
}

export default ViewportGridService;
