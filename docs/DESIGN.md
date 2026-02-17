# Collaborative Whiteboard Design (Miro-Style)

## What problem are we solving?
Teams need a shared, real-time whiteboard where multiple users can create and edit visual artifacts together (sticky notes, shapes, connectors, text, freehand drawing, images) with low latency, reliable conflict handling, and predictable behavior.

## What are the product goals?
- Support real-time collaborative editing with presence indicators and cursors.
- Keep interactions smooth at 60 FPS for common boards.
- Preserve deterministic board state across clients and reconnects.
- Provide a permission model for view/comment/edit/admin access.
- Enable version history and recovery of past board states.

## What is out of scope for the first version?
- Rich templates marketplace.
- Advanced diagram-specific auto-layout.
- Video/audio conferencing.
- AI-assisted generation and summarization.

## Who are the primary users and use cases?
- Product/design teams: brainstorming, user journey mapping, planning.
- Engineering teams: architecture diagrams and async review.
- Facilitators/educators: workshops and collaborative teaching.

Core use cases:
- Create and move objects.
- Multi-user editing in the same region of the board.
- Group, align, and connect objects.
- Comment and review mode.
- Export board snapshots (PNG/PDF) and sharing links.

## What high-level architecture should be used?
Use a client-server architecture with an event-driven collaboration backend.

- Client (Web):
  - React UI + canvas/WebGL rendering layer.
  - Local interaction engine (selection, drag, resize, draw).
  - Local-first state cache for optimistic updates.
- Realtime Collaboration Service:
  - WebSocket gateway for operation broadcast.
  - CRDT/OT-based merge engine.
  - Presence service (cursor, selection, active tool).
- API Service:
  - AuthN/AuthZ, board metadata, permissions, exports, history access.
- Storage:
  - Durable board snapshot store.
  - Append-only operation log for replay/audit.
  - Asset storage for uploaded files/images.

## How should board data be modeled?
Represent board state as a normalized graph of entities.

- `Board`: id, title, owner, createdAt, updatedAt, settings.
- `Element`: id, type, transform, zIndex, style, content, groupId.
- `Connector`: id, fromElementId, toElementId, route, style.
- `Comment`: id, authorId, anchor, text, resolved.
- `Presence`: userId, cursor, viewport, selectedElementIds, tool.

Each mutable entity includes:
- `version` for conflict tracking.
- `updatedBy` and `updatedAt` for audit.

## How should real-time synchronization and conflict resolution work?
Use operation-based CRDT semantics for collaborative edits.

- Client emits fine-grained operations (`create`, `update`, `delete`, `reparent`, `reorder`).
- Operations are timestamped and causally ordered with vector/lamport clocks.
- Server validates permissions, applies merge rules, and broadcasts accepted operations.
- Clients apply remote operations idempotently.

Merge behavior guidelines:
- Position/transform updates: last-writer-wins per field with causal ordering.
- Text edits: sequence CRDT for character-level merging.
- Deletion tombstones: prevent resurrection from delayed updates.

## How should rendering and interaction be implemented?
Use a hybrid rendering strategy:
- DOM for text editing overlays, context menus, accessibility surfaces.
- Canvas/WebGL for large-scale element rendering.

Interaction pipeline:
- Pointer event -> hit test -> tool state machine -> local operation -> render -> sync.

Performance strategies:
- Spatial index (R-tree/quadtree) for hit testing.
- Viewport culling and level-of-detail rendering.
- Batched operation application and animation-frame scheduling.

## How should permissions and sharing be handled?
Board-level roles:
- `viewer`: read-only.
- `commenter`: comments and reactions.
- `editor`: create/edit/delete elements.
- `admin`: permissions, board settings, destructive operations.

Sharing mechanisms:
- Direct user/group grants.
- Link-based access with expiration and role constraints.

## How should reliability and offline behavior work?
- Local operation queue when disconnected.
- Reconnect handshake: fetch latest server checkpoint + missing ops.
- Deterministic replay to reach converged state.
- Automatic periodic snapshots to reduce replay cost.

## How should observability and operations be designed?
- Metrics: active sessions, op latency, merge conflicts, reconnect duration.
- Structured logs with board/user/session correlation IDs.
- Tracing across WebSocket gateway, merge engine, persistence path.
- Alerting for elevated error rates and sync lag.

## How should security and compliance be addressed?
- OAuth/OIDC authentication; short-lived access tokens.
- Permission checks on every operation server-side.
- Rate limiting per session/user/IP for abuse protection.
- Encryption in transit (TLS) and at rest for metadata/assets.
- Audit trail for role changes and destructive actions.

## What are the key API and event contracts?
Core API endpoints:
- `POST /boards`
- `GET /boards/:id`
- `GET /boards/:id/history`
- `POST /boards/:id/export`
- `POST /boards/:id/share`

Realtime messages:
- `join_board`, `leave_board`
- `presence_update`
- `ops_submit`
- `ops_ack`
- `ops_broadcast`
- `snapshot_checkpoint`

## How should testing and quality be validated?
- Unit tests:
  - Operation reducers and merge rules.
  - Element transform and z-index ordering logic.
- Property tests:
  - Convergence under operation permutation.
- Integration tests:
  - Multi-client collaboration scenarios with reconnects.
- Load tests:
  - High-frequency pointer ops and large-board rendering.
- End-to-end tests:
  - Share flow, permission enforcement, history restore.

## What are the delivery phases and milestones?
1. Foundation:
   - Board model, rendering core, single-user editing.
2. Realtime collaboration:
   - Presence, operation sync, conflict resolution.
3. Sharing and permissions:
   - Access roles, link-sharing, comments.
4. Reliability:
   - Offline queue, snapshots, history restore.
5. Hardening:
   - Performance optimization, observability, security controls.

## What are the major risks and mitigations?
- Risk: Merge complexity causes divergence.
  - Mitigation: CRDT property testing + deterministic replay validation.
- Risk: Large boards degrade performance.
  - Mitigation: Culling, indexing, progressive rendering, perf budgets.
- Risk: Permission bugs expose data.
  - Mitigation: Server-side authorization middleware and negative tests.

## What decisions should be made early?
- CRDT framework choice (build vs adopt existing implementation).
- Canvas vs WebGL renderer baseline.
- Snapshot and operation log retention strategy.
- Multi-tenant isolation model and storage partitioning.
