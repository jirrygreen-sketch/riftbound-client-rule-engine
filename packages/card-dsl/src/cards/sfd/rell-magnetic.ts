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
    "[Tank] 的 KeywordDef 已注册（effects/keywords/Tank.ts），其展开的 continuous.combat 静态效果" +
    "（mode: damage-assignment、priority: first、damage: lethal）经生产静态绑定进 ability 图层后，" +
    "layers/engine.ts 的 snapshot 没有任何伤害分配消费分支（continuous.combat 尚未接入 combat 伤害分配，815，RIFT-9/RIFT-91）。" +
    "攻击能力还需要按印刷 Energy 上限筛选 Equipment（energyLte）、生成忽略费用的 FinalizedCostPlan，并把被打出的对象链接给 effect.attach；当前 ObjectFilter 没有费用谓词，effect.play 只返回成功次数且没有卡牌程序→费用/附着接线（RIFT-89）。不近似实现。",
  abilities,
  sourceText:
    "[Tank] (I must be assigned combat damage first.)\n" +
    "When I attack, you may play an Equipment with Energy cost no more than :rb_energy_2:, ignoring its cost, and attach it to me."
} satisfies CardProgram;
