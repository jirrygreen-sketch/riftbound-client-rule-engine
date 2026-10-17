import type { Ability, CardProgram, Condition } from "../../ir/index.js";

/** Vex, Cheerless — [1][A] changes both resources (CR v1.5 356.3/356.4).
 * The combat predicate and static-to-Finalize cost binding remain judge-required.
 */
const inCombat = {
  kind: "compare",
  left: { kind: "count", subject: "self-in-combat", filter: { object: "self" } },
  operator: "gte",
  right: { kind: "constant", value: 1 }
} satisfies Condition;

const abilities: Ability[] = [
  {
    kind: "static",
    effect: {
      kind: "continuous.cost-modification", stage: "discount", resource: "energy",
      amount: { kind: "constant", value: 1 },
      minimum: { kind: "constant", value: 1 },
      appliesTo: { type: "spell", controller: "caster" }
    },
    condition: inCombat
  },
  {
    kind: "static",
    effect: {
      kind: "continuous.cost-modification", stage: "discount", resource: "power",
      amount: { kind: "constant", value: 1 }, universal: true,
      appliesTo: { type: "spell", controller: "caster" }
    },
    condition: inCombat
  },
  {
    kind: "static",
    effect: {
      kind: "continuous.cost-modification", stage: "increase", resource: "energy",
      amount: { kind: "constant", value: 1 },
      appliesTo: { type: "spell", controller: "caster-opponent" }
    },
    condition: inCombat
  },
  {
    kind: "static",
    effect: {
      kind: "continuous.cost-modification", stage: "increase", resource: "power",
      amount: { kind: "constant", value: 1 }, universal: true,
      appliesTo: { type: "spell", controller: "caster-opponent" }
    },
    condition: inCombat
  }
];

const program = {
  canonicalCardId: "card.hash-f53634b94e6fae93d877ca3bb7f92c97c1f881953a9d82fc5a297b398f35d3ad",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "continuous.cost-modification 尚未接入 Finalize 的 CostPlanInput.discounts/increases：programs/statics.ts 的 layerFor 没有该 kind 的映射，友敌法术关系也须随费用查询求值。费用原语已支持普通 Energy/Power 改费及 any-domain [A] 费用要求；本卡的 [1][A] 是同时修改两种资源，最低 [1] 按 356.4.e 仅属于本折扣，加费按 356.3。While I am in combat 仍需 740.2.c 的进行中战斗与战斗身份谓词，不能仅数 self（RIFT-359）。不近似实现。",
  abilities,
  sourceText:
    "While I'm in combat, friendly spells cost :rb_energy_1::rb_rune_rainbow: less to a minimum of :rb_energy_1:, " +
    "and enemy spells cost :rb_energy_1::rb_rune_rainbow: more."
} satisfies CardProgram;

export default program;
