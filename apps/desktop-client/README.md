# Desktop client protocol v2

The v2 transport and projection state are isolated under
`src/transport/v2` and `src/state/v2`. They keep the server projection
authoritative and store only connection, event-cursor, pending-command, and
choice UI state locally.

To switch a UI route to v2:

1. Create a `V2Transport` with the room WebSocket URL and connect it when the
   route mounts.
2. Create a `V2ClientStateStore` for the authenticated viewer and apply each
   transport `projection`, `event`, and `receipt` notification to the store.
3. Render `store.state.projection`; use `store.state.choice` for pending
   `choose` prompts and `buildV2ChooseCommand` for an answer.
4. Send actions through `transport.sendCommand(...)`. Keep the command
   promise/receipt as the confirmation boundary; do not mutate the projection
   optimistically.
5. On route teardown call `transport.disconnect()`. Reconnects automatically
   include the latest `stateVersion` and `eventSeq` query cursors, and pending
   commands retain their original `commandId` for idempotent retry.

The v2 modules import the current contract directly from
`packages/protocol/src/v2` until the coordinating task adds the v2 barrel
export to `@riftbound/protocol`.

