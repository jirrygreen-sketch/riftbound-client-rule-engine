import type { CardProgram } from "../../ir/index.js";

/**
 * Sharkling (unl-006-219) — Unit, 3 Energy, Might 1, Fury, tag Bilgewater.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-006-219，逐字）：
 *   "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)\n"
 *   "[Assault 4] (+4 :rb_might: while I'm an attacker.)"
 *
 * 规则依据（CR v1.5）：
 * - [Accelerate]（805）：805.1 是 Optional Additional Cost 关键词，805.1.a 出现在单位上；
 *   805.1.b 功能上等价于 "As you play me, you may pay [1][C] as an additional cost. If you do,
 *   I enter ready."。费用固定为 1 Energy + 1 Power，因此 keyword 不带数值；805.1.b.1 规定
 *   单位有一个或多个域时，Power 部分必须用与单位某一域匹配的力量支付（本卡域为 Fury，
 *   与印刷的 :rb_rune_fury: 一致）；805.2 / 805.2.a 说明该费用只能在打出该单位的流程中支付；
 *   805.2.b 说明支付后产生延迟替代效果；805.6 / 805.6.a 说明它把"横置进场"替换为"就绪进场"、
 *   不触发任何与"成为就绪"相关的能力；805.5 说明是否拥有 Accelerate 是可引用特征。
 *   卡只声明 keyword（契约 3.1/3.7），展开（accelerate.cost 静态声明 + 入场替代）归
 *   effects/keywords/Accelerate.ts。
 * - [Assault 4]（807.1.b.1-2）：Assault Value = 印刷值 4；807.1.c 功能上等价于 "While I am an
 *   attacker, I have +4 [M]"；807.1.d / 807.1.d.1 说明该修正在维持 Attacker designation 期间
 *   生效；807.2 多来源相加、合并为一个 Assault Value；807.3 这是可引用特征。展开归
 *   effects/keywords/Assault.ts（RIFT-81）。
 *
 * status = judge-required（2026-10-18 复核，缺口不近似实现）：
 * - [Accelerate]（805）的两半都已合入：cost/cost-plan.ts 的 optionalAdditional 支持
 *   kind "accelerate"（805.1.b 的固定 [1][C]、805.1.b.1 的域匹配力量），chain/engine.ts
 *   在 resolve 时读 selectedAdditional 决定 805.6 的就绪入场，replacement/ 的入场替代
 *   本身也能绑定。仍缺的是把本卡 keyword 接进打出流程的生产消费：programs/play.ts 的
 *   translateCost 对展开的 cost 抛 "Unsupported play cost field optional"，
 *   accelerate.cost 静态声明在 programs/statics.ts 抛 "no layer mapping"，
 *   没有任何 play producer 读取它来生成 { kind: "accelerate" } 费用组。
 * - [Assault 4] 的展开是 static continuous.might + designation 条件。生产 binder 现在能
 *   登记该静态能力（图层层 arithmetic/continuous.might），但 programs/statics.ts 用基础
 *   解释器求值 ability.condition；object-property(self, "designation") 在 ObjectSnapshot
 *   上不存在，读失败被兜底为 false，因此 +4 对攻击者同样不生效（实测 attacker/defender/null
 *   三种 combatRole 下 Might 均不变）。把 designation 映射到 combatRole 的扩展求值器
 *   （effects/interpreter/expr-ext/）没有生产调用方，combat/flow.ts 的 startCombat 也仍抛
 *   "combat-start-transaction"，即没有真正的 Attacker designation 生产方。
 *
 * 依赖：keyword→CostPlanInput 的生产接线、static 条件的 designation 扩展求值接线与战斗角色指派。
 */
export default {
  canonicalCardId:
    "card.hash-a9d231899d6f3cc46b5f8d00320977ba937b799647d39e1c0b6ccf4ddb83b162",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两个关键词的展开都已合入并能通过校验，但仍没有生产消费方，均不近似实现：" +
    "(1) [Accelerate]（805）——effects/keywords/Accelerate.ts 的 accelerate.cost 静态费用声明与 805.6 的 " +
    "object-enters-board 入场替代本身可用：cost/cost-plan.ts 的 optionalAdditional 支持 kind \"accelerate\"（805.1.b 的 " +
    "固定 [1][C] 与 805.1.b.1 的域匹配力量），chain/engine.ts 在 resolve 单位时按 selectedAdditional 决定就绪入场，" +
    "replacement/ 的 bindReplacement 也能把横置入场改写成就绪入场（golden 用真实 move-zone 验证）。缺的是卡牌 keyword → " +
    "费用组的生产接线：programs/play.ts 的 translateCost 对展开的 cost 仍抛 \"Unsupported play cost field optional\"，" +
    "accelerate.cost 静态声明在 programs/statics.ts 仍抛 \"Static ability kind accelerate.cost has no layer mapping\"，" +
    "没有任何 play producer 读取它生成 { kind: \"accelerate\" } 费用组，也没有把该展开接入本卡的替代生命周期。" +
    "(2) [Assault 4]（807）——continuous.might 图层算术修正本身可用且生产 binder 现在能登记该静态能力" +
    "（实测 bindStatic 成功、图层层 arithmetic），但 807.1.d 的 Attacker designation 读不到：" +
    "programs/statics.ts 的 abilityEnvironment 用基础解释器求值 ability.condition，" +
    "object-property(self, \"designation\") 不在 ObjectSnapshot 上，MissingInformation 被兜底为 false，" +
    "所以 +4 对攻击者也不生效（实测 attacker/defender/null 三种 combatRole 下 Might 均不变）；" +
    "把 designation 映射到 combatRole 的扩展求值器（effects/interpreter/expr-ext/）没有生产调用方，" +
    "combat/flow.ts 的 startCombat 仍抛 \"combat-start-transaction\"（CR 466.2 需要原子的同时时点波次与角色指派），" +
    "即没有真正的 Attacker designation 生产方。" +
    "依赖：keyword→CostPlanInput 的生产接线、static 条件的 designation 扩展求值接线与战斗角色指派。" +
    "不近似实现（不把 Assault 4 写成恒定的 +4，也不手改费用）。",
  abilities: [
    // 805.1.b：费用固定为 [1][C]，keyword 不带数值；805.4：多个实例冗余。
    { kind: "keyword", keyword: "accelerate" },
    // 807.1.b.1-2：印刷为 "Assault 4"，Assault Value = 4。
    { kind: "keyword", keyword: "assault", value: 4 }
  ],
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)\n" +
    "[Assault 4] (+4 :rb_might: while I'm an attacker.)"
} satisfies CardProgram;
