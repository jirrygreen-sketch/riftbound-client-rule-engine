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
  the current program. The current whitelist has no card in this state after
  reviewing the official Spiritforged errata's NEW/OLD text.
- `contract-request-required`: the card needs an additive shared contract before
  its real semantics can be represented. Fiora, Worthy uses this state because
  its triggered optional Order Power cost has no IR field or payment node.
- `verified-no-ability`: an official printing has no ability text and the
  current no-ability program is the complete capability.

The current distribution is 21 merged awaiting acceptance, 24 dependency not
ready, 1 contract-request-required, 1 missing source evidence, 0 blocked source
conflict, and 4 verified no-ability. Across the card program files, the literal
statuses are 23 `executable`, 24 `judge-required`, and 4 `no-ability`. A status
string is not an execution proof, and merged code is not an acceptance result.
The 51 independent golden files currently report 39 passing files, 12 failing
files, 272 passing cases, and 52 TODO cases. The manifest records the exact
exit/pass/fail/todo result for every card. A TODO does not count as an execution
pass, and a failing golden remains visible rather than being used as proof that
a feature is absent.

## Dedicated bounded entry

[`m1-pair.ts`](../../packages/integration-tests/src/headless/m1-pair.ts)
reuses the real `runHeadlessGame`, `HeadlessJournal`, and
`replayHeadlessJournal` paths. Importing the module only constructs a frozen
plan; it starts no games. The plan contains 100 different seeds:

- seeds 001 through 050 run Rumble on A and Fiora on B;
- seeds 051 through 100 reverse the seats.

`probeM1Acceptance()` executes at most the first case and returns whatever the
real production path produced. Its values are diagnostics, not a stable pass
condition: a future fix may legitimately turn the observed blocked game into a
winner, exception, or different blocker. A normal blocked, guard, or concession
result is retained and never promoted to a pass. `runM1Acceptance()` remains the
explicit 100-game gate and requires 100 distinct planned natural winners, no
exceptions or blockers, no concessions, exact embedded/fresh-world replay, and
privacy-safe projections. Neither function is called from module initialization
or the existing soak/CLI/feeder entry points.

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

On frozen integration `3ef041a1`, the first probe happened to end blocked in
seed 001 at `Unsupported filter field battlefieldWas`; its single journal had
replay and privacy agreement but no natural winner. That is an immutable audit
observation, not a current test expectation. The active production tree is
separate from the frozen evidence and may change as the named owners repair
shared ports. The complete M1 gate remains **0/100 accepted** until a real
`runM1Acceptance()` reaches the strict gate.

The existing four-deck Vex/Vi regression remains in
`packages/integration-tests/test/headless/dual-bot.test.ts` without deleted or
weakened assertions. A focused run alongside the privacy tests currently
reports 10 failed, 10 passed, and 1 TODO; the failures originate in
`runHeadlessGame` initialization on the same current judge-required programs.
This task does not relabel those failures as acceptance or use them to excuse
the two-precon gate.

## Production setup and frozen evidence

The audit snapshot `3ef041a1e78cc964b2d4c23d3af95f5c7d6302bd` records lifecycle
source/test hashes under `productionSetup.frozenEvidence`. Those hashes identify
the evidence that was reviewed; they do not require active `lifecycle.ts` or
its tests to remain byte-identical. A drift check may report that the manifest
needs a fresh review, but a legitimate implementation fix must not fail the
stable business acceptance suite merely because a historical hash changed.

Both deck builders are exercised directly from the official catalog records for
the selected printings: canonical identity, full name, card type, domains,
printed Energy/Power/Might (including null), card text, and the real 1 Legend, 1
chosen Champion, 39 Main Deck, 3 Battlefield, and 12 Rune shape. The live setup
and probe may advance independently of the frozen audit snapshot.

Fiora, Worthy has a source-backed acceptance checklist instead of a requirement
that the implementation remain incomplete:

- declining Finalize pays no Order and does not ready;
- accepting pays exactly one Order before Resolve;
- a live friendly unit crossing 4 → 5 triggers once, while 5 → 6 and a new
  incarnation do not;
- Resolve uses the frozen event `it` incarnation rather than a current-id
  lookup;
- unpayable payment rolls back atomically without readiness, receipt,
  frequency consumption, or a pending item.

The production Mighty matcher/producer, event-object binding, Finalize cost
mechanics, and pure Order conversion have progressed in integration. The
original Fiora CardProgram and its payment continuation still need their own
owners to make the whole-card checklist pass. The card remains pending; a
successful repair can add payment IR and change the observed IR without making
this test fail.

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
The official Spiritforged page labels “open battlefield” as OLD TEXT and
“uncontrolled” as NEW TEXT. The selected catalog text and current CardProgram
in `packages/card-dsl/src/cards/rad/yone-blademaster.ts` both use
“uncontrolled”, so the old source-conflict blocker is removed. Yone remains a
whole-card acceptance item because the program's Weaponmaster and combat body
have not passed a real default game. This task does not modify the card or
expand phase-one scope.

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
3. Reverify every executable or judge-required program with a whole-card
   production scenario. Start from its independent golden's observed result:
   update stale gap-existence assertions into positive behavior tests only where
   the authoritative primitive exists; retain genuine `test.todo` boundaries.
   Add legal, illegal, stale-target, declined, and atomic rollback cases where
   the card text requires them.
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
