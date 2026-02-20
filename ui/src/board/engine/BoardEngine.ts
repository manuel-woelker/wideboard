import type {
  BoardClipboardEvent,
  BoardCommand,
  BoardKeyboardEvent,
  BoardOrderingAction,
  BoardPointerEvent,
  BoardWheelEvent
} from './boardEvents';
import type { BoardDelta, BoardDeltaBatch, BoardDeltaEnvelope, BoardRevision } from './boardDeltas';
import type { BoardElement, BoardEngineConfig, BoardState } from './boardEngineTypes';
import { createDefaultBoardElementRegistry, type BoardElementRegistry } from './elementRegistry';

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2.5;
const ZOOM_SENSITIVITY = 0.0015;
const KEYBOARD_MOVE_STEP = 10;

function clampZoom(zoom: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

function areStringListsEqual(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => {
      return right[index] === value;
    })
  );
}

function cloneElement(element: BoardElement): BoardElement {
  return { ...element };
}

function normalizeElementIds(ids: string[], state: BoardState) {
  const seen = new Set<string>();
  return ids.filter((id) => {
    if (seen.has(id) || !state.elements[id]) {
      return false;
    }

    seen.add(id);
    return true;
  });
}

function createElementState(elements: BoardElement[], registry: BoardElementRegistry) {
  const elementMap: Record<string, BoardElement> = {};
  const elementOrder: string[] = [];

  elements.forEach((element) => {
    registry.assertKnownKind(element.kind);
    const alreadyHadElement = Boolean(elementMap[element.id]);
    elementMap[element.id] = cloneElement(element);

    if (alreadyHadElement) {
      const existingIndex = elementOrder.indexOf(element.id);
      if (existingIndex !== -1) {
        elementOrder.splice(existingIndex, 1);
      }
    }

    elementOrder.push(element.id);
  });

  return {
    elements: elementMap,
    elementOrder
  };
}

function createInitialState(config: BoardEngineConfig, registry: BoardElementRegistry): BoardState {
  const elementState = createElementState(config.initialElements ?? [], registry);
  return {
    elements: elementState.elements,
    elementOrder: elementState.elementOrder,
    selection: [],
    viewport: {
      panX: config.initialViewport?.panX ?? 0,
      panY: config.initialViewport?.panY ?? 0,
      zoom: clampZoom(config.initialViewport?.zoom ?? 1)
    },
    interaction: {
      mode: 'idle'
    }
  };
}

function cloneState(state: BoardState): BoardState {
  const elements = Object.fromEntries(
    Object.entries(state.elements).map(([id, element]) => [id, cloneElement(element)])
  );
  const interaction =
    state.interaction.mode === 'dragging_selection'
      ? {
          ...state.interaction,
          origin: { ...state.interaction.origin },
          elementIds: [...state.interaction.elementIds],
          startPositions: Object.fromEntries(
            Object.entries(state.interaction.startPositions).map(([id, position]) => [
              id,
              { ...position }
            ])
          )
        }
      : { mode: 'idle' as const };

  return {
    elements,
    elementOrder: [...state.elementOrder],
    selection: [...state.selection],
    viewport: { ...state.viewport },
    interaction
  };
}

function applyOrdering(order: string[], ids: string[], action: BoardOrderingAction) {
  const selectedSet = new Set(ids);
  const currentSelected = order.filter((id) => selectedSet.has(id));
  if (currentSelected.length === 0) {
    return order;
  }

  if (action === 'bring_to_front') {
    const remaining = order.filter((id) => !selectedSet.has(id));
    return [...remaining, ...currentSelected];
  }

  if (action === 'send_to_back') {
    const remaining = order.filter((id) => !selectedSet.has(id));
    return [...currentSelected, ...remaining];
  }

  const next = [...order];
  if (action === 'bring_forward') {
    for (let index = next.length - 2; index >= 0; index -= 1) {
      const current = next[index];
      const nextId = next[index + 1];
      if (selectedSet.has(current) && !selectedSet.has(nextId)) {
        next[index] = nextId;
        next[index + 1] = current;
      }
    }
    return next;
  }

  for (let index = 1; index < next.length; index += 1) {
    const current = next[index];
    const previous = next[index - 1];
    if (selectedSet.has(current) && !selectedSet.has(previous)) {
      next[index] = previous;
      next[index - 1] = current;
    }
  }
  return next;
}

type MutateState = (state: BoardState, deltas: BoardDelta[]) => void;
type CommandType = BoardCommand['type'];
type CommandHandler<TType extends CommandType> = (
  state: BoardState,
  deltas: BoardDelta[],
  command: Extract<BoardCommand, { type: TType }>
) => void;
type CommandHandlerMap = {
  [TType in CommandType]: CommandHandler<TType>;
};
type CommandPayload<TType extends CommandType> = Omit<
  Extract<BoardCommand, { type: TType }>,
  'type'
>;
type DispatchMethod<TType extends CommandType> = keyof CommandPayload<TType> extends never
  ? (payload?: CommandPayload<TType>) => BoardRevision
  : (payload: CommandPayload<TType>) => BoardRevision;

/**
 * Strictly-typed command dispatch proxy API (`dispatch.<type>(payload)`).
 */
export type BoardEngineDispatchProxy = {
  [TType in CommandType]: DispatchMethod<TType>;
};

/**
 * Engine update payload emitted after each committed state mutation.
 */
export interface BoardEngineUpdate {
  /** Revision after the commit. */
  revision: BoardRevision;
  /** Deltas emitted for this revision. */
  deltas: BoardDelta[];
}

/**
 * Listener function invoked when the engine commits a new revision.
 */
export type BoardEngineListener = (update: BoardEngineUpdate) => void;

/**
 * Headless board state engine with deterministic reducers and revisioned deltas.
 */
export class BoardEngine {
  /** Registry used for kind validation and kind-specific reducers. */
  private readonly elementRegistry: BoardElementRegistry;

  /** Current canonical board state snapshot. */
  private state: BoardState;

  /** Current committed revision number. */
  private revision: BoardRevision = 0;

  /** Revision-ordered delta envelopes for incremental queries. */
  private readonly deltaHistory: BoardDeltaEnvelope[] = [];
  /** Subscribers notified after each committed revision. */
  private readonly listeners = new Set<BoardEngineListener>();
  /** Command dispatch table mapped by command type. */
  private readonly commandHandlers: CommandHandlerMap;
  /** Strict dispatch proxy for ergonomic command invocation. */
  public readonly dispatch: BoardEngineDispatchProxy;

  public constructor(config: BoardEngineConfig = {}) {
    this.elementRegistry = config.elementRegistry ?? createDefaultBoardElementRegistry();
    this.state = createInitialState(config, this.elementRegistry);
    this.commandHandlers = this.createCommandHandlers();
    this.dispatch = this.createDispatchProxy();
  }

  /**
   * Applies pointer-driven interactions such as selection and dragging.
   */
  public handlePointer(event: BoardPointerEvent): BoardRevision {
    if (event.phase === 'down' && event.button === 0 && event.targetElementId) {
      return this.commit((state, deltas) => {
        const targetId = event.targetElementId;
        if (!targetId || !state.elements[targetId]) {
          return;
        }

        const previousSelection = [...state.selection];
        let nextSelection = [...state.selection];

        if (event.shiftKey) {
          if (nextSelection.includes(targetId)) {
            nextSelection = nextSelection.filter((id) => id !== targetId);
          } else {
            nextSelection.push(targetId);
          }
        } else if (!nextSelection.includes(targetId) || nextSelection.length !== 1) {
          nextSelection = [targetId];
        }

        nextSelection = normalizeElementIds(nextSelection, state);
        if (!areStringListsEqual(previousSelection, nextSelection)) {
          state.selection = nextSelection;
          deltas.push({
            type: 'selection_changed',
            previous: previousSelection,
            current: [...state.selection]
          });
        }

        if (state.selection.length === 0) {
          return;
        }

        const previousInteraction = state.interaction;
        const startPositions = Object.fromEntries(
          state.selection.map((id) => {
            const element = state.elements[id];
            return [id, { x: element.x, y: element.y }];
          })
        );

        state.interaction = {
          mode: 'dragging_selection',
          pointerId: event.pointerId,
          origin: { ...event.point },
          elementIds: [...state.selection],
          startPositions
        };

        deltas.push({
          type: 'interaction_changed',
          previous: { mode: previousInteraction.mode },
          current: { mode: state.interaction.mode }
        });
      });
    }

    if (
      event.phase === 'move' &&
      stateIsDraggingSelection(this.state) &&
      (this.state.interaction.pointerId === null ||
        event.pointerId === this.state.interaction.pointerId)
    ) {
      return this.commit((state, deltas) => {
        if (!stateIsDraggingSelection(state)) {
          return;
        }

        const deltaX = event.point.x - state.interaction.origin.x;
        const deltaY = event.point.y - state.interaction.origin.y;
        if (deltaX === 0 && deltaY === 0) {
          return;
        }

        state.interaction.elementIds.forEach((id) => {
          const element = state.elements[id];
          const start = state.interaction.startPositions[id];
          if (!element || !start) {
            return;
          }

          const previousElement = cloneElement(element);
          const nextElement = this.elementRegistry.reduce(
            {
              ...element,
              x: start.x,
              y: start.y
            },
            {
              type: 'translate',
              delta: {
                x: deltaX,
                y: deltaY
              }
            }
          );
          state.elements[id] = nextElement;
          deltas.push({
            type: 'element_updated',
            id,
            previous: previousElement,
            current: cloneElement(nextElement)
          });
        });
      });
    }

    if (
      (event.phase === 'up' || event.phase === 'cancel') &&
      stateIsDraggingSelection(this.state) &&
      (this.state.interaction.pointerId === null ||
        event.pointerId === this.state.interaction.pointerId)
    ) {
      return this.commit((state, deltas) => {
        if (!stateIsDraggingSelection(state)) {
          return;
        }

        const previousInteractionMode = state.interaction.mode;
        (state as BoardState).interaction = { mode: 'idle' };
        deltas.push({
          type: 'interaction_changed',
          previous: { mode: previousInteractionMode },
          current: { mode: 'idle' }
        });
      });
    }

    return this.revision;
  }

  /**
   * Applies keyboard-driven board mutations.
   */
  public handleKeyboard(event: BoardKeyboardEvent): BoardRevision {
    if (event.phase !== 'down') {
      return this.revision;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      return this.dispatch.remove_elements({
        ids: this.state.selection
      });
    }

    if (event.key === 'ArrowLeft') {
      return this.dispatch.move_selection({
        delta: { x: -KEYBOARD_MOVE_STEP, y: 0 }
      });
    }

    if (event.key === 'ArrowRight') {
      return this.dispatch.move_selection({
        delta: { x: KEYBOARD_MOVE_STEP, y: 0 }
      });
    }

    if (event.key === 'ArrowUp') {
      return this.dispatch.move_selection({
        delta: { x: 0, y: -KEYBOARD_MOVE_STEP }
      });
    }

    if (event.key === 'ArrowDown') {
      return this.dispatch.move_selection({
        delta: { x: 0, y: KEYBOARD_MOVE_STEP }
      });
    }

    if ((event.ctrlKey || event.metaKey) && event.key === ']') {
      return this.dispatch.order_selection({
        action: 'bring_forward'
      });
    }

    if ((event.ctrlKey || event.metaKey) && event.key === '[') {
      return this.dispatch.order_selection({
        action: 'send_backward'
      });
    }

    return this.revision;
  }

  /**
   * Reserved clipboard reducer entrypoint for copy/paste command flows.
   */
  public handleClipboard(_event: BoardClipboardEvent): BoardRevision {
    return this.revision;
  }

  /**
   * Applies wheel-driven zoom interactions.
   */
  public handleWheel(event: BoardWheelEvent): BoardRevision {
    const zoomFactor = Math.exp(-event.deltaY * ZOOM_SENSITIVITY);
    return this.dispatch.zoom_viewport({
      zoom: this.state.viewport.zoom * zoomFactor,
      anchor: event.point
    });
  }

  /**
   * Registers a listener for committed engine updates.
   *
   * Returns an unsubscribe function that removes the listener.
   */
  public subscribe(
    listener: BoardEngineListener,
    options: {
      /** Emit the current revision immediately after subscription. */
      emitCurrent?: boolean;
    } = {}
  ): () => void {
    this.listeners.add(listener);

    if (options.emitCurrent) {
      listener({
        revision: this.revision,
        deltas: []
      });
    }

    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Applies a board command and records deltas/revision when state changes.
   */
  public execute(command: BoardCommand): BoardRevision {
    return this.commit((state, deltas) => {
      const handler = this.commandHandlers[command.type] as CommandHandler<CommandType>;
      handler(state, deltas, command as Extract<BoardCommand, { type: CommandType }>);
    });
  }

  /** Builds the strict `dispatch.<type>(payload)` proxy. */
  private createDispatchProxy(): BoardEngineDispatchProxy {
    return new Proxy({} as BoardEngineDispatchProxy, {
      get: (_target, property) => {
        if (typeof property !== 'string' || !(property in this.commandHandlers)) {
          throw new Error(`Unknown board command "${String(property)}"`);
        }

        const commandType = property as CommandType;
        return (payload?: unknown) => {
          const command = {
            type: commandType,
            ...((payload ?? {}) as object)
          } as Extract<BoardCommand, { type: CommandType }>;
          return this.execute(command);
        };
      }
    });
  }

  /** Builds the board command dispatch table. */
  private createCommandHandlers(): CommandHandlerMap {
    return {
      set_elements: (state, deltas, command) =>
        this.handleSetElementsCommand(state, deltas, command),
      add_element: (state, deltas, command) => this.handleAddElementCommand(state, deltas, command),
      remove_elements: (state, deltas, command) =>
        this.handleRemoveElementsCommand(state, deltas, command),
      select: (state, deltas, command) => this.handleSelectCommand(state, deltas, command),
      clear_selection: (state, deltas) => this.handleClearSelectionCommand(state, deltas),
      move_selection: (state, deltas, command) =>
        this.handleMoveSelectionCommand(state, deltas, command),
      move_elements: (state, deltas, command) =>
        this.handleMoveElementsCommand(state, deltas, command),
      set_viewport: (state, deltas, command) =>
        this.handleSetViewportCommand(state, deltas, command),
      pan_viewport: (state, deltas, command) =>
        this.handlePanViewportCommand(state, deltas, command),
      zoom_viewport: (state, deltas, command) =>
        this.handleZoomViewportCommand(state, deltas, command),
      order_selection: (state, deltas, command) =>
        this.handleOrderSelectionCommand(state, deltas, command)
    };
  }

  private handleSetElementsCommand(
    state: BoardState,
    deltas: BoardDelta[],
    command: Extract<BoardCommand, { type: 'set_elements' }>
  ) {
    command.elements.forEach((element) => {
      this.elementRegistry.assertKnownKind(element.kind);
    });
    const next = createElementState(command.elements, this.elementRegistry);
    const previousState = cloneState(state);
    state.elements = next.elements;
    state.elementOrder = next.elementOrder;
    state.selection = normalizeElementIds(state.selection, state);

    previousState.elementOrder.forEach((id, index) => {
      const previous = previousState.elements[id];
      if (!next.elements[id]) {
        deltas.push({
          type: 'element_removed',
          element: previous,
          index
        });
      }
    });

    state.elementOrder.forEach((id, index) => {
      const current = state.elements[id];
      const previous = previousState.elements[id];
      if (!previous) {
        deltas.push({
          type: 'element_added',
          element: cloneElement(current),
          index
        });
        return;
      }

      if (
        previous.x !== current.x ||
        previous.y !== current.y ||
        previous.width !== current.width ||
        previous.height !== current.height ||
        JSON.stringify(previous) !== JSON.stringify(current)
      ) {
        deltas.push({
          type: 'element_updated',
          id,
          previous,
          current: cloneElement(current),
          previousIndex: previousState.elementOrder.indexOf(id),
          currentIndex: index
        });
      } else if (previousState.elementOrder.indexOf(id) !== index) {
        deltas.push({
          type: 'element_updated',
          id,
          previous,
          current: cloneElement(current),
          previousIndex: previousState.elementOrder.indexOf(id),
          currentIndex: index
        });
      }
    });

    if (!areStringListsEqual(previousState.selection, state.selection)) {
      deltas.push({
        type: 'selection_changed',
        previous: previousState.selection,
        current: [...state.selection]
      });
    }
  }

  private handleAddElementCommand(
    state: BoardState,
    deltas: BoardDelta[],
    command: Extract<BoardCommand, { type: 'add_element' }>
  ) {
    this.elementRegistry.assertKnownKind(command.element.kind);
    if (state.elements[command.element.id]) {
      return;
    }

    const index =
      typeof command.index === 'number'
        ? Math.max(0, Math.min(command.index, state.elementOrder.length))
        : state.elementOrder.length;

    state.elements[command.element.id] = cloneElement(command.element);
    state.elementOrder.splice(index, 0, command.element.id);

    deltas.push({
      type: 'element_added',
      element: cloneElement(command.element),
      index
    });
  }

  private handleRemoveElementsCommand(
    state: BoardState,
    deltas: BoardDelta[],
    command: Extract<BoardCommand, { type: 'remove_elements' }>
  ) {
    const ids = normalizeElementIds(command.ids, state);
    if (ids.length === 0) {
      return;
    }

    const selectedSet = new Set(state.selection);
    ids.forEach((id) => {
      const element = state.elements[id];
      if (!element) {
        return;
      }

      const index = state.elementOrder.indexOf(id);
      delete state.elements[id];
      if (index !== -1) {
        state.elementOrder.splice(index, 1);
      }

      deltas.push({
        type: 'element_removed',
        element: cloneElement(element),
        index
      });
      selectedSet.delete(id);
    });

    const nextSelection = normalizeElementIds(Array.from(selectedSet), state);
    if (!areStringListsEqual(state.selection, nextSelection)) {
      const previousSelection = [...state.selection];
      state.selection = nextSelection;
      deltas.push({
        type: 'selection_changed',
        previous: previousSelection,
        current: [...state.selection]
      });
    }
  }

  private handleSelectCommand(
    state: BoardState,
    deltas: BoardDelta[],
    command: Extract<BoardCommand, { type: 'select' }>
  ) {
    const previousSelection = [...state.selection];
    const sourceIds = normalizeElementIds(command.ids, state);
    const sourceSet = new Set(sourceIds);
    const currentSet = new Set(state.selection);
    let nextSelection: string[] = [];
    const mode = command.mode ?? 'replace';

    if (mode === 'replace') {
      nextSelection = sourceIds;
    } else if (mode === 'add') {
      nextSelection = normalizeElementIds([...state.selection, ...sourceIds], state);
    } else if (mode === 'remove') {
      nextSelection = state.selection.filter((id) => !sourceSet.has(id));
    } else {
      nextSelection = normalizeElementIds(
        [
          ...state.selection.filter((id) => !sourceSet.has(id)),
          ...sourceIds.filter((id) => !currentSet.has(id))
        ],
        state
      );
    }

    if (areStringListsEqual(previousSelection, nextSelection)) {
      return;
    }

    state.selection = nextSelection;
    deltas.push({
      type: 'selection_changed',
      previous: previousSelection,
      current: [...state.selection]
    });
  }

  private handleClearSelectionCommand(state: BoardState, deltas: BoardDelta[]) {
    if (state.selection.length === 0) {
      return;
    }

    const previousSelection = [...state.selection];
    state.selection = [];
    deltas.push({
      type: 'selection_changed',
      previous: previousSelection,
      current: []
    });
  }

  private handleMoveSelectionCommand(
    state: BoardState,
    deltas: BoardDelta[],
    command: Extract<BoardCommand, { type: 'move_selection' }>
  ) {
    if (command.delta.x === 0 && command.delta.y === 0) {
      return;
    }

    normalizeElementIds(state.selection, state).forEach((id) => {
      const previous = cloneElement(state.elements[id]);
      const current = this.elementRegistry.reduce(state.elements[id], {
        type: 'translate',
        delta: command.delta
      });
      state.elements[id] = current;
      deltas.push({
        type: 'element_updated',
        id,
        previous,
        current: cloneElement(current)
      });
    });
  }

  private handleMoveElementsCommand(
    state: BoardState,
    deltas: BoardDelta[],
    command: Extract<BoardCommand, { type: 'move_elements' }>
  ) {
    if (command.delta.x === 0 && command.delta.y === 0) {
      return;
    }

    normalizeElementIds(command.ids, state).forEach((id) => {
      const previous = cloneElement(state.elements[id]);
      const current = this.elementRegistry.reduce(state.elements[id], {
        type: 'translate',
        delta: command.delta
      });
      state.elements[id] = current;
      deltas.push({
        type: 'element_updated',
        id,
        previous,
        current: cloneElement(current)
      });
    });
  }

  private handleSetViewportCommand(
    state: BoardState,
    deltas: BoardDelta[],
    command: Extract<BoardCommand, { type: 'set_viewport' }>
  ) {
    const previousViewport = { ...state.viewport };
    const nextZoom =
      typeof command.zoom === 'number' ? clampZoom(command.zoom) : state.viewport.zoom;
    state.viewport = {
      panX: command.panX,
      panY: command.panY,
      zoom: nextZoom
    };

    if (
      previousViewport.panX !== state.viewport.panX ||
      previousViewport.panY !== state.viewport.panY ||
      previousViewport.zoom !== state.viewport.zoom
    ) {
      deltas.push({
        type: 'viewport_changed',
        previous: previousViewport,
        current: { ...state.viewport }
      });
    }
  }

  private handlePanViewportCommand(
    state: BoardState,
    deltas: BoardDelta[],
    command: Extract<BoardCommand, { type: 'pan_viewport' }>
  ) {
    if (command.delta.x === 0 && command.delta.y === 0) {
      return;
    }

    const previousViewport = { ...state.viewport };
    state.viewport = {
      ...state.viewport,
      panX: state.viewport.panX + command.delta.x,
      panY: state.viewport.panY + command.delta.y
    };
    deltas.push({
      type: 'viewport_changed',
      previous: previousViewport,
      current: { ...state.viewport }
    });
  }

  private handleZoomViewportCommand(
    state: BoardState,
    deltas: BoardDelta[],
    command: Extract<BoardCommand, { type: 'zoom_viewport' }>
  ) {
    const nextZoom = clampZoom(command.zoom);
    if (nextZoom === state.viewport.zoom) {
      return;
    }

    const previousViewport = { ...state.viewport };
    let nextPanX = state.viewport.panX;
    let nextPanY = state.viewport.panY;

    if (command.anchor) {
      const worldX = command.anchor.x / state.viewport.zoom - state.viewport.panX;
      const worldY = command.anchor.y / state.viewport.zoom - state.viewport.panY;
      nextPanX = command.anchor.x / nextZoom - worldX;
      nextPanY = command.anchor.y / nextZoom - worldY;
    }

    state.viewport = {
      panX: nextPanX,
      panY: nextPanY,
      zoom: nextZoom
    };
    deltas.push({
      type: 'viewport_changed',
      previous: previousViewport,
      current: { ...state.viewport }
    });
  }

  private handleOrderSelectionCommand(
    state: BoardState,
    deltas: BoardDelta[],
    command: Extract<BoardCommand, { type: 'order_selection' }>
  ) {
    const selectedIds = normalizeElementIds(state.selection, state);
    const previousOrder = [...state.elementOrder];
    const nextOrder = applyOrdering(state.elementOrder, selectedIds, command.action);
    if (areStringListsEqual(previousOrder, nextOrder)) {
      return;
    }

    state.elementOrder = nextOrder;
    nextOrder.forEach((id, index) => {
      const previousIndex = previousOrder.indexOf(id);
      if (previousIndex === index) {
        return;
      }

      const element = state.elements[id];
      deltas.push({
        type: 'element_updated',
        id,
        previous: cloneElement(element),
        current: cloneElement(element),
        previousIndex,
        currentIndex: index
      });
    });
  }

  /**
   * Returns current board state snapshot.
   */
  public getState(): Readonly<BoardState> {
    return this.state;
  }

  /**
   * Returns current engine revision.
   */
  public getRevision(): BoardRevision {
    return this.revision;
  }

  /**
   * Returns all committed deltas after the provided revision.
   */
  public getDeltasSince(revision: BoardRevision): BoardDeltaBatch {
    return {
      since: revision,
      current: this.revision,
      batches: this.deltaHistory.filter((entry) => entry.revision > revision)
    };
  }

  /**
   * Runs a mutation transaction and commits revision/deltas atomically.
   */
  private commit(mutate: MutateState): BoardRevision {
    const nextState = cloneState(this.state);
    const deltas: BoardDelta[] = [];
    mutate(nextState, deltas);

    if (deltas.length === 0) {
      return this.revision;
    }

    this.revision += 1;
    this.state = nextState;
    const envelope: BoardDeltaEnvelope = {
      revision: this.revision,
      deltas
    };
    this.deltaHistory.push(envelope);
    this.notifyListeners(envelope);

    return this.revision;
  }

  /** Notifies subscribers after a revision commit. */
  private notifyListeners(envelope: BoardDeltaEnvelope) {
    this.listeners.forEach((listener) => {
      listener({
        revision: envelope.revision,
        deltas: envelope.deltas
      });
    });
  }
}

function stateIsDraggingSelection(state: BoardState): state is BoardState & {
  interaction: Extract<BoardState['interaction'], { mode: 'dragging_selection' }>;
} {
  return state.interaction.mode === 'dragging_selection';
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest;

  const testElements: BoardElement[] = [
    {
      id: 'note-1',
      kind: 'note',
      x: 10,
      y: 20,
      width: 100,
      height: 80,
      text: 'Hello'
    },
    {
      id: 'image-1',
      kind: 'image',
      x: 220,
      y: 120,
      width: 200,
      height: 160,
      src: '/img.png',
      alt: 'img'
    }
  ];

  describe('BoardEngine', () => {
    it('initializes with revision 0 and deterministic state', () => {
      const engine = new BoardEngine({
        initialElements: testElements
      });

      expect(engine.getRevision()).toBe(0);
      expect(engine.getState().elementOrder).toEqual(['note-1', 'image-1']);
      expect(engine.getState().selection).toEqual([]);
    });

    it('selects and moves elements via commands with emitted deltas', () => {
      const engine = new BoardEngine({
        initialElements: testElements
      });

      const revision1 = engine.dispatch.select({
        ids: ['note-1']
      });
      const revision2 = engine.dispatch.move_selection({
        delta: { x: 15, y: -5 }
      });

      expect(revision1).toBe(1);
      expect(revision2).toBe(2);
      expect(engine.getState().elements['note-1'].x).toBe(25);
      expect(engine.getState().elements['note-1'].y).toBe(15);

      const deltas = engine.getDeltasSince(0);
      expect(deltas.batches).toHaveLength(2);
      expect(deltas.batches[0].deltas[0]?.type).toBe('selection_changed');
      expect(deltas.batches[1].deltas[0]?.type).toBe('element_updated');
    });

    it('handles pointer drag lifecycle and updates interaction state', () => {
      const engine = new BoardEngine({
        initialElements: testElements
      });

      engine.handlePointer({
        type: 'pointer',
        phase: 'down',
        point: { x: 10, y: 20 },
        button: 0,
        buttons: 1,
        pointerId: 5,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        targetElementId: 'note-1'
      });
      engine.handlePointer({
        type: 'pointer',
        phase: 'move',
        point: { x: 30, y: 45 },
        button: 0,
        buttons: 1,
        pointerId: 5,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false
      });
      engine.handlePointer({
        type: 'pointer',
        phase: 'up',
        point: { x: 30, y: 45 },
        button: 0,
        buttons: 0,
        pointerId: 5,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false
      });

      expect(engine.getState().elements['note-1'].x).toBe(30);
      expect(engine.getState().elements['note-1'].y).toBe(45);
      expect(engine.getState().interaction.mode).toBe('idle');
      expect(engine.getRevision()).toBe(3);
    });

    it('updates viewport from wheel and pan commands with deltas', () => {
      const engine = new BoardEngine({
        initialElements: testElements
      });

      engine.handleWheel({
        type: 'wheel',
        point: { x: 100, y: 100 },
        deltaX: 0,
        deltaY: -120
      });
      engine.dispatch.pan_viewport({
        delta: { x: 20, y: -10 }
      });

      expect(engine.getState().viewport.zoom).toBeGreaterThan(1);
      expect(engine.getState().viewport.panX).not.toBe(0);
      expect(engine.getState().viewport.panY).not.toBe(0);

      const viewportDeltaCount = engine
        .getDeltasSince(0)
        .batches.flatMap((batch) => batch.deltas)
        .filter((delta) => delta.type === 'viewport_changed').length;
      expect(viewportDeltaCount).toBe(2);
    });

    it('applies ordering reducers and records index movement', () => {
      const engine = new BoardEngine({
        initialElements: testElements
      });

      engine.dispatch.select({
        ids: ['note-1']
      });
      engine.dispatch.order_selection({
        action: 'bring_to_front'
      });

      expect(engine.getState().elementOrder).toEqual(['image-1', 'note-1']);
      const lastBatch = engine.getDeltasSince(1).batches.at(-1);
      expect(lastBatch?.deltas.some((delta) => delta.type === 'element_updated')).toBe(true);
    });

    it('deletes selected elements via keyboard reducer', () => {
      const engine = new BoardEngine({
        initialElements: testElements
      });

      engine.dispatch.select({
        ids: ['note-1']
      });
      engine.handleKeyboard({
        type: 'keyboard',
        phase: 'down',
        key: 'Delete',
        code: 'Delete',
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false
      });

      expect(engine.getState().elements['note-1']).toBeUndefined();
      expect(engine.getState().selection).toEqual([]);
    });

    it('rejects unknown kinds during initialization', () => {
      expect(() => {
        return new BoardEngine({
          initialElements: [
            {
              id: 'unknown-1',
              kind: 'sticker',
              x: 0,
              y: 0,
              width: 10,
              height: 10
            } as unknown as BoardElement
          ]
        });
      }).toThrow('Unknown board element kind "sticker"');
    });

    it('rejects unknown kinds during add command', () => {
      const engine = new BoardEngine({
        initialElements: testElements
      });

      expect(() => {
        engine.dispatch.add_element({
          element: {
            id: 'unknown-1',
            kind: 'sticker',
            x: 0,
            y: 0,
            width: 10,
            height: 10
          } as unknown as BoardElement
        });
      }).toThrow('Unknown board element kind "sticker"');
    });
  });
}
