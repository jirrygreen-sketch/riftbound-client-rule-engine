import type { CardProgram } from "../../ir/index.js";

/**
 * Loose Cannon (ogn-251-298) — Legend, Fury/Chaos, Jinx.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogn-251-298，逐字）：
 *   At start of your Beginning Phase, draw 1 if you have one or fewer cards in
 *   your hand.
 *
 * 规则依据（CR v1.5）：
 * - 315.2 / 315.2.a.1：Beginning Phase（Beginning Step）的开始是回合流程时点；
 *   封闭时点表用 "beginning-start" 表示（ruleRefs 315.2.a.1）。
 * - 383.2.a.1：CR 明确点名 Loose Cannon——“if you have one or fewer cards in your
 *   hand” 紧跟触发条件之后？不：规则原文明确写 “The 'if you have one or fewer cards in
 *   your hand' conditional statement is not immediately after the trigger condition,
 *   so it is part of the effect and not the condition.” 因此它是对效果指令的
 *   条件从句，不是触发条件。
 * - 135.2.b.3 / 135.2.b.5.b / 359.3.f.2：效果内的条件在指令结算时检查，作用于其后的
 *   指令；手牌数量是公开信息（108.7.e），不是隐藏信息。
 * - 414.1 / 414.3：“Draw 1” 是 effect.draw；190.6.d 隐含 "you" = 能力控制者。
 *
 * status = judge-required：
 * - 手牌数量在合并原语里不可读：Expr 没有读取 PlayerSnapshot.handSize 的位置；
 *   count 表达式只做 ctx.query 的对象计数（没有手牌对象可数，且手牌内容属私有信息），
 *   PlayerSnapshot 也没有暴露给 Condition/Expr 的路径。因此 “one or fewer cards in
 *   your hand” 的求值（包含应在触发时还是结算时检查）没有可执行实现；
 * - “one or fewer” 关系（≤1）可写成 compare lte，但左侧取值缺口是阻塞点。
 * 依赖：RIFT-87/90（条件管线）、RIFT-89（表达式/玩家特征读取）。draw 部分已可用，
 * golden 用解释器实际执行该子效果。
 */
const looseCannon = {
  canonicalCardId:
    "card.hash-6725e8158faf2110c1c44cc6e73ac51a68eb3031e134f604a57dc4ef7e8b84a3",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺手牌数量读取：108.7.c / 108.7.e 的面朝下手牌内容属私有信息、手牌张数是公开信息，但合并 IR 的 count 表达式只做对象集合" +
    "计数，PlayerSnapshot.handSize 没有进入 Expr/Condition 的路径，无法表达 “one or fewer cards " +
    "in your hand”。该从句按 383.2.a.1（CR 点名 Loose Cannon）属于效果而不是触发条件，" +
    "在指令结算时检查（135.2.b.3 / 359.3.f.2）；求值路径未合并前不近似实现。" +
    "依赖 RIFT-87/90（条件管线）与 RIFT-89（玩家特征/表达式读取）；effect.draw 子效果已可用。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "beginning-start",
        filter: { event: "beginning-start", player: "self" }
      },
      optional: false,
      body: [
        {
          id: "loose-cannon.draw-one",
          op: "effect.draw",
          // 效果内条件（383.2.a.1 / 135.2.b.3）：手牌 ≤1 时抽 1。
          condition: {
            kind: "compare",
            left: {
              // “one or fewer cards in your hand”：手牌数量。count 表达式只做对象集合计数，
              // 且 filter 里 “controller” 占位符（=能力控制者）没有解析路径；保留描述性形状。
              kind: "count",
              subject: "cards-in-your-hand",
              filter: { zone: "hand", controller: "controller" }
            },
            operator: "lte",
            right: { kind: "constant", value: 1 }
          },
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText:
    "At start of your Beginning Phase, draw 1 if you have one or fewer cards in your hand."
} satisfies CardProgram;

export default looseCannon;
