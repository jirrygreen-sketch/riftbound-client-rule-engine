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
 * Status: judge-required (2026-10-18 source audit, measured).
 * The card-hidden timing point exists (events/timing-points.ts), but there is no
 * Hide action/producer and no EVENT_PATTERN_TYPES entry, so a trigger cannot be
 * subscribed; the source-Battlefield "here" anchor is also rejected by
 * programs/filters.ts ("Unsupported filter field here", measured). Gold still
 * has no frozen token definition (187.5) or activated program: the declared
 * effect.token instruction measures negated/impossible with
 * blockedReason "token-definition-or-abilities-judge-required". effect.token's
 * frozen arguments also cannot carry the printed exhausted entry override
 * (measured TypeError on an entriesExhausted argument; 143.4 / 185.2.d).
 * ChainEngine already routes play through describePlay; the remaining token
 * integration is that ability-bearing tokens need a program identity/adapter,
 * not a blanket absence of play handling. Gold's [A] also needs Universal Power.
 */
export default {
  canonicalCardId: "card.hash-722142d79d944add290577d2ffd13c8f888e9948a549f7948d622833d6a0783e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "(2026-10-18 实测) (1)「When you hide a card here」仍缺 Hide 动作与 card-hidden 生产者及 " +
    "EVENT_PATTERN_TYPES 入口（card-hidden 只是 timing-points 里的时点）；programs/filters.ts 也拒绝 " +
    "here 锚点（实测 \"Unsupported filter field here\"），来源战场范围无法表达（CR 422.1 / 422.2）。" +
    "(2) Gold gear token 缺 187.5 的定义与启动程序：声明的 effect.token 实测 negated/impossible，" +
    "blockedReason \"token-definition-or-abilities-judge-required\"；其 [Add] [A] 仍需 Universal Power，" +
    "不能近似为任一域。" +
    "(3)「exhausted」缺入场覆盖：effect.token 的 argsSchema / create-token 动作没有该参数" +
    "（实测传入 entriesExhausted 抛 TypeError；143.4 / 185.2.d），不得用后续 exhaust 替代。" +
    "(4) ChainEngine 已通过 describePlay 路由 play；但 Gold 等能力 Token 仍需可绑定的程序身份/适配，" +
    "不能以无能力 Token 的 cardId:null 代替。",
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
          // "play a Gold gear token exhausted" — chain creation + play is tracked
          // by the judgeReason. Gold is a Gear token, so the printed play
          // destination is the playing player's Base (355.2.a, 811.1.d.1.a);
          // resolve that Base first (abilities/instructions/effect.token require
          // a concrete LocationRef, matching the merged chem-baroness shape) and
          // pass it as a linked location.
          id: "bandle-scouts-academy.read-base",
          op: "condition.value",
          args: {
            value: { kind: "location", value: "ability-controller-base" },
            key: { kind: "constant", value: "base" }
          }
        },
        {
          id: "bandle-scouts-academy.play-gold",
          op: "effect.token",
          linkedTo: "bandle-scouts-academy.read-base",
          args: {
            token: { kind: "constant", value: "gold" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            location: {
              kind: "linked-value",
              instructionId: "bandle-scouts-academy.read-base",
              key: "base"
            },
            linkKey: { kind: "constant", value: "goldToken" }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

