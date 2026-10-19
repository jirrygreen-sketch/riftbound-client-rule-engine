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
- `missing-source-evidence`: the old survey identified a printing difference
  or unmatched functional clause. Yone, Blademaster and Riposte remain here
  even though their current program files say `executable`.
- `verified-no-ability`: an official printing has no ability text and the
  current no-ability program is the complete capability.

The current distribution is 21 merged awaiting acceptance, 24 dependency not
ready, 2 missing source evidence, and 4 verified no-ability. Across the card
program files, the literal statuses are 23 `executable`, 24
`judge-required`, and 4 `no-ability`. A status string is not an execution
proof, and merged code is not an acceptance result. The 21 merged-but-unaccepted
goldens retain 24 `test.todo` boundaries; the manifest indexes each one. A TODO
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
The captured probe evidence is
`/tmp/RIFT-857-m1-two-precons-acceptance/probe-final.json`, SHA-256
`d748ff5192d2cd0f1f8ca525cb62fe8e233d22d815a2b596e770b78c7e86999c`.

The existing four-deck Vex/Vi regression remains in
`packages/integration-tests/test/headless/dual-bot.test.ts` without deleted or
weakened assertions. A focused run alongside the privacy tests currently
reports 10 failed, 10 passed, and 1 TODO; the failures originate in
`runHeadlessGame` initialization on the same current judge-required programs.
This task does not relabel those failures as acceptance or use them to excuse
the two-precon gate.

## RIFT-831 setup status

The current HEAD contains the RIFT-831 lifecycle setup work from
`75b000695c208267c5460a5a909dafa1be4f7e4c` and the later merge
`21c9cb1524f38bb47779e3baf29d49488292e9e6`. The focused lifecycle regression
is `packages/engine-core/test/engine-gaps/lifecycle.test.mjs`. The sibling
commit `cd266f2bffe2dff9cd2851e647f00aa4c3e7b361` is not an ancestor of this
task HEAD. These lifecycle tests prove setup/leave boundaries; they do not
prove the two full precon programs execute.

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
3. Reverify the 21 merged-but-unaccepted programs through whole-card
   production scenarios, preserving every existing golden and adding legal,
   illegal, stale-target, declined, and atomic rollback boundaries.
4. Run the explicit 100-game gate. Acceptance requires 100/100 natural
   terminations with zero exceptions, replay mismatches, or privacy leaks.
5. Only after the automated gate passes, run the manual two-native-client game
   through the real public room path. This document does not claim that run.

No new task IDs are assigned here, and phase two is not authorized.

## Review commands

```sh
pnpm --filter @riftbound/integration-tests typecheck
pnpm --filter @riftbound/integration-tests exec vitest run --config vitest.config.ts test/headless/m1-pair.test.ts
```

The full explicit gate is available only by calling `runM1Acceptance()` from an
authorized verification context. It is intentionally not wired to an automatic
test because it must report an unaccepted result rather than create a synthetic
pass while prerequisites remain open.
