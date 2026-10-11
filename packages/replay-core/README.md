# replay-core

`@riftbound/replay-core` is a small, deterministic replay envelope and event
log validator. It has no runtime dependencies and does not depend on the
engine or protocol packages.

The envelope records the replay identity and starting conditions:

- `rulesetId`
- `protocolVersion`
- `cardDataVersion`
- `seed` (a non-empty string or safe integer)
- `players` (public `{ id, name }` identities only)
- `initialStateHash` and `initialEventHash` (`null` until hashes are generated)
- `events` (ordered `{ seq, type, data }` records)

`validateReplayEnvelope(value)` validates and returns a normalized copy without
mutating its input. `serializeReplay(value)` emits compact JSON with stable key
ordering. `parseReplay(json)` rejects malformed JSON and invalid envelopes.

The validator rejects:

- unknown fields at the envelope, player, and event-record levels
- missing or non-contiguous event sequence numbers
- out-of-order or duplicate event sequence numbers
- hidden hand fields, including `hand`, `hiddenHand`, `privateHand`,
  `concealedHand`, and `opponentHand`, anywhere in event data
- non-JSON event values, sparse arrays, symbols, and non-finite numbers

Event `data` is intentionally opaque to this package. Consumers should put
only public event payloads there; card plays may contain a public card
identifier, but concealed cards and hidden hand contents must never be logged.

## Example

```ts
import {
  parseReplay,
  serializeReplay,
  validateReplayEnvelope
} from "@riftbound/replay-core";

const replay = {
  rulesetId: "synthetic-demo",
  protocolVersion: "0.1.0",
  cardDataVersion: "cards-demo-1",
  seed: 12345,
  players: [
    { id: "player-1", name: "Player One" },
    { id: "player-2", name: "Player Two" }
  ],
  initialStateHash: null,
  initialEventHash: null,
  events: [
    {
      seq: 1,
      type: "game-started",
      data: { playerIds: ["player-1", "player-2"] }
    }
  ]
};

const checked = validateReplayEnvelope(replay);
const serialized = serializeReplay(checked);
const roundTripped = parseReplay(serialized);
```
