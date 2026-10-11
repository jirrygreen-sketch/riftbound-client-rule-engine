# Integration tests

These tests exercise the real protocol, engine, and game-server source through
the aliases in `vitest.config.ts`. They never skip a missing package or export.
Load, protocol, or contract failures are test failures.

Run them with:

```sh
pnpm --filter @riftbound/integration-tests typecheck
pnpm --filter @riftbound/integration-tests test
```

## Upstream contract expected by the WebSocket slice

- `@riftbound/engine-core` must export `createInitialGame`, `submitCommand`,
  and `projectGame` from `src/index.ts`.
- `apps/game-server/src/room.ts` currently imports `createEngine`,
  `EngineUpdate`, `MatchSnapshot`, and `RuleEngine`, but the engine source does
  not export them. The server and engine owners need to agree on one public
  engine API before the room can start a match.
- `apps/game-server/src/server.ts` must export `createGameServer` and emit the
  protocol `welcome`/`room`/`projection`/`request-result` shapes from
  `@riftbound/protocol`.
- The server must attach the authenticated actor, honor `expectedVersion`, and
  use the top-level `commandId` for idempotent replay and conflict detection.
  It currently reads `inbound.command.commandId`, which is not part of the
  shared command shape.
- Errors caused by a request must echo `requestId` so clients can correlate the
  failure with the command they sent.

The WebSocket suite intentionally fails while the server still emits its legacy
flat welcome and room shapes. Once the upstream APIs implement the contract
above, the suite verifies create, join, play, prompt privacy, respond,
reconnect, duplicate replay, stale-version rejection, and command-id conflict
handling on `127.0.0.1` with an ephemeral port.
