# Why refactor the board into a headless engine?
The current board behavior is concentrated in `BoardComponent`, which couples state transitions to DOM concerns. A headless `BoardEngine` makes board behavior deterministic and testable without rendering, while the UI becomes an adapter from browser events to engine calls.

## What does success look like?
- `BoardEngine` is the primary interface for board interactions.
- The UI delegates event handling to the engine and renders from engine state.
- Board changes can be asserted via state snapshots and deltas without DOM.
- Element behavior is pluggable and registered during engine initialization.

## What architectural boundaries should we enforce?
- `BoardEngine` owns canonical board state and mutations.
- `BoardComponent` owns DOM bindings, coordinate conversion from screen space, and presentation.
- Element type modules own type-specific defaults and mutation behavior.
- Shared contracts live in a small `engine/types` surface used by both engine and UI.

## What should the `BoardEngine` public API be?
- `constructor(config: BoardEngineConfig)`
- `handlePointer(event: BoardPointerEvent): BoardRevision`
- `handleKeyboard(event: BoardKeyboardEvent): BoardRevision`
- `handleClipboard(event: BoardClipboardEvent): BoardRevision`
- `handleWheel(event: BoardWheelEvent): BoardRevision`
- `dispatch(command: BoardCommand): BoardRevision` for non-DOM-driven actions
- `getState(): Readonly<BoardState>`
- `getRevision(): BoardRevision`
- `getDeltasSince(revision: BoardRevision): BoardDeltaBatch`

## How should pluggable element types work?
- Define `BoardElementType<TModel>` with:
- `kind`
- `createDefault(input)`
- `reduce(event, context)` for type-scoped state transitions
- `getBounds(model)` for hit testing and selection frame
- Register types at startup via `BoardElementRegistry` in `BoardEngineConfig`.
- Engine rejects unknown element kinds at initialization and command time.

## Which files and modules should be introduced?
- `ui/src/board/engine/BoardEngine.ts`
- `ui/src/board/engine/boardEngineTypes.ts`
- `ui/src/board/engine/boardEvents.ts`
- `ui/src/board/engine/boardDeltas.ts`
- `ui/src/board/engine/elementRegistry.ts`
- `ui/src/board/engine/elementTypes/noteElementType.ts`
- `ui/src/board/engine/elementTypes/imageElementType.ts`

## What migration phases should be followed?
1. Phase 0: Baseline behavior capture
- Add or tighten integration tests in `BoardComponent.test.tsx` for current interactions (selection, drag, resize, clipboard, image drop) before refactor.
2. Phase 1: Extract contracts
- Move shared board model/event types out of `BoardComponent` into `engine` contracts.
- Keep behavior unchanged; only type and shape extraction.
3. Phase 2: Implement `BoardEngine` core
- Introduce board state container, revision clock, and delta collection.
- Implement command/event reducers for selection, movement, viewport, and ordering.
4. Phase 3: Introduce element registry
- Define registry API and migrate note/image logic into element type reducers.
- Route element-kind operations through registry instead of conditionals in engine core.
5. Phase 4: Integrate UI with engine
- Refactor `BoardComponent` handlers to translate DOM events into `BoardEngine` events.
- Render from `getState()` and optionally incremental updates from `getDeltasSince(...)`.
6. Phase 5: Cleanup and hardening
- Remove duplicated state logic from component.
- Delete obsolete helpers that are replaced by engine modules.

## What state and delta model should be used?
- State:
- `elements` map keyed by id
- `selection` set/list
- `viewport` (pan and zoom)
- `interaction` transient mode (dragging, marquee, resizing)
- Deltas:
- `element_added`
- `element_removed`
- `element_updated`
- `selection_changed`
- `viewport_changed`
- `interaction_changed`
- `revision` metadata for deterministic replay and incremental UI sync

## What tests are required to validate this refactor?
- Engine unit tests:
- Data-driven reducer tests for pointer/keyboard/clipboard/wheel behavior.
- Delta emission assertions for each supported transition.
- Registry tests:
- Unknown kind rejection.
- Note/image type reducer behavior and bounds calculations.
- UI integration tests:
- `BoardComponent` verifies event-to-engine wiring and rendered output parity.

## How should rollout risk be controlled?
- Keep a behavior parity checklist from existing integration tests and run it after each phase.
- Avoid mixed ownership: once a behavior moves to engine, remove duplicate component logic immediately.
- Use a feature branch checkpoint per phase to simplify rollback if regressions appear.

## What is the definition of done?
- `BoardComponent` no longer mutates board state directly.
- All board mutations pass through `BoardEngine`.
- Element kinds are registered via initialization config and can be extended without core edits.
- Engine tests cover state and deltas without DOM dependency.
- Existing board UI behavior remains functionally equivalent.
