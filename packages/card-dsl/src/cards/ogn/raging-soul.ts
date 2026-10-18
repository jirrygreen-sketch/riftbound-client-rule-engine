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
 * 两者共用同一条件：本回合该控制者至少执行过一次 discard 动作。条件写成
 * compare + count（subject 承载"本回合弃牌数"的语义）；Condition 联合类型仍没有
 * 历史查询成员——condition.history 是 Resolve 期的 body 指令，不是 Condition——
 * 所以这个门控目前没有真实消费方，见下。
 *
 * 当前真实缺口（复核 2026-10-18）：
 * - compare/count 只查询现场对象，不读 subject 所描述的弃牌历史；Condition/Expr
 *   没有读取 ctx.history 的表达式。需要按宿主控制者查询本回合 discard（364.3.a / 423.1）。
 * - programs/keyword-grants.ts 的 KeywordGrantLayerEngine 已能把授予的 Assault
 *   展开、把 combatRole 对齐到 designation，并规范化 Ganking 的 movement.routes；
 *   golden 对这三项有独立执行证据。但默认 ChainEngine 仍使用普通 LayerEngine，
 *   attachProgramLifecycle 只展开印刷关键词，尚未接入动态授予的二次展开。
 * - combat/flow.ts 的 Combat 开始事务仍抛 combat-start-transaction，缺实际战斗指定
 *   生产者（807.1.d.1 / 466.2）。测试初始 attacker 快照仅证明已有指定时的图层行为。
 * 不把已合入的关键词适配器能力列为缺失，也不以注入适配器证明默认生产路径完整。
 */
const ragingSoul = {
  canonicalCardId: "card.hash-55958c501a029c3b3b6cc885be9c3637445d707ccf6347d1f0338abd97718571",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口（复核 2026-10-18）：(1) 364.3.a / 423.1 的本回合弃牌门控：" +
    "bindStaticToLayers 经 evaluateCondition 的 compare/count 只查现场对象，" +
    "matchesObjectFilter 忽略 filter.player，count 忽略描述性的 subject；Condition/Expr " +
    "缺按宿主控制者读取 ctx.history({ scope: \"turn\", action: \"discard\" }) 的条件消费方，" +
    "因此无弃牌或仅对手弃牌时也会误授予关键词。(2) 默认 ChainEngine 使用普通 LayerEngine，" +
    "attachProgramLifecycle 只展开印刷关键词，尚未接入 KeywordGrantLayerEngine 的动态授予展开" +
    "（含 designation/combatRole 对齐及 permission.routes 规范化）；默认路径不能把 " +
    "continuous.grant-keyword 授予的 Assault 变成 Might 加成，也不能把 Ganking 变成 movement 许可。" +
    "(3) combat/flow.ts 仍以 combat-start-transaction 阻塞 Combat 开始的原子时点与指定生产" +
    "（466.2 / 807.1.d.1）。不近似实现。",
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
