# Full Product Persistence

This module adds a storage-only foundation for authoritative room and match
recovery. It deliberately does not import `@riftbound/protocol`, the game
server, or the existing replay-core index. The parent task can therefore adopt
it as `@riftbound/replay-core/full-product` without coupling persistence to a
database or a specific server implementation.

## Storage Interface

`EventPersistenceStore` is the replaceable boundary:

- `appendEvents({ events, request?, response? })` appends a contiguous block of
  `eventSeq` values in one durable record. A request signature and response can
  be committed with the events, which makes a command and its result one
  atomic persistence unit.
- `appendRequest({ request, response? })` persists a no-event request receipt.
- `getRequest(requestId)` returns the stored response and event cursor.
- `readEvents(afterEventSeq, limit?)` returns a deterministic event backfill
  window and rejects cursors ahead of the log.
- `saveSnapshot({ eventSeq, payload })` atomically writes a checkpoint with a
  checksum. A snapshot is never allowed to be ahead of the event log.
- `readSnapshot()` returns the checkpoint so a caller can backfill only
  `eventSeq > snapshot.eventSeq`.

`FileEventStore.open` is the Node standard-library implementation. Each event
log record is one newline-delimited JSON object with a SHA-256 checksum over a
stable serialization of the record. Appends are serialized in call order,
flushed with `datasync`, and sequence numbers are validated inside the write
critical section. Opening a store loads the whole log, drops only an
incomplete final record, and reports that recovery through `store.recovery`.
Corruption before the final record, a bad checksum, an unsupported format, a
non-contiguous sequence, or a snapshot ahead of the log is an error rather than
silent data loss.

The request signature is the stable serialization of `requestId`,
`commandId`, and `command`. Replaying the same signature returns the original
events and response. Reusing a `requestId` with a different command throws
`IdempotencyConflictError`, and the rejected write does not modify the log.

`FileEventStore` is intended for one writer per event-log path in one Node
process. The in-process queue makes appends deterministic, but it is not a
cross-process file lock. The parent server should own one store per room and
close it before another process can open the same path.

## Parent Task Integration

1. Add a package export for `./full-product` pointing to
   `./dist/full-product/index.js` and `./dist/full-product/index.d.ts`.
2. Create one store per persisted room, for example with
   `events.log` and `snapshot.json` below a room-id-scoped data directory.
3. On restart, `FileEventStore.open` first. Read the snapshot, then
   `readEvents(snapshot.eventSeq)` and apply the returned events to the room
   state before serving reconnects.
4. Before executing a client command, call `getRequest(requestId)`. A stored
   matching signature can return its stored response without running the
   engine. A mismatched signature should map to the protocol's existing
   `idempotency-conflict` error.
5. After a validated command, persist all resulting events and the response in
   one `appendEvents` call before acknowledging the client. Requests that do
   not produce events can use `appendRequest`.
6. Checkpoint room state after the event append is durable. Keep the log
   indefinitely until the parent task defines compaction and retention.

Tests are included in
`test/full-product/full-product.test.mjs`. The package test script only runs
top-level `test/*.test.mjs`, so run this suite directly:

```sh
pnpm --filter @riftbound/replay-core build
node --test packages/replay-core/test/full-product/full-product.test.mjs
```
