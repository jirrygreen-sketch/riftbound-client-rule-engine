import type { Ability, CardProgram } from "../../ir/index.js";

/** Rell, Magnetic (sfd-024-221). */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "tank" },
  {
    kind: "triggered",
    trigger: { at: "attack-declared", filter: { event: "attack-declared", filter: { source: "self" } }, once: "per-combat" },
    optional: false,
    body: [
      {
        id: "rell-magnetic.may-play-equipment",
        op: "choice.optional",
        args: {
          prompt: { kind: "constant", value: "Play an Equipment costing no more than 2 Energy, ignoring its cost, and attach it to me?" },
          body: {
            kind: "constant",
            value: [
              {
                id: "rell-magnetic.play-equipment",
                op: "effect.play",
                args: {
                  pick: { kind: "constant", value: "rell-magnetic.equipment" },
                  cost: { kind: "constant", value: { finalized: true, energy: 0, power: [], xp: 0 } },
                  linkKey: { kind: "constant", value: "played" }
                },
                picks: [
                  {
                    id: "rell-magnetic.equipment",
                    options: ["dynamic:equipment-in-hand"],
                    filter: { type: "gear", tag: "Equipment", zone: "hand", controller: "controller", energyLte: 2 },
                    min: 1,
                    max: 1,
                    selection: "one"
                  }
                ]
              }
            ]
          }
        }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-27bea0f367ed3fcfb05e2db8a75852c62b0d458ec5b40b46249818322961e541",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处当前缺口（复核 2026-10-17），均不近似实现：" +
    "(1) [Tank] 的 KeywordDef 已注册（effects/keywords/Tank.ts），其展开的 continuous.combat 静态效果" +
    "（mode: damage-assignment、priority: first、damage: lethal）经生产静态绑定进 ability 图层，" +
    "layers/engine.ts 的 snapshot 也暴露该注册，但没有任何伤害分配消费分支读取它：" +
    "唯一的战斗伤害分配内核 combat/base-combat-allocation.ts（CR v1.4 的窄内核）把 keywordPriority 固定为 'proven-none'" +
    "（\"No Tank/Backline/other assignment-priority requirement is bound here\"），" +
    "而 CR v1.5 的 combat/flow.ts 根本到不了分配步骤（CombatFlow.dealDamage 抛 TurnCombatBlockedError('simultaneous-damage-transaction')，" +
    "advance 对 staged combat 抛 'combat-start-transaction'），因此 815.1.b/.c 的「先被指派战斗伤害」约束不生效。" +
    "(2) 攻击能力需要按印刷 Energy 上限筛选 Equipment（:rb_energy_2:）、生成忽略费用的 FinalizedCostPlan，" +
    "并把被打出的对象链接给 effect.attach：ObjectFilter 没有费用谓词（实测 translateObjectFilter 对 picks.filter 抛 " +
    "\"Unsupported filter field energyLte\"，cost/plan-values.ts 的 readCost 也不读取印刷费用上限）；" +
    "cost/cost-plan.ts 能表达 ignore-base 计划，effect.play 也接受调用方已 finalize 的计划，" +
    "但它只链接成功张数（实测 typeof number），没有「已打出对象 → effect.attach 的 objects」的卡牌程序接线。" +
    "依赖：continuous.combat 的战斗伤害分配消费方（815.1.b/.c）、目标过滤的印刷费用上限消费方、" +
    "已打出对象的链接回执与 attach 接线。不近似实现（不写成无条件 location，也不省略费用上限）。",
  abilities,
  sourceText:
    "[Tank] (I must be assigned combat damage first.)\n" +
    "When I attack, you may play an Equipment with Energy cost no more than :rb_energy_2:, ignoring its cost, and attach it to me."
} satisfies CardProgram;
