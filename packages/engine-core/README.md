# engine-core

This package is the authoritative, pure-function core for the
`synthetic-demo` vertical slice. It implements only the small rules surface
needed to exercise deterministic command submission, prompt ownership and
version checks, rollback on rejected commands, and viewer-safe projections.

It is not a complete implementation of the official Riftbound rules. Card,
zone, trigger, replacement, and judge-policy behavior outside the synthetic
demo are intentionally out of scope.

The public entry points are:

- `createInitialGame(options)`
- `submitCommand(state, command)`
- `projectGame(state, viewerPlayerId)`
- `createRoomSnapshot(state, roomId, viewerPlayerId)`

Rejected commands return the original state reference and an empty event list;
they do not advance `version` or `eventSeq`.
