# wideboard Client Architecture

## Why does this document focus on the client side?
The whiteboard experience is primarily shaped by client behavior: rendering performance, interaction latency, optimistic collaboration, and local state consistency. This document defines the browser architecture needed to support those constraints.

## What are the client architecture goals?
- Keep direct manipulation interactions responsive and predictable.
- Support multi-user collaboration with conflict-tolerant local updates.
- Maintain clear module boundaries so features can be added safely.
- Scale to large boards without degrading baseline interaction quality.

## What are the main client-side layers?
- `App Shell Layer`: route setup, authentication session, board bootstrapping.
- `Feature UI Layer`: toolbars, panels, context menus, dialogs, inspectors.
- `Interaction Layer`: pointer/keyboard handling, selection model, tool state machine.
- `State Layer`: local board model, derived selectors, command dispatch pipeline.
- `Sync Layer`: WebSocket transport, operation queue, ack/retry handling.
- `Rendering Layer`: viewport, culling, hit testing, shape rendering.
- `Persistence Layer`: local cache, offline queue, session restore metadata.

## How should module boundaries be organized?
Suggested structure under `ui/src/`:
- `app/`: application bootstrap and providers.
- `board/`: board screen composition and viewport container.
- `features/tools/`: tool implementations (select, draw, text, connector).
- `features/inspector/`: style and element property editing.
- `shared/store/`: Jestor stores, selectors, command APIs.
- `shared/sync/`: realtime protocol client and operation lifecycle.
- `shared/render/`: rendering primitives, spatial index, transform utilities.
- `shared/domain/`: element schemas, operation types, validation rules.

## How should state management work on the client?
Use the in-repo Jestor helper as the single shared UI state mechanism.

- Keep canonical client board state in one normalized store.
- Use `select.<key>()` hooks for fine-grained subscriptions.
- Apply user actions as commands, then emit operations to the sync layer.
- Store transient interaction state separately from persistent board entities.

State partitions:
- `boardEntities`: elements/connectors/comments indexed by id.
- `interaction`: active tool, selection, drag/resize session, clipboard metadata.
- `viewport`: zoom, pan, visible bounds.
- `collaboration`: remote cursors, peer selections, connection status.
- `sync`: pending operations, acknowledged revision, replay cursor.

## How should user interactions flow through the system?
Interaction pipeline:
1. Input event is captured (`pointer`, `keyboard`, `wheel`).
2. Active tool resolves intent using hit-test and modifier keys.
3. Tool dispatches one or more domain commands.
4. Store applies optimistic local updates immediately.
5. Sync layer serializes operations and sends to collaboration backend.
6. Renderer re-renders dirty regions on animation frame.

This keeps local interaction latency low while preserving deterministic operation flow.

## How should real-time collaboration be handled in the client?
- Maintain an ordered outgoing operation queue with retry on reconnect.
- Tag each operation with client/session identifiers and logical ordering metadata.
- Apply remote operations idempotently and ignore already-acknowledged local echoes.
- Separate presence updates (cursor, viewport, active tool) from persistent board ops.

Conflict strategy on the client:
- Respect server-acknowledged ordering.
- Keep per-field merge behavior deterministic.
- Preserve deletion tombstones until compaction checkpoints.

## How should rendering be implemented for performance?
- Use a canvas-oriented renderer for board primitives.
- Keep DOM overlays for text editing and accessibility-critical controls.
- Maintain spatial indexing for fast hit testing and viewport culling.
- Re-render only dirty regions whenever possible.

Performance controls:
- Frame budget target: maintain smooth interaction at typical zoom levels.
- Debounce non-critical recalculations (layout inspectors, analytics events).
- Batch remote operation application per animation frame.

## How should offline and reconnect behavior work on the client?
- Cache latest board snapshot locally for fast reopen.
- Queue local operations when disconnected and replay on reconnect.
- Perform reconnect handshake:
  1. fetch latest checkpoint metadata
  2. request missing operations from last acked revision
  3. replay local unacked operations
- Surface sync status in UI (`connected`, `reconnecting`, `offline`, `degraded`).

## How should reliability and error handling be designed?
- Treat sync failures as recoverable by default with bounded retries.
- Keep irreversible destructive actions behind explicit confirmation.
- Log recoverable and non-recoverable client errors with board/session correlation ids.
- Fail closed on permission errors from backend and roll back optimistic state when required.

## How should client security boundaries be enforced?
- Never treat client-side checks as authoritative for permissions.
- Minimize sensitive data retention in local storage.
- Clear collaboration/session data on sign-out and board access loss.
- Sanitize imported content and external asset metadata before rendering.

## How should the client be tested?
- Unit tests:
  - Command reducers and selector correctness.
  - Tool state machine transitions.
- Integration tests:
  - Interaction-to-operation pipeline for key tools.
  - Reconnect and replay behavior.
- UI tests:
  - Multi-selection, keyboard shortcuts, zoom/pan invariants.
- Performance checks:
  - Render cost and interaction responsiveness on synthetic large boards.

## What are the immediate implementation milestones for the client?
1. Establish module boundaries and board store schema.
2. Implement select/move/resize tool pipeline with optimistic updates.
3. Add sync queue with ack handling and reconnect replay.
4. Add remote presence overlays and connection status UI.
5. Harden rendering with culling, hit-test indexing, and perf instrumentation.
