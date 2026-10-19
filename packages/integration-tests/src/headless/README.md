# Headless official-deck runner

The runner uses `createMatch`, `TurnFlow.execute/move/pass/endTurn/advance` and
`CombatFlow.dealDamage`; it never settles a rules action itself. The default
victory threshold remains the engine's eight points. The forty-turn and 10,000
command limits leave the match unfinished with `termination: "guard"`. There is
no automatic concession. `completed`/`winners` count actual engine winners only.

Candidate plays use the priority holder's own hand and the engine's timing and
location queries, including Action/Reaction in Showdowns and Reaction in closed
Chains. Movement candidates use layered objects and movement restrictions:
Base → Battlefield, Battlefield → own Base, and Battlefield → Battlefield only
with an engine-derived Ganking permission. Final legality/cost validation stays
with the engine. Attack/defense designations belong to the engine's engagement
process; the bot must not manufacture either designation.

Battle counts are derived from committed timing events (`combat-start`,
`attack-declared`, `defense-declared`, `showdown-open`, `conquer`, `score`, and
`points-gained`). Rejected intentions do not count as combat or scoring.
`winnerRatio`, `winsByPlayer`, `averageTurns`, `terminationReasons`, and
`blockerReasons` are included for each pair and the matrix.

Journals contain the setup seed/mulligans, exact commands and rejection reasons,
complete committed events, kernel-state/linked-state/chain digests, and final
A/B/spectator projection digests. Replay compares all of these state/event
facts. New journals also carry a content-integrity digest so altered commands,
events, failures or final state are rejected before replay; journals without
that optional field remain replayable through the complete strict path.
Projection privacy is audited at setup and after every attempted command,
including current objects and newly committed nested events, for both players
and spectators, with a full final A/B/spectator projection check. Journals are
authoritative private evidence and are not client projections.

For exactly 100 games, run one pair (the CLI's `--games` is **per pairing**):

```sh
heavy pnpm --filter @riftbound/integration-tests headless --games=100 --decks=rumble-sfd,fiora-sfd --max-turns=40
```

`--seeds` accepts a comma-separated fixed-seed list; `--max-actions` sets the
independent command guard. With four decks, `--games=100` runs 600 games.

## Contract change requests / unfinished natural-victory gate

These are observed limitations of the `src/game` + `src/turn` + `src/combat`
path, not permission to substitute lower-level mutations or no-op services.
The fixed-seed eight-point battle-victory test remains TODO until the path has
real commands and source-backed services for these obligations:

1. `game/lifecycle.ts`: `MatchCard` does not carry printed characteristics;
   `tokenCard` sets Energy/Power/Might to null and `createDeckCards` labels every
   main-deck card `unit`. Request catalog-bound type/stat/cost propagation,
   preserving actual printed nulls, and lifecycle/program binding during setup.
   Filling these fields by editing the kernel after setup is not acceptable.
2. `turn/flow.ts` / `combat/flow.ts`: `move(player, ref, fieldId)` always blocks
   a valid move with `standard-move-transaction`; it cannot express a Base
   destination at all. Request atomic Exhaust + Move (including group moves),
   destination/permission validation, Move triggers and cleanup, through the
   public match command path (CR v1.5 144.1–144.4, 450–455).
3. `combat/flow.ts`: combat start and Showdown conversion throw
   `combat-start-transaction` / `showdown-conversion`; `dealDamage()` always
   throws `simultaneous-damage-transaction` and exposes no damage-choice input.
   Request engagement opening, engine-owned attacker/defender designations,
   legal damage choices and an atomic simultaneous-damage command connected to
   this Match, including real cleanup/Conquer/Score (CR v1.5 462–468).
   The separate canonical Duel V2 executors require different admitted state
   and trusted services; they cannot be grafted onto this Match with fake
   callbacks or copied board state.
4. `programs/*`: an `executable` registry label does not guarantee this binding
   supports the whole program. For example, the actual Bubble Bot lifecycle
   rejects `other` in a filter with `ProgramBindingError: judge-required`.
   Some generated triggers also fail the engine's closed event vocabulary with
   `TriggerSpecValidationError`; these retain the full diagnostic under
   `unsupported-trigger-spec`. Request source-backed binding support (or
   corrected unsupported status).
   The runner surfaces these failures as `blocked`, preserving pending official
   semantics, instead of swallowing the failure and ending the turn.

An all-green diagnostic regression is **not** evidence that the official
setup → turns → combat → scoring → natural victory gate is complete. Consult
actual `winners` and `battleStats`, and retain the reported blocker distribution.

## Verification on 2026-10-18

The 100 distinct seeds `RIFT-739-natural-1` through `RIFT-739-natural-100`
(rumble-sfd versus fiora-sfd) produced **0 natural winners**, 100 blocked,
0 concessions/exceptions/guards, and an average of 1.12 started turns. The
blockers were 72 missing printed costs, 4 missing source cost domains, and
24 unsupported `other` filters. Combat/Conquer/Score counts were all zero.
Twelve actual target selections were answered. All journals replayed and all
player/spectator privacy audits passed. This run does not meet M1 natural victory.

The focused headless suite passed 17 tests with the natural-victory gate left
as one TODO; `heavy pnpm typecheck` exited zero. The complete integration package
is not green: multiplayer tests hit their existing ten-second deadlines, and
one loaded run also hit the existing thirty-second deterministic-game deadline
(the final focused suite passed unchanged assertions). The separately executed
default-path suite failed nine assertions expecting the old P4/schema-7 runtime;
those CLI/runtime/test files are unchanged from task baseline `c8b86a3`.
No legacy profile, journal, snapshot or timeout was modified to hide these failures.

Local evidence is under `/tmp/RIFT-739-headless-natural-victory/`, especially
`hundred-verified-summary.json`, `headless-final.log`, `typecheck-verified.log`,
`package-test-final-idle.log`, and `default-path.log`.
