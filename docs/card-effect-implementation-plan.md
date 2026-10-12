# Card Effect Implementation Plan

Requested as-of: 2026-10-11 (Asia/Hong Kong)

Audit run: 2026-10-12 (Asia/Hong Kong)

## Rules Boundary

The active baseline is Core Rules v1.4, last updated 2026-07-16. Core Rules
v1.5 / Radiance and Tournament Rules 2026-10-09 are published future targets,
effective 2026-10-16. The local file
`work/riftbound-core-rules-text/Riftbound-Core-Rules-Latest.txt` is still
the v1.4 text and has SHA-256
`613934903FDC7DBF9FA3FA792E4A6B622F8856CCFF2EE38B85AC466202D67F0D`.

`work/riftboundfaq/sources/rules-manifest.json` labels `current` as `"1.5"`,
but that downloaded manifest state is not proof that v1.5 is active before
2026-10-16. This plan uses v1.4 semantics for the current baseline. In
particular, v1.4 still uses broad `ignored` behavior, while v1.5 separates
`Ignored` from `Negated` and gives their linked instructions different
consequences. Do not silently apply that v1.5 behavior before its effective
date.

The Disintegrate case is version-sensitive: its linked kill-and-draw behavior
must be tested against the active baseline rather than inferred from v1.5.
Its printed catalog text remains unchanged.

This is a candidate review, not an implementation report. The machine-readable
cases are in `work/reviews/effect-candidate-cases.json`. The two files must
continue to agree on the eight candidates, opcodes, statuses, and limitations.

## Baseline

The current catalog and coverage report contain:

| Metric | Count |
| --- | ---: |
| Printings | 1,381 |
| Canonical identities | 1,080 |
| Executable effects | 0 |
| Judge-required effects | 1,348 |
| Empty ability text | 33 |

The source files are `packages/card-data/data/deck-catalog.json` and
`packages/card-data/data/effect-coverage.json`. The canonical identity key
makes alternate art and cross-set duplicates one logical card, so coverage work
should count identities rather than printings. Some identity groups contain
multiple printings; for example, `ogn-076-298` and `ogn-076a-298` are two
printings of the same Yasuo identity.

All eight candidate cases are `judge-required` in the current coverage report.
They are candidate inputs for future work, not completed implementations.

## Engine Reality

The candidate opcodes are not integrated into the real card pool yet.

- `packages/engine-core/src/state.ts` currently defines only
  `DamageEffect`, `GainPointsEffect`, and `JudgeRequiredEffect`.
- `packages/card-dsl/src/index.ts` currently recognizes only the
  synthetic-demo opcodes `draw.cards`, `damage.target`, `gain.energy`, and
  `summon.self`.
- `compileEffectText` accepts only a small set of synthetic-demo sentences.
- None of those opcodes is wired into card-pool execution, so no candidate
  printing should move to `executable` from the existing engine alone.

## No-Ability Classification

The 33 empty-text printings represent 15 canonical identities: six Basic Runes
and nine Units.

The 24 Rune printings are six canonical Basic Runes, four printings each:
Fury, Calm, Mind, Body, Chaos, and Order. They are not vanilla cards. Core
Rules 164.2 states that every Basic Rune always has two abilities:

1. `[E]: [Reaction] - Add [1]`
2. `Recycle this: [Reaction] - Add [C]`, where `[C]` is Power of that Rune's
   Domain.

These abilities come from the rules, not from the empty upstream text. They
need a structural Rune object, Rune Deck, recycle destination, resource pool,
and activated-ability lifecycle. They should not be counted as executable
effects merely because `ability` is empty.

The nine no-text Unit identities are Playful Phantom, Mega-Mech, Mountain
Drake, Shipyard Skulker, Vanguard Sergeant, three domain-specific Recruits,
and VEN Recruit. Their empty text is valid, but they are only runnable once the
engine has Unit objects with Might, damage markers, entering exhausted, and
standard unit behavior. They are candidates for object-model support, not
effect-compiler wins.

## Candidate Families

All eight cases remain candidates with coverage status `judge-required`. A
card can only move out of `judge-required` when every required mechanism is
implemented and tested. Partial support must leave it `judge-required`.

| Printing | Candidate | Family | Required opcodes | Current limitation |
| --- | --- | --- | --- | --- |
| `ogn-009-298` | Hextech Ray | Fixed damage to one target | `chooseTarget`, `dealDamage` | Target legality must be retested at Resolve |
| `ogn-005-298` | Disintegrate | Damage plus linked condition | `chooseTarget`, `dealDamage`, `condition.ifKilled`, `draw` | Kill attribution and v1.4 ignored behavior are required |
| `ven-048-166` | Cloud Drake | Self-play draw | `trigger.whenYouPlaySelf`, `draw` | Card-played lifecycle and counters are not implemented |
| `ogn-096-298` | Watchful Sentry | Deathknell draw | `trigger.deathknell`, `draw` | Pending trigger and replacement handling are required |
| `ogn-134-298` | Mobilize | Channel fallback | `channelRune`, `condition.ifCannot`, `draw` | Rune Deck and explicit channel outcome count are required |
| `ogn-216-298` | Soaring Scout | Deathknell channel | `trigger.deathknell`, `channelRune` | Deathknell and Rune Deck support are required |
| `sfd-031-221` | Desert's Call | Token summon | `createToken`, `playToken` | Token object model is required; Repeat stays a separate gate |
| `ogn-076-298` | Yasuo, Remorseful | Attack-trigger dynamic damage | `trigger.whenIAttack`, `chooseTarget`, `dealDamage`, `value.currentMight` | Attack event and current-Might resolution are required |

Lecturing Yordle (`ogn-087-298`) is another self-play Draw 1 representative,
but its Tank keyword is unrelated to the draw instruction. It should not become
executable until Tank combat-damage assignment is also supported; otherwise
the draw parser alone is not enough evidence.

## Module Scope

Future implementation should stay inside the package boundaries below, with
each package's tests changed only in that package's `test/` directory:

| Module | Owned contract |
| --- | --- |
| `packages/card-dsl/src/index.ts` | IR opcodes, targets, triggers, conditions, values, validation, and compilation |
| `packages/card-dsl/test/card-dsl.test.mjs` | IR validation and text-compilation cases |
| `packages/card-data/src/index.ts` | Compilation coverage mapping and status selection |
| `packages/card-data/test/card-data.test.mjs` | Printing-to-identity and coverage-count assertions |
| `packages/engine-core/src/state.ts` | Execution state, pending items, zones, targets, and cleanup types |
| `packages/engine-core/src/index.ts` | Execution, target resolution, events, and cleanup behavior |
| `packages/engine-core/test/engine.test.mjs` | Rule-behavior and lifecycle cases |

Keep shared contract changes centralized in the coordinating workstream.
Regenerate `packages/card-data/data/effect-coverage.json` only through the
package script after the compiler and tests are ready; do not hand-edit the
generated coverage report.

## Implementation Batches

1. **Target, damage, and draw foundation.** Add `chooseTarget`, `dealDamage`,
   `draw`, `condition.ifKilled`, and the `spell.resolve`, `card.played`, and
   `source.died` event plumbing needed by Hextech Ray, Disintegrate, Cloud
   Drake, and Watchful Sentry. Implement Finalize locking and Resolve
   retesting, kill attribution, pending Deathknell creation, replacement
   removal, Burn Out, and lethal-damage cleanup. Use v1.4 `ignored` behavior
   for Disintegrate until the v1.5 effective date.
2. **Channel and fallback.** Add `channelRune` and `condition.ifCannot` for
   Mobilize and Soaring Scout. Channel must produce an explicit success count
   during Resolve; `If you can't` must not be approximated from a pre-resolve
   legality guess.
3. **Token summon.** Add `createToken` and `playToken` for Desert's Call.
   Implement token units with Might, exhausted entry, and board location.
   Keep optional Repeat costs and independent repeat choices as a later gate,
   so the card remains `judge-required` until that behavior is verified.
4. **Attack-trigger dynamic damage.** Add `trigger.whenIAttack` and
   `value.currentMight` for Yasuo. The attack event must identify the source
   battlefield and Resolve must read current Might rather than a stale value.
5. **Structural Basic Runes.** Implement the inherent Core Rules 164.2 Rune
   abilities separately from effect text. Do not derive them from the empty
   card text.

## Acceptance Commands

Run these package-level gates after each batch:

```text
pnpm --filter @riftbound/card-dsl test
pnpm --filter @riftbound/engine-core test
pnpm --filter @riftbound/card-data test
pnpm --filter @riftbound/card-dsl typecheck
pnpm --filter @riftbound/engine-core typecheck
pnpm --filter @riftbound/card-data typecheck
```

After compiler and engine tests pass, regenerate and inspect coverage with:

```text
pnpm --filter @riftbound/card-data build:coverage
```

Keep validation package-level and focused. Run full-project tests only if a
change crosses these package boundaries.

## Test Requirements

Each family needs at least:

- A success case.
- An invalid or unavailable target case where applicable.
- An insufficient-resource case such as an empty Main Deck or Rune Deck.
- A replacement or counter case where the effect must not fire.
- A printing-to-identity assertion so alternate printings do not inflate
  executable counts.

Tests should assert the printed original text and official rules references
alongside the IR. Unknown text, unresolved ambiguity, or partial mechanism
support must produce `judge-required`, not a plausible interpretation.

## Explicit Non-Promises

This plan does not promise full card-pool support. It does not translate or
infer Chinese semantics, and it does not classify the remaining 1,348
`judge-required` printings as unsupported forever. The candidate batch is
limited to eight verified cases that can drive the next engine and DSL
interface work. No candidate is implemented merely because it appears here.
