# Foundation and Synthetic Room Persistence

Status date: 2026-10-12

This document records persistence for the current authoritative foundation and
synthetic WebSocket rooms. It describes the behavior present in this checkout and
the acceptance evidence still required. The persistence implementation is a server
mechanism only; it does not improve official Riftbound rules coverage.

Persistence is not official Riftbound gameplay coverage. In particular, the
experimental life/health/attack runtime in
`packages/engine-core/src/full-product/runtime.ts` remains quarantined and must not
be described as the official product runtime.

## 1. Goals and Non-Goals

### Goals

1. Persist server-owned room state across a controlled server restart.
2. Make every accepted room mutation durable before acknowledging it.
3. Preserve request idempotency across restarts.
4. Let clients resume through public cursors and viewer-safe projections.
5. Keep resume tokens and private decks server-private.

### Non-Goals

1. A distributed, multi-process database guarantee.
2. Official Riftbound rules execution, scoring, or victory semantics.
3. Production operation without backups, retention policy, and recovery drills.
4. A client-readable archive format. The archive is a server-private format.

## 2. Runtime Configuration

The target server configuration is:

| Option | Current status |
| --- | --- |
| `storageDirectory` | Implemented as `GameServerOptions.storageDirectory`; when set, `createGameServer()` constructs `FileRoomStore` |
| `RIFTBOUND_STORAGE_DIRECTORY` | Read by `apps/game-server/src/index.ts`; absence falls back to `InMemoryRoomStore` |
| `HOST` / `PORT` | Present; defaults `127.0.0.1` and `8787` |

The configured path must not be exposed through a public API, WebSocket message,
room view, or projection. With `FileRoomStore`, `roomStore.list()` creates the
storage root, validates the directory, and performs an exclusive temporary-file
write/remove probe during startup. A failure closes the room store and rejects
`GameServer.start()` before the HTTP listener accepts traffic. The parent
mainline recorded passing game-server and integration test suites for the
persistence implementation on 2026-10-12; an explicitly hostile or readonly
storage-directory run was not identified in that result.

Absence of `RIFTBOUND_STORAGE_DIRECTORY` means the ordinary in-memory room store
is used. That mode is suitable for development and tests, not a persistence
deployment. The CLI currently accepts any non-empty string; it does not resolve
relative paths to a documented base directory or validate that the path is an
intended writable directory.

## 3. Server-Private Archive Model

Each persisted room owns one directory:

```text
storageDirectory/
  sha256(room-id)/
    archive.log
    archive.snapshot.json
```

`archive.log` is the authoritative, ordered, checksummed log. The snapshot path
is accepted by the storage helper but ignored for correctness. The durable log
record is the only durability receipt. Opening validates complete log records; a
damaged final tail can be ignored during recovery, and later appends begin after
the last valid record. A corrupt record before that final tail is an error rather
than a reason to invent state.

The archive contains:

- Schema version.
- Room ID and ruleset ID.
- Seat records, including player ID, display name, resume token, ready flag, and private deck.
- Game state when a game has started.
- Room version and room event sequence.
- The full room event log.
- Processed command/request metadata used for idempotency.

The archive is server-private. Current code exports it only into `FileRoomStore`;
no public message path was found that sends the archive, room view, or projection
containing it. It must never be logged as cleartext. Client recovery authenticates
the resume token inside the server and receives only public room state plus the
viewer's own projection. No leak path found by source review is not equivalent
to a completed negative E2E privacy audit.

## 4. Mutation Transaction

The public server implements this ordering through `runRoomTransaction()`:

1. Capture the pre-mutation archive.
2. Replace live transports with buffered transports.
3. Apply the mutation in memory.
4. `write()` and `datasync()` the archive to the room's log.
5. Send the request receipt.
6. Send the relevant room/projection updates.

If durable saving fails:

1. Restore the pre-mutation archive.
2. Preserve the active connection/session bindings.
3. Return the storage error to the requesting client.
4. Do not advance the public room version, event sequence, or game cursor.
5. Do not acknowledge the mutation as successful.

The transaction compares the archived state before and after the operation and
saves only when the JSON archive changed. Reconnect and replay messages do not
append an archive record solely to resend data. On save failure, the server
restores the archive, restores the pre-operation connection map, and rolls back
the socket context's handshake/session fields before returning the error. Create
is transactional at the public boundary: `roomStore.create(room)` precedes the
durable first-seat transaction, and the create handler removes the in-memory room
and calls `roomStore.remove()` if either step fails. Join, game command,
`submit-deck`, `set-ready`, disconnect, and resume use the same transaction wrapper.

A failed `write()` or `datasync()` is an unresolved-write result, not proof that
the archive never reached disk. The underlying `FileEventStore` marks the handle
`write-failed` and refuses further use until the store is reopened. Recovery must
reopen and read the log to determine its actual last valid record; the public
server must not treat every storage error as a universal "nothing was persisted"
guarantee.

## 5. Restart Recovery

Current startup behavior with a configured storage directory:

1. Call `roomStore.list()`.
2. Create the storage root if needed and perform the write-permission probe.
3. Enumerate SHA-256 room directories under `storageDirectory`.
4. Open each room's log and load its last archive record.
5. Reconstruct the authoritative `GameRoom` through `GameRoom.restore()`.
6. Put restored rooms into the server room map before listening.
7. Keep all sockets initially disconnected.
8. Accept resume by validating the client token against the private seat archive.
9. On any startup failure, close the room store before rejecting `start()`.

The startup ordering is: restore before listen. If startup fails, no socket can
enter the room because the room map is populated only after `roomStore.list()`
resolves and the HTTP listener is opened afterward.

`GameRoom.restore()` validates schema, room identity, seat IDs, safe room
version/event sequence, room-event length and ordering, seat membership, and
processed-request shape, then rebuilds command and room-request idempotency maps.
`GameServer.stop()` drains socket queues and the global room mutation queue,
terminates clients, closes HTTP/WebSocket listeners, and then calls
`RoomStore.close()`.

A damaged final log record may be truncated to the last valid record during
recovery. A checksum failure before the final record must fail recovery for that
room rather than silently inventing state.

## 6. Request Idempotency

All mutating client requests carry a request ID. Durable room requests use:

- Player ID.
- `requestId`.
- Canonical payload hash.
- Result metadata, including the returned versions and duplicate flag.

### 6.1 Game Commands

Game commands are deduplicated by the existing `commandId`. A repeated
`commandId` from the same player with the same canonical payload replays the
original receipt with `duplicate: true`; a different payload returns
`idempotency-conflict`.

### 6.2 Lobby Requests

`submit-deck` and `set-ready` must use the same durable request-id semantics:

| Case | Required result |
| --- | --- |
| Same player, same `requestId`, same canonical payload | Replay the original receipt with `duplicate: true`; add no room event |
| Same player, same `requestId`, different payload | Return `idempotency-conflict`; add no room event |
| Another player reusing the ID | Return `idempotency-conflict` or another explicit non-success error; do not mutate |
| Request ID first seen | Apply once, durably save, then acknowledge |

The metadata must be in the archive so restart does not turn a replay into a new
mutation.

## 7. Resume and Cursor Safety

Resume proceeds in this order:

1. Authenticate the resume token against the private seat archive.
2. Validate supplied game and room cursors.
3. Only after validation, bind the new socket as the active connection.
4. Send the resumed welcome, public room state, and the viewer's projection.
5. Replay missed room events and game events from the validated cursors.

A cursor ahead of the authoritative log must be rejected before the new socket
is bound. A failed resume must not evict the existing active socket. A delayed
close event from an old socket must not evict a newer active socket.

## 8. Current Implementation Boundary

### Present in this checkout

| Capability | Evidence |
| --- | --- |
| Server-private room archive schema | `apps/game-server/src/room.ts` |
| Archive export and rollback restore | `GameRoom.exportArchive()` and `GameRoom.restoreArchive()` |
| Archive consistency validation and reconstruction | `GameRoom.restore()` |
| Command idempotency and payload conflict | `GameRoom.submit()` |
| Durable lobby request metadata in the archive | `GameRoom.processedRoomRequests` in `room.ts` |
| `submit-deck` / `set-ready` deduplication by player and `requestId` | `GameRoom.submitDeck()` and `setReady()` |
| Same-payload replay and different-payload conflict | `processedRoomRequests` and canonical payload hash logic |
| Room/game/resume cursor validation helpers | `validateRoomEventCursor()`, `validateGameEventCursor()`, and `validateResumeCursors()` |
| CLI persistence configuration | `RIFTBOUND_STORAGE_DIRECTORY` in `apps/game-server/src/index.ts` |
| Public `storageDirectory` option and `FileRoomStore` construction | `GameServerOptions` and `createGameServer()` in `server.ts` |
| Room store lifecycle contract | `RoomStore.save()`, optional `list()`, and optional `close()` in `room-store.ts` |
| File-backed room store | `apps/game-server/src/file-room-store.ts` |
| SHA-256 room-directory isolation | `FileRoomStore.roomPath()` |
| Public startup restore and shutdown drain/close | `GameServer.start()` and `GameServer.stop()` in `server.ts` |
| Restart reading and archive restoration | `FileRoomStore.get()` and `FileRoomStore.list()` |
| Storage-root creation and write-permission preflight | `FileRoomStore.list()` and `assertRootWritable()` |
| Write-failure store quarantine | `FileRoomStore.save()` closes the failed store and marks the instance unusable |
| Opaque per-room durable log helper | `apps/game-server/src/full-product/persistent-room-store.ts` |
| Fsync-oriented append and last-record load | `PersistentRoomArchiveStore.save()` and `.load()` |
| Durable transaction with buffered sends and rollback | `runRoomTransaction()` in `server.ts` |
| Cursor validation before reconnect binds the socket | `handleResumeHello()` calls `validateResumeCursors()` before `reconnect()` |

Focused tests exist for the file store, durable log helper, public server
transaction, restart behavior, idempotency, and rollback. The parent mainline
recorded these ordinary executions as passing on 2026-10-12:

| Command | Recorded result |
| --- | --- |
| `pnpm --filter @riftbound/game-server exec vitest run --config vitest.config.ts` | 18 files / 139 tests passed |
| `pnpm --filter @riftbound/integration-tests exec vitest run --config vitest.config.ts` | 6 files / 37 tests passed |

These results support the focused public-server and integration coverage. They
do not replace a real two-client restart/privacy run or a production storage
recovery procedure.

### Pending integration and verification

The following remain unverified as inspected in this documentation pass:

1. An explicitly hostile-path or readonly-directory run of the startup write
   probe.
2. A real restart/resume run with two clients and privacy observations.
3. A documented production retention, backup, and recovery procedure.

### Source-review risks

These are read-only review findings in the current code, not reproduced failures
or test results:

1. `GameRoom.restore()` validates processed room-request shape and safe
   integers, but does not bound stored `roomVersion` or `roomEventSeq` against
   the archive's authoritative values.
2. `GameRoom.restore()` validates top-level archive fields but does not deeply
   validate every nested game-state shape before use.
3. Room request hashes use the raw submitted payload before deck normalization.
   Semantically equivalent retries can therefore be rejected as
   `idempotency-conflict` when their raw JSON shape differs.
4. Corrupt or unsupported archive directories can abort `FileRoomStore.list()`;
   the public server currently does not quarantine one bad room while starting
   the rest.

## 9. Acceptance Workflow

Run this with a disposable server process, fresh storage directory, two real
WebSocket clients, and controlled server restarts.

1. Configure and start the server.
2. Confirm startup fails fast for an unusable configured storage directory.
3. Confirm an unconfigured server remains in memory and is labeled non-persistent.
4. Connect clients A and B.
5. A creates a room; B joins it.
6. A submits a valid deck and records the returned room cursor.
7. B submits a valid deck and records the returned room cursor.
8. A and B set ready; confirm the match starts once.
9. Stop the server cleanly.
10. Restart it with the same `storageDirectory`.
11. Resume A and B with their stored resume tokens.
12. Confirm both seats are initially offline, resume succeeds, and private decks
    are not present in any client-visible message.
13. Replay A's original `submit-deck` and ready request IDs with the same payloads;
    confirm `duplicate: true` and no new room events.
14. Reuse one request ID with a different payload; confirm `idempotency-conflict`.
15. Disconnect A and resume with a valid cursor; confirm the new socket becomes
    active and replay contains exactly the missed viewer-safe events.
16. Attempt another resume with a future cursor; confirm rejection and that the
    active socket remains usable.
17. Save a receipt and projection log during the run for review.
18. Stop the server, reopen the room log, and confirm the last record restores the
    same room/event cursors.

Record the actual command, commit/build identity, storage directory, and all
resulting errors. Do not close the persistence gate from source inspection alone.

## 10. Evidence Matrix

| Required evidence | Current status |
| --- | --- |
| Storage helper unit behavior | Covered by the passing game-server suite recorded by the parent mainline |
| File room store behavior | Covered by the passing game-server suite recorded by the parent mainline |
| Public server `storageDirectory` and CLI environment configuration | Covered by passing game-server and integration suites recorded by the parent mainline |
| Storage-root creation and write-permission preflight | Implementation covered by passing suites; explicit hostile/readonly run not recorded |
| Public server startup recovery | Covered by passing game-server and integration suites recorded by the parent mainline |
| Durable save before every acknowledged mutation | Covered by passing game-server and integration suites recorded by the parent mainline |
| Save-failure rollback after public mutation | Covered by passing game-server and integration suites recorded by the parent mainline |
| Durable lobby request idempotency | Covered by passing game-server and integration suites recorded by the parent mainline |
| Command idempotency | Covered by passing game-server and integration suites recorded by the parent mainline |
| Cursor-before-bind resume safety | Covered by passing game-server and integration suites recorded by the parent mainline |
| Tokens/decks never sent to clients | No sending path found and archive is private; real-client E2E negative audit not recorded |
| Restart with two live clients | Not verified |

## 11. Review Verdict

**Current state: substantially implemented, not accepted as complete persistence.**

The public server has CLI/server persistence configuration, `FileRoomStore`,
storage-root startup preflight, startup restore, shutdown drain and close,
durable mutation ordering, rollback, archived lobby-request idempotency, and
cursor-before-bind resume in source. The parent mainline recorded passing
focused game-server and integration suites. Acceptance remains open because a
real two-client restart/privacy run and a production retention/backup/recovery
procedure are still missing, and the source-review risks above are not
dispositioned. Storage failures after an unresolved write must be recovered from
the actual log, not from an assumption that nothing was persisted. Nothing in
this document improves official Riftbound rules coverage or promotes the
experimental life runtime to production.
