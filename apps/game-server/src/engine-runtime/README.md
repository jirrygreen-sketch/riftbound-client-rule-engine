# New engine runtime

`createEngineRuntime(options)` is an opt-in server owner for the Core Rules
v1.5 engine. It creates the RIFT-262 match lifecycle, binds a trusted
CardProgram registry when one is supplied, and exposes the v2 command,
projection, and journal boundaries:

```ts
const runtime = createEngineRuntime({ matchId, decks, programs }).start();
const result = runtime.submit(playerId, commandV2);
const privateView = runtime.projectFor(playerId);
const publicView = runtime.projectFor(null);
const recovered = createEngineRuntime({ matchId, decks, programs }).restore(runtime.journal());
```

The command boundary checks `commandId` and `stateVersion` before invoking the
engine. Accepted commands advance the authoritative state version once and are
recorded with the engine/ruleset versions, command payload, receipt, and
viewer-specific projection digests. A duplicate command returns the original
receipt and never invokes the engine again. A stale command is rejected without
an entry in the journal body.

Projection v2 is built from engine-owned snapshots. Hidden hand, deck, and rune
deck identities are omitted or replaced with viewer-scoped opaque references;
the authority object and physical card provenance never cross the projection
boundary. Choice options are included only for the chooser.

`room.ts`/`server.ts` integration is intentionally deferred. The smallest
follow-up wiring is:

1. Add a trusted ruleset switch to room creation. The default remains the
   existing runtime; only an explicit `core-1.5`/engine-v2 setting calls
   `createEngineRuntime`.
2. Translate the room's verified two-seat deck roster into
   `EngineRuntimeOptions`, call `start()`, and retain the runtime owner on the
   room session.
3. Route v2 command messages through `submit(playerId, command)` and publish
   `result.projection` to that socket only.
4. Persist `runtime.journal()` at the room checkpoint and call `restore` before
   accepting commands after a restart. Keep the old archive/profile path
   untouched for legacy rooms.
