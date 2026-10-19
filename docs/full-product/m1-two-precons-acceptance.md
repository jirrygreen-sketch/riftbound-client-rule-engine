# RIFT-857: Two-precon M1 acceptance

This document defines the review boundary for the first M1 pair. It does not
declare the pair accepted. The machine-readable authority for the current card
whitelist is
[`m1-two-precons-manifest.json`](../plans/m1-two-precons-manifest.json).

## Fixed scope

The only phase-one decks are `rumble-sfd` (Rumble, Mechanized Menace) and
`fiora-sfd` (Fiora, Grand Duelist). The Vex and Vi decks remain available to
the existing headless regression and are not part of this acceptance. No card
outside the 51 canonical identities in the manifest may be admitted to this
phase by changing a fixture, stripping text, or filling an unsupported effect.

Both decks keep the existing selected construction: one Legend, one chosen
Champion, 39 Main Deck cards, three Battlefields, and 12 Runes. The Champion
card also occurs once in the Main Deck. `energy: null` and `power: null` remain
absence of a printed value. They are never normalized to zero.

| Deck | Legend | Chosen Champion | Main Deck | Battlefields | Runes | Unique canonical IDs |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Rumble | Mechanized Menace | Rumble, Hotheaded | 39 | 3 | 12 | 25 |
| Fiora | Grand Duelist | Fiora, Peerless | 39 | 3 | 12 | 26 |

The shared source plan is authoritative for the scope:
`/root/swarm-rift/shared/m1-two-precons-plan.json`, SHA-256
`766542e45e2a2dcdb9d52c76f3483790584e649419635b8f04ccea6724ed4303`.
The tracked deck source is `docs/plans/m1-decks.json`, SHA-256
`17227200ed8b5db2f09cd5e7e05949b72c7c13bdab50ac1e954739c76b14ff04`.
The gitignored local catalog is `packages/card-data/data/deck-catalog.json`,
SHA-256 `06d99a589fed6046bff8072847946d5304a8ca43ef1e4e2c680c4a7a0f1df766`.
Its declared digest is
`sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10`.

## Evidence states

The manifest deliberately separates four states:

- `merged-awaiting-acceptance`: a CardProgram exists and its current status is
  `executable`, but the complete card has not yet passed a real production
  acceptance scenario.
- `dependency-not-ready`: the program is `judge-required` because a named
  engine, event, cost, target, or lifecycle dependency is incomplete.
- `missing-source-evidence`: the old survey identified an unmatched functional
  clause. Riposte remains here even though its current program file says
  `executable`.
- `blocked-source-conflict`: an official card source directly conflicts with
  the current program. Yone is moved here from `missing-source-evidence`.
- `contract-request-required`: the card needs an additive shared contract before
  its real semantics can be represented. Fiora, Worthy uses this state because
  its triggered optional Order Power cost has no IR field or payment node.
- `verified-no-ability`: an official printing has no ability text and the
  current no-ability program is the complete capability.

The current distribution is 20 merged awaiting acceptance, 24 dependency not
ready, 1 contract-request-required, 1 missing source evidence, 1 blocked source
conflict, and 4 verified no-ability. Across the card
program files, the literal statuses are 23 `executable`, 24
`judge-required`, and 4 `no-ability`. A status string is not an execution
proof, and merged code is not an acceptance result. The 20 merged-but-unaccepted
goldens retain 23 `test.todo` boundaries; the manifest indexes each one. A TODO
does not count as an execution pass.

## Dedicated bounded entry

[`m1-pair.ts`](../../packages/integration-tests/src/headless/m1-pair.ts)
reuses the real `runHeadlessGame`, `HeadlessJournal`, and
`replayHeadlessJournal` paths. Importing the module only constructs a frozen
plan; it starts no games. The plan contains 100 different seeds:

- seeds 001 through 050 run Rumble on A and Fiora on B;
- seeds 051 through 100 reverse the seats.

`probeM1Acceptance()` executes at most the first case. A thrown initialization
error, or a game terminating with an exception, stops the run and returns the
exact seed, orientation, error, canonical card ID, program status, and judge
reason available from the real error. `runM1Acceptance()` is the explicit full
gate. Neither function is called from module initialization or the existing
soak/CLI/feeder entry points.

The direct Node 22 form used for a review probe is:

```sh
node --experimental-strip-types - <<'NODE'
const m = await import("./packages/integration-tests/src/headless/m1-pair.ts");
console.log(JSON.stringify(m.probeM1Acceptance(), null, 2));
NODE
```

Each result retains the actual termination, winner, scores, committed battle
timing events, journal digest, A/B projection digests, the spectator projection
digest recovered from the final journal, embedded replay result, independent
fresh-world replay result, privacy result, exceptions, blockers, and concede
count. A game counts as natural only when the engine declares a
winner at or above the victory score and all replay, privacy, blocker,
exception, and concede conditions also pass. Blocked, guard, concession,
exception, replay mismatch, and privacy leak always fail the aggregate.

The current first probe stops during initialization before any command. The
real lifecycle rejects Ferrous Forerunner's shipped `judge-required`
`CardProgram` with `ProgramBindingError` and canonical ID
`card.hash-057dababf241fe29f90a9a6c306d4463227bed0d80f3df33c8261f7f43f5fed3`.
This is why the full 100-game acceptance has not run. Zero games have been
accepted; the pair is not a pass.
The captured current probe evidence is
`/tmp/RIFT-857-m1-two-precons-acceptance/probe-current.json`, SHA-256
`d748ff5192d2cd0f1f8ca525cb62fe8e233d22d815a2b596e770b78c7e86999c`.

The existing four-deck Vex/Vi regression remains in
`packages/integration-tests/test/headless/dual-bot.test.ts` without deleted or
weakened assertions. A focused run alongside the privacy tests currently
reports 10 failed, 10 passed, and 1 TODO; the failures originate in
`runHeadlessGame` initialization on the same current judge-required programs.
This task does not relabel those failures as acceptance or use them to excuse
the two-precon gate.

## RIFT-831 setup status

The current task HEAD `e2710938ce4b4cc9c492dcf1e848c7ba9801b703` does not
contain the required newsource merge `b6dc9debd813125413085a8a301f1ccdec5ef092`.
The parent review HEAD `f036b0e5026aba1668ae88be2d74a05abeb55670` is also not
an ancestor of this task HEAD. The current lifecycle is SHA-256
`59aa7584e929afef458df2a862e643e0462bebbbc4497eec872ff67fa2f1166e`;
the newsource lifecycle is
`9172c97c4fcda86998e5ac6d98810ccb56724fdf1d3bd181919270a48512adbd`.
Their focused lifecycle tests also differ. The current test passes 8/8, but it
does not prove the refreshed newsource setup/leave boundary. The manifest marks
this as `parent-wiring-required`; the parent must integrate the newsource
before treating the 831 boundary as refreshed.

Fiora, Worthy is not certified by its `executable` label. The parent full-seed
probe at `/root/swarm-rift/shared/parent-reviews/integration-f036b0e5-20261019-0745/full-seed-probe.json`
(SHA-256 `e366720c974fcda8c18ccd742ef347386c071acc7cbed566be8af966d38c6c23`)
reaches a real `ProgramBindingError: Unsupported filter field becomesMighty`.
Its printed optional one Order Power payment appears only in comments: the
program has one `effect.ready` instruction and no payment IR. The manifest now
maps these to the might-changed payload/filter producer, triggered optional
Finalize cost, and the authoritative event:it bridge, all owned by
`engine-core`. The optional Order Power portion also needs a parent-owned
additive IR/wire change because `TriggeredAbility` has no cost field. The
manifest records that contract request and keeps the card
`contract-request-required`; it does not silently certify the executable label.

## Official effect order and source precedence

The machine-readable evidence is under `effectOrderPolicy`,
`officialEffectOrderEvidence`, and `cardSourceConflicts` in the manifest. It
uses the official policy snapshot (`official-effect-order-policy.json`, SHA-256
`1d5f9b0faae6cfd31861b61c0d6c430e3775f05a88ae4ca4fa6a2023d1d0f2f6`), its
source snapshot index, and the cached Core Rules v1.5 text. Core Rules v1.5 is
dated 2026-10-09 and effective 2026-10-16. The official Radiance rulings are
dated 2026-10-09 and effective 2026-10-16. The cached Spiritforged errata was
published 2026-01-14 and states no separate effective date; the Spiritforged
rules patch states an effective date of 2025-12-12.

The policy separates the source rules rather than assigning every card a
numeric priority. CR 002 allows a card to control when it fundamentally
contradicts the rules. CR 051 interprets card terminology through the rules.
CR 054.1 applies a prohibition to the same action or effect under its concrete
conditions. CR 303.2.a orders simultaneous actions, effects, and triggers by
the applicable turn/controller rule; it does not collapse the Chain into a
single FIFO or LIFO rule. Finalize remains oldest-first and Resolve
newest-first under CR 337 and CR 340.

The evidence index covers Priority/Focus and legal Reaction windows; cost and
optional additional-cost choice, payment, legality, and rollback; replacement
and prevent ordering; continuous layers and object dependencies; simultaneous
trigger order; Pending/Finalize/Resolve; invalid targets, Ignored/Negated
instructions, linked instructions, and LKI; and combat designation and
simultaneous damage. Each entry records official URLs, publication/effective
dates where stated, rule numbers, M1 canonical IDs, a timeline, player choice
and response windows, current production entry, and an exact existing test
title. The current index has 4 verified mechanisms, 5 pending integrations, and
3 blocked interactions. A verified mechanism is not a whole-card or whole-deck
pass.

The official Radiance Chronobreak ruling is indexed as blocked and not
generalized. It requires each owner to order only its own played-back units,
then groups are placed in turn order; the full interaction is not implemented.
The index also records the official Spiritforged Yone errata conflict: the
selected `sfd-233-star-221` printing and official errata use “open
battlefield”, while the current CardProgram in
`packages/card-dsl/src/cards/rad/yone-blademaster.ts` uses “uncontrolled”. The
card is blocked for review by the existing card-dsl owner; this task does not
modify it or expand phase-one scope.

The official source set and their SHA-256 values are recorded in the manifest.
The source snapshots are authoritative evidence; the local HTML/PDF cache is
not a replacement for the linked official pages. Community FAQs and videos
remain discovery aids only. A later Core Rules version requires a separate
versioned diff and must not silently replace the current game or replay
ruleset profile.

## Minimum follow-up sequence

1. Close the generic engine prerequisites before changing card ownership:
   token entry and Deathknell; dynamic keyword re-expansion; combat/score event
   payloads and the location anchor; effective-Mighty queries; additional and
   Repeat cost Finalize/rollback; non-target pick/Equipment binding; and the
   Legion finalized-card history condition. The manifest maps exact source
   paths, dependent canonical cards, card programs, independent goldens,
   template goldens, source evidence, and acceptance obligations.
2. Resolve Yone and Riposte source evidence from official card text and Core
   Rules v1.5. Do not promote them from `executable` status alone.
3. Reverify the 20 merged-but-unaccepted programs through whole-card
   production scenarios, preserving every existing golden and adding legal,
   illegal, stale-target, declined, and atomic rollback boundaries.
4. Run the explicit 100-game gate. Acceptance requires 100/100 natural
   terminations with zero exceptions, replay mismatches, or privacy leaks.
5. Only after the automated gate passes, run the manual two-native-client game
   through the real public room path. This document does not claim that run.

No new task IDs are assigned here, and phase two is not authorized.

## Contract change request

The manifest requests one additive contract from the parent contract owner:
`TriggeredAbility.cost?: CostSpec`. The current type has no triggered-cost
field, so Fiora, Worthy's printed optional one Order Power payment cannot be
represented by the existing program even though the card file comments claim
it. The matching engine change is to translate that cost into
`TriggerRegistration.cost` and ask, decline, pay, or roll back at Finalize
before Resolve. The field must be optional, old profiles 1–9 and old journals
must remain unchanged, and no replay/schema version may be silently upgraded.
Minimum acceptance is: decline pays nothing; a chosen Order Power is paid once;
an unpayable payment rolls back atomically; and Resolve never re-prompts for a
cost already locked or declined at Finalize. This request is recorded, not
approved by this task.

## Review commands

```sh
pnpm --filter @riftbound/integration-tests typecheck
pnpm --filter @riftbound/integration-tests exec vitest run --config vitest.config.ts test/headless/m1-pair.test.ts
```

The full explicit gate is available only by calling `runM1Acceptance()` from an
authorized verification context. It is intentionally not wired to an automatic
test because it must report an unaccepted result rather than create a synthetic
pass while prerequisites remain open.
