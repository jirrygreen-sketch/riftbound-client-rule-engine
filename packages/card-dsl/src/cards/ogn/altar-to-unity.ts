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
 * Status: judge-required. The hold wave already carries battlefieldId and
 * the token body executes for either controller. The remaining gap is binding
 * that event battlefield to this host's identity and current controller;
 * here:true is not supported, and literal details matching cannot evaluate a
 * symbolic self anchor. No controller-wide hold approximation is used.
 */
export default {
  canonicalCardId: "card.hash-235642b62ac009ff34cfa13db7debd2bf1e71c1a9bf411cf5ffab5dfd06e5099",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 held 事件与本战场 here 的动态范围绑定（CR 383.4.d.2.b/190.6.d）：turn/flow.ts 已发出 details.battlefieldId，但没有 battlefield object；programs/filters.ts 拒绝 here:true，事件 details 的字面值匹配也不能把 self 解析为宿主战场身份。只按 player:self 监听会响应控制者在其它战场的固守；需在触发测试时关联 held 战场、宿主及其当前控制者。",
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
