# protocol

The protocol package defines the wire and engine command contracts for the
`synthetic-demo` vertical slice.

- `PlayerCommand` contains only client-authored fields; the acting player is
  never accepted from a client payload.
- `Command` is the engine command with the authoritative `playerId` attached.
- `Prompt` carries `ownerPlayerId`, `playerId`, `stateVersion`, `status`, and
  the allowed options.
- Runtime validators validate client messages, server messages, commands,
  prompts, projections, events, and snapshots.

This is a deliberately small contract for a demo, not a complete
representation of the official Riftbound rules or tournament protocol.
