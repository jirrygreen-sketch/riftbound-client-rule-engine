import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Shock Blast (ven-059-166) — Spell, 3 energy + 1 Power, no printed Might, domain Mind.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-059-166，逐字）：
 *   "[Action] (Play on your turn or in showdowns.)\n" +
 *   "This costs :rb_energy_2: less if you control something that's [Empowered].\n" +
 *   "Deal 4 to a unit at a battlefield."
 *
 * 规则依据（Core Rules v1.5）：
 * - [Action]（806.1 / 806.1.c）：许可类关键词，授予在任意玩家回合的 Showdown 期间打出的
 *   许可；卡侧只声明 keyword（契约 3.7），展开与 806.1.c 的链许可由 keywords/Action.ts
 *   与 chain/ 负责。
 * - "This costs :rb_energy_2: less if you control something that's [Empowered]."：
 *   356.4.b 的减费表达式，按 356.4.a 可由该牌本身提供、在 Finalize 的费用计算
 *   折扣步骤套用；356.4.c.2 保证不会把该分量降到 0 以下。“你控制某物是 [Empowered]”
 *   的门槛需要一个 Empowered 状态谓词（828.2：Empowered 是卡牌特征，可被检查）。
 * - "Deal 4 to a unit at a battlefield."：effect.damage（418.1 / 418.1.b，已合入原语）。
 *   目标是一个位于战场的单位：355.9.a.1 的 “unit” 默认指 Board 对象，355.9.b 要求符合
 *   “at a battlefield” 这一目标限制；位置过滤沿用已合入程序的拼法 location: "battlefield"
 *   （layers/filter.ts 的 matchesObjectFilter 比较 object.location.type，
 *   同 ven-060-166 sky-crusier）。
 *
 * status = judge-required（缺口均不近似实现）：
 * 1. 减费没有可执行路径：(a) continuous.cost-modification 的静态声明没有卡牌侧消费方——
 *    cost/cost-plan.ts 的 CostDiscount 只接受调用方传入的 CostDiscount，没有从 CardProgram
 *    的 static 效果读取，也没有 cost.modify 原语（依赖 RIFT-89）；(b) “你控制某物是
 *    [Empowered]” 的谓词没有已合入实现：Contract 的 Condition 没有 empowered 谓词，
 *    layers/engine.ts 的 conditionMatches 只识别 always/never/type/has-tag/has-keyword，
 *    Empowered 状态也不是 ObjectSnapshot 特征（同 ven/055-166 applied-researchers 的登记）。
 *    程序里只保留可审查的描述性门槛（具名谓词），绝不写成恒定 true 的条件。
 * 2. 已支持部分：effect.damage 的“Deal 4 to a unit at a battlefield”由 golden 用解释器 +
 *    参考内核真实执行（含位置过滤匹配与失效目标 ignored 的边界）；减费与 Empowered 门槛写
 *    test.todo。
 * 依赖：RIFT-89（费用计划与静态减费接线）、RIFT-91（图层条件求值与 Empowered 谓词）。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "action" },
  {
    // "This costs :rb_energy_2: less if you control something that's [Empowered]."
    // 356.4.b 的减费；门槛是 “你控制某物拥有 Empowered 状态”，但 Empowered
    // 谓词尚无已合入实现（见 judgeReason 第 1.b 点），因此条件写成具名描述，
    // 绝不写成恒真或近似为“你控制某个单位”。
    kind: "static",
    effect: {
      kind: "continuous.cost-modification",
      resource: "energy",
      amount: { kind: "constant", value: -2 },
      minimum: { kind: "constant", value: 0 },
      appliesTo: "self"
    },
    condition: {
      kind: "expression",
      value: { kind: "constant", value: "you-control-something-empowered" }
    }
  },
  {
    kind: "play",
    cost: {
      kind: "cost.printed",
      energy: { kind: "constant", value: 3 },
      // 印刷 1 点 Mind Power（domains: ["Mind"]）。
      power: { kind: "constant", value: 1 }
    },
    body: [
      {
        // "Deal 4 to a unit at a battlefield." — 418.1 的 Deal；数额是印刷的固定 4。
        id: "shock-blast.deal-4",
        op: "effect.damage",
        args: {
          amount: { kind: "constant", value: 4 },
          target: { kind: "constant", value: "shock-blast.battlefield-unit" }
        },
        targets: [
          {
            id: "shock-blast.battlefield-unit",
            // 355.9.b 的 “at a battlefield” 限制：只有位于战场的单位合法。
            filter: { type: "unit", location: "battlefield" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-c9945e7665b7b73c7fc723b3de1260db01ea2a28b12779b874641e989df11f0b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "减费没有可执行路径，均不近似实现：(1)「This costs :rb_energy_2: less」是 356.4.b 的减费、按 356.4.a 由本牌提供、" +
    "在 Finalize 的费用计算折扣步骤套用（356.4.c.2 保证该分量不为负），但 continuous.cost-modification 的静态声明没有卡牌侧消费方：" +
    "cost/cost-plan.ts 的 CostDiscount 只接受调用方传入的 CostDiscount，没有从 CardProgram 的 static 效果读取，也没有 cost.modify " +
    "指令原语（RIFT-89）。(2) 门槛「if you control something that's [Empowered]」没有已合入谓词：契约的 Condition 没有 empowered 谓词，" +
    "layers/engine.ts 的 conditionMatches 只识别 always/never/type/has-tag/has-keyword，Empowered（828.2 的可检查特征）也不是 " +
    "ObjectSnapshot 特征；程序里只保留具名描述门槛，绝不写成恒真条件或近似成“你控制某个单位”。" +
    "已支持部分：「Deal 4 to a unit at a battlefield」是已合入的 effect.damage（418.1）且目标限制按 355.9.b 声明，golden 真实执行" +
    "（含位置过滤与目标失效时的 ignored 边界）。依赖：RIFT-89（费用计划与静态减费接线）、RIFT-91（图层条件求值与 Empowered 谓词）。",
  abilities,
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "This costs :rb_energy_2: less if you control something that's [Empowered].\n" +
    "Deal 4 to a unit at a battlefield."
} satisfies CardProgram;
