# RIFT-1030 headless journal replay mismatch

## Conclusion

The three RIFT-990 strict replay failures have two independent causes.

1. The archived journal files contain `counters: {}`. The runtime counter field
   is `Map<string, number>`. The journal digest encodes a Map as
   `{"map":[...]}`, while ordinary JSON persistence erased that type. Applying
   only this schema-aware counter recovery reproduces the stored integrity of
   all 81 completed RIFT-990 journals when their recorded key order is kept.
2. After counter recovery, all three journals reach a later engine identity
   mismatch. `packages/engine-core/src/programs/play.ts:359` derives the Play
   chain-item id from a module-global `playSequence`. A Gold token created and
   played by a card trigger receives a process-history-dependent id. Replay
   starts with a fresh module counter, so the same command history generates a
   different id in the `chain-item-pending.details.item` event.

The command sequence itself remains deterministic through those points. The
strict comparison was not relaxed: command failures, every event byte, setup
blockers, and final state are still compared.

## First divergences

All observations below use the archived journal after only the legacy counter
Map restoration. Event indices are zero based; sequence numbers are one based.

| Seed | Command | Event index | Sequence | Archived item id | Replay item id |
|---|---:|---:|---:|---|---|
| 046 | 39 | 563 | 564 | `play:token-113:1:A:225` | `play:token-113:1:A:12` |
| 058 | 34 | 503 | 504 | `play:token-113:1:B:180` | `play:token-113:1:B:9` |
| 060 | 23 | 380 | 381 | `play:token-113:1:B:128` | `play:token-113:1:B:8` |

The differing field is exactly
`events[i].details.item` on a `task-resolved` event with
`timingPoint: "chain-item-pending"`. The event object is the canonical Gold
token with ref `token-113:1`, and every other event field is equal.

Before the first engine identity divergence, counter recovery is necessary.
Without it, replay stops at event index 18 (`seq: 19`) because an empty Map is
encoded as `{"map":[]}` at runtime but the archive contains `{}`. This is a
journal encoding defect, not a different rules result.

## Rule basis

- CR 114: shuffle setup; CR 115-115.2: establish Turn Order. Their randomized
  setup decisions must come from the recorded match seed.
- CR 303.1 and 303.2: game actions execute completely one at a time. A pending
  chain item therefore needs a stable identity when the action is committed.
- CR 303.2.a: simultaneous actions are ordered from the Turn Player. The replay
  must execute that same order.
- CR 370.1.a.1 and 370.1.a.2: an event belongs to the exact action/change that
  produced it and is simultaneous only when produced by one game action. The
  journal comparison must retain the exact produced event.
- CR 383.3.d and 383.3.d.1: simultaneous Triggered Abilities are ordered by
  their controller, starting with the Turn Player across controllers.

These rules require replay to reproduce the recorded action/event sequence;
they do not authorize replacing a recorded chain identity with a fresh
process-local sequence value.

## Minimal reproduction

From the repository root:

```sh
pnpm --filter @riftbound/replay-core test
```

The regression reads the read-only RIFT-990 archive when present and verifies
the legacy counter migration when `RIFT_990_EVIDENCE_DIR` is supplied. It also
runs three fresh seed games through the real production runner, writes their
journals through the canonical codec, reads them back, and calls
`replayHeadlessJournal` on each restored journal. The full headless journal diagnosis used the
real production setup (`createMatch`, `ChainEngine`, `TurnFlow`,
`createProgramBinding`, and `attachLifecycle`). It copied the runner to
`/tmp/RIFT-1030-headless-replay-mismatch/` only to add first-difference
reporting; it did not alter engine state, synthesize callbacks, or patch game
decisions.

## Suggested engine-core fix

The owner of `packages/engine-core/src/programs/play.ts` should remove the
module-global `playSequence` from the persisted semantics. Derive the Play id
from stable replay input such as the command/action id plus the exact source
ref, or expose a per-Match counter whose initial value and consumed draws are
part of the journal. Replay must create a fresh counter at the recorded setup
state and reproduce the same values.

A focused regression should create a Gold token from a card trigger, play it
through the real `ChainEngine`/`TurnFlow` path, and assert the pending item id is
identical when that journal is replayed in a fresh module/process context. It
must also show that replaying an earlier match cannot change a later match's
item ids.

The change belongs to engine-core and was not made here. `duel.ts` is also
outside this workstream's write scope, so its use of this codec is documented
as an integration request instead of being edited.

## Evidence

- `/root/swarm-rift/shared/rift990-evidence/journals/046-RIFT-990-m1-seed-046.journal.json`
- `/root/swarm-rift/shared/rift990-evidence/journals/058-RIFT-990-m1-seed-058.journal.json`
- `/root/swarm-rift/shared/rift990-evidence/journals/060-RIFT-990-m1-seed-060.journal.json`
- `/tmp/RIFT-1030-headless-replay-mismatch/revived-046-deep.log`

## Contract requests for the parent

1. In `packages/integration-tests/src/headless/stats.ts:513-518` and `:592`,
   import and use
   `reviveLegacyJournalCounters`, `stringifyPersistedReplayJson`, and the
   matching parse helper before integrity validation, persistence, and replay
   comparison. This requires the parent to add the replay-core workspace
   dependency/export wiring. The journal archive must then be written in the
   canonical form so a new Map round-trips without migration. The same codec
   must be used by `packages/integration-tests/src/headless/duel.ts` for its
   in-memory integrity digest and before the final strict comparison.
2. In `packages/engine-core/src/programs/play.ts:359` (and the hidden-play id
   at line 331), replace the process-global `playSequence` dependency with a
   stable command/action-derived id or a per-Match counter recorded in the
   journal. Do not compare only hashes after stripping `details.item`; that
   would hide a real chain identity difference.

The current regression deliberately keeps the production write/read/strict
replay test green for fresh journals. The three archived journals still fail at
the later `details.item` difference until request 2 is completed; temporarily
removing that assertion avoids shipping a permanently red integration gate
without pretending that the historical-journal acceptance criterion passed.
