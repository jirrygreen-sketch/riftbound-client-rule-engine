import type { CardProgram } from "../../ir/index.js";

/**
 * Hand of Noxus (ogn-253-298) — Legend, Fury/Order, Darius.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogn-253-298，逐字）：
 *   :rb_exhaust:: [Reaction], [Legion] — [Add] :rb_energy_1:. (Abilities that
 *   add resources can't be reacted to. Get the effect if you've played a card
 *   this turn.)
 *
 * 规则依据（CR v1.5）：
 * - 404.1.a / 415.5：“:” 前的 :rb_exhaust: 是启动能力的费用（"Exhaust me"）；
 *   合并费用管线支持 { kind: "exhaust", object: "self" }。
 * - 813.1.d / 813.1.c：能力上的 [Reaction] 是 Closed State 启动许可，IR 用
 *   activated.timing = "reaction" 声明；430.3 另允许 Reaction Add 在支付费用时启动。
 * - 430.1 / 430.2.a：[Add] :rb_energy_1: 是 Add 动作，加 1 Energy；触发式/启动式 Add
 *   能力 Finalize 后立即结算、不传递 Priority/Focus（由链与费用管线负责）。
 * - 812.1 / 812.1.b.1 / 812.1.c：[Legion] 是依赖型关键词，功能等价于
 *   “若你本回合已 Finalize 过另一张牌，此牌获得 [Text]”；[Text] 是依赖能力
 *   （本卡的 [Add] 1）。排除本卡自身（812.1.c “与持有 Legion 的牌不同”）需要
 *   HistoryQuery 的 exclude 维度（契约 3.8 第 2 条），由关键词展开提供谓词。
 *
 * status = judge-required：
 * - 依赖型关键词的闸门没有可执行路径：Legion 的 KeywordDef 展开（RIFT-82）引用
 *   condition.predicate / condition.history，而合并解释器只支持 always/never/
 *   expression/compare/all/any/not，没有 history 条件；812.1.c 的“排除本卡”维度
 *   也尚未在合并 HistoryQuery 中接通。本卡把闸门保留为 restriction（Legion +
 *   history 条件形状），但没有卡牌 Restriction 的消费方。
 * - Reaction Add 的支付窗口（430.3）与启动能力→链的生产接线未合并。
 * 依赖：RIFT-82（kw-deathknell-legion）、RIFT-89（费用/支付接线）、RIFT-90（条件/历史）。
 */
const handOfNoxus = {
  canonicalCardId:
    "card.hash-c65f6bc670e670cfb9086db63e2e7e090e36f226d4eb71005c0460c57fe89b49",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Legion 闸门（812.1.b.1：本回合已 Finalize 过另一张牌才获得 [Text]）没有可执行路径：" +
    "Legion 的 KeywordDef 展开引用 condition.predicate / condition.history（RIFT-82），而合并解释器的 " +
    "Condition 只支持 always/never/expression/compare/all/any/not；812.1.c 的“排除本卡自身”" +
    "维度（契约 3.8 HistoryQuery.exclude）也未在合并实现中接通。本卡以 restriction 保留 “Legion + " +
    "history 条件” 的闸门形状，但没有消费卡牌 Restriction 的内核路径；430.3 的 Reaction Add " +
    "启动窗口与启动能力→链的生产接线同样缺失。依赖 RIFT-82（kw-deathknell-legion）、" +
    "RIFT-89（费用/支付接线）、RIFT-90（条件/历史）。",
  abilities: [
    {
      kind: "activated",
      timing: "reaction",
      cost: {
        kind: "activated",
        payments: [{ kind: "exhaust", object: "self" }]
      },
      restriction: {
        kind: "legion",
        value: { kind: "constant", value: "legion-gate" },
        condition: {
          kind: "compare",
          left: {
            kind: "count",
            subject: "cards-finalized-this-turn",
            filter: { player: "controller", exclude: "self" }
          },
          operator: "gte",
          right: { kind: "constant", value: 1 }
        }
      },
      body: [
        {
          id: "hand-of-noxus.add-energy",
          op: "effect.resources",
          args: {
            energy: { kind: "constant", value: 1 }
          }
        }
      ]
    }
  ],
  sourceText:
    ":rb_exhaust:: [Reaction], [Legion] — [Add] :rb_energy_1:. (Abilities that add resources " +
    "can't be reacted to. Get the effect if you've played a card this turn.)"
} satisfies CardProgram;

export default handOfNoxus;
