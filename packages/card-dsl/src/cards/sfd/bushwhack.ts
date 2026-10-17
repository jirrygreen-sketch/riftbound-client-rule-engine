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
 *   declares the keyword only; keyword expansion belongs to
 *   `effects/keywords/Hidden.ts` and to the cost/zone/chain work that file
 *   records as unmerged.
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
 * Status: judge-required. Three real gaps, none approximated:
 * - Hidden has no executable reader: the merged `cost.hidden` static effect has
 *   no consumer that grants the Hide action, the facedown zone or the facedown
 *   play (cost/README.md records the full payment-scope contract as still
 *   requested);
 * - the body-level `replacement.enter` shape is not an executable op: the
 *   merged replacement family only consumes `replacement.enter` declarations
 *   inside a bound replacement ability, and no instruction or program adapter
 *   registers a temporary board-entry replacement for the rest of the turn,
 *   while effect.ready is not equivalent (see above);
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
    "三处依赖未合入，均不近似实现：(1) [Hidden] 展开没有可执行读者——合并的 keywords/Hidden.ts 已声明 " +
    "static effect { kind: \"cost.hidden\" }，但当前没有任何代码据它授予 Hide 动作、facedown 区域或「从 facedown 打出」许可" +
    "（811.1.b / 811.1.c / 811.6；cost/README.md 仍把完整 payment-scope/savepoint 契约列为待请求共享契约）。" +
    "(2)「Friendly units enter ready this turn」是入场替代（143.4 / 184.1 / 185.2.d；369.1/369.3 以 Master Yi, Honed 为例，" +
    "805.6 明确它不是『先横置再就绪』），effect.ready 文件头亦自述不参与入场流程。本卡把形状写成 body 内的 replacement.enter 指令，" +
    "但合并的替代族只消费替换能力声明里的 replacement.enter（replacement/bind.ts），没有任何指令或程序适配器能为本回合注册" +
    "临时入场替代，同时还要完成被替代事件的来源绑定。(3)「Play a Gold gear token exhausted」缺 Gold gear token 定义与入场状态改写：" +
    "CR 187.5 的 Gold 自带 \"[Reaction][>] Kill this, [E]: [Add] [A]\" 能力，effect.token 的冻结定义表按设计不收录带能力的 token" +
    "（blockedReason: token-definition-or-abilities-judge-required），且 create-token/play 动作明确不支持入场状态覆盖" +
    "（『Entry overrides are not supported』）；440.2.c / 185.2.a / 350.2 / 354 的链上创建 + 打出流程由费用/链批次负责。" +
    "依赖：cost.hidden 读者、body 级临时入场替代注册（含被替代事件来源绑定）、Gold token 定义与入场状态改写。",
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
          // stated in the shape the replacing pipeline consumes; no merged op
          // registers it (see judgeReason). The affected units are selected by
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
          // the 143.4 / 185.2.d entry stipulation. All three are unmerged and
          // deliberately fail closed instead of creating a wrong token.
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
