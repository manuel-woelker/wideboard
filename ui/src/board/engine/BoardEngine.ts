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
import { createBoardEngineTestHarness } from './boardEngineTestHarness';
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
type HistoryPolicy = 'plain' | 'coalescing' | 'none';
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
interface BoardHistoryEntry {
  forward: BoardDelta[];
  backward: BoardDelta[];
  meta: {
    kind: 'user' | 'synthetic';
    groupId?: string;
  };
}

interface CommitOptions {
  historyPolicy?: HistoryPolicy;
}

function cloneDelta(delta: BoardDelta): BoardDelta {
  switch (delta.type) {
    case 'element_added':
      return {
        type: 'element_added',
        element: cloneElement(delta.element),
        index: delta.index
      };
    case 'element_removed':
      return {
        type: 'element_removed',
        element: cloneElement(delta.element),
        index: delta.index
      };
    case 'element_updated':
      return {
        type: 'element_updated',
        id: delta.id,
        previous: cloneElement(delta.previous),
        current: cloneElement(delta.current),
        previousIndex: delta.previousIndex,
        currentIndex: delta.currentIndex
      };
    case 'selection_changed':
      return {
        type: 'selection_changed',
        previous: [...delta.previous],
        current: [...delta.current]
      };
    case 'viewport_changed':
      return {
        type: 'viewport_changed',
        previous: { ...delta.previous },
        current: { ...delta.current }
      };
    default:
      return {
        type: 'interaction_changed',
        previous: { ...delta.previous },
        current: { ...delta.current }
      };
  }
}

function cloneDeltas(deltas: BoardDelta[]): BoardDelta[] {
  return deltas.map((delta) => cloneDelta(delta));
}

function invertDelta(delta: BoardDelta): BoardDelta {
  switch (delta.type) {
    case 'element_added':
      return {
        type: 'element_removed',
        element: cloneElement(delta.element),
        index: delta.index
      };
    case 'element_removed':
      return {
        type: 'element_added',
        element: cloneElement(delta.element),
        index: delta.index
      };
    case 'element_updated':
      return {
        type: 'element_updated',
        id: delta.id,
        previous: cloneElement(delta.current),
        current: cloneElement(delta.previous),
        previousIndex: delta.currentIndex,
        currentIndex: delta.previousIndex
      };
    case 'selection_changed':
      return {
        type: 'selection_changed',
        previous: [...delta.current],
        current: [...delta.previous]
      };
    case 'viewport_changed':
      return {
        type: 'viewport_changed',
        previous: { ...delta.current },
        current: { ...delta.previous }
      };
    default:
      return {
        type: 'interaction_changed',
        previous: { ...delta.current },
        current: { ...delta.previous }
      };
  }
}

function invertDeltas(deltas: BoardDelta[]): BoardDelta[] {
  return [...deltas].reverse().map((delta) => invertDelta(delta));
}

function isDurableHistoryDelta(delta: BoardDelta) {
  return delta.type !== 'interaction_changed';
}

function normalizeInsertionIndex(index: number, length: number) {
  return Math.max(0, Math.min(index, length));
}

function isPureTranslationElementUpdate(delta: BoardDelta) {
  if (delta.type !== 'element_updated') {
    return false;
  }

  if (typeof delta.previousIndex === 'number' || typeof delta.currentIndex === 'number') {
    return false;
  }

  const { x: previousX, y: previousY, ...previousRest } = delta.previous;
  const { x: currentX, y: currentY, ...currentRest } = delta.current;
  if (previousX === currentX && previousY === currentY) {
    return false;
  }

  return JSON.stringify(previousRest) === JSON.stringify(currentRest);
}

function getTranslationDeltaSignature(deltas: BoardDelta[]) {
  if (deltas.length === 0 || !deltas.every((delta) => isPureTranslationElementUpdate(delta))) {
    return null;
  }

  const ids = deltas.map((delta) => (delta.type === 'element_updated' ? delta.id : ''));
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) {
    return null;
  }

  return [...ids].sort().join('|');
}

function isPureNoteTextUpdate(delta: BoardDelta) {
  if (delta.type !== 'element_updated') {
    return false;
  }

  if (delta.previous.kind !== 'note' || delta.current.kind !== 'note') {
    return false;
  }

  if (
    typeof delta.previousIndex === 'number' &&
    typeof delta.currentIndex === 'number' &&
    delta.previousIndex !== delta.currentIndex
  ) {
    return false;
  }

  return (
    delta.previous.id === delta.current.id &&
    delta.previous.x === delta.current.x &&
    delta.previous.y === delta.current.y &&
    delta.previous.width === delta.current.width &&
    delta.previous.height === delta.current.height &&
    delta.previous.text !== delta.current.text
  );
}

function getNoteTextDeltaSignature(deltas: BoardDelta[]) {
  if (deltas.length === 0 || !deltas.every((delta) => isPureNoteTextUpdate(delta))) {
    return null;
  }

  const ids = deltas.map((delta) => (delta.type === 'element_updated' ? delta.id : ''));
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) {
    return null;
  }

  return [...ids].sort().join('|');
}

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
  /** Linear undo/redo history of durable board mutations. */
  private readonly history: BoardHistoryEntry[] = [];
  /** Points at the currently applied history entry; -1 means no entries applied. */
  private historyCursor = -1;
  /** Monotonic synthetic group identifier sequence. */
  private syntheticHistoryGroupSequence = 0;
  /** Subscribers notified after each committed revision. */
  private readonly listeners = new Set<BoardEngineListener>();
  /** Command dispatch table mapped by command type. */
  private readonly commandHandlers: CommandHandlerMap;
  /** Strict dispatch object for ergonomic command invocation. */
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
      return this.commit(
        (state, deltas) => {
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
        },
        {
          historyPolicy: 'none'
        }
      );
    }

    if (
      event.phase === 'move' &&
      stateIsDraggingSelection(this.state) &&
      (this.state.interaction.pointerId === null ||
        event.pointerId === this.state.interaction.pointerId)
    ) {
      return this.commit(
        (state, deltas) => {
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
        },
        {
          historyPolicy: 'coalescing'
        }
      );
    }

    if (
      (event.phase === 'up' || event.phase === 'cancel') &&
      stateIsDraggingSelection(this.state) &&
      (this.state.interaction.pointerId === null ||
        event.pointerId === this.state.interaction.pointerId)
    ) {
      return this.commit(
        (state, deltas) => {
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
        },
        {
          historyPolicy: 'none'
        }
      );
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

    const isAccelerator = event.ctrlKey || event.metaKey;
    const normalizedKey = event.key.toLowerCase();
    if (isAccelerator && !event.shiftKey && normalizedKey === 'z') {
      return this.undo();
    }

    if (isAccelerator && (normalizedKey === 'y' || (event.shiftKey && normalizedKey === 'z'))) {
      return this.redo();
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      return this.dispatch.removeElements({
        ids: this.state.selection
      });
    }

    if (event.key === 'ArrowLeft') {
      return this.dispatch.moveSelection({
        delta: { x: -KEYBOARD_MOVE_STEP, y: 0 }
      });
    }

    if (event.key === 'ArrowRight') {
      return this.dispatch.moveSelection({
        delta: { x: KEYBOARD_MOVE_STEP, y: 0 }
      });
    }

    if (event.key === 'ArrowUp') {
      return this.dispatch.moveSelection({
        delta: { x: 0, y: -KEYBOARD_MOVE_STEP }
      });
    }

    if (event.key === 'ArrowDown') {
      return this.dispatch.moveSelection({
        delta: { x: 0, y: KEYBOARD_MOVE_STEP }
      });
    }

    if ((event.ctrlKey || event.metaKey) && event.key === ']') {
      return this.dispatch.orderSelection({
        action: 'bring_forward'
      });
    }

    if ((event.ctrlKey || event.metaKey) && event.key === '[') {
      return this.dispatch.orderSelection({
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
    return this.dispatch.zoomViewport({
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
    return this.commit(
      (state, deltas) => {
        const handler = this.commandHandlers[command.type] as CommandHandler<CommandType>;
        handler(state, deltas, command as Extract<BoardCommand, { type: CommandType }>);
      },
      {
        historyPolicy: this.getCommandHistoryPolicy(command)
      }
    );
  }

  /** Builds the strict `dispatch.<type>(payload)` plain function object. */
  private createDispatchProxy(): BoardEngineDispatchProxy {
    const commandTypes = Object.keys(this.commandHandlers) as CommandType[];
    return Object.fromEntries(
      commandTypes.map((commandType) => {
        return [commandType, this.createDispatchMethod(commandType)];
      })
    ) as BoardEngineDispatchProxy;
  }

  private createDispatchMethod<TType extends CommandType>(
    commandType: TType
  ): DispatchMethod<TType> {
    return ((payload?: CommandPayload<TType>) => {
      const command = {
        type: commandType,
        ...((payload ?? {}) as object)
      } as Extract<BoardCommand, { type: TType }>;
      return this.execute(command);
    }) as DispatchMethod<TType>;
  }

  private getCommandHistoryPolicy(command: BoardCommand): HistoryPolicy {
    if (
      command.type === 'select' ||
      command.type === 'clearSelection' ||
      command.type === 'setViewport' ||
      command.type === 'panViewport' ||
      command.type === 'zoomViewport'
    ) {
      return 'none';
    }

    if (
      command.type === 'moveSelection' ||
      command.type === 'moveElements' ||
      command.type === 'setElements'
    ) {
      return 'coalescing';
    }

    return 'plain';
  }

  /** Builds the board command dispatch table. */
  private createCommandHandlers(): CommandHandlerMap {
    return {
      setElements: (state, deltas, command) =>
        this.handleSetElementsCommand(state, deltas, command),
      addElement: (state, deltas, command) => this.handleAddElementCommand(state, deltas, command),
      removeElements: (state, deltas, command) =>
        this.handleRemoveElementsCommand(state, deltas, command),
      select: (state, deltas, command) => this.handleSelectCommand(state, deltas, command),
      clearSelection: (state, deltas) => this.handleClearSelectionCommand(state, deltas),
      moveSelection: (state, deltas, command) =>
        this.handleMoveSelectionCommand(state, deltas, command),
      moveElements: (state, deltas, command) =>
        this.handleMoveElementsCommand(state, deltas, command),
      setViewport: (state, deltas, command) =>
        this.handleSetViewportCommand(state, deltas, command),
      panViewport: (state, deltas, command) =>
        this.handlePanViewportCommand(state, deltas, command),
      zoomViewport: (state, deltas, command) =>
        this.handleZoomViewportCommand(state, deltas, command),
      orderSelection: (state, deltas, command) =>
        this.handleOrderSelectionCommand(state, deltas, command)
    };
  }

  private handleSetElementsCommand(
    state: BoardState,
    deltas: BoardDelta[],
    command: Extract<BoardCommand, { type: 'setElements' }>
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
    command: Extract<BoardCommand, { type: 'addElement' }>
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
    command: Extract<BoardCommand, { type: 'removeElements' }>
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
    command: Extract<BoardCommand, { type: 'moveSelection' }>
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
    command: Extract<BoardCommand, { type: 'moveElements' }>
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
    command: Extract<BoardCommand, { type: 'setViewport' }>
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
    command: Extract<BoardCommand, { type: 'panViewport' }>
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
    command: Extract<BoardCommand, { type: 'zoomViewport' }>
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
    command: Extract<BoardCommand, { type: 'orderSelection' }>
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
   * Indicates whether a previous durable state is available.
   */
  public canUndo() {
    return this.historyCursor >= 0;
  }

  /**
   * Indicates whether a newer durable state is available.
   */
  public canRedo() {
    return this.historyCursor < this.history.length - 1;
  }

  /**
   * Reverts one durable history entry.
   */
  public undo(): BoardRevision {
    if (!this.canUndo()) {
      return this.revision;
    }

    const entry = this.history[this.historyCursor];
    const nextCursor = this.historyCursor - 1;
    return this.applyHistoryDeltas(entry.backward, nextCursor);
  }

  /**
   * Reapplies one durable history entry.
   */
  public redo(): BoardRevision {
    if (!this.canRedo()) {
      return this.revision;
    }

    const nextCursor = this.historyCursor + 1;
    const entry = this.history[nextCursor];
    return this.applyHistoryDeltas(entry.forward, nextCursor);
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
  private commit(mutate: MutateState, options: CommitOptions = {}): BoardRevision {
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
      deltas: cloneDeltas(deltas)
    };
    this.deltaHistory.push(envelope);
    this.recordHistoryFromCommit(deltas, options.historyPolicy ?? 'plain');
    this.notifyListeners(envelope);

    return this.revision;
  }

  private recordHistoryFromCommit(deltas: BoardDelta[], historyPolicy: HistoryPolicy) {
    if (historyPolicy === 'none') {
      return;
    }

    const durableDeltas = deltas.filter((delta) => isDurableHistoryDelta(delta));
    if (durableDeltas.length === 0) {
      return;
    }

    this.linearizeRedoTailIfNeeded();
    const nextEntry: BoardHistoryEntry = {
      forward: cloneDeltas(durableDeltas),
      backward: invertDeltas(durableDeltas),
      meta: {
        kind: 'user'
      }
    };
    if (historyPolicy === 'coalescing') {
      const previousEntry = this.history[this.history.length - 1];
      if (previousEntry && previousEntry.meta.kind === 'user') {
        const coalesced =
          this.tryCoalesceConsecutiveMoveEntries(previousEntry, nextEntry) ??
          this.tryCoalesceConsecutiveNoteTextEntries(previousEntry, nextEntry);
        if (coalesced) {
          this.history[this.history.length - 1] = coalesced;
          this.historyCursor = this.history.length - 1;
          return;
        }
      }
    }

    this.history.push(nextEntry);
    this.historyCursor = this.history.length - 1;
  }

  private tryCoalesceConsecutiveMoveEntries(
    previousEntry: BoardHistoryEntry,
    nextEntry: BoardHistoryEntry
  ): BoardHistoryEntry | null {
    const previousSignature = getTranslationDeltaSignature(previousEntry.forward);
    const nextSignature = getTranslationDeltaSignature(nextEntry.forward);
    if (!previousSignature || !nextSignature || previousSignature !== nextSignature) {
      return null;
    }

    const previousById = new Map<string, Extract<BoardDelta, { type: 'element_updated' }>>();
    previousEntry.forward.forEach((delta) => {
      if (delta.type === 'element_updated') {
        previousById.set(delta.id, delta);
      }
    });

    const nextById = new Map<string, Extract<BoardDelta, { type: 'element_updated' }>>();
    nextEntry.forward.forEach((delta) => {
      if (delta.type === 'element_updated') {
        nextById.set(delta.id, delta);
      }
    });

    const mergedForward: BoardDelta[] = [];
    for (const [id, previous] of previousById) {
      const next = nextById.get(id);
      if (!next) {
        return null;
      }

      mergedForward.push({
        type: 'element_updated',
        id,
        previous: cloneElement(previous.previous),
        current: cloneElement(next.current)
      });
    }

    return {
      forward: mergedForward,
      backward: invertDeltas(mergedForward),
      meta: {
        kind: 'user'
      }
    };
  }

  private tryCoalesceConsecutiveNoteTextEntries(
    previousEntry: BoardHistoryEntry,
    nextEntry: BoardHistoryEntry
  ): BoardHistoryEntry | null {
    const previousSignature = getNoteTextDeltaSignature(previousEntry.forward);
    const nextSignature = getNoteTextDeltaSignature(nextEntry.forward);
    if (!previousSignature || !nextSignature || previousSignature !== nextSignature) {
      return null;
    }

    const previousById = new Map<string, Extract<BoardDelta, { type: 'element_updated' }>>();
    previousEntry.forward.forEach((delta) => {
      if (delta.type === 'element_updated') {
        previousById.set(delta.id, delta);
      }
    });

    const nextById = new Map<string, Extract<BoardDelta, { type: 'element_updated' }>>();
    nextEntry.forward.forEach((delta) => {
      if (delta.type === 'element_updated') {
        nextById.set(delta.id, delta);
      }
    });

    const mergedForward: BoardDelta[] = [];
    for (const [id, previous] of previousById) {
      const next = nextById.get(id);
      if (!next) {
        return null;
      }

      mergedForward.push({
        type: 'element_updated',
        id,
        previous: cloneElement(previous.previous),
        current: cloneElement(next.current)
      });
    }

    return {
      forward: mergedForward,
      backward: invertDeltas(mergedForward),
      meta: {
        kind: 'user'
      }
    };
  }

  private linearizeRedoTailIfNeeded() {
    if (!this.canRedo()) {
      return;
    }

    const redoTail = this.history
      .slice(this.historyCursor + 1)
      .map((entry) => this.cloneHistoryEntry(entry));
    if (redoTail.length === 0) {
      return;
    }

    this.syntheticHistoryGroupSequence += 1;
    const groupId = `g-${this.syntheticHistoryGroupSequence}`;
    const linearized: BoardHistoryEntry[] = [...redoTail].reverse().map((entry) => ({
      forward: cloneDeltas(entry.backward),
      backward: cloneDeltas(entry.forward),
      meta: {
        kind: 'synthetic' as const,
        groupId
      }
    }));

    this.history.push(...linearized);
    this.historyCursor = this.history.length - 1;
  }

  private cloneHistoryEntry(entry: BoardHistoryEntry): BoardHistoryEntry {
    return {
      forward: cloneDeltas(entry.forward),
      backward: cloneDeltas(entry.backward),
      meta: {
        kind: entry.meta.kind,
        groupId: entry.meta.groupId
      }
    };
  }

  private applyHistoryDeltas(deltas: BoardDelta[], nextCursor: number): BoardRevision {
    if (deltas.length === 0) {
      this.historyCursor = nextCursor;
      return this.revision;
    }

    const nextState = cloneState(this.state);
    deltas.forEach((delta) => {
      this.applyDelta(nextState, delta);
    });

    this.revision += 1;
    this.state = nextState;
    this.historyCursor = nextCursor;
    const envelope: BoardDeltaEnvelope = {
      revision: this.revision,
      deltas: cloneDeltas(deltas)
    };
    this.deltaHistory.push(envelope);
    this.notifyListeners(envelope);
    return this.revision;
  }

  private applyDelta(state: BoardState, delta: BoardDelta) {
    if (delta.type === 'element_added') {
      this.elementRegistry.assertKnownKind(delta.element.kind);
      const id = delta.element.id;
      const existingIndex = state.elementOrder.indexOf(id);
      if (existingIndex !== -1) {
        state.elementOrder.splice(existingIndex, 1);
      }
      state.elements[id] = cloneElement(delta.element);
      state.elementOrder.splice(
        normalizeInsertionIndex(delta.index, state.elementOrder.length),
        0,
        id
      );
      return;
    }

    if (delta.type === 'element_removed') {
      const id = delta.element.id;
      delete state.elements[id];
      const index = state.elementOrder.indexOf(id);
      if (index !== -1) {
        state.elementOrder.splice(index, 1);
      }
      state.selection = state.selection.filter((selectionId) => selectionId !== id);
      return;
    }

    if (delta.type === 'element_updated') {
      const id = delta.id;
      this.elementRegistry.assertKnownKind(delta.current.kind);
      state.elements[id] = cloneElement(delta.current);
      if (typeof delta.currentIndex === 'number') {
        const existingIndex = state.elementOrder.indexOf(id);
        if (existingIndex !== -1) {
          state.elementOrder.splice(existingIndex, 1);
        }
        state.elementOrder.splice(
          normalizeInsertionIndex(delta.currentIndex, state.elementOrder.length),
          0,
          id
        );
      } else if (!state.elementOrder.includes(id)) {
        state.elementOrder.push(id);
      }
      return;
    }

    if (delta.type === 'selection_changed') {
      state.selection = normalizeElementIds(delta.current, state);
      return;
    }

    if (delta.type === 'viewport_changed') {
      state.viewport = {
        ...delta.current
      };
      return;
    }

    if (delta.current.mode === 'idle') {
      state.interaction = {
        mode: 'idle'
      };
    }
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
      createBoardEngineTestHarness({
        initialElements: testElements
      }).test({
        arrange: (engine) => {
          expect(engine.getRevision()).toBe(0);
          expect(engine.getState().elementOrder).toEqual(['note-1', 'image-1']);
          expect(engine.getState().selection).toEqual([]);
        },
        act: () => {},
        assert: {
          events: [],
          stateDiff: []
        }
      });
    });

    it('selects and moves elements via commands with emitted deltas', () => {
      const actual = createBoardEngineTestHarness({
        initialElements: testElements
      }).test({
        arrange: (engine) => {
          engine.dispatch.select({
            ids: ['note-1']
          });
        },
        act: (engine) => {
          engine.dispatch.moveSelection({
            delta: { x: 15, y: -5 }
          });
        },
        assert: {
          events: [
            {
              revision: 2,
              deltas: [
                {
                  type: 'element_updated',
                  id: 'note-1',
                  previous: {
                    id: 'note-1',
                    kind: 'note',
                    x: 10,
                    y: 20,
                    width: 100,
                    height: 80,
                    text: 'Hello'
                  },
                  current: {
                    id: 'note-1',
                    kind: 'note',
                    x: 25,
                    y: 15,
                    width: 100,
                    height: 80,
                    text: 'Hello'
                  }
                }
              ]
            }
          ],
          stateDiff: [
            {
              op: 'replace',
              path: '/elements/note-1/x',
              value: 25
            },
            {
              op: 'replace',
              path: '/elements/note-1/y',
              value: 15
            }
          ]
        }
      });

      expect(actual.events).toHaveLength(1);
    });

    it('handles pointer drag lifecycle and updates interaction state', () => {
      createBoardEngineTestHarness({
        initialElements: testElements
      }).test({
        arrange: (engine) => {
          engine.dispatch.select({
            ids: ['note-1']
          });
        },
        act: (engine) => {
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
        },
        assert: {
          events: [
            {
              revision: 2,
              deltas: [
                {
                  type: 'interaction_changed',
                  previous: {
                    mode: 'idle'
                  },
                  current: {
                    mode: 'dragging_selection'
                  }
                }
              ]
            },
            {
              revision: 3,
              deltas: [
                {
                  type: 'element_updated',
                  id: 'note-1',
                  previous: {
                    id: 'note-1',
                    kind: 'note',
                    x: 10,
                    y: 20,
                    width: 100,
                    height: 80,
                    text: 'Hello'
                  },
                  current: {
                    id: 'note-1',
                    kind: 'note',
                    x: 30,
                    y: 45,
                    width: 100,
                    height: 80,
                    text: 'Hello'
                  }
                }
              ]
            },
            {
              revision: 4,
              deltas: [
                {
                  type: 'interaction_changed',
                  previous: {
                    mode: 'dragging_selection'
                  },
                  current: {
                    mode: 'idle'
                  }
                }
              ]
            }
          ],
          stateDiff: [
            {
              op: 'replace',
              path: '/elements/note-1/x',
              value: 30
            },
            {
              op: 'replace',
              path: '/elements/note-1/y',
              value: 45
            }
          ]
        }
      });
    });

    it('updates viewport from wheel and pan commands with deltas', () => {
      const expectedZoom = Math.exp(0.18);
      const expectedPanAfterZoom = 100 / expectedZoom - 100;
      createBoardEngineTestHarness({
        initialElements: testElements
      }).test({
        arrange: () => {},
        act: (engine) => {
          engine.handleWheel({
            type: 'wheel',
            point: { x: 100, y: 100 },
            deltaX: 0,
            deltaY: -120
          });
          engine.dispatch.panViewport({
            delta: { x: 20, y: -10 }
          });
        },
        assert: {
          events: [
            {
              revision: 1,
              deltas: [
                {
                  type: 'viewport_changed',
                  previous: {
                    panX: 0,
                    panY: 0,
                    zoom: 1
                  },
                  current: {
                    panX: expectedPanAfterZoom,
                    panY: expectedPanAfterZoom,
                    zoom: expectedZoom
                  }
                }
              ]
            },
            {
              revision: 2,
              deltas: [
                {
                  type: 'viewport_changed',
                  previous: {
                    panX: expectedPanAfterZoom,
                    panY: expectedPanAfterZoom,
                    zoom: expectedZoom
                  },
                  current: {
                    panX: expectedPanAfterZoom + 20,
                    panY: expectedPanAfterZoom - 10,
                    zoom: expectedZoom
                  }
                }
              ]
            }
          ],
          stateDiff: [
            {
              op: 'replace',
              path: '/viewport/panX',
              value: expectedPanAfterZoom + 20
            },
            {
              op: 'replace',
              path: '/viewport/panY',
              value: expectedPanAfterZoom - 10
            },
            {
              op: 'replace',
              path: '/viewport/zoom',
              value: expectedZoom
            }
          ]
        }
      });
    });

    it('applies ordering reducers and records index movement', () => {
      createBoardEngineTestHarness({
        initialElements: testElements
      }).test({
        arrange: (engine) => {
          engine.dispatch.select({
            ids: ['note-1']
          });
        },
        act: (engine) => {
          engine.dispatch.orderSelection({
            action: 'bring_to_front'
          });
        },
        assert: {
          events: [
            {
              revision: 2,
              deltas: [
                {
                  type: 'element_updated',
                  id: 'image-1',
                  previous: {
                    id: 'image-1',
                    kind: 'image',
                    x: 220,
                    y: 120,
                    width: 200,
                    height: 160,
                    src: '/img.png',
                    alt: 'img'
                  },
                  current: {
                    id: 'image-1',
                    kind: 'image',
                    x: 220,
                    y: 120,
                    width: 200,
                    height: 160,
                    src: '/img.png',
                    alt: 'img'
                  },
                  previousIndex: 1,
                  currentIndex: 0
                },
                {
                  type: 'element_updated',
                  id: 'note-1',
                  previous: {
                    id: 'note-1',
                    kind: 'note',
                    x: 10,
                    y: 20,
                    width: 100,
                    height: 80,
                    text: 'Hello'
                  },
                  current: {
                    id: 'note-1',
                    kind: 'note',
                    x: 10,
                    y: 20,
                    width: 100,
                    height: 80,
                    text: 'Hello'
                  },
                  previousIndex: 0,
                  currentIndex: 1
                }
              ]
            }
          ],
          stateDiff: [
            {
              op: 'replace',
              path: '/elementOrder/0',
              value: 'image-1'
            },
            {
              op: 'replace',
              path: '/elementOrder/1',
              value: 'note-1'
            }
          ]
        }
      });
    });

    it('deletes selected elements via keyboard reducer', () => {
      createBoardEngineTestHarness({
        initialElements: testElements
      }).test({
        arrange: (engine) => {
          engine.dispatch.select({
            ids: ['note-1']
          });
        },
        act: (engine) => {
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
        },
        assert: {
          events: [
            {
              revision: 2,
              deltas: [
                {
                  type: 'element_removed',
                  element: {
                    id: 'note-1',
                    kind: 'note',
                    x: 10,
                    y: 20,
                    width: 100,
                    height: 80,
                    text: 'Hello'
                  },
                  index: 0
                },
                {
                  type: 'selection_changed',
                  previous: ['note-1'],
                  current: []
                }
              ]
            }
          ],
          stateDiff: [
            {
              op: 'replace',
              path: '/elementOrder/0',
              value: 'image-1'
            },
            {
              op: 'remove',
              path: '/elementOrder/1'
            },
            {
              op: 'remove',
              path: '/elements/note-1'
            },
            {
              op: 'remove',
              path: '/selection/0'
            }
          ]
        }
      });
    });

    it('undoes and redoes durable mutations', () => {
      const engine = new BoardEngine({
        initialElements: testElements
      });

      engine.dispatch.select({
        ids: ['note-1']
      });
      engine.dispatch.moveSelection({
        delta: { x: 15, y: -5 }
      });

      expect(engine.getState().elements['note-1'].x).toBe(25);
      expect(engine.getState().elements['note-1'].y).toBe(15);
      expect(engine.canUndo()).toBe(true);
      expect(engine.canRedo()).toBe(false);

      engine.undo();
      expect(engine.getState().elements['note-1'].x).toBe(10);
      expect(engine.getState().elements['note-1'].y).toBe(20);
      expect(engine.canRedo()).toBe(true);

      engine.redo();
      expect(engine.getState().elements['note-1'].x).toBe(25);
      expect(engine.getState().elements['note-1'].y).toBe(15);
    });

    it('coalesces consecutive move commits into one undo step', () => {
      const engine = new BoardEngine({
        initialElements: testElements
      });

      engine.dispatch.select({
        ids: ['note-1']
      });
      engine.dispatch.moveSelection({
        delta: { x: 10, y: 0 }
      });
      engine.dispatch.moveSelection({
        delta: { x: 5, y: 0 }
      });
      expect(engine.getState().elements['note-1'].x).toBe(25);

      engine.undo();
      expect(engine.getState().elements['note-1'].x).toBe(10);

      engine.redo();
      expect(engine.getState().elements['note-1'].x).toBe(25);
    });

    it('coalesces consecutive note text commits into one undo step', () => {
      const engine = new BoardEngine({
        initialElements: testElements
      });

      const firstPass = engine.getState().elementOrder.map((id) => {
        const element = engine.getState().elements[id];
        if (element.id !== 'note-1' || element.kind !== 'note') {
          return element;
        }
        return {
          ...element,
          text: 'Hello!'
        };
      });
      engine.dispatch.setElements({
        elements: firstPass
      });

      const secondPass = engine.getState().elementOrder.map((id) => {
        const element = engine.getState().elements[id];
        if (element.id !== 'note-1' || element.kind !== 'note') {
          return element;
        }
        return {
          ...element,
          text: 'Hello!!'
        };
      });
      engine.dispatch.setElements({
        elements: secondPass
      });
      expect(engine.getState().elements['note-1']).toMatchObject({
        kind: 'note',
        text: 'Hello!!'
      });

      engine.undo();
      expect(engine.getState().elements['note-1']).toMatchObject({
        kind: 'note',
        text: 'Hello'
      });

      engine.redo();
      expect(engine.getState().elements['note-1']).toMatchObject({
        kind: 'note',
        text: 'Hello!!'
      });
    });

    it('preserves undone future states after branching edits', () => {
      const engine = new BoardEngine({
        initialElements: testElements
      });

      engine.dispatch.select({
        ids: ['note-1']
      });
      engine.dispatch.moveSelection({
        delta: { x: 10, y: 0 }
      });
      engine.dispatch.moveSelection({
        delta: { x: 10, y: 0 }
      });
      expect(engine.getState().elements['note-1'].x).toBe(30);

      engine.undo();
      expect(engine.getState().elements['note-1'].x).toBe(10);

      engine.dispatch.moveSelection({
        delta: { x: 5, y: 0 }
      });
      expect(engine.getState().elements['note-1'].x).toBe(15);

      engine.undo();
      expect(engine.getState().elements['note-1'].x).toBe(10);

      engine.undo();
      expect(engine.getState().elements['note-1'].x).toBe(30);

      engine.undo();
      expect(engine.getState().elements['note-1'].x).toBe(10);
    });

    it('handles keyboard undo and redo accelerators', () => {
      const engine = new BoardEngine({
        initialElements: testElements
      });

      engine.dispatch.select({
        ids: ['note-1']
      });
      engine.dispatch.moveSelection({
        delta: { x: 10, y: 0 }
      });

      engine.handleKeyboard({
        type: 'keyboard',
        phase: 'down',
        key: 'z',
        code: 'KeyZ',
        shiftKey: false,
        altKey: false,
        ctrlKey: true,
        metaKey: false
      });
      expect(engine.getState().elements['note-1'].x).toBe(10);

      engine.handleKeyboard({
        type: 'keyboard',
        phase: 'down',
        key: 'y',
        code: 'KeyY',
        shiftKey: false,
        altKey: false,
        ctrlKey: true,
        metaKey: false
      });
      expect(engine.getState().elements['note-1'].x).toBe(20);
    });

    it('does not record selection-only commands in undo history', () => {
      const engine = new BoardEngine({
        initialElements: testElements
      });

      engine.dispatch.select({
        ids: ['note-1']
      });
      engine.dispatch.clearSelection();

      expect(engine.canUndo()).toBe(false);
      expect(engine.canRedo()).toBe(false);
    });

    it('does not record pan and zoom commands in undo history', () => {
      const engine = new BoardEngine({
        initialElements: testElements
      });

      engine.dispatch.panViewport({
        delta: { x: 20, y: -10 }
      });
      engine.dispatch.zoomViewport({
        zoom: 1.4,
        anchor: { x: 100, y: 120 }
      });

      expect(engine.canUndo()).toBe(false);
      expect(engine.canRedo()).toBe(false);
    });

    it('rejects unknown kinds during initialization', () => {
      expect(() => {
        return createBoardEngineTestHarness({
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
      const harness = createBoardEngineTestHarness({
        initialElements: testElements
      });

      expect(() => {
        harness.test({
          arrange: () => {},
          act: (engine) => {
            engine.dispatch.addElement({
              element: {
                id: 'unknown-1',
                kind: 'sticker',
                x: 0,
                y: 0,
                width: 10,
                height: 10
              } as unknown as BoardElement
            });
          },
          assert: {
            events: [],
            stateDiff: []
          }
        });
      }).toThrow('Unknown board element kind "sticker"');
    });
  });
}
