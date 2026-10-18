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
 * 当前真实缺口（复核 2026-10-18，逐项实测，不近似实现）:
 * - 已合入并可执行：continuous.grant-keyword 原语、Assault/Ganking 的 KeywordDef，以及
 *   programs/statics.ts 的 bindStaticToLayers——本卡两条 static 会被登记成 ability 图层
 *   效果，真实弃牌后图层能读回 assault / ganking（本卡 golden 与模板参数行断言该结果）。
 * - (1) 条件的历史消费与绑定缺口：静态条件只能经
 *   effects/interpreter/condition.ts 的 evaluateCondition 求值，count 走现场集合查询，
 *   layers/filter.ts#matchesObjectFilter 既不读 filter.player 也不读描述性的 subject；
 *   filter { player: "controller" } 的相对玩家占位符在集合查询里没有锚点，实测在没有弃牌的
 *   回合也会数到宿主自身并判为真，两个关键词被错误授予。需要把 count/HistoryQuery 落到
 *   ctx.history({ scope: "turn", action: "discard" }) 的 Condition 消费方。
 * - (2) 被授予 Assault 的 designation 缺口：运行时授予的关键词不会再次进入
 *   KeywordDef.expand；Assault 的 KeywordDef 读 object-property(self, "designation")，
 *   而生产 ObjectSnapshot 只有契约 3.8 的 combatRole，求值抛 MissingInformation 后按
 *   false 处理（实测 combatRole=attacker 时 Might 仍是印刷值 4）。战斗指定本身也没有生产者：
 *   combat/flow.ts 对战斗开始抛 TurnCombatBlockedError("combat-start-transaction")。
 * - (3) 被授予 Ganking 的 movement 许可缺口：Ganking 的 KeywordDef 发出字符串 permission，
 *   而 layers/rules/query.ts 的 movement() 只读规范化的 permission.routes，实测该授权下
 *   canGank 仍为 false；zones/movement.ts 的标准移动也只读调用方传入的
 *   hasGanking / ruleView.canGank。
 * 依赖：条件谓词的历史消费与绑定、运行时授予关键词的 KeywordDef 二次展开与
 * designation/combatRole 对齐、movement() 许可形态对齐。未落地前整卡保持 judge-required。
 */
const ragingSoul = {
  canonicalCardId: "card.hash-55958c501a029c3b3b6cc885be9c3637445d707ccf6347d1f0338abd97718571",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "『If you've discarded a card this turn, I have [Assault] and [Ganking]』（复核 2026-10-18）：" +
    "已合入并可执行：continuous.grant-keyword 原语与 programs/statics.ts 的 bindStaticToLayers 会把本卡两条 static " +
    "登记成 ability 图层效果，真实弃牌后图层能读回 assault / ganking 两个关键词。整卡仍不可执行的三处真实缺口：" +
    "(1) 364.3.a / 423.1 的回合历史门控没有 Condition 消费方：静态条件只能经 effects/interpreter/condition.ts 的 " +
    "evaluateCondition 求值，count 走现场集合查询（layers/filter.ts#matchesObjectFilter 既不读 filter.player，也不读描述性的 subject），" +
    "filter 里的相对玩家占位符在集合查询里没有锚点，实测没有弃牌的回合也会数到宿主自身而把门槛判真，两个关键词被错误授予；" +
    "需要把 compare/count 落到 ctx.history({ scope: \"turn\", action: \"discard\" }) 的条件消费方；" +
    "(2) 807.1.b.3 / 807.1.c / 807.1.d.1：运行时授予的关键词不会再次进入 KeywordDef.expand，" +
    "而 Assault 展开读 object-property(self, \"designation\")，生产 ObjectSnapshot 只有契约 3.8 的 combatRole" +
    "（求值抛 MissingInformation 后按 false 处理，实测 combatRole=attacker 时 Might 仍是印刷值 4）；" +
    "战斗指定本身也没有生产者：combat/flow.ts 的 Combat 开始事务仍抛 TurnCombatBlockedError(\"combat-start-transaction\")；" +
    "(3) 810.1.c / 144.4.c.1：授予后的 Ganking 没有可消费的 movement 许可形态——Ganking 的 KeywordDef 发出字符串 permission，" +
    "而 layers/rules/query.ts 的 movement() 只读规范化的 permission.routes（实测该授权下 canGank 仍为 false），" +
    "zones/movement.ts 的标准移动也只读调用方传入的 hasGanking / ruleView.canGank。" +
    "依赖：条件谓词的历史消费与绑定、运行时授予关键词的 KeywordDef 二次展开与 designation/combatRole 对齐、" +
    "movement() 许可形态对齐。不近似实现。",
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
