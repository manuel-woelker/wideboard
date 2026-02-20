# Why add a debug overlay for board state inspection?
A persistent debug overlay improves diagnosis speed during development by exposing board internals without opening devtools or adding temporary logs.

## How is the overlay opened and closed?
- Add a floating debug button in the lower-right corner of the board viewport.
- Button toggles overlay visibility.
- Overlay is hidden by default.
- Overlay keeps state local to development workflows and should not block normal board interactions when closed.

## What are the required tabs and their content?
1. Raw board state
- Show a read-only JSON view of the current board state snapshot.
- Render with stable key ordering where practical to reduce visual churn.
- Support vertical scrolling for large payloads.

2. Last update event
- Show the most recent engine/UI update event payload that changed board-relevant state.
- Include event type/name and payload body.
- Display a clear empty state before the first event is captured.

3. Undo stack
- Show undo history entries in order with the current cursor/position highlighted.
- Include redo-visible entries when applicable so history position is explicit.
- Display current index and total stack size summary.

## How is debug data captured and synchronized?
- Subscribe to board engine updates at the same integration point used by the board component.
- On each update:
: refresh cached raw state snapshot
: persist the latest event payload
: refresh undo/redo history metadata and active position
- Keep debug data read-only and derived from engine state to avoid mutating gameplay state.

## What UX and performance constraints apply?
- Overlay should be fixed-position and layered above board content.
- Default size should work on desktop and collapse responsively on narrow screens.
- Large JSON payload rendering must not cause visible input lag during common board actions.
- If needed, defer formatting/stringification until a tab becomes active.

## What tests are required?
1. Debug button renders in lower-right and toggles overlay visibility.
2. Each tab is selectable and shows the correct panel content.
3. Raw board state panel updates after a board mutation.
4. Last update event panel reflects the most recent update payload.
5. Undo stack panel shows entries and highlights the current position correctly across undo/redo.
6. Empty-state behavior is verified for event/undo panels before interactions.

## What implementation milestones should be tracked?
1. Add debug overlay component shell with tab navigation and lower-right toggle button.
2. Wire overlay to board engine data subscriptions for state/event/history snapshots.
3. Implement per-tab renderers and empty states.
4. Add/adjust tests in board UI test suite.
5. Run format and check commands before merge.
