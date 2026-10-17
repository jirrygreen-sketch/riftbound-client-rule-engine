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
 * Status: judge-required — the effect cannot be honestly executed:
 * - "play a ... token" is chain creation plus a cost-waived play
 *   (440.2.c / 185.2.a / 350.2 / 354). The merged effect.token primitive
 *   models the chain handoff and the reference kernel executes it, but the
 *   production path still needs the card-program play binding and its
 *   finalized cost plan (RIFT-257 / RIFT-261).
 * - The Gold definition (187.5) carries its own activated ability, which
 *   effect.token.ts deliberately keeps out of its frozen definition table
 *   ("definitions requiring other abilities, including Gold, remain
 *   blocked/judge-required").
 * - "exhausted" is an entry override (143.4 / 185.2.d) and the create-token
 *   action explicitly does not support entry overrides.
 * - The trigger needs the `card-hidden` producer: the Hide action is not in
 *   the GameAction set and no module emits `card-hidden`
 *   (docs/rules/timing-point-producers.md).
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
    "「play a Gold gear token exhausted」缺链上生成 + 打出的生产接线：effect.token 的 play 模式在参照内核可用" +
    "（create-token to chain + play），但生产链需要 CardProgram 绑定与已 Finalize 的费用计划（RIFT-257 / RIFT-261）；" +
    "Gold gear token（187.5）自带启动能力，effect.token 的定义表按设计不收录（blocked）；" +
    "「exhausted」是入场替代修正（143.4 / 185.2.d），create-token 动作明确不支持入场修正；" +
    "「When you hide a card here」还缺 card-hidden 生产者：Hide 动作不在 GameAction 集内，也没有模块发出该时点" +
    "（docs/rules/timing-point-producers.md），且触发器不消费 here 锚点。不近似实现。",
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

