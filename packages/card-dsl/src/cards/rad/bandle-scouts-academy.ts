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
 * Status: judge-required (2026-10-17 source audit).
 * card-hidden still lacks a Hide action/producer and EVENT_PATTERN_TYPES entry;
 * the source-Battlefield here anchor is not consumed by trigger translation.
 * Gold still has no frozen token definition/activated program (187.5), and
 * effect.token/create-token cannot carry an exhausted entry override (185.2.d).
 * ChainEngine already routes play through describePlay; the remaining token
 * integration is that ability-bearing tokens need a program identity/adapter,
 * not a blanket absence of play handling. Gold's [A] also needs Universal Power.
 */
export default {
  canonicalCardId: "card.hash-722142d79d944add290577d2ffd13c8f888e9948a549f7948d622833d6a0783e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "(1)「When you hide a card here」缺 Hide 动作/card-hidden 生产者及 EVENT_PATTERN_TYPES 入口；programs/filters.ts 也不消费 here 来源战场锚点（CR 422.1 / 422.2）。" +
    "(2) Gold gear token 缺 187.5 的定义与启动程序；其 [Add] [A] 仍需 Universal Power，不能近似为任一域。" +
    "(3)「exhausted」缺入场覆盖：effect.token 的 argsSchema / create-token 动作没有该参数（143.4 / 185.2.d），不得用后续 exhaust 替代。" +
    "(4) ChainEngine 已通过 describePlay 路由 play；但 Gold 等能力 Token 仍需可绑定的程序身份/适配，不能以无能力 Token 的 cardId:null 代替。",
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

