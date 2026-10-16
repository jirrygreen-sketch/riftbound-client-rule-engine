import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Mageseeker Investigator (unl-163-219) — Unit, Order, energy 4, Might 4,
 * tag Demacia.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-163-219，逐字）:
 *   "Opponents must pay :rb_rune_rainbow: for each unit beyond the first to move
 *    multiple units to my battlefield at the same time."
 *
 * 规则依据（CR v1.5）:
 * - 204.4：Applied Costs——"应用到一项或多项 Game Action 上的费用，通常写成由 'must'
 *   引导的被动能力里带费用"；204.4.a 规定关联的 Game Action 就是该费用的 Linked
 *   Effect；204.4.b 规定费用的支付随该 Game Action 一起发生、不入链；204.4.c 规定
 *   付不出或不愿付就不能执行该 Game Action。CR 用本卡作为 204.4 的示例。
 * - 355.10.b："to my battlefield" 是对该 Game Action 的位置限制/许可，不是目标；
 *   447/449 的移动与"同一时间移动多个单位"的批次由移动流程给出。
 * - 135.2.e.5 / 163.2.b：:rb_rune_rainbow: 是任意域 Power（[A]），不是六域之一；
 *   PlayerSnapshot.power / FinalizedCostPlan.power 只有六域值，cost/README.md 的
 *   契约请求 2 记录该缺口。
 *
 * status = judge-required（缺口不近似实现）:
 * 1. 没有 Applied Cost 的消费方：effects/instructions/ 下没有 cost.applied（或等价）
 *    原语文件（RIFT-9 清单的费用族是 cost.printed/activated/pay/modify/additional/
 *    sacrifice/hidden/xp/discard/recycle/reveal），也没有任何已合入组件把卡牌的
 *    静态费用声明接入移动流程的 Finalize/合法性检查；204.4.b 要求付费与移动同一
 *    时机，不能改写成触发式或入链的费用。
 * 2. [A]（任意域 Power）没有可执行表达：六域封闭枚举下没有 universal 值，
 *    cost/README.md 明确要求"保留 universal 源，不能用某一色替代"。
 * 3. "move multiple units … at the same time" 的批次计数没有通路：没有读取"同一
 *    Game Action 移动的单位数"的表达式，也没有把批次大小变成费用数量的接口。
 * 4. "my battlefield" 的位置锚定（355.10.b）需要移动流程暴露目的战场与来源身份；
 *    已合入的移动时点载荷（object-moved）不是费用钩子。
 *
 * 依赖：RIFT-9 / RIFT-89（Applied Cost 原语、费用计划接线与 universal Power）、
 * RIFT-21/31（移动流程与批次）、RIFT-90（位置限制）。
 * 本卡没有任何已合入的原语可在 golden 里真实执行，故只做校验与结构断言 + test.todo。
 */
const abilities: Ability[] = [
  {
    kind: "static",
    effect: {
      // 204.4：Applied Cost。字段只是可审查记录（无消费方，见 judgeReason）。
      kind: "cost.applied",
      appliesTo: "self",
      // 204.4.a：关联的 Game Action 是 Move（447/449），且是同一时间的一批。
      action: "move",
      batch: "simultaneous",
      // 355.10.b："to my battlefield" 是该 Game Action 的位置限制（目的战场＝
      // 本卡所在战场），不是目标选择。
      destination: { kind: "self-battlefield" },
      // 204.4.b / 204.4.c：由执行该 Game Action 的对手随动作支付；付不出则不能执行。
      payer: "moving-player",
      // 135.2.e.5 / 163.2.b：:rb_rune_rainbow: 是任意域 Power（[A]）。
      resource: "power",
      domain: "any",
      // "for each unit beyond the first"：数量 = 同批移动的单位数 - 1。
      amount: { perBatch: "units-moved", minus: 1 }
    }
  }
];

const program = {
  canonicalCardId:
    "card.hash-b160c71d3dd5254b9c98867feb0f67b7805cefc8624fcf4d00f8f427ab3be532",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口：(1) 没有 Applied Cost（204.4）的消费方：effects/instructions/ 无 cost.applied（或等价）原语，" +
    "也没有已合入组件把卡牌的静态费用声明接进移动流程的合法性检查；204.4.b 要求付费与 Game Action 同一时机，" +
    "不能改写成触发式/入链费用。(2) [A]（135.2.e.5 / 163.2.b 的任意域 Power）没有可执行表达：" +
    "六域封闭枚举下没有 universal 值，cost/README.md 的契约请求 2 明确要求保留 universal 源、不能用某一色替代。" +
    "(3)「同一时间移动多个单位」的批次计数没有通路：没有读取「同一 Game Action 移动的单位数」的表达式，" +
    "也没有把批次大小变成费用数量的接口（204.4 的 for each unit beyond the first）。(4)「my battlefield」（355.10.b）" +
    "的位置锚定需要移动流程暴露目的战场与来源身份；已合入的 object-moved 时点载荷不是费用钩子。" +
    "依赖：RIFT-9 / RIFT-89（Applied Cost 原语、费用计划接线与 universal Power）、RIFT-21/31（移动流程与批次）、RIFT-90（位置限制）。" +
    "本卡没有可在 golden 里真实执行的已合入原语，只做校验与结构断言。不近似实现。",
  abilities,
  sourceText:
    "Opponents must pay :rb_rune_rainbow: for each unit beyond the first to move " +
    "multiple units to my battlefield at the same time."
} satisfies CardProgram;

export default program;
