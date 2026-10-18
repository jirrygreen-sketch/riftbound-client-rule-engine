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
 * status = judge-required（2026-10-18 按当前合入源码复核，缺口实测，不近似实现）:
 * 1. Applied Cost 可以经 `continuous.restrict`（mode `applied-cost`）用指令路径真实登记，
 *    layers/rules/query.ts 的 appliedCosts() 也能按动作名读回（实测读回 actions:["move"]
 *    与完整 cost）；但没有任何消费方把它接进标准移动的费用计划（204.4.b 要求付费与移动同一
 *    时机，不能改写成触发式或入链的费用）。
 * 2. 程序绑定的静态路径还有一个形状缺口：statics.ts 的 normalizedEffect 只把
 *    `continuous.applied-cost` 归一化成 applied-cost，对卡面按文档写的
 *    `continuous.restrict` + mode `applied-cost` 会保留 kind "restriction"；而
 *    layers/rules/query.ts 的 appliedCosts() 只匹配 kind applied-cost，实测静态绑定后
 *    registered effect 是 { kind: "restriction", mode: "applied-cost", actions: ["move"] }，
 *    appliedCosts("move") 返回空（同一形状经 continuous.restrict 指令路径登记时 kind 是
 *    applied-cost，读回正常）。静态声明要能被查询读到，需要在 apps 侧把 mode 映射成 kind。
 * 3. [A]（任意域 Power）没有可执行表达：六域封闭枚举下没有 universal 值，cost/README.md 明确
 *    要求"保留 universal 源，不能用某一色替代"。
 * 4. "move multiple units … at the same time" 的批次计数没有通路：没有读取"同一 Game Action
 *    移动的单位数"的表达式，也没有把批次大小变成费用数量的接口。
 * 5. "my battlefield" 的位置锚定（355.10.b）需要移动流程暴露目的战场与来源身份；已合入的
 *    移动时点载荷（object-moved）不是费用钩子。
 * 依赖：Applied Cost 静态绑定的 kind 归一化与移动消费、universal Power、移动批次计数，以及
 * “my battlefield”的运行期位置锚定。指令路径的登记本身在 golden 中有真实执行证据。
 */
const abilities: Ability[] = [
  {
    kind: "static",
    effect: {
      // 204.4：Applied Cost 通过已合入 continuous.restrict 的 applied-cost 模式登记；
      // 移动费用计划仍需消费该登记（见 judgeReason）。
      kind: "continuous.restrict",
      mode: "applied-cost",
      // layers/rules/query.ts 的 appliedCosts() 读复数 actions；静态卡牌数据不经过
      // continuous.restrict 指令求值时的归一化。
      actions: ["move"],
      // 204.4.a：关联的 Game Action 是 Move（447/449），且是同一时间的一批。
      batch: "simultaneous",
      // 355.10.b："to my battlefield" 是该 Game Action 的位置限制（目的战场＝
      // 本卡所在战场），不是目标选择。
      destination: { kind: "self-battlefield" },
      // 204.4.b / 204.4.c：由执行该 Game Action 的对手随动作支付；付不出则不能执行。
      payer: "moving-player",
      // "Opponents" is an additional relative-player gate, not every mover.
      // Descriptive only until the Applied Cost consumer resolves this scope.
      payerScope: "opponent",
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
    "当前缺口（2026-10-18 实测）：(1) Applied Cost 可经 continuous.restrict 的 applied-cost 模式用指令路径真实登记，" +
    "layers/rules/query.ts 的 appliedCosts() 也按动作名读回（golden 已断言），但仍没有移动费用计划消费方；" +
    "204.4.b 要求付费与 Game Action 同一时机，不能改写成触发式/入链费用。(2) [A]（135.2.e.5 / 163.2.b 的任意域 Power）没有可执行表达：" +
    "六域封闭枚举下没有 universal 值，cost/README.md 的契约请求 2 明确要求保留 universal 源、不能用某一色替代。" +
    "(3)「同一时间移动多个单位」的批次计数没有通路：没有读取「同一 Game Action 移动的单位数」的表达式，" +
    "也没有把批次大小变成费用数量的接口（204.4 的 for each unit beyond the first）。(4)「my battlefield」（355.10.b）" +
    "的位置锚定需要移动流程暴露目的战场与来源身份；已合入的 object-moved 时点载荷不是费用钩子。" +
    "另外，程序绑定的静态路径尚未接通该声明：statics.ts 的 normalizedEffect 只把 `continuous.applied-cost` 归一化成 applied-cost，" +
    "对卡面采用的 `continuous.restrict` + mode applied-cost 会保留 kind \"restriction\"；appliedCosts() 只匹配 applied-cost，" +
    "实测静态绑定后 registered effect 为 { kind: \"restriction\", mode: \"applied-cost\", actions: [\"move\"] } 且 appliedCosts(\"move\") 为空" +
    "（同一形状经 continuous.restrict 指令路径登记时 kind 是 applied-cost，读回正常）；卡内已改用查询实际读取的复数 actions 拼写。" +
    "依赖：Applied Cost 的移动消费、universal Power、移动批次计数，以及“my battlefield”的运行期位置锚定；" +
    "payerScope: opponent 保留原文 Opponents 的相对付款人门槛，仍需消费方按本卡当前控制者解析，不能向己方移动收费。" +
    "指令路径的登记已有局部执行证据；不近似实现。",
  abilities,
  sourceText:
    "Opponents must pay :rb_rune_rainbow: for each unit beyond the first to move " +
    "multiple units to my battlefield at the same time."
} satisfies CardProgram;

export default program;
