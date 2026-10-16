import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Gearhead (sfd-068-221) — Unit, Mind, Zaun.
 * energy 5, power: none printed, Might 3.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-068-221，逐字）:
 *   "[Accelerate] (You may pay :rb_energy_1::rb_rune_mind: as an additional cost to have me
 *   enter ready.)\nEach Equipment attached to me gives double its base Might bonus."
 *
 * 规则依据（CR v1.5）:
 * - [Accelerate]（805）：可选附加费用关键词（805.1/805.1.a：出现在 Units 上，805.1.b 的
 *   功能文本 = 「打出时可选支付 [1][C]，若支付则我就绪入场」，本卡域为 Mind，故 C = Mind）。
 *   按契约 3.7 只声明关键词，展开（cost.additional + 入场就绪替代，805.6）由
 *   effects/keywords/Accelerate.ts 负责，卡牌不重写。
 * - "Each Equipment attached to me gives double its base Might bonus"：附件对宿主 Might 的修正
 *   由 Might Bonus（137.1–137.3、435.1.d：Top-Most Card 的 Might 由所有 Attached 卡的
 *   Might Bonus 调制；137.3.a：仅在 Attached 期间生效）在算术图层计算；"double" 是 CR 433.1
 *   式的倍化——按该 Equipment 的**基础** Might Bonus 再增加等量一份（"base" 明确取印刷值，
 *   而不是当前图层计算结果）。这是附着物侧的持续修正，不是本卡的 Buff 计数（702/703）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required，两处依赖均未合入，不近似实现：
 * - Accelerate 的 card 侧声明可用，但其展开的两半都不可执行：cost.additional 没有卡牌程序 → 
 *   费用计划的接线（RIFT-89），入场的就绪替代依赖 replacement.enter 与 805.6 的替代执行
 *   （卡程序无法把「横置入场」替换成「就绪入场」，绝不用事后 effect.ready 近似，见 effect.ready 文件头）。
 * - 「Equipment attached to me 的基础 Might Bonus 翻倍」需要附着物 Might Bonus 特征与
 *   Arithmetic 图层的双倍调制：ObjectSnapshot 只有 might/energy/power 等当前特征，没有
 *   Might Bonus（137.1）字段，layers 也没有「按附着物基础 Might Bonus 附加额外等量修正」的
 *   规则，且没有任何卡牌 static 能力 → 图层注册的接线（RIFT-91）。
 * 依赖：RIFT-89（费用计划接线）、RIFT-91 后续（Might Bonus 特征与附着调制图层）、replacement.enter（入场替代批次）。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "accelerate" },
  {
    // 137.3/435.1.d：Equipment 的 Might Bonus 调制宿主 Might。"double its base Might bonus"
    // 声明为「按每个附着 Equipment 的基础 Might Bonus 再加一份等量修正」的算术层静态效果；
    // 图层没有该规则、也没有资产附着物 Might Bonus 特征（见 judgeReason）。
    kind: "static",
    effect: {
      kind: "continuous.might",
      mode: "add",
      layer: "arithmetic",
      appliesTo: "self",
      amount: {
        kind: "constant",
        value: "each-attached-equipment-base-might-bonus"
      },
      source: "attached-equipment",
      multiplier: 1,
      baseValue: true
    }
  }
];

const program = {
  canonicalCardId: "card.hash-2c09104cfceee81462b6ee602bc9183760b8851fe12ba9f8a6283f6432704cd4",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "两处依赖未合入，均不近似实现：(1) [Accelerate]（805）的 card 侧关键词声明可用，但其展开的两半都不可执行：" +
    "可选附加费用 [1][Mind]（805.1.b/805.1.b.1）没有卡牌程序 → Finalize 费用计划的接线（RIFT-89），" +
    "入场就绪替代（805.6）依赖 replacement.enter 的执行——绝不用事后 effect.ready 近似（effect.ready 文件头明确入场状态归 create-token/replacement.enter）。" +
    "(2)「Each Equipment attached to me gives double its base Might bonus」需要附着物的 Might Bonus 特征（137.1–137.3、435.1.d：" +
    "Top-Most Card 的 Might 由所有 Attached 卡的 Might Bonus 调制；137.3.a 仅在 Attached 期间生效）与算术图层的双倍调制：" +
    "ObjectSnapshot 没有 Might Bonus 字段，已合入的 layers/ 也没有「按附着物基础 Might Bonus 附加等量修正」的规则，" +
    "同时没有任何卡牌 static 能力 → 图层注册的消费方（RIFT-91）。" +
    "依赖：RIFT-89（费用计划接线）、RIFT-91 后续（Might Bonus 特征与附着调制）、replacement.enter（入场替代批次）。",
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_mind: as an additional cost to have me enter ready.)\n" +
    "Each Equipment attached to me gives double its base Might bonus."
} satisfies CardProgram;

export default program;
