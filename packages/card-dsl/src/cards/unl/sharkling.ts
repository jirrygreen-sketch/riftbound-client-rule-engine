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
 * status = judge-required（缺口不近似实现）：
 * - [Accelerate]（805）的两半都已合入：cost/cost-plan.ts 的 optionalAdditional 支持
 *   kind "accelerate"（805.1.b 的固定 [1][C]、805.1.b.1 的域匹配力量，golden 用真实
 *   buildCostPlan 断言支付与拒绝两条路径），replacement/ 的入场替代也能把 805.6 的
 *   "exhausted=true 横置入场" 改写成就绪入场（golden 用 bindReplacement + 真实 move-zone 验证）。
 *   仍缺的是把本卡 keyword 接进打出流程的生产消费：没有 play producer 读取 accelerate.cost
 *   静态效果来生成 { kind: "accelerate" } 费用组，也没有把该展开接入本卡的替代生命周期。
 * - [Assault 4] 的展开是 static continuous.might + designation 条件，图层算术修正本身可用
 *   （continuous.might 原语 + LayerEngine，实测把该展开绑定到非攻击者仍会加 4 Might：3 → 7），
 *   但 807.1.d 的 Attacker designation 没有生产方：combat/flow.ts 的 startCombat 仍抛
 *   "combat-start-transaction"（CR 466.2 需要原子的同时时点波次与角色指派），
 *   ObjectSnapshot.combatRole 只有测试内核手工置值；而且 Assault 展开用的 condition.kind 是
 *   compare(object-property(self, "designation"))，图层条件词表（layers/engine.ts 的
 *   conditionMatches）只认 always/never/type/has-tag/has-keyword，未知条件按 true ——
 *   直接绑定就是近似实现。
 *
 * 依赖：Accelerate 费用组与替代生命周期的生产消费、战斗角色指派（combat/flow.ts 的
 * combat-start-transaction）与图层条件对 designation/combatRole 的消费。
 */
export default {
  canonicalCardId:
    "card.hash-a9d231899d6f3cc46b5f8d00320977ba937b799647d39e1c0b6ccf4ddb83b162",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两个关键词的展开都已合入，但仍没有消费方把它们接进打出与图层流程：" +
    "(1) [Accelerate]（805）——effects/keywords/Accelerate.ts 的 accelerate.cost 静态费用声明与 805.6 的 " +
    "object-enters-board 入场替代本身可用：cost/cost-plan.ts 的 optionalAdditional 支持 kind \"accelerate\"（805.1.b 的 " +
    "固定 [1][C] 与 805.1.b.1 的域匹配力量，golden 用真实 buildCostPlan 断言支付/拒绝），replacement/ 的 bindReplacement " +
    "也能把横置入场改写成就绪入场（golden 用真实 move-zone 验证）。缺的是卡牌 keyword → 费用组/替代生命周期的生产接线：" +
    "没有 play producer 读取 accelerate.cost 生成 { kind: \"accelerate\" } 费用组，也没有把该展开接入本卡的替代生命周期。" +
    "(2) [Assault 4]（807）——continuous.might 图层算术修正本身可用，但 807.1.d 的 Attacker designation 没有生产方：" +
    "combat/flow.ts 的 startCombat 仍抛 \"combat-start-transaction\"（CR 466.2 需要原子的同时时点波次与角色指派），" +
    "ObjectSnapshot.combatRole 只有测试内核手工置值；且 Assault 展开用的 " +
    "compare(object-property(self, \"designation\"), eq, \"attacker\") 不在图层条件词表内" +
    "（layers/engine.ts 的 conditionMatches 只认 always/never/type/has-tag/has-keyword，未知条件按 true）——" +
    "实测把该展开绑定到非攻击者仍会加 4 Might（3 → 7），直接绑定即近似实现。" +
    "依赖：Accelerate 费用组与替代生命周期的生产消费、战斗角色指派与图层条件消费。" +
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
