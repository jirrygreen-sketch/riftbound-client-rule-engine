# Current Rules Audit

Audit date: 2026-10-12

This is an evidence-boundary audit, not a claim that the full official rules
engine is implemented. Current implementation and test status are tracked in
[implementation-status.md](implementation-status.md).

## Official Rule Versions

The official rules hub is the authoritative entry point:
https://playriftbound.com/en-us/rules-hub/

As of 2026-10-12:

- Active Core Rules: `v1.4`, last updated `2026-07-16`.
- Published future Core Rules target: `v1.5 / Radiance`, last updated
  `2026-10-09`, effective `2026-10-16`.
- Published future Tournament Rules target: `2026-10-09`, effective with the
  Radiance Pre-Rift on `2026-10-16`.
- The Radiance product release date is `2026-10-23`; it is not the rules
  effective date.

Official articles state calendar dates. Where fixtures use timestamps ending
in `T00:00:00.000Z`, the `00Z` value is a serialization assumption made by
this project, not an official claim that the rule takes effect at UTC midnight.

Verified official articles:

- Radiance rules update:
  https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/
- Tournament rules changelog:
  https://playriftbound.com/en-us/news/announcements/october-2026-tournament-rules-changelog/

## Local Source Evidence

Local SHA-256 verification on 2026-10-12:

| Local source | SHA-256 | Fixture status |
| --- | --- | --- |
| `work/riftboundfaq/sources/CR-v1.5.pdf` | `94d41fee86f88b61c4157c0389c0595d990b98e5b42555c99d9f649ee64d1fec` | Matches the registered Radiance Core Rules hash. |
| `work/riftboundfaq/sources/Tournament-Rules-2026-10-09.pdf` | `ce07da4fb632526afbbce7f058287a57e7444fa6bde17b0938ff52ce3fab3d07` | Matches the registered Tournament Rules hash. |
| `work/riftboundfaq/sources/CR-v1.4.pdf` | `9c5fb8b8638f2cd19ceda237929fa2c37aac23c797cc7410294993470ba5a30b` | Local file verified; the current fixture source table records no hash for Core 1.4. |

The Core 1.5 and Tournament hashes match the values recorded by the local
fixture set. The Core 1.4 hash observation is recorded here without changing
the fixture source table.

## Authority Boundaries

Official rules documents and official FAQ material are authoritative sources.
The local `work/riftboundfaq/content/(rulings)/` collection is a maintained
but non-official ruling and case collection. It can expose test scenarios and
interpretation disputes, but it is not a substitute for official rules or an
authoritative ruling.

The community card source is used only for correction, comparison, and missing
record detection. It is not the card-coverage baseline; that baseline comes from
the official gallery records.

Fixture `statement`, `given`, and `expected` fields are original project test
specifications. They are not copied official rule or ruling text. Fixture
evidence references identify sources; consumers must consult those sources and
their terms directly.

## Judge Required Semantics

Unknown or unsupported semantics must block automatic resolution:

- Unknown ability text is returned as `judgeRequired`, not approximated by the
  card DSL compiler.
- The foundation adapter marks official card text, inherent rune abilities,
  token-like definitions, and mapped multi-type definitions as judge-required
  rather than guessing an effect. Unsupported card types are rejected rather
  than being guessed as another engine type.
- Playing such a card creates an outstanding judge-required task and prompt.
  Answering the prompt with player confirmation returns the engine's
  `judge-required` error; an authoritative ruling is required.
- Rule fixtures may use `auto`, `prompt`, `judgeRequired`, or
  `notImplemented` decisions. Only `judgeRequired` may carry a judge reason,
  and that reason must cite registered evidence.
- `notImplemented` means official semantics is specified but the current
  implementation task is not complete. Schema validation success does not turn
  it into implemented behavior.

## Current Implementation Boundary

The current foundation surface is a narrow CR v1.4 1v1 Duel vertical slice:

- Each player opens with four submitted Main Deck cards.
- Cards are taken in submitted order for deterministic behavior.
- No official shuffle, mulligan, first-player selection, battlefield
  selection, rune channeling, sideboarding, or official ability execution is
  implemented.
- Submitted battlefields remain in the battlefield zone.
- Submitted runes remain in the private rune-deck zone.
- The server foundation adapter maps catalog printings into
  `createConfiguredGame`; it is not a second game core.
- The broader 1,381-card data snapshot establishes identity, text references,
  images, and bounded deck validation. It does not make card abilities
  executable.

## Audit Caveat

The coordinating session reported partial test verification on 2026-10-12:
protocol 7, engine-core 27, game-server 60, desktop-client 55, card-data 51,
card-dsl 14, judge-tools 17, and replay-core 10 passing. Integration tests
were 31 of 34 passing, with the remaining 3 under repair. This audit does not
assert full-suite green status or a fixed total test count.
