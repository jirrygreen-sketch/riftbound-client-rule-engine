# Protocol v2

Protocol v2 is the wire contract for the new engine layers (`turn`, `combat`,
`chain`, `effects`, and scoring). It is intentionally isolated from the
historical duel profiles. The coordinator should add this line to
`packages/protocol/src/index.ts` when the server and client switch to v2:

```ts
export * from "./v2/index.js";
```

The version and contract tags are `PROTOCOL_V2_VERSION` (`2.0.0`),
`PROTOCOL_V2_COMMAND_CONTRACT`, `PROTOCOL_V2_EVENT_CONTRACT`, and
`PROTOCOL_V2_PROJECTION_CONTRACT`.

## Messages

| Message | Type | Privacy |
| --- | --- | --- |
| `V2CommandMessage` | `command` carrying one `V2Command` | client-authored fields only; actor comes from the authenticated session |
| `V2MulliganCommand` | `mulligan` with selected object/UID ids | owner-only hand identity |
| `V2PlayCommand` | `play` with a card object, optional cost plan, `targets`, and `picks` | target/pick choices are sent only when legal for the viewer |
| `V2ActivateCommand` | `activate` with ability id, source, cost, targets, and picks | source and choices are owner-only when hidden |
| `V2PassCommand` | `pass` | public action receipt |
| `V2ChooseCommand` | `choose` answering a suspended choice request | owner-only; the answer is replayed by `choiceId` |
| `V2MoveCommand` | `move` with object and destination | only visible object identities may be named |
| `V2DeclareAttackCommand` | `declare-attack` with battlefield and attackers | public combat declaration |
| `V2DeclareDefenseCommand` | `declare-defense` with battlefield and defenders | public combat declaration |
| `V2ConcedeCommand` | `concede` | public game result |
| `V2RuneResourceCommand` | staged `rune-energy` / `rune-power` intent naming an exact Rune incarnation | owner-only; not yet part of the general V2 wire union |
| `V2EventMessage` | `event` carrying `V2EngineEvent` | timing point is public; each payload field is `public`, `owner-only`, or `hidden` |
| `V2ProjectionMessage` | `projection` carrying `V2Projection` | viewer-specific; hidden zones are counts/omissions only |
| `V2CommandReceipt` | `command-receipt` | public idempotency result; rejection text contains no hidden state |

Every command includes `commandId` and `stateVersion`. A duplicate
`commandId` is represented by a receipt with `duplicate: true` and must not
reapply the command.

## Privacy rules

`V2EventField` is the field-level privacy marker. A public field has a value
visible to every viewer; an owner-only field includes `ownerPlayerId`; a
hidden field contains no value at all. The projection validator rejects
owner-only fields for spectators and opponents.

Projection rules are deliberately strict:

- hand objects are present only for their owner;
- deck and rune-deck order and card identities are never projected, including
  to the owner;
- facedown and hidden-cost cards are represented by counts or public state,
  never by card id, name, or order;
- chain source identities and pending choice options are owner-only when the
  source/choice is private;
- public board objects, locations, priority, chain status, and scoring remain
  available to both players and spectators.

`V2EventJournalRecord` mirrors the journal-v1 sequence fields (`seq`,
`eventSeq`, and `stateVersion`) and carries the same `core-1.5` ruleset
version. It is an event projection record, not a replacement for the existing
journal header or command entry types.
The two Rune resource intents are staged protocol types with their own
`isV2RuneResourceCommand` guard. They are intentionally absent from
`V2Command`, `isV2Command`, command envelopes, and transport guards until the
authoritative server handler lands in the same change. The payload is exactly
`{ type, commandId, stateVersion, runeObjectId, zoneEntryId }`; the actor comes
from the authenticated session. Clients cannot supply amounts, quantities,
Domains, player ids, balances, Gold aliases, or payment-window overrides.
