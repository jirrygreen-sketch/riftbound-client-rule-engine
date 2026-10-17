import type { CardProgram } from "../../ir/index.js";

/**
 * Bandle Scouts' Academy (rad-157-167) — Battlefield (domainless, RAD).
 *
 * Printed text:
 *   When you hide a card here, play a Gold gear token exhausted.
 *   (It has "[Reaction][>] Kill this, :rb_exhaust:: [Add]
 *   :rb_rune_rainbow:.")
 *
 * Rules evidence (Core Rules v1.5):
 * - 422.1 / 422.2: Hiding places a card facedown at a Battlefield you
 *   control; Hide is a Discretionary Action. The "card-hidden" timing point
 *   (events/timing-points.ts) carries the hidden card and the battlefield, and
 *   is the merged trigger point for "when you hide a card here".
 * - 812.1 / 811: Hidden is the keyword that lets a card be hidden; the card
 *   hidden here is whatever the hiding player hides, not this Battlefield.
 * - 187.5: the Gold gear token is a domainless gear token with the printed
 *   "[Reaction][>] Kill this, [E]: [Add] [A]." activated ability.
 *
 * Status: judge-required (re-verified 2026-10-17) — the effect cannot be
 * honestly executed:
 * - "When you hide a card here" cannot be subscribed: `card-hidden` is not in
 *   EVENT_PATTERN_TYPES (events/trigger-spec.ts), so pipeline.registerTrigger
 *   rejects the spec, and the Hide action is not in the GameAction set, so no
 *   module emits the timing point
 *   (docs/rules/timing-point-producers.md). The "here" anchor is also not an
 *   EventPattern field: RIFT-257's programs/filters.ts rejects `here` with
 *   "Unsupported filter field here".
 * - The Gold definition (187.5) carries its own activated ability, which
 *   effect.token.ts deliberately keeps out of its frozen definition table
 *   ("definitions requiring other abilities, including Gold, remain
 *   blocked/judge-required").
 * - "exhausted" is an entry override (143.4 / 185.2.d) and the create-token
 *   action has no argument for it: effect.token.argsSchema accepts only
 *   token/amount/mode/location/target/pick/locations/choiceId/linkKey.
 * - The production chain has no consumer for { type: "play" }: chain/engine.ts
 *   requires the caller's describePlay card-program adapter, and
 *   EngineRuntimeHost returns impossible for the play action.
 * RIFT-257 (card-program binding) and RIFT-261 (cost kinds, cost.pay/modify)
 * are merged and are no longer the gap.
 *
 * The trigger and the intended body are recorded (token id, destination and
 * entry exhaustion) so downstream tooling can see the full shape; execution
 * is judged, and nothing is approximated.
 */
export default {
  canonicalCardId: "card.hash-722142d79d944add290577d2ffd13c8f888e9948a549f7948d622833d6a0783e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "(1) 「When you hide a card here」无法订阅：card-hidden 不在 EVENT_PATTERN_TYPES " +
    "（events/trigger-spec.ts），pipeline.registerTrigger 直接拒绝该 spec；Hide 动作也不在 GameAction " +
    "集内，没有模块发出该时点（docs/rules/timing-point-producers.md）。「here」也不是 EventPattern " +
    "字段，RIFT-257 的 programs/filters.ts 判 “Unsupported filter field here”。" +
    "(2) Gold gear token（187.5）自带启动能力，effect.token 的冻结定义表按设计不收录（blocked，返回 " +
    "token-definition-or-abilities-judge-required）。" +
    "(3) 「exhausted」是入场替代修正（143.4 / 185.2.d），create-token 动作没有该参数：" +
    "effect.token 的 argsSchema 只收 token/amount/mode/location/target/pick/locations/choiceId/linkKey。" +
    "(4) 生产链没有消费 { type: \"play\" } 的 host 动作（chain/engine.ts 要求调用方提供 describePlay；" +
    "EngineRuntimeHost 对 play 返回 impossible）。RIFT-257 的 CardProgram 绑定与 RIFT-261 的费用种类/" +
    "cost.pay 均已合入，不再是缺口。不近似实现。",
  sourceText:
    "When you hide a card here, play a Gold gear token exhausted. (It has \"[Reaction][>] Kill this, :rb_exhaust:: [Add] :rb_rune_rainbow:.\")",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-hidden",
        // "When you hide a card here": the hiding player is the ability's
        // controller ("self" is the merged PlayerSelector spelling), and the
        // event must be at this Battlefield. "here" is a descriptive
        // placeholder: the merged EventPattern has no source-battlefield
        // anchor, so the "here" scoping is part of the pending trigger-filter
        // contract (see judgeReason).
        filter: { event: "card-hidden", here: true, player: "self" }
      },
      optional: false,
      body: [
        {
          // "play a Gold gear token exhausted" — chain creation + play is
          // tracked by the judgeReason. The token id (187.5) and the
          // controller-base destination keep the authored shape reviewable;
          // the "exhausted" entry override has no frozen argument to carry it.
          id: "bandle-scouts-academy.play-gold",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "gold" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            // Gold is a Gear token, so the printed play destination is the
            // playing player's Base (355.2.a, 811.1.d.1.a). The frozen
            // create-token action only accepts the ability controller's Base,
            // which is why the controller-base placeholder is used here.
            location: { kind: "constant", value: { type: "base", player: "controller" } }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

