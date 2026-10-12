# Riftbound Rules Coverage

Status date: 2026-10-12

This document is evidence-bound. It classifies current repository behavior, not intent. Where official text, IR, runtime behavior, or tests do not close a semantic loop, the item is `judge-required` or explicitly not implemented.

## 1. Rule Version Boundary

As of 2026-10-12:

| Boundary | Status | Source |
| --- | --- | --- |
| Active Core Rules | `v1.4`, last updated `2026-07-16` | Official Rules Hub and Core Rules v1.4 |
| Published future Core Rules target | `v1.5 / Radiance`, last updated `2026-10-09`, effective `2026-10-16` | Official Rules Hub and Radiance patch notes |
| Published future Tournament Rules target | dated `2026-10-09`, effective `2026-10-16` | Official Tournament Rules changelog |
| Radiance product release | `2026-10-23` | Official Rules Hub / patch notes |

Official entry points:

- <https://playriftbound.com/en-us/rules-hub/>
- <https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/>
- <https://playriftbound.com/en-us/news/announcements/october-2026-tournament-rules-changelog/>
- <https://playriftbound.com/en-us/news/rules-and-releases/vendetta-rules-faq-and-clarifications>
- Future Core Rules v1.5 PDF: <https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf>
- Future Tournament Rules PDF: <https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/861752822d217edf37d9febaeaf77a7d924c1bb6.pdf>

Repository hashes for reviewed artifacts:

| Artifact | SHA-256 |
| --- | --- |
| Core Rules v1.4 | `9c5fb8b8638f2cd19ceda237929fa2c37aac23c797cc7410294993470ba5a30b` |
| Core Rules v1.5 / Radiance | `94d41fee86f88b61c4157c0389c0595d990b98e5b42555c99d9f649ee64d1fec` |
| Tournament Rules | `ce07da4fb632526afbbce7f058287a57e7444fa6bde17b0938ff52ce3fab3d07` |

Rules that differ between v1.4 and v1.5, notably the changed `ignored` / `Ignored` / `Negated` terminology and related replacement semantics, must remain v1.4-only until v1.5 is effective. Timestamps ending at `T00:00:00.000Z` in project serialization are implementation assumptions, not an official midnight-effective-time claim.

## 2. Executive Finding

The current full-product engine in `packages/engine-core/src/full-product/runtime.ts` is an experimental life/health/attack template and is not an official Riftbound runtime. It must not be exposed, selected, or advertised as official Riftbound gameplay.

The server adapter says this explicitly: `apps/game-server/src/full-product/runtime-adapter.ts:65` calls it an "Experimental life-based combat adapter, NOT the official Riftbound runtime." The adapter projects `score: player.life` at `runtime-adapter.ts:248` and labels natural endings `life-zero` at `runtime-adapter.ts:179`; those are compatibility projections, not evidence that score, Control, Conquer, or Hold are implemented.

Nonconformance in `packages/engine-core/src/full-product/runtime.ts`:

- Card definitions use `attack` and `health` at lines 41-46.
- Players use `life` at lines 75-78.
- The runtime accepts `declare-attack` at lines 94 and 162, permits a target unit or literal target `"player"`, and resolves declared attacks at lines 490 and 660.
- Loss is based on `life <= 0` at line 878.
- It effectively supports only `unit` and `spell` at lines 219-224, while `battlefield`, `rune`, `champion`, and `legend` appear as type labels rather than full official game-object implementations.
- `defaultMaximumBoardSize` is 6 at line 219. A generic board-size counter is not a Base/Battlefield Count model.
- There is no official Score, Base, Battlefield Location, Control, Contested, Conquer, Hold, Focus, Showdown, Combat Damage assignment, Deathknell, or cleanup victory state machine.

The protocol also aliases `FULL_PRODUCT_RULESET_ID` to the foundation identifier, and one translated event still emits `rulesetId: "riftbound-foundation"` at `runtime-adapter.ts:618`. These aliases are wiring plumbing, not official-rules coverage.

## 3. Official Core Rules v1.4 Baseline

The following short rule references are sufficient to define the required convergence target. They do not reproduce full official text.

| Official area | Core Rules v1.4 reference | Required state/action |
| --- | --- | --- |
| Base | `107.1` | One player Base; it is a Location; controlled Permanents and Runes reside there |
| Battlefield Zone | `107.2` | Houses multiple Battlefields; each Battlefield is individually a Location |
| Board Unit location | `141.1`, `146.1` | A Board Unit is at a Battlefield or its Base; its Location is the currently occupied Base or Battlefield |
| Contested | `190.3` | Applied when an opposing Unit becomes present; persists until Control is established/re-established subject to cleanup |
| Battlefield Control | `190.4` | Established at the end of Combat/Showdown when Units remain; maintained/lost under specified conditions |
| Cleanup victory | `194.2`, `194.3` | Cleanup checks Victory Score; default Victory Score is 8; winner must be unique |
| Beginning scoring step | `315.2.b` | Turn player Holds all controlled Battlefields |
| Showdowns | `316.8` | Combat and Non-Combat Showdowns; structured opportunity for Action/Reaction |
| Focus | `464.2.d` | Attacker gains Focus at Combat/Showdown opening |
| Combat Damage | `465.2` | Uses current Might; assignment and dealing are distinct and damage is dealt simultaneously after assignment |
| Control after Combat | `466.5` | Remaining Units establish Control; establishment can result in Conquer |
| Scoring | `468`, `469.1`, `469.2` | Scoring is Conquer or Hold of Battlefields |
| Final Point | `471.1` | Additional restriction applies to Conquer, not every point source |
| Score triggers | `471.2` | Score, Conquer, and Hold Battlefield abilities trigger when Scored |
| Cleanup win check | `472` | Reach Victory Score and have more points than every opponent in cleanup |
| 1v1 Duel | `485.3`, `485.4` | Victory Score 8; Battlefield Count 2; each player provides 3 Battlefields and only 1 is used, chosen during setup |
| Deathknell | `808.1.d` | Triggers on Killed and sent to Trash; replacements remove pending trigger; source details are snapshotted before movement |

No v1.5/Radiance semantic may replace a v1.4 behavior before `2026-10-16`.

## 4. Coverage Matrix

### 4.1 Implemented

These are implemented only at the stated repository boundary. They are not a complete official ruleset.

| Capability | Evidence | Boundary |
| --- | --- | --- |
| Canonical identity grouping for deck copy counting | `apps/game-server/src/card-catalog.ts`; `constructed-policy.ts:239-268` | Same official English `fullName` maps to one canonical identity |
| Constructed zone sizes and copy pools | `constructed-policy.ts:428-453` | Main Deck + Chosen Champion = 40; Legend = 1; Champion = 1; Runes = 12; Battlefields = 3; Sideboard = 0-10 |
| Default canonical copy limits | `constructed-policy.ts:126-133`, `432-442` | Main/Champion/Sideboard and Legend pool default 3; Runes 12; Battlefields 1 |
| Canonical copy counting across zones | `apps/game-server/src/deck-validation.ts:560-615` | Bans, restricted/limited policies, and canonical counts are enforced |
| Prompt blocking and judge-required refusal | Old foundation evidence in `packages/engine-core/src/index.ts`; server foundation adapter | A judge-required card blocks automatic approximation instead of guessing |
| Server-side versioning and idempotency plumbing | Full-product room/orchestrator tests | Does not make the underlying engine official |

`apps/game-server/src/card-catalog.ts:606-618` shows the actual catalog runtime uses the constructed-policy rules. `PARTIAL_DECK_RULES` in `deck-validation.ts:129-140` still has an unconnected Sideboard `10-10` value and a comment saying "sideboard is 10 cards"; this is an audit defect and should be reconciled or removed from active use.

### 4.2 Partially Implemented

Old foundation evidence is reusable as a seed, not as an official rules implementation:

| Foundation concept | Evidence |
| --- | --- |
| Player score | `packages/engine-core/src/state.ts:148`; initialization at `packages/engine-core/src/index.ts:637`; `gain-points` around `index.ts:1240`; score victory checks around `index.ts:1450-1505` |
| Base / Battlefield zones | `packages/engine-core/src/state.ts:10-27` and `154-156`; initialization/loading/projection around `index.ts:637-699` and `517-527` |
| Battlefield capacity | `packages/engine-core/src/state.ts:100-104`; default at `index.ts:238-240`; no runtime enforcement found |
| Priority and prompt | `packages/engine-core/src/state.ts:205-215`; initial priority at `index.ts:247-279`; pass rotation at `index.ts:869-885`; playable gating around `index.ts:1580-1592` |
| Judge-required blocking | `packages/engine-core/src/state.ts:56-61`; task creation around `index.ts:1029-1042`; prompt around `1344-1349`; refusal around `1204-1213` |
| Synthetic trigger | `packages/engine-core/src/index.ts:1115-1129` and `1342-1354`; this is not official Battlefield Conquer |
| Server foundation boundary | `apps/game-server/src/foundation-game.ts:19-41`; official-text/multi-type/rune/token-like cards are blocked as judge-required around lines 135-164 |

| Capability | Current behavior | Official gap |
| --- | --- | --- |
| Score | Old foundation has player `score`, `startingPoints`, `targetPoints`, and score victory; full-product adapter projects `score` from `life` | No full-product Conquer/Hold scoring, once-per-Battlefield-per-turn tracking, Final Point restriction, or cleanup unique-leader check |
| Base / Battlefield zones | Old foundation models `base` and `battlefield` zones and initializes/projects them | No Location model, per-Battlefield Control, Contested status, or official Board Unit location rules |
| Battlefield capacity | Old foundation has `battlefieldCapacity` with default 5 | No runtime capacity enforcement; capacity 5 is also not the official 1v1 Duel Battlefield Count 2 |
| Turn/priority machinery | Old foundation has active/priority rotation and prompt blocking; full product has a template turn loop | No official setup, mulligan, first-player selection, Battlefield selection, channel, HOT FEPR, Focus, Chain, Showdown, Combat, or cleanup fixed point |
| Automatic trigger concept | Old foundation has a synthetic optional `trigger-conquer` demo task and prompt | Not official Battlefield Conquer; no general triggered-ability, pending-chain, replacement, or Deathknell lifecycle |
| Full-product room orchestration | Two seats, deck validation, ready gating, start, reconnect/replay, idempotency, and result are tested | Orchestrator and adapter are not wired into the public WebSocket room lifecycle |
| EffectIR execution | Experimental runtime accepts eight opcodes | Not connected to official card pool; opcodes are not sufficient official semantics |

The old foundation can seed score, zone, prompt, and blocking patterns, but its synthetic trigger must not be renamed or reused as official Conquer.

### 4.3 Judge-Required

An item is `judge-required` when official behavior is known to exist but the implementation cannot automatically and verifiably execute it. It is not a fallback approximation.

The current classification includes:

- All official card ability text outside explicitly verified compiler and runtime coverage.
- Any official card whose text references location, Battlefield, Control, scoring, Combat, Showdown, Deathknell, replacement, hidden information, or target legality semantics not represented by the runtime.
- Any v1.4/v1.5 semantic difference that cannot be resolved from the effective official version.
- Any official judge or FAQ interpretation not present in the reviewed sources.
- Any ambiguity in whether an empty ability text printing truly has no ability; `no-ability` is a text classification, not proof of an official rules absence. Basic Runes still have inherent abilities under Core Rules `164.2`.

A card may leave `judge-required` only when all of the following close the loop: official text source, canonical identity, effect IR, deterministic runtime mechanism, version boundary, and focused tests. Experimental opcode support alone never changes the classification.

### 4.4 Explicitly Not Implemented

| Official capability | Status |
| --- | --- |
| Official Base/Battlefield Location model | Not implemented in full-product runtime |
| Contested and Battlefield Control | Not implemented |
| Conquer and Hold scoring | Not implemented |
| 8-point 1v1 Duel Victory Score configuration | Not implemented |
| Battlefield Count 2 and per-player 3-choose-1 setup | Not implemented |
| Official setup: shuffle, mulligan, first player, Battlefield selection, channel, draw | Not implemented |
| HOT FEPR and full priority transfer | Not implemented |
| Focus | Not implemented |
| Combat and Non-Combat Showdowns | Not implemented |
| Official Combat Damage assignment and simultaneous dealing | Not implemented |
| Cleanup fixed point and unique-leader victory | Not implemented |
| Deathknell trigger, replacement check, death snapshot, pending-chain removal | Not implemented |
| Official Battlefield/rune/champion/legend object behavior | Not implemented as a full state machine |
| Domain Identity restrictions | Explicit policy limitation in `constructed-policy.ts:135-149` |
| Champion/Legend/Signature restrictions | Explicit policy limitation in `constructed-policy.ts:135-149` |
| Independently verified regional product availability | Explicit policy limitation in `constructed-policy.ts:147-149` |

## 5. Card Data and EffectIR Coverage

Current coverage data in `packages/card-data/data/effect-coverage.json`:

| Metric | Count |
| --- | --- |
| Printings | 1,381 |
| Canonical identities | 1,080 |
| Executable effects | 0 |
| Judge-required effects | 1,348 |
| Empty-text / no-ability-classified effects | 33 |

The experimental full-product IR accepts these eight opcodes in `packages/card-dsl/src/full-product/types.ts` and executes them in `packages/card-dsl/src/full-product/runtime.ts`:

`cost.energy`, `draw.cards`, `gain.energy`, `gain.score`, `move.zone`, `prompt.target`, `chain.create`, `judge.required`.

This is schema/runtime support only. It is not wired to the official card pool and does not implement official Combat, Showdown, scoring, location, trigger, replacement, or DeathIR semantics. Therefore executable official-card coverage remains zero.

Room persistence work does not alter this coverage result. It only affects foundation/synthetic room durability and must not be counted as official rules implementation.

Earlier documentation mentioning four synthetic-demo opcodes describes a different, smaller experimental surface. The current full-product IR has eight opcodes; neither count is official card-pool coverage.

The maintained local `(rulings)` collection is non-official and is not treated as authoritative. The official Vendetta FAQ entry is a source, but each case must be separately verified and cited before it can alter runtime behavior; otherwise it remains `judge-required`.

## 6. Canonical Printing and Deck Rules

Canonical identity is derived from official English `fullName` in `constructed-policy.ts`. Alternate art, reprints, promos, and cross-set same-name printings share a canonical ID and merge for copy counting. This is the implementation's interpretation supported by Core Rules `132.3` / `132.4` and Tournament Rules `601.2.a`; the implementation does not independently claim an official "alternate art" clause.

Current default copy pool:

- Main Deck, Champion, and Sideboard: default 3 copies per canonical identity.
- Legend: default 3 copies per canonical identity.
- Rune Deck: default 12 copies per canonical identity.
- Battlefields: default 1 copy per canonical identity.

Current structure:

- Main Deck + Chosen Champion: exactly 40.
- Legend: exactly 1.
- Champion: exactly 1.
- Rune Deck: exactly 12.
- Battlefields: exactly 3.
- Sideboard: 0-10 in the active constructed policy.

The validator enforces canonical copy counts across configured zone groups at `deck-validation.ts:560-615` and requires distinct canonical identities in Battlefields at lines 630-638. The implementation explicitly marks Domain Identity, Champion/Legend/Signature restrictions, and independently verified regional availability as not implemented.

## 7. Convergence Plan

1. **Quarantine the template.** Keep the life/health/attack runtime experimental. Do not bind it to the public room lifecycle, package it as official Riftbound, or map `life` to `score`.
2. **Model official state.** Add score, Base, multiple Battlefields, Location, per-Battlefield Control, Contested status, current Might, turn-score tracking, and official object types as first-class state.
3. **Implement 1v1 Duel configuration.** Victory Score 8, Battlefield Count 2, and each player providing 3 Battlefields with one selected during setup.
4. **Implement setup.** Shuffle, mulligan, first-player selection, Battlefield selection, rune channeling, and initial draw must be deterministic and replayable.
5. **Implement turn machinery.** HOT FEPR, priority transfer, Focus, Chain, replacement checks, Cleanup fixed point, Showdown, and Combat must follow Core Rules v1.4.
6. **Implement scoring.** Hold in the Beginning Phase, Conquer on Control establishment, once per Battlefield per turn, Final Point restrictions, Score/Conquer/Hold triggers, and cleanup unique-leader victory.
7. **Implement Deathknell correctly.** Snapshot location and relevant details before movement, check replacement effects, add pending trigger before Trash movement, and remove pending trigger when the Kill/movement is replaced.
8. **Keep unknown card effects blocked.** Unsupported official text remains `judge-required`; no plausible approximation, inferred ruling, or unverified v1.5 semantics.
9. **Reuse foundation ideas only where valid.** Score/zone/prompt/blocking patterns can seed implementation; synthetic `trigger-conquer` cannot be treated as official Conquer.
10. **Gate release on official action tests.** Official state transitions need deterministic tests for setup, scoring, Combat/Showdown, Final Point, triggers, Deathknell, reconnect/replay, and private information.

## 8. Review Gates

Before the runtime can be called official Riftbound:

- Core Rules v1.4 references are bound to implementation and tests.
- Every rule in section 4.4 is moved only after implementation and focused tests.
- `judge-required` remains the only path for unverified official card effects.
- Card data coverage only counts a printing executable when the full semantic loop is closed.
- No full-product projection uses `life` as official `score`.
- v1.5/Radiance changes are introduced only after their effective date and under a separate versioned test suite.
