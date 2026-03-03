# Why do we need an event-based sync plan for shared board editing?
Multiple users need to edit the same board concurrently without losing data, while keeping behavior deterministic and replayable. An append-only edit event log provides an auditable source of truth, supports offline edits, and aligns with the board engine's deterministic state model.

## What outcomes define success?
- All users converge to the same board state after sync.
- Local edits are responsive while offline and during reconnect.
- Event ordering and idempotency prevent duplicate or divergent mutations.
- The system can recover state from snapshots plus subsequent events.

## What event model should be stored?
- Use immutable domain events (not UI events), for example:
: `element_created`, `element_updated`, `element_deleted`
: `selection_changed` (optional, if shared-presence is needed)
: `z_order_changed`, `viewport_changed` (only if collaborative behavior requires it)
- Each event should include:
: `eventId` (UUID/ULID), `boardId`, `actorId`, `clientId`
: `baseVersion` (last known server version when the edit was created)
: `createdAtMs` (client timestamp for diagnostics only)
: `payload` (minimal mutation data)
- Server assigns authoritative `serverVersion` on acceptance.

## How should ordering and causality work?
- Use per-board monotonic `serverVersion` assigned by the server transaction that persists an event.
- Clients keep:
: `lastAckedServerVersion`
: `pendingEvents[]` (optimistically applied local events awaiting ack)
- Rebase model:
: on ack, remove matching pending event
: on remote event, apply to canonical state and reapply still-pending local events in creation order
- Idempotency:
: server rejects already-seen `eventId` for `(boardId, eventId)`
: client ignores already-applied server versions.

## Where should data be persisted?
- Client local store:
: IndexedDB for `pendingEvents`, board snapshot cache, and last synced version.
- Server store:
: `board_events` append-only table keyed by `(board_id, server_version)`
: unique index for `(board_id, event_id)`
: periodic `board_snapshots` table for faster hydration.

## How should sync transport work?
- Initial load:
: `GET /boards/:boardId/snapshot?sinceVersion=<n>` returns latest snapshot and delta events after `n`.
- Live updates:
: WebSocket channel per board streams committed server events.
- Client upload:
: `POST /boards/:boardId/events:batch` with pending events (ordered by client creation sequence).
- Acknowledgement:
: response maps `eventId -> serverVersion` or rejection reason.

## How should conflicts be resolved?
- Prefer deterministic merge semantics per event type:
: last-write-wins for scalar fields with serverVersion tiebreak
: operation-based transforms for positional edits where possible
: delete-wins when update targets deleted element, unless explicit resurrection is supported
- Keep merge logic in one shared reducer path used by both local replay and remote apply.
- Record conflict counters/telemetry to identify problematic mutation patterns.

## How should reconnect and offline behavior work?
- On disconnect, continue queuing and optimistically applying local events.
- On reconnect:
: fetch delta from `lastAckedServerVersion`
: apply remote deltas
: resubmit still-pending events in original client order
- If batch fails due to schema/version mismatch, client requests full snapshot + delta and retries once.

## How should snapshots and compaction work?
- Server creates snapshots every `N` events or `T` minutes per active board.
- Snapshot contains canonical board state and `snapshotVersion`.
- Event compaction is optional initially; retain full log for audit/debug until storage pressure requires pruning policy.

## What security and multi-tenant rules are required?
- Authorize board membership on every snapshot/event API and WebSocket subscribe.
- Validate event payload schema server-side before persistence.
- Scope all reads/writes by `tenantId` and `boardId`.
- Rate-limit batch uploads and enforce maximum payload size.

## What implementation phases reduce delivery risk?
1. Define event schema, server versioning contract, and shared reducer invariants.
2. Implement server append-only event persistence with idempotency keys.
3. Add client pending-event queue + optimistic apply/rebase loop.
4. Add WebSocket fan-out for committed events.
5. Add snapshot creation and hydration endpoint.
6. Add reconnect recovery and retry logic.
7. Add telemetry and operational safeguards.

## What tests are required?
1. Unit tests for reducer determinism and conflict semantics (data-driven cases).
2. Client tests for pending queue ack, retry, and rebase behavior.
3. Server tests for idempotent event ingestion and strict serverVersion monotonicity.
4. Integration test with two simulated clients editing same board concurrently and converging to identical state.
5. Offline/reconnect integration test with delayed remote events and local pending edits.
6. Snapshot hydration test ensuring snapshot + tail events equals full replay state.

## What is the definition of done?
- Two or more concurrent users can edit one board and converge deterministically.
- Offline edits survive refresh and sync correctly after reconnect.
- Event ingestion is idempotent, ordered, and observable via metrics/logs.
- Snapshot hydration path is implemented and covered by automated tests.
