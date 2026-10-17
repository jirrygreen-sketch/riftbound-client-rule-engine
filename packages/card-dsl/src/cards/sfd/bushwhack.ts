import type { CardProgram } from "../../ir/index.js";

/**
 * Bushwhack (sfd-004-221) — Spell, 2 Energy + 1 Fury power, Fury.
 *
 * Printed text:
 *   [Hidden] (Hide now for :rb_rune_rainbow: to react with later for
 *   :rb_energy_0:.)
 *   Friendly units enter ready this turn. Play a Gold gear token exhausted.
 *
 * Catalog evidence (packages/card-data/data/deck-catalog.json, sfd-004-221):
 * cardType Spell, domains ["Fury"], energy 2, power 1, might null, tags [].
 *
 * Modeling notes (Core Rules v1.5):
 * - [Hidden] (811) is a keyword ability: 811.1.b keeps the card in hand (or in
 *   the Champion Zone) and lets its controller Hide it as a Discretionary
 *   Action, 811.1.c.2 keeps Hide off the chain, and 811.6 grants Reaction to a
 *   card that was hidden or played from facedown from the next turn on. The card
 *   declares the keyword only; the expansion's cost.hidden effect still needs
 *   the Hide/facedown/timing integration.
 * - "Friendly units enter ready this turn" is an entry replacement, not a
 *   later Ready: 143.4 makes units enter the Board exhausted, 184.1 / 185.2.d
 *   let an effect state that an object enters ready, and 369.1 / 369.3 make such
 *   a clause a Replacement Effect over the entry event (Master Yi, Honed "I
 *   enter ready" is the quoted example). 805.6's Accelerate wording is explicit
 *   that the replacement is not "enter exhausted and then become ready", so
 *   `effect.ready` cannot stand in (effect.ready's own header says the same).
 *   The affected units are selected programmatically by their controller, so
 *   they are not targets (355.10.d).
 * - "Play a Gold gear token exhausted" is the play of a NEW token: 440.2.c /
 *   185.2.a create a played token on the Chain first and let the play procedure
 *   finish (350.2, 354); 187.5 defines the Gold gear token as a domainless gear
 *   token that carries its own printed "[Reaction][>] Kill this, [E]: [Add]
 *   [A]." ability. "exhausted" is the entry stipulation of 184.1 / 185.2.d for
 *   a token whose default state would be ready (149.1 / 359.2.d: non-Unit Gear
 *   enters Ready at the player's Base), not a later Exhaust (143.4).
 *
 * Status: judge-required (re-checked 2026-10-17). Three real gaps, none
 * approximated:
 * - Hidden has no executable reader: the merged `cost.hidden` static effect has
 *   no consumer that grants the Hide action, the facedown zone or the facedown
 *   play (cost/README.md records the full payment-scope contract as still
 *   requested), the GameAction set has no "hide" action, and
 *   programs/statics.ts layerFor has no mapping for the cost.hidden kind;
 * - replacement.enter is registered and supports this-turn duration, but its
 *   appliesTo must identify the host/source. The binder's matchesEnterAction
 *   likewise only orients that host's chain-to-board move. This spell needs
 *   other friendly units, including newly created tokens, to enter ready.
 *   ResolveContext.replacement is also a runtime-only extension not forwarded
 *   by the production interpreter; effect.ready after entry is not equivalent;
 * - the Gold token cannot be played: 187.5's definition carries its own
 *   ability, which `effect.token`'s frozen DEFINITIONS table deliberately
 *   excludes ("definitions requiring other abilities, including Gold, remain
 *   blocked/judge-required"), and the create-token/play actions support no
 *   entry-state override ("Entry overrides are not supported").
 * The printed structure (token id, destination, entry exhaustion, replacement
 * scope) is recorded so the card can be completed without re-deriving it.
 */
export default {
  canonicalCardId: "card.hash-ee775877b722c8156c89940004f522bef67be48c96cbc0ae9175061e38ad6c56",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "复核 2026-10-17：(1) cost.hidden 尚未接通 Hide 动作、facedown 区域与次回合打出许可" +
    "（811.1.b/811.1.c/811.6），programs/statics.ts 的 layerFor 对该静态效果没有映射。" +
    "(2) replacement.enter 原语与 this-turn 时限已合入，但 appliesTo 必须标识 host/source，" +
    "replacement/bind.ts 的 matchesEnterAction 也仅改写宿主的 chain→board move-zone，不能覆盖其他友方单位；" +
    "object-enters-board 映射不包含 create-token。生产解释器还未转发运行时扩展 ResolveContext.replacement（host + pipeline）。" +
    "缺本回合跨对象入场朝向替代（143.4/184.1/185.2.d/369.3/805.6），事后 effect.ready 不等价。" +
    "(3) effect.token 已有 create-token(to: chain)→play 路径，但定义表仍不含带 187.5 印刷能力的 Gold，" +
    "且 TokenSpec/create-token/play 不支持 entersExhausted 入场覆盖（Entry overrides are not supported）。" +
    "依赖：Hidden 执行接线、跨对象临时入场替代及其结算上下文、Gold 定义/能力与横置入场支持。",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    {
      kind: "play",
      // Printed cost (2 Energy + 1 Fury power) comes from the catalog; the
      // Finalize cost plan is its consumer.
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          // "Friendly units enter ready this turn" — the entry replacement is
          // retained as a blocked cross-object declaration: replacement.enter
          // currently registers host/source entry only (see judgeReason).
          // The affected units are selected by
          // characteristics, so they carry no TargetSpec (355.10.d).
          id: "bushwhack.units-enter-ready",
          op: "replacement.enter",
          args: {
            duration: { kind: "constant", value: "this-turn" },
            exhausts: { kind: "constant", value: false },
            appliesTo: {
              kind: "constant",
              value: { type: "unit", controller: "controller" }
            }
          }
        },
        {
          // "Play a Gold gear token exhausted" — chain creation plus the play
          // handoff (440.2.c / 185.2.a) with the CR 187.5 Gold definition and
          // the 143.4 / 185.2.d entry stipulation. The chain/play handoff exists,
          // but the Gold definition and entry override remain blocked.
          id: "bushwhack.play-gold-token",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "gold" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            // 149.1 / 149.2 / 359.2.d: Gear are played to the player's Base
            // unless an effect says otherwise; "controller" is the
            // controller-relative placeholder the merged token program family
            // uses for that destination.
            location: {
              kind: "constant",
              value: { type: "base", player: "controller" }
            },
            entersExhausted: { kind: "constant", value: true },
            linkKey: { kind: "constant", value: "goldToken" }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "Friendly units enter ready this turn. Play a Gold gear token exhausted."
} satisfies CardProgram;
