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
 * implements the chain-create + play handoff, but two gaps remain:
 * - the printed destination "in your base" cannot be named by the frozen IR.
 *   `location` must evaluate to literal data ({type:"base",
 *   player:<PlayerId>}) and the primitive only accepts a base whose player is
 *   `ctx.controller` (verified: the "controller" placeholder is negated before
 *   any token is created); no Expr or ObjectSelector can build a LocationRef
 *   from the ability controller (effect.move accepts the literal
 *   "controller-base", effect.token has no such spelling). Hard-coding a seat
 *   would place the token in the wrong player's base.
 * - the trigger cannot register: the nested `{ event, here, player }` spelling
 *   is rejected by the engine validator (events/trigger-spec.ts EventPattern
 *   has no `here` field and the engine spellings are "held"/"self"), and no
 *   merged consumer binds a CardProgram's triggered ability into a
 *   TriggerRegistration (RIFT-257).
 *
 * `player: "controller"` below is the spelling merged cards use for "the
 * ability controller's base" (sfd/assembly-rig, sfd/rumble-scrapper). It is
 * deliberately not resolvable today; the golden test executes the token half
 * with the concrete seat the controller occupies and records the placeholder
 * as a test.todo (the merged primitive negates the placeholder instead of
 * silently creating a token in an arbitrary base).
 */
export default {
  canonicalCardId: "card.hash-235642b62ac009ff34cfa13db7debd2bf1e71c1a9bf411cf5ffab5dfd06e5099",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口：(1) 印刷目的地 'in your base' 无法命名：effect.token 把 location 当字面数据求值且只接受 player 等于 ctx.controller 的 {type:'base', player:<PlayerId>}（实测 controller 占位值在创建 token 前被 negated），" +
    "冻结 IR 没有控制者相对的 LocationRef 表达式或拼写（effect.move 认字面量 'controller-base'，effect.token 没有）；写死座位会把 token 放进错误玩家的基地，属近似实现。" +
    "(2) 触发无法注册：本卡嵌套 { event, here, player } 拼写被引擎侧 assertTriggerSpec 拒绝（events/trigger-spec.ts 的 EventPattern 没有 here 字段，自身玩家拼写为 self），" +
    "且没有已合入消费方把 CardProgram 的 triggered 能力绑定成 TriggerRegistration（RIFT-257）。" +
    "hold 时点已由 turn/flow.ts 的 Score 波发射；CR 187.1 的 Recruit 定义与 440.2.c 的链上创建 + play 交接已合入并由 golden 真实执行（token 半段用控制者实际座位）。" +
    "依赖：effect.token 的控制者相对 location（契约变更请求）与 RIFT-257。不近似实现。",
  sourceText: "When you hold here, play a 1 :rb_might: Recruit unit token in your base.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "hold",
        // "here" = this battlefield (the ability host); "you" = its controller
        // (190.6.d). Spelling follows the merged battlefield cards that use
        // "When you hold here" (sfd/rumble-scrapper, sfd/sunken-temple).
        filter: { event: "hold", here: true, player: "controller" }
      },
      optional: false,
      body: [
        {
          id: "altar-to-unity.play-recruit",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "recruit" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            location: { kind: "constant", value: { type: "base", player: "controller" } },
            linkKey: { kind: "constant", value: "recruitToken" }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;
