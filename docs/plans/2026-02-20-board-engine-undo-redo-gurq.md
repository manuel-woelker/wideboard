# Why add undo/redo linear history in the Board Engine?
The current engine keeps revisioned deltas but has no undo/redo behavior. This plan introduces linear-history undo/redo that preserves reachable past states even after branching edits, following the GURQ approach.

## What behaviors must be tested before calling this complete?
1. Undo reverts the latest reversible state mutation.
2. Redo reapplies an undone mutation.
3. Undo/redo emit engine update events and increment revisions.
4. Branching after undo does not drop prior redoable history.
5. Prior future states remain reachable after branching through repeated undo/redo traversal.
6. Keyboard shortcuts in UI trigger undo/redo:
: `Ctrl/Cmd+Z` undo
: `Ctrl/Cmd+Y` redo
: `Ctrl/Cmd+Shift+Z` redo
7. Keyboard undo/redo should not fire while text editing is active inside input/contenteditable controls.

## How should engine tests be structured?
- Add colocated tests in `ui/src/board/engine/BoardEngine.ts` using the existing harness and direct engine assertions where sequence checks are clearer.
- Prefer black-box behavior checks:
: state before/after undo and redo
: emitted deltas for undo and redo revisions
: cursor capability checks via `canUndo()` and `canRedo()`

## How should GURQ branch preservation be validated?
- Scenario:
: Start at state `S0`.
: Apply `A`, then `B`.
: Undo once to reach `A`.
: Apply new change `C`.
: Undo repeatedly and verify state `A+B` is still reachable, then continue back to `S0`.
- Assertions:
: x-position/state checkpoints match expected sequence
: no exception or invalid history transitions

## How should UI integration be validated?
- Add colocated tests in `ui/src/board/BoardComponent.test.tsx`.
- Use `onEngineReady` to perform an initial move mutation.
- Dispatch keyboard events on `window` and assert rendered element frame updates after undo/redo.
- Add a focused-editor test asserting shortcut events do not mutate board state.
