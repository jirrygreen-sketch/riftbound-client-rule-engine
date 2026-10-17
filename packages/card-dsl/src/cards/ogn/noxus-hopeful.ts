import type { CardProgram } from "../../ir/index.js";

/**
 * Noxus Hopeful (ogn-012-298) — Unit, Fury, Trifarian/Noxus, energy 4, Might 4.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogn-012-298，逐字）:
 *   "[Legion] — I cost :rb_energy_2: less. (Get the effect if you've played
 *    another card this turn.)"
 *
 * 规则依据（Core Rules v1.5）:
 * - 812.1 / 812.1.a：Legion 是依赖型关键词，格式 "[Legion][>] [Text]"；
 *   812.1.b / 812.1.b.2：从关键词到子句结束整体是 Legion 能力，[Text] 是依赖能力。
 * - 812.1.b.1：功能上等于 "If you have played another card this turn, this card
 *   gains [Text]."；812.1.c：只要**与本卡不同**的牌本回合被你 Finalized，条件即成立；
 *   812.2：同一玩家打出一张牌即可满足其所有 Legion 实例。
 * - 366.2 / 366.2.a：改费被动能力在可打出该牌的任意区域始终生效。
 * - 356.4 / 356.4.b："I cost [2] less" 是减费（discount），在费用计划的减费阶段生效。
 *
 * 结构说明:
 * - abilities[0]：按契约 3.1 声明 legion 关键词能力（不重写关键词逻辑；KeywordDef
 *   的展开由关键词注册表负责）。
 * - abilities[1]：Legion 依赖能力本体，声明为带条件的 static 费用改写效果
 *   （kind: "cost.modify"），condition 用已定义的 history 维度表达 812.1.c 的
 *   "另一张牌"（本回合、排除宿主自身），amount 为减少量 2 Energy。
 *
 * 未合入依赖（不近似实现）:
 * - Legion 的 KeywordDef 与 HistoryQuery.exclude/objectFilter 形状已经合入，参考内核也能
 *   按这些字段计数；生产 ResolveContext 仍没有对 static condition 提供同等的历史对象过滤，
 *   因此 812.1.c 还不能可靠排除宿主自身的 play。
 * - cost.modify 仍没有 static CardProgram → CostPlan 的消费路径：static binder 没有该层类型，
 *   费用计划也没有从静态能力收集这项 discount。
 * 保持 judge-required，不近似实现。
 */
const noxusHopeful = {
  canonicalCardId: "card.hash-d8fc7a6f007a594060f40601cd5a28becae060a1537ac98db24d17e8039fc452",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "『[Legion] — I cost :rb_energy_2: less』的依赖条件是 812.1.c 的『与本卡不同的一张牌本回合被你 Finalized』：" +
    "Legion 展开与 HistoryQuery.exclude/objectFilter 形状已合入，参考内核也能执行排除；但生产 ResolveContext " +
    "尚未把历史对象过滤提供给 static condition，812.1.c 仍不能可靠排除宿主自身。cost.modify 也没有 " +
    "static CardProgram → CostPlan 的消费路径（static binder 与费用计划都不收集该 discount）。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "legion" },
    {
      kind: "static",
      effect: {
        kind: "cost.modify",
        resource: "energy",
        amount: { kind: "constant", value: 2 },
        appliesTo: "self",
        // 356.4 / 356.4.b：减费在费用计划的减费阶段按 356.4 的顺序应用；
        // amount 是减少量，不是带符号的差值。
        stage: "discount"
      },
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "cards-finalized-this-turn",
          // 812.1.c：本回合被该玩家 Finalized 的、与本卡不同的牌。
          filter: { player: "controller", exclude: "self" }
        },
        operator: "gte",
        right: { kind: "constant", value: 1 }
      }
    }
  ],
  sourceText: "[Legion] — I cost :rb_energy_2: less. (Get the effect if you've played another card this turn.)"
} satisfies CardProgram;

export default noxusHopeful;
