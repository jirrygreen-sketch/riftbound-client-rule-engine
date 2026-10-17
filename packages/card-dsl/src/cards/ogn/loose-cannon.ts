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
 *   手牌张数用 count 表达式读取（手牌对象按 filter 计数），count 由解释器求值。
 *
 * status = judge-required：
 * - 条件从句（383.2.a.1 的 CR 点名）本身可以用 count + compare lte 表达，手牌内容
 *   在合并内核里也是可数的对象集合（TestWorld 与生产 query 都按 filter 计数），
 *   golden 已真实执行“≤1 张手牌才抽 1”的分支；
 * - 但触发注册仍在 CardProgram 绑定缺口里：`beginning-start` 的 TriggerSpec 过滤词汇
 *   不接受卡牌写的 `{ event: "beginning-start", player: "self" }`（trigger-spec.ts 的
 *   EventPattern 只列事件类名，时点类名不属于 EVENT_PATTERN_TYPES），且没有生产方把
 *   本卡的 triggered 能力注册到事件管线（RIFT-257）。
 * - “you” 的收件人（190.6.d）在条件里写死为能力控制者；跨玩家的 filter 归一化
 *   （controller: "self" → 当前玩家）由 chain/engine.ts 的 query 包装完成，属既有路径。
 * 依赖：RIFT-257（触发注册与 EventPattern 词汇扩展）。draw 部分已可用，golden 用
 * 解释器实际执行该子效果。
 */
const looseCannon = {
  canonicalCardId:
    "card.hash-6725e8158faf2110c1c44cc6e73ac51a68eb3031e134f604a57dc4ef7e8b84a3",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "条件从句（383.2.a.1 的 CR 点名，属效果而不是触发条件，结算时检查 135.2.b.3 / 359.3.f.2）已可用：count（手牌 filter）+ compare lte " +
    "由解释器真实求值，golden 覆盖 0/1/2 张手牌。仍缺的是触发注册：卡牌声明的 { event: \"beginning-start\", player: \"self\" } " +
    "不在 trigger-spec.ts 的封闭 EventPattern 词汇里（EVENT_PATTERN_TYPES 只列事件类名，时点类名不是合法事件类型；空 filter 可注册但无法表达 \"your Beginning Phase\"），" +
    "且没有生产方把本卡的 triggered 能力注册到事件管线（RIFT-257）。依赖：RIFT-257（触发注册与 EventPattern 词汇扩展）。不近似实现。",
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
              // “one or fewer cards in your hand”：手牌数量（108.7.e 公开信息）。
              // “you” 是能力控制者（190.6.d），用 PlayerSelector "self"；
              // chain/engine.ts 的 query 包装把它归一化为当前玩家。
              kind: "count",
              subject: "cards-in-your-hand",
              filter: { zone: "hand", controller: "self" }
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
