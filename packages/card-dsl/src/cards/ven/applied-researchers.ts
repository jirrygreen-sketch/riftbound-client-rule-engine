import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * applied-researchers — M2 源码复核（2026-10-18）。
 * CR v1.5 827.1.c.1：Empower 印刷费用为 3 Energy。
 * 442.1.a/828.1.b.1：依赖能力只在宿主 Empowered 时有效。
 * Empower KeywordDef 已合入；缺口是逐实例费用参数与生产接线。
 * 2026-10-18 复核：cost/discounts/collect.ts 的 spell-play-cost 折扣消费通道已合入，
 * 当前缺口收窄为卡程序到该通道的生产桥接。具体规则与剩余阻塞见 judgeReason；执行证据在
 * templates/keyword-static-static-673.test.mjs，局部执行不代表整卡可执行。
 */
const abilities: Ability[] = [
  {
    kind: "keyword",
    keyword: "empower",
    value: 3
  },
  {
    kind: "static",
    effect: {
      kind: "continuous.cost-modification",
      resource: "energy",
      amount: -1,
      minimum: 1,
      appliesTo: "spell-play-cost",
      filter: { type: "spell", controller: "self" }
    },
    condition: {
      kind: "compare",
      left: { kind: "object-property", object: "self", property: "empowered" },
      operator: "gte",
      right: { kind: "constant", value: 1 }
    }
  },
  {
    kind: "static",
    effect: {
      kind: "continuous.cost-modification",
      resource: "power",
      amount: -1,
      domain: "any",
      appliesTo: "spell-play-cost",
      filter: { type: "spell", controller: "self" }
    },
    condition: {
      kind: "compare",
      left: { kind: "object-property", object: "self", property: "empowered" },
      operator: "gte",
      right: { kind: "constant", value: 1 }
    }
  }
];

export default {
  canonicalCardId: "card.hash-ffb7fa0eb6027d1158053512ab5917c1ff4226d11f9110deeade65133c7312b4",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口（2026-10-18 复核，均为实测）：(1) 827.1.c.1 的 3 Energy 印刷费用缺 " +
    "KeywordAbility.params.cost → expandProgram → Empower.expand 接线：expandProgram 只向 " +
    "Empower.expand 传 { value, host }，实测展开产 { kind: \"empower\" }，生产 buildCostPlan 抛 " +
    "CostPlanError('Unsupported cost kind: empower')。(2) 契约 ObjectSnapshot（effects/contract.ts）" +
    "尚未声明 empowered（442.1.a），生产快照缺字段时按 MissingInformation 失败闭合；统一生产 " +
    "Empowered 状态适配与 442.1.b/c 的二元状态限制仍需接通。(3) 828.1.c 的门控已改读真实 " +
    "empowered 计数，参考内核随 empower/disempower 动作正确翻转。(4) continuous.cost-modification 的 " +
    "spell-play-cost 折扣消费通道已合入（cost/discounts/collect.ts 的 collectCostModifications / " +
    "finalizeCostPlan 可接受 StaticCostAbility 并执行 1 Energy + 1 任意域 Power 折扣及 356.4.e 的" +
    "单条最低 1 Energy），但 programs/statics.ts 的 layerFor 仍不识别该 kind，Chain Finalize 也未接 " +
    "finalizeCostPlan——没有把卡程序 static 送进该通道的生产桥接，折扣无法进入法术 Finalize 费用计划。",
  abilities,
  sourceText:
    "[Empower] :rb_energy_3: (:rb_energy_3:: Empower me. Use only if not Empowered.)\n" +
    "[Empowered][>] Your spells cost :rb_energy_1::rb_rune_rainbow: less, to a minimum of :rb_energy_1:."
} satisfies CardProgram;
