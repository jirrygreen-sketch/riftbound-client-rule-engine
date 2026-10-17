import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * rad-077-167 Wrath of the Freljord（能量 9、Power 无印刷值、Might 7、领域 Body、无标签）。
 *
 * 原文（逐字，已对照官方卡图 "I enter ready." / "[SHIELD 3] (+3 [M] while I'm a
 * defender.)"）：
 *   "I enter ready."
 *   "[Shield 3] (+3 :rb_might: while I'm a defender.)"
 *
 * 规则依据（CR v1.5）：
 * - 143.4：单位默认**横置**进入 Board。369.3 明确 "I enter ready." 是入场时机的
 *   替代效果（Replacement Effect），把"以横置状态进场"替换成"以就绪状态进场"；
 *   369.3 的例子里 Master Yi, Honed 的同名文本就是这个替代。805.6.a（Accelerate）
 *   进一步说明这类替代不是"先横置再就绪"，因此不触发"成为就绪"类能力——本卡的
 *   文本形式相同，同一结论适用。
 * - [Shield 3]（814.1 / 814.1.b / 814.1.c）：Passive Ability 关键词；814.1.c 的功能
 *   等价是 "While I am a defender, I have +3 [M]"；814.1.d 的 Defender 身份在 Combat
 *   中获得（461），814.1.d.1 说明只要保持该身份就持续有效；814.2 多个来源的 Shield
 *   数值相加；814.3 是可引用特征。按 README 第 5 节只声明关键词与数值，展开属
 *   effects/keywords/Shield.ts（已合入 continuous.might + defender 条件的形状）。
 *
 * 状态：judge-required。缺口：
 * 1. 入场替代：契约 3.1 的 replacement 能力（replaces + with）可以写出形状
 *    （keywords/Accelerate.ts 已这样写"横置入场 → 就绪入场"），但消费方缺失——
 *    入场替代管线（replacement.enter 族）尚未合入：events/pipeline.ts 的
 *    ReplacementRegistration 依赖宿主提供 matches/apply，而 card-dsl 的
 *    replacement 能力到该注册表之间没有已合入的适配器（同 contracts/breakneck-mech
 *    的判定，依赖 replacement.enter 管线）。按契约 3.1 的"可以……"形状要求，替代效果
 *    的 with 体里用 effect.ready 表达"以就绪进场"（该原语已合入，golden 真实执行）。
 * 2. [Shield 3] 的展开产出 continuous.might 静态效果 + defender designation 条件；
 *    图层消费方（RIFT-91 layers-continuous）未合入，且 814.1.d 的 Defender 身份还
 *    不是 ObjectSnapshot 特征（契约 3.8 只给 ObjectSnapshot 加了 combatRole）。
 * 依赖：replacement.enter 入场替代管线、RIFT-91（layers-continuous）、契约 3.8。
 * 不近似实现：不用结算期的 effect.ready 冒充"进场即就绪"（那会变成进场后再重置，
 *   与 369.3 / 805.6.a 明确不同），也不手写 Shield 的 Might 加成。
 */
const abilities: Ability[] = [
  {
    // 369.3 / 143.4：把"以横置状态进入 Board"替换为"以就绪状态进入 Board"。
    kind: "replacement",
    replaces: {
      event: "object-enters-board",
      filter: { source: "self", exhausted: true }
    },
    with: [
      {
        // effect.ready 已合入；这里代表替代后"就绪进场"的结果，
        // 不经过 object-readied 时点（369.3 / 805.6.a）。
        id: "wrath-of-the-freljord.enter-ready",
        op: "effect.ready",
        args: { objects: { kind: "constant", value: { kind: "source" } } }
      }
    ]
  },
  // 814.1.b.1：印刷 "[Shield 3]"，Shield Value = 3。
  { kind: "keyword", keyword: "shield", value: 3 }
];

const program = {
  canonicalCardId:
    "card.hash-fc7374c39848c88e67ed66b36519a4f64f748f14266f0341692d6f5db092e3e4",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "「I enter ready.」是入场替代效果（369.3：把 143.4 的横置进场替换成就绪进场；805.6.a 明确不是先横置再就绪、不触发「成为就绪」）：" +
    "形状已按契约 3.1 的 replacement 能力写出（replaces object-enters-board + exhausted，with 用已合入的 effect.ready），" +
    "但入场替代管线（replacement.enter 族）尚未合入——card-dsl 的 replacement 能力到 events/pipeline.ts 的 ReplacementRegistration 之间没有适配器（同 breakneck-mech 的判定）。" +
    "[Shield 3]（814.1）的展开产出 continuous.might 静态效果 + defender 条件，图层消费方（RIFT-91 layers-continuous）未合入，" +
    "且 814.1.d 的 Defender 身份还不是 ObjectSnapshot 特征（契约 3.8 只加了 combatRole）。" +
    "依赖：replacement.enter 入场替代管线、RIFT-91、契约 3.8。不近似实现：不用结算期 effect.ready 冒充「进场即就绪」，也不手写 Shield 的 Might 加成。",
  abilities,
  sourceText:
    "I enter ready.\n[Shield 3] (+3 :rb_might: while I'm a defender.)"
} satisfies CardProgram;

export default program;
