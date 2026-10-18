import type { Ability, CardProgram, Condition } from "../../ir/index.js";

/**
 * Vex, Cheerless — [1][A] changes both resources (CR v1.5 356.3/356.4).
 *
 * Status: judge-required (cards/README.md §2), re-verified 2026-10-18 against the
 * merged engine sources. Three measured current gaps, none approximated:
 * - The 740.2.c "in combat" predicate still cannot be evaluated. The merged cost
 *   collector rejects this card's condition with CostPlanError(judge-required)
 *   "Unsupported cost count subject self-in-combat" (cost/discounts/values.ts
 *   evaluateCostValue), and the base interpreter's CountExpr branch ignores
 *   `subject` and queries only `filter`, so it would count the self filter's
 *   objects instead of proving an ongoing combat plus a combat designation.
 * - The default static binder rejects this card's structured appliesTo
 *   ({ type: 'spell', controller: 'caster' / 'caster-opponent' }):
 *   programs/statics.ts staticTarget maps only self/source anchors and throws
 *   ProgramBindingError('judge-required', 'Unsupported static appliesTo ...').
 * - Even with those two fixed the production Finalize has no consumer:
 *   chain/engine.ts finalize still calls buildCostPlan directly and never
 *   finalizeCostPlan/collectCostModifications, so a registered declaration
 *   would not reach the play cost plan.
 * The merged collector does handle the declaration's arithmetic (Energy plus a
 * universal [A] Power component, per-discount minimum 1) once the condition is
 * answerable; the golden covers that subpath and the fail-closed condition.
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
    "三处当前缺口（2026-10-18 复核实测；不近似实现）：(1) 740.2.c 的 While I'm in combat 仍不可求值——生产费用收集器实测以 " +
    "CostPlanError(judge-required) \"Unsupported cost count subject self-in-combat\" 拒绝本卡条件（cost/discounts/values.ts 的 evaluateCostValue 只支持 objects/cards/units/gear(s)/runes），" +
    "基础解释器的 CountExpr 分支也不消费 subject、仅按 filter 查询对象，无法证明进行中战斗与战斗身份。(2) 默认静态绑定拒绝本卡的相对友敌 appliesTo：programs/statics.ts 的 staticTarget 只接受 self/source 锚点，" +
    "实测对 { type: \"spell\", controller: \"caster\" / \"caster-opponent\" } 抛 ProgramBindingError(judge-required) \"Unsupported static appliesTo ...\"。(3) 即使前两项接通，生产 Finalize 仍无消费方：" +
    "chain/engine.ts 的 finalize 直接调用 buildCostPlan，未调用 finalizeCostPlan/collectCostModifications，已注册声明不会进入打出费用计划。" +
    "已核实可执行部分：收集器把本卡的 [1] Energy 折扣（356.4.e 的最低 1 仅属于本折扣）与 universal [A] Power 折扣、以及 356.3 的加费正确折算（golden 绑定实测）；" +
    "[A] 按 163.2.b 是任意域 Power 费用要求，不伪造成某个具名域。",
  abilities,
  sourceText:
    "While I'm in combat, friendly spells cost :rb_energy_1::rb_rune_rainbow: less to a minimum of :rb_energy_1:, " +
    "and enemy spells cost :rb_energy_1::rb_rune_rainbow: more."
} satisfies CardProgram;

export default program;
