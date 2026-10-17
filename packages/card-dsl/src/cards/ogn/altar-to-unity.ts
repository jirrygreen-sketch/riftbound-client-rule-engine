import type { CardProgram } from "../../ir/index.js";

/**
 * Altar to Unity (ogn-275-298) — Battlefield, domainless.
 *
 * "When you hold here, play a 1 :rb_might: Recruit unit token in your base."
 *
 * CR v1.5 anchors:
 * - 383.4.d / 383.4.d.1 / 383.4.d.2.b: "When you hold here …" is a Hold
 *   Effect; the Hold Abilities of anything that references the player Holding
 *   are put on the chain when the Condition that the controller of the
 *   triggering source has performed a Hold is met (timing point "hold",
 *   emitted by scoring/ with rule refs 315.2.b.2 / 471.2 / 473.2.b).
 * - 190.6.a / 190.6.d: "you" in a battlefield's ability is the battlefield's
 *   Controller, and the implied controller makes the ability's choices.
 * - 440.2.c / 185.2.a: the printed wording "play a … token" creates the token
 *   on the Chain and lets the play action take it over, which is
 *   `effect.token` mode "play" (the merged primitive performs create-token
 *   with to "chain" and then hands the returned ObjectRef to play).
 * - 187.1: a 1 [M] Recruit token is a domainless unit token with 1 Might and
 *   the Recruit tag; 185.3.a / 185.3.b: tokens have no costs and no domains
 *   (null characteristics, never 0).
 *
 * Status rationale (contract §3.1, cards README §2): the `hold` timing point is
 * now emitted by the TurnFlow Score wave, and the merged `effect.token`
 * implements the chain-create + play handoff. A condition.value read of
 * `ability-controller-base` supplies the controller-relative destination.
 * The remaining gap is trigger registration: the held emission (turn/flow.ts Score wave)
 *   carries no object for "here" to anchor, the validator's event name is
 *   "held" (not "hold"), and no merged field can express this battlefield's
 *   scope (`here: true` is rejected by events/trigger-spec.ts and by the
 *   binding layer).
 *
 * `condition.value` binds the LocationRef and `effect.token` consumes it through
 * `linked-value`; this is executable for either controller without hard-coding a
 * seat.
 */
export default {
  canonicalCardId: "card.hash-235642b62ac009ff34cfa13db7debd2bf1e71c1a9bf411cf5ffab5dfd06e5099",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "唯一缺口是触发无法注册：held 发射（turn/flow.ts Score 波）载荷没有 object 供「here」锚定，" +
    "校验器事件名是 held（不是 hold），且没有合并字段能表达本战场的范围（here:true 被 events/trigger-spec.ts 与绑定层拒绝）。" +
    "CR 187.1 的 Recruit 定义、440.2.c 的链上创建 + play 交接，以及通过 condition.value 读取 ability-controller-base 并经 linked-value 传入 effect.token 均已合入并由 A/B 控制者 golden 真实执行。" +
    "依赖：held 事件的 here 范围载荷与触发注册语义（契约变更请求）。不近似实现。",
  sourceText: "When you hold here, play a 1 :rb_might: Recruit unit token in your base.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "hold",
        // "here" = this battlefield (the ability host); "you" = its controller
        // (190.6.d). "held" is the validator's event name; the here-anchor and
        // the registration gap are recorded in judgeReason.
        filter: { event: "held", here: true, player: "controller" }
      },
      optional: false,
      body: [
        {
          id: "altar-to-unity.resolve-base",
          op: "condition.value",
          args: {
            value: { kind: "location", value: "ability-controller-base" },
            key: { kind: "constant", value: "base" }
          }
        },
        {
          id: "altar-to-unity.play-recruit",
          op: "effect.token",
          linkedTo: "altar-to-unity.resolve-base",
          args: {
            token: { kind: "constant", value: "recruit" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            location: {
              kind: "linked-value",
              instructionId: "altar-to-unity.resolve-base",
              key: "base"
            },
            linkKey: { kind: "constant", value: "recruitToken" }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;
