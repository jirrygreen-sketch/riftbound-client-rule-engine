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
 *   effect.token's Expr vocabulary (its own isExpr) has no `kind: 'location'`
 *   member, so the merged interpreter path cannot evaluate the LocationRef
 *   expression form that effect.move/expr.ts support; `location` stays literal
 *   data ({type:"base", player:<PlayerId>}) and the primitive negates any base
 *   whose player is not `ctx.controller`, so a "controller" placeholder is
 *   dropped before any token is created. Hard-coding a seat would place the
 *   token in the wrong player's base (contract change request: add
 *   `kind: 'location'` to effect.token's Expr vocabulary; the merged
 *   resolveLocationSelector already provides the semantics).
 * - the trigger cannot register: the held emission (turn/flow.ts Score wave)
 *   carries no object for "here" to anchor, the validator's event name is
 *   "held" (not "hold"), and no merged field can express this battlefield's
 *   scope (`here: true` is rejected by events/trigger-spec.ts and by the
 *   binding layer).
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
    "两处缺口：(1) 印刷目的地 'in your base' 无法命名：effect.token 的 Expr 词表（其 isExpr）没有 kind:'location' 成员，" +
    "合并解释器路径无法求值 effect.move/expr.ts 已支持的 LocationRef 表达式；location 只能是字面数据 " +
    "{type:'base', player:<PlayerId>}，且原语对 player 不等于 ctx.controller 的 base 直接 negated（创建前丢弃），" +
    "写死座位会把 token 放进错误玩家的基地，属近似实现（契约变更请求：给 effect.token 的 Expr 词表加 kind:'location'；" +
    "合并的 resolveLocationSelector 已提供语义，target/location/ref.ts 支持 'ability-controller-base'）。" +
    "(2) 触发无法注册：held 发射（turn/flow.ts Score 波）载荷没有 object 供「here」锚定，" +
    "校验器事件名是 held（不是 hold），且没有合并字段能表达本战场的范围（here:true 被 events/trigger-spec.ts 与绑定层拒绝）。" +
    "CR 187.1 的 Recruit 定义与 440.2.c 的链上创建 + play 交接已合入并由 golden 真实执行（token 半段用控制者实际座位）。" +
    "依赖：effect.token 的 kind:'location' Expr 词表（契约变更请求）。不近似实现。",
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
