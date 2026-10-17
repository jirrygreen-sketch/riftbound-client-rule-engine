import type { CardProgram } from "../../ir/index.js";

/**
 * Sprite Call (ogn-094-298) — Spell, 3 energy, Mind.
 *
 * Printed text (packages/card-data/data/deck-catalog.json, ogn-094-298):
 *   [Hidden] (Hide now for :rb_rune_rainbow: to react with later for
 *   :rb_energy_0:.)
 *   [Action] (Play on your turn or in showdowns.)
 *   Play a ready 3 :rb_might: Sprite unit token with [Temporary]. (Kill it at
 *   the start of its controller's Beginning Phase, before scoring.)
 *
 * Modeling notes (Core Rules v1.5):
 * - [Hidden] (811) and [Action] (806) are declared as keyword abilities only.
 *   Hidden's expansion (effects/keywords/Hidden.ts, cost.hidden) grants the
 *   Hide discretionary action and the facedown play permission;
 *   Action's expansion grants the Showdown permission. The card names both
 *   keywords and nothing more (contract 3.7).
 * - "Play a ready 3 Might Sprite unit token" is a play of a NEW token, which CR
 *   440.2.c/185.2.a resolve by creating it on the Chain and then handing it to
 *   the play flow (420.3/420.3.a). That is exactly effect.token's mode "play"
 *   shape. The Sprite definition itself is printed: 187.2 fixes a 3 Might
 *   domainless unit token with the Fae tag and the Temporary keyword, whose
 *   cost is null (185.3.a: tokens have no costs) — never 0.
 * - "ready" is 143.4's exception: units enter the Board exhausted by default
 *   and only an entry override or effect makes them ready (185.2.d: tokens
 *   follow the rules for their type). The printed word is therefore an entry
 *   stipulation on the creation/play action, not a later effect.ready.
 * - "[Temporary]" is the token's printed keyword (187.2 / 816.1: "At the start
 *   of this permanent's controller's Beginning Phase, before scoring, kill
 *   this"), so it belongs to the token definition rather than to a grant
 *   instruction from this card.
 *
 * Status: judge-required (re-checked 2026-10-17; every gap below is measured).
 * - effect.token's frozen definition table has no Sprite: the primitive negates
 *   with blockedReason "token-definition-or-abilities-judge-required" (there is
 *   no 187.2 3 Might Fae Sprite definition carrying Temporary).
 * - "ready" is an entry-state stipulation (143.4 default exhausted entry,
 *   185.2.d tokens follow their type). The primitive's argument list rejects an
 *   entry-readiness override ("Invalid effect.token argument"), so readiness
 *   cannot be expressed on the creation/play boundary. Modelling it as a
 *   follow-up effect.ready would invent a second action the card never prints.
 * - Temporary's KeywordDef expansion is merged, but its beginning-start trigger
 *   is still rejected by the closed trigger event vocabulary, so the printed
 *   keyword cannot enter the live pipeline.
 * - [Hidden]'s cost.hidden expansion still has no producer (the production
 *   static binder has no layer mapping for cost.hidden), so no Hide action or
 *   facedown play permission exists. [Action]'s showdown permission is consumed
 *   already through the keyword expansion (continuous.timing) and chain.canAct.
 * Not approximated: no generic token is substituted for the Sprite, and
 * readiness is not modelled as a follow-up effect.ready.
 */
const spriteCall = {
  canonicalCardId: "card.hash-6f54620dc8f77d546cac09d65f9233740f7ec347a9981fbe6aae3fed0b9f3ef7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "复核 2026-10-17（缺口均实测，均不近似实现）：(1) CR 187.2 的 3 Might Sprite 是域外单位 token，" +
    "带 Fae 标签与 Temporary 关键词、费用为 null（185.3.a：token 没有费用，不是 0）；" +
    "已合入的 effect.token 只在冻结定义表（recruit/sand-soldier/mech/reflection/tentacle）中解析定义 id，" +
    "表中不含带能力的 token，Sprite 因此以 blockedReason「token-definition-or-abilities-judge-required」negated。" +
    "(2)「ready」是入场状态限定（143.4 默认横置进场、185.2.d token 沿用其类型规则），" +
    "而 effect.token 的参数表直接拒绝入场状态改写（实测 Invalid effect.token argument），" +
    "事后 effect.ready 会凭空多出原文没有的动作。(3) Temporary 的 KeywordDef 展开已合入" +
    "（816.1.b 的 beginning-start kill this），但其触发仍被封闭事件词表拒绝（beginning-start 不在 " +
    "EVENT_PATTERN_TYPES），attachProgramLifecycle 下无法登记，进不了实时管线。" +
    "(4) [Hidden] 的 cost.hidden 没有生产消费路径（静态绑定实测「Static ability kind cost.hidden has no " +
    "layer mapping」），811.1.b/811.1.c.2 的 Hide 行动与背面打出许可都不可执行；" +
    "[Action] 的 showdown 时机许可已由关键词展开（continuous.timing）与 chain.canAct 消费。" +
    "不近似实现：不用其他 token 替代 Sprite，也不用事后 effect.ready 冒充入场就绪。",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          id: "sprite-call.play-sprite",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "sprite" },
            amount: { kind: "constant", value: 1 },
            // 440.2.c / 185.2.a: a played token is created on the Chain and
            // handed to the play flow. The Sprite's printed entry state (ready)
            // is part of that flow (143.4 / 185.2.d), not a later effect.
            mode: { kind: "constant", value: "play" },
            entersReady: { kind: "constant", value: true },
            location: {
              kind: "constant",
              value: { type: "base", player: "controller" }
            },
            linkKey: { kind: "constant", value: "sprite" }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Play a ready 3 :rb_might: Sprite unit token with [Temporary]. " +
    "(Kill it at the start of its controller's Beginning Phase, before scoring.)"
} satisfies CardProgram;

export default spriteCall;

