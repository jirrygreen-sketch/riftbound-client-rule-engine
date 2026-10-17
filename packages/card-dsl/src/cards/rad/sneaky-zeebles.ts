import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * rad-076-167 Sneaky Zeebles（能量 2、Power 无印刷值、Might 1、领域 Body、无标签）。
 *
 * 原文（逐字，已对照官方卡图）：
 *   "When I conquer, [Add] :rb_rune_rainbow:. (Abilities that add resources
 *    can't be reacted to.)"
 *
 * 规则依据（CR v1.5）：
 * - "When I conquer"：Conquer 触发（383.4.c / 471.1）；时点枚举里是 conquer
 *   （ruleRefs 468.5.d / 471.1 / 473.2.a），触发者为本来源单位。
 * - "[Add] :rb_rune_rainbow:"：430.1 的 Add 是把资源放进 Rune Pool；135.2.e.5 的
 *   rainbow 符号 = [A] = 任意领域的 Power，135.2.e.5.b 明确加到 Rune Pool 的 [A]
 *   可用来支付任意领域的 Power 费用。相对地 163.2.b 的 "Universal Power" 是另一回事
 *   （contract 3.6 的封闭 Domain 类型无法表示，effect.resources 文档也明确不接受）。
 *   这里印刷的是 [A]，不是 Universal。
 * - 提醒文本 "Abilities that add resources can't be reacted to"：430.2 / 430.2.a 说明
 *   Add 的触发/启动能力立即 finalize 并结算，且这一过程不传递 Priority 与 Focus；
 *   这是引擎链/优先权职责，不是本卡的效果正文。
 *
 * 状态：judge-required。缺口：
 * 1. rainbow（[A]）在封闭 Domain 类型里没有表示：contract 3.6 与 effect.resources 的
 *    DOMAINS 常量都只有 Fury/Calm/Mind/Body/Chaos/Order 六域（实测把 "rainbow" 交给
 *    effect.resources 会 negated）；要真正"加 1 点可支付任意领域的 Power"，需要内核在
 *    加资源时选择领域，或新增万能 Power 的表示——两者都不存在，属契约缺口
 *    （见最终回复的契约变更请求）。
 * 2. 430.2.a 的"立即结算、不传递 Priority 与 Focus"属链/优先权接线；参考内核只记录
 *    gain-power 动作，没有该立即 finalize 的路径。
 * 依赖：契约缺口（万能 Power 表示）与链的 Add 立即结算接线。
 * 不近似实现：不把 [A] 近似成某一个具体领域（那会凭空限制可支付的费用），
 *   也不改写成 effect.channel / effect.draw。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "conquer",
      filter: { event: "conquer", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        // 430.1 / 135.2.e.5：Add 1 Power of any domain。值是 [A] 的符号表示，
        // 不是六个 Domain 之一（见 judgeReason 的契约缺口）。
        id: "sneaky-zeebles.add-rainbow",
        op: "effect.resources",
        args: {
          power: { kind: "constant", value: ["rainbow"] },
          linkKey: { kind: "constant", value: "sneaky-zeebles.added" }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-36af4340a3b4308d5a0aaf002e73ae4fb29bec09c724487100a7387c8f819063",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "[Add] :rb_rune_rainbow: 的 rainbow 符号（135.2.e.5 的 [A]，可支付任意领域的 Power）在封闭 Domain 类型里没有表示：" +
    "contract 3.6 与 effect.resources 的 DOMAINS 都只有六域（实测把 rainbow 传给 effect.resources 会被 negated），" +
    "要真正加 1 点「可支付任意领域」的 Power，需要内核在加资源时选择领域或新增万能 Power 表示，属契约缺口（见最终回复的契约变更请求）；" +
    "另外 430.2 / 430.2.a 的「Add 能力立即 finalize 并结算、不传递 Priority 与 Focus」属链/优先权接线，" +
    "参考内核只记录 gain-power 动作（timingPoint 是环境主阶段时点），没有该立即结算路径。" +
    "golden 用六域之一的 gain-power 在测试内核里验证了同一原语路径（effect.resources 成功给 Rune Pool 加 1 点 Power、并链接实际增加量），" +
    "但该等价行为不覆盖 [A] 的领域自由度。不近似实现：不把 [A] 写成某个具体领域（那会凭空限制可支付的费用）。",
  abilities,
  sourceText:
    "When I conquer, [Add] :rb_rune_rainbow:. (Abilities that add resources can't be reacted to.)"
} satisfies CardProgram;

export default program;
