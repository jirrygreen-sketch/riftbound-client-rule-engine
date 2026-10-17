# Engine journal replay

`readJournal(input)` accepts a protocol `journal-v1.ts` envelope, JSON, or the
protocol's JSONL serialization. It verifies all records, sequence/actor/version
constraints, duplicate history, header/record digests, the envelope digest and
the protected head before invoking any setup or engine code. Failures use
`JournalReplayError` with a stable `code` and a record/field `path`. Incomplete
JSON tails and a body ending before its head produce `TRUNCATED_JOURNAL`.

`replayJournal(input, options)` creates a fresh match with the current
`createMatch`, the header seed and ruleset, then applies accepted commands in
order. Pass/concede invoke the engine directly. A duplicate produces a snapshot
without executing again; an operation is integrity-protected audit evidence,
never an executable state patch. The result contains an initial snapshot and
one snapshot per record, one viewer's engine projection v2, and a public final
summary (winner, turn, phase, scores, versions and counts).

The caller supplies the current build's `engineVersion` and a `resolveSetup`
function. The resolver must verify the trusted catalog/deck digests and recover
the decks, host, UID/entropy source and setup choices. It must allocate a fresh
host and supply `readState(match)` with the authority's current objects, ordered
zones, chain, pending choices, events and active information grants. The
replayer always overrides seed and ruleset with the validated header values.
Current `createMatch` fixes the ordered seats to A/B; other seat identities fail
explicitly instead of being reinterpreted.

The optional `executeCommand` adapter bridges `play-card` and
`respond-to-prompt` to the current trusted program/choice boundary. It must
execute the real engine transaction and report accepted, rejected or blocked.
It must derive chain/cost identities deterministically (for example from
`commandId`), preserve null printed costs, and retain judge-required behavior.
Missing adapters and rejected transactions fail explicitly. This module does
not supply semantics absent from the journal contract.

An engine version difference sets `engineMismatch: true` and still recomputes
the match. Recorded state/event versions and projection bytes are compared
only for the same engine version. The cryptographic journal checks always run,
including for a mismatched engine. Projection digest keys are the literal
viewer string (`A`, `B`, `spectator`, `replay`, or `null`); only a recorded key
for the selected viewer is compared. `stateDigest`/`privateStateDigest` are
integrity protected but not reinterpreted: the protocol does not specify their
state serialization. They are never substituted for recomputed state.

Output never includes the header, commands, receipts, raw authority or another
viewer's projection. The engine's `simultaneousGroup` event field can contain a
hidden card's authoritative ID; replay omits that internal coordination field.
Stored projection digests are checked against the original engine projection
internally, while returned `projectionDigest` hashes the safe replay output.
Snapshot values are detached from authority and each other.

## Verification

From the repository root, with the workspace dependencies already built:

```sh
pnpm --filter @riftbound/replay-core build
node --experimental-strip-types --test packages/replay-core/test/v2/*.test.mjs
heavy pnpm --filter @riftbound/replay-core test
pnpm --filter @riftbound/replay-core typecheck
```

The focused suites record real createMatch/pass/concede games using the
headless M1 decks and headless kernel, compare every replay snapshot for both
players and public viewers, exercise a real synthetic CardProgram transaction,
and cover corruption, truncation, duplicate commands, version differences and
hidden-information filtering. They require the same ignored local catalog as
the headless deck builder. Synthetic explicit costs do not alter null printed
costs and do not claim official card behavior.

## Integration requests (outside this workstream's write scope)

- `protocol/src/journal-v1.ts` still uses `FullProductCommand`, while protocol
  v2 and the server runtime use a different command union and journal shape.
  Unify the contract before connecting these journals; this reader accepts
  exactly the existing protocol format and does not rewrite historical logs.
- The header identifies decks by digest but does not contain setup choices or
  a resolvable setup reference. Define their trusted retrieval and entropy/UID
  contract so that a standalone reader can recover the whole setup. Define
  state digest serialization and public-view digest keys at the same boundary.
- `integration-tests/src/headless` exposes statistics/digests, not its private
  command log or a protocol journal. Export a protocol-v1 journal with its
  deterministic setup to permit direct replay of those original bot logs.
- `replay-core/package.json` needs the protocol/engine dependencies and a v2
  export. This module follows the existing workspace's relative dist imports
  until the package owner supplies stable public entry points.
- `replay-core/scripts/run-tests.mjs` currently scans only `test/` and
  `test/full-product/`. Add `test/v2/` discovery and teach its isolated-build
  resolver to preserve sibling protocol/engine dist resolution. The focused
  command above executes v2 independently in the meantime.
- Fix `simultaneousGroup` at the engine projection boundary as well, so live
  engine projections have the same privacy protection as replay output.
