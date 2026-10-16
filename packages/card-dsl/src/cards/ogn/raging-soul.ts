import type { CardProgram } from "../../ir/index.js";

/**
 * Raging Soul (ogn-019-298) — Unit, Fury, Spirit/Shadow Isles, energy 4, Might 4.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogn-019-298，逐字）:
 *   "If you've discarded a card this turn, I have [Assault] and [Ganking].
 *    (+1 :rb_might: while I'm an attacker. I can move from battlefield to
 *    battlefield.)"
 *
 * 规则依据（Core Rules v1.5）:
 * - 364.3 / 364.3.a：以 "if" 开头的持续被动能力是条件被动能力（条件为
 *   "你本回合弃过一张牌"）。
 * - 807.1 / 807.1.b.3 / 807.1.c：Assault 未带数值时视为 1，功能上等于
 *   "While I am an attacker, I have +1 [M]"；807.1.d.1：仅在保持 Attacker
 *   designation 期间生效。
 * - 810.1 / 810.1.b / 810.1.c：Ganking 是给单位 Standard Move 增加"战场到战场"
 *   许可的被动关键词（810.2 多个实例冗余）。
 * - 423.1 / 423.1.b：弃牌是本回合内的历史事件，"you've discarded" 用本回合
 *   discard 动作计数判定（契约 3.6 history 查询；423.1.b 的触发证明该动作可被观测）。
 * - 807.3 / 810.3：是否拥有这些关键词是单位特征，可被检查。
 *
 * 结构说明: 两个 static 条件效果 —— (1) 授予 Assault（默认 1）；(2) 授予 Ganking；
 * 两者共用同一条件：本回合该控制者至少执行过一次 discard 动作（condition.kind
 * "expression" 用 count 主体表达历史计数，具体查询维度由 condition.history 消费）。
 *
 * 未合入依赖（不近似实现）:
 * - 没有 continuous.grant-keyword 原语（RIFT-9 的 continuous.keyword 缺口）；
 *   RIFT-91 的 layers 也没有 CardProgram static 能力 → 图层注册消费方。
 * - 条件历史查询未接通：条件按 expression + count 形状声明，需要一个把
 *   count/HistoryQuery 落到 ctx.history({ scope: "turn", action: "discard" }) 的消费方
 *   （RIFT-89/90 的条件历史落地）。
 * - 被授予的 Assault/Ganking 仍需在接收者上展开（RIFT-81 / RIFT-83 的 KeywordDef），
 *   且 Assault 需要 Attacker designation（ObjectSnapshot 尚无该特征，契约 3.8）。
 * 依赖：RIFT-9（continuous.keyword）、RIFT-81、RIFT-83、RIFT-91、RIFT-89/90。
 */
const ragingSoul = {
  canonicalCardId: "card.hash-55958c501a029c3b3b6cc885be9c3637445d707ccf6347d1f0338abd97718571",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "『If you've discarded a card this turn, I have [Assault] and [Ganking]』需要两项都缺失的能力：continuous.grant-keyword 持续效果" +
    "（RIFT-9 的 continuous.keyword 缺口）+ 本回合 discard 历史条件（需把 count/HistoryQuery 落到 ctx.history 的消费方，RIFT-89/90），" +
    "并且被授予的 Assault 还需 Attacker designation（ObjectSnapshot 无该特征，契约 3.8）与 RIFT-81/83 的展开。" +
    "依赖：RIFT-9、RIFT-81、RIFT-83、RIFT-91、RIFT-89/90。不近似实现。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.grant-keyword",
        keyword: "assault",
        appliesTo: "self"
      },
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "cards-discarded-this-turn",
          filter: { player: "controller" }
        },
        operator: "gte",
        right: { kind: "constant", value: 1 }
      }
    },
    {
      kind: "static",
      effect: {
        kind: "continuous.grant-keyword",
        keyword: "ganking",
        appliesTo: "self"
      },
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "cards-discarded-this-turn",
          filter: { player: "controller" }
        },
        operator: "gte",
        right: { kind: "constant", value: 1 }
      }
    }
  ],
  sourceText:
    "If you've discarded a card this turn, I have [Assault] and [Ganking]. " +
    "(+1 :rb_might: while I'm an attacker. I can move from battlefield to battlefield.)"
} satisfies CardProgram;

export default ragingSoul;
