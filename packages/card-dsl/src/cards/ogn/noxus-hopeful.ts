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
 * 未合入依赖（2026-10-17 逐条实测，不近似实现）:
 * - 条件本身还求不出 812.1.c 的历史语义：把印刷 condition 绑到已映射的图层 kind 上实测，
 *   expr.ts 的 count 只按 filter 查询当前对象集合，不消费 subject
 *   "cards-finalized-this-turn" 的历史，filter 里的 player 也不是它认识的键，
 *   于是 `exclude: "self"` 之外的**任意**现存对象都会让计数 ≥ 1：对手手牌、对手战场单位、
 *   自己的符文都算数（实测各为 1），而条件并不因此正确。真正的 812.1.c 语义
 *   （本回合被该玩家 Finalized 的、与本卡不同的另一张牌）没有生产求值路径。
 * - cost.modify 仍没有 static CardProgram → CostPlan 的消费路径：static binder 的 layerFor
 *   没有该 kind（实测 "Static ability kind cost.modify has no layer mapping"），
 *   费用计划也没有从静态能力收集这项 discount。
 * 保持 judge-required，不近似实现。
 */
const noxusHopeful = {
  canonicalCardId: "card.hash-d8fc7a6f007a594060f40601cd5a28becae060a1537ac98db24d17e8039fc452",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处当前缺口（2026-10-17 实测，不近似实现）：" +
    "(1) 812.1.c 的条件求值不成立：把印刷 condition 绑到已映射的图层 kind 后实测，" +
    "expr.ts 的 count 只按 filter 查询当前对象集合、不消费 subject \"cards-finalized-this-turn\" 的历史，" +
    "filter 的 player 也不是它认识的键，于是除 exclude: \"self\" 外的**任意**现存对象" +
    "（对手手牌、对手战场单位、自己的符文）都会让计数 ≥ 1（实测各为 1），条件与" +
    "『本回合已被你 Finalized 的、与本卡不同的另一张牌』无关；真实历史语义无生产求值路径。" +
    "(2) cost.modify 没有 static CardProgram → CostPlan 的消费路径：programs/statics.ts 的 layerFor " +
    "没有该 kind（实测 \"Static ability kind cost.modify has no layer mapping\"），" +
    "费用计划也不会从静态能力收集 356.4 的 discount，实测打出仍支付全部印刷费用。",
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
