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
 * - continuous.grant-keyword 指令原语已合入（RIFT-258），Assault/Ganking 的 KeywordDef
 *   也已合入（RIFT-81 的 Assault / RIFT-83 的 Ganking），授予指令本身已由 golden 用
 *   解释器 + 图层引擎真实执行；但没有任何已合入消费方把卡牌的 static 能力注册进图层
 *   （卡牌程序绑定 RIFT-257）。
 * - 条件历史查询未接通：条件按 compare + count 形状声明，图层 conditionMatches 只识别
 *   always/never/type/has-tag/has-keyword，未识别的 compare 条件按 true 处理，直接注册
 *   会把本回合未弃牌的场合也视为满足；需要一个把 count/HistoryQuery 落到
 *   ctx.history({ scope: "turn", action: "discard" }) 的消费方。
 * - 被授予的 Assault 仍需 Attacker designation（ObjectSnapshot 尚无 designation/combatRole
 *   特征，契约 3.8），Ganking 的移动许可也需要 layers/rules/query 的 movement 消费者接入
 *   Standard Move 合法性检查。
 * 依赖：RIFT-257（卡牌 static 绑定）、图层条件词表（compare/history）、契约 3.8 的
 * designation 落地与移动许可消费。
 */
const ragingSoul = {
  canonicalCardId: "card.hash-55958c501a029c3b3b6cc885be9c3637445d707ccf6347d1f0338abd97718571",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "『If you've discarded a card this turn, I have [Assault] and [Ganking]』：continuous.grant-keyword 指令（RIFT-258）与 " +
    "Assault（RIFT-81）/Ganking（RIFT-83）的 KeywordDef 已合入，授予指令已由 golden 经解释器 + 图层引擎真实执行；整卡仍不可执行的三处：" +
    "(1) 没有任何已合入消费方把卡牌 static 能力注册进图层（卡牌程序绑定 RIFT-257）；" +
    "(2) 条件历史查询未接通——conditions 里的 compare + count 在图层 conditionMatches 中不可识别，未识别条件按 true 处理，" +
    "直接注册会在本回合未弃牌时也授予关键词（需 count/HistoryQuery → ctx.history 的消费方）；" +
    "(3) 被授予的 Assault 需要 Attacker designation（ObjectSnapshot 无 designation/combatRole 特征，契约 3.8），" +
    "Ganking 的移动许可还需接入 Standard Move 合法性检查（layers/rules 的 movement 查询）。" +
    "依赖：RIFT-257、图层条件词表（compare/history）、契约 3.8 的 designation 落地与移动许可消费。不近似实现。",
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
