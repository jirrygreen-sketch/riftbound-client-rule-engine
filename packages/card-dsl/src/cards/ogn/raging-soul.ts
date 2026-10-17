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
 * 当前真实缺口（复核 2026-10-17，不近似实现）:
 * - continuous.grant-keyword 指令原语已合入（RIFT-258），Assault/Ganking 的 KeywordDef
 *   也已合入（RIFT-81 的 Assault / RIFT-83 的 Ganking），卡牌 static 绑定（RIFT-257）
 *   已合入：programs/statics.ts 的 bindStaticToLayers 会把本卡两条 static 注册成图层效果
 *   （实测 createEngineStaticBinder.bindStatic 注册后图层能读到 granted 关键词）。
 * - 条件历史查询仍未接通：条件按 compare + count 声明，但 count 是对**当前对象集合**的
 *   现场查询——filter { player: "controller" } 的相对玩家占位符在集合查询里没有锚点，
 *   实测在没有弃牌的回合也会数到宿主自身并判为真，两个关键词被错误授予；需要把
 *   count/HistoryQuery 落到 ctx.history({ scope: "turn", action: "discard" }) 的消费方
 *   （当前条件消费方缺口）。
 * - 被授予的 Assault 仍需 Attacker designation：ObjectSnapshot 现在只有契约 3.8 的
 *   combatRole，而 Assault 的 KeywordDef 读 object-property "designation"，求值抛
 *   MissingInformation 后按 false 处理（实测 combatRole=attacker 时 Might 仍是印刷值）；
 *   且没有任何已合入产者写入 combatRole（combat/flow.ts 对战斗开始抛
 *   combat-start-transaction）。
 * - 被授予的 Ganking 的 continuous.movement 许可还没有可消费形态：Ganking 的 KeywordDef
 *   发出字符串 permission，而 layers/rules/query.ts 的 movement() 只读规范化的
 *   permission.routes（实测 movement().canGank 仍为 false）。
 * 依赖：条件谓词的历史消费与绑定、combatRole 生产方与 designation 对齐、movement()
 * 许可形态对齐。
 */
const ragingSoul = {
  canonicalCardId: "card.hash-55958c501a029c3b3b6cc885be9c3637445d707ccf6347d1f0338abd97718571",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "『If you've discarded a card this turn, I have [Assault] and [Ganking]』（复核 2026-10-17）：" +
    "continuous.grant-keyword 指令、Assault/Ganking 的 KeywordDef 与卡牌 static 绑定" +
    "（programs/statics.ts 的 bindStaticToLayers）均已合入，golden 用真实 binder + 图层引擎注册两条 static；" +
    "整卡仍不可执行的三处：(1) 条件历史查询未接通——compare + count 的 count 是对当前对象集合的现场查询，" +
    "filter 里的相对玩家占位符在集合查询中无锚点，实测没有弃牌的回合也会数到宿主自身并判为真，两个关键词被错误授予；" +
    "需要把 count/HistoryQuery 落到 ctx.history({ scope: \"turn\", action: \"discard\" }) 的条件消费方；" +
    "(2) 被授予的 Assault 需要 Attacker designation：ObjectSnapshot 只有契约 3.8 的 combatRole，而 Assault 的 KeywordDef 读 " +
    "object-property \"designation\"（求值抛 MissingInformation 后按 false 处理，实测 combatRole=attacker 时 Might 仍是印刷值），" +
    "且没有已合入产者写入 combatRole（combat/flow.ts 对战斗开始抛 combat-start-transaction）；" +
    "(3) 被授予的 Ganking 的 continuous.movement 许可没有可消费形态：KeywordDef 发出字符串 permission，" +
    "而 layers/rules/query.ts 的 movement() 只读规范化的 permission.routes（实测 movement().canGank 仍为 false）。" +
    "依赖：条件谓词的历史消费与绑定、combatRole 生产方与 designation 对齐、movement() 许可形态对齐。不近似实现。",
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
