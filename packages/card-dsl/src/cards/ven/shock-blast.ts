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
 * status = judge-required（2026-10-17 RIFT-618 第三轮复核；缺口以本任务实测为准）：
 * 1. 「This costs :rb_energy_2: less」是 356.4.b 的减费，按 356.4.a 由本牌提供、在 Finalize 的
 *    费用折扣步骤套用（356.4.c.2 保证该分量不为负）。“你控制某物是 [Empowered]”的门槛
 *    （828.2：Empowered 是可检查特征）仍没有已合入谓词：ObjectSnapshot 没有 empowered 字段，
 *    layers/engine.ts 的 conditionMatches 只识别 always/never/type/has-tag/has-keyword，
 *    未知 kind 落回 true。程序里只保留具名描述门槛，绝不写成恒真条件或近似成“你控制某个单位”。
 * 2. continuous.cost-modification 的静态声明没有消费方：cost.modify 原语与
 *    cost/cost-plan.ts 的减费求值已合入，但 programs/statics.ts 的 layerFor() 对
 *    continuous.cost-modification 抛 ProgramBindingError（无图层映射），也没有消费方把
 *    CardProgram static 装进 CostPlanInput.discounts。本任务 golden 实测该绑定失败。
 * 3. 已支持部分：「Deal 4 to a unit at a battlefield」（418.1，含 355.9.b 的位置限制）由
 *    golden 用真实解释器 + 参考内核执行（含目标失效的 ignored 边界）。
 * 依赖：static → Finalize 费用计划的减费安装路径与 Empowered 状态谓词（442.1.a/828.2）。
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
    "两条当前缺口（复核 2026-10-17，RIFT-618；均不近似实现）：" +
    "(1) 减费没有可执行路径：「This costs :rb_energy_2: less」按 356.4.b/356.4.a 在 Finalize 折扣步骤套用，" +
    "cost.modify 原语与 cost/cost-plan.ts 的减费求值已合入，但 programs/statics.ts 的 layerFor() 对 " +
    "continuous.cost-modification 没有图层映射（本任务实测 bindStatic 抛 " +
    "\"Static ability kind continuous.cost-modification has no layer mapping\"），也没有消费方把 " +
    "CardProgram static 装进 CostPlanInput.discounts。" +
    "(2) 门槛「if you control something that's [Empowered]」没有已合入谓词：ObjectSnapshot 无 empowered 字段，" +
    "layers/engine.ts 的 conditionMatches 只识别 always/never/type/has-tag/has-keyword 并对其余 kind 落回 true；" +
    "程序里只保留具名描述门槛，不写成恒真条件或近似成「你控制某个单位」。" +
    "已支持部分：「Deal 4 to a unit at a battlefield」是 effect.damage（418.1），目标限制按 355.9.b 声明，" +
    "golden 真实执行（含位置过滤与目标失效时的 ignored）。依赖：static → Finalize 费用计划安装路径、" +
    "Empowered 状态谓词（442.1.a/828.2）。",
  abilities,
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "This costs :rb_energy_2: less if you control something that's [Empowered].\n" +
    "Deal 4 to a unit at a battlefield."
} satisfies CardProgram;
