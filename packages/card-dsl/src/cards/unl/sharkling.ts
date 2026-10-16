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
 * - 两个 KeywordDef 的展开文件都已合入，但没有任何生产方把卡牌的 keyword 能力接进打出流程：
 *   cost/cost-plan.ts 只消费调用方传入的 optionalAdditional，没有从 accelerate.cost 静态
 *   效果生成 { kind: 'accelerate' } 费用组的路径；805.2.b/805.6 的延迟入场替代也没有
 *   消费方（blazing-scorcher、azir-sovereign、kaisa-survivor 记录同一批次缺口）。
 * - [Assault 4] 的展开是 static continuous.might + designation 条件，但 registerContinuousEffect
 *   没有调用方，且 807.1.d 的 Attacker designation 不是 ObjectSnapshot 特征
 *   （契约 3.8 的 combatRole 未进当前 HEAD）。
 *
 * 依赖：RIFT-86 / RIFT-89（费用计划对卡牌 keyword 的消费）、RIFT-81 / RIFT-91（Assault 展开
 * 与图层接线）、契约 3.8 的 combatRole 落地。
 */
export default {
  canonicalCardId:
    "card.hash-a9d231899d6f3cc46b5f8d00320977ba937b799647d39e1c0b6ccf4ddb83b162",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两个关键词的展开文件都已合入，但没有消费方把它们接进打出与图层流程：(1) [Accelerate]（805）的" +
    "effects/keywords/Accelerate.ts（accelerate.cost 静态费用声明 + 805.6 的 object-enters-board 入场替代）" +
    "没有任何生产方读取——cost/cost-plan.ts 只消费调用方传入的 optionalAdditional，没有从卡牌 keyword 生成 " +
    "{ kind: 'accelerate' } 费用组的路径，805.1.b.1 的域匹配力量（本卡 Fury）与 805.2.b/805.6.a 的延迟就绪" +
    "替代因此都不生效（blazing-scorcher、kaisa-survivor、azir-sovereign 记录同一缺口）。" +
    "(2) [Assault 4]（807）的 effects/keywords/Assault.ts（static continuous.might + " +
    "compare(object-property(self, 'designation'), eq, 'attacker')）同样没有卡牌→图层的注册路径" +
    "（registerContinuousEffect 无调用方），且 807.1.d 的 Attacker designation 不是 ObjectSnapshot 特征" +
    "（契约 3.8 combatRole 未进 HEAD）。" +
    "依赖：RIFT-86 / RIFT-89（费用计划对卡牌 keyword 的消费）、RIFT-81 / RIFT-91（Assault 展开与图层接线）、" +
    "契约 3.8 的 combatRole 落地。不近似实现（不把 Assault 4 写成恒定的 +4，也不手改费用）。",
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
