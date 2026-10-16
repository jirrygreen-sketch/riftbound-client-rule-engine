import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Pyke, Dockside Butcher (unl-028-219) — Unit, 3 energy, no printed power,
 * Might 2, Fury, tags Pyke/Bilgewater/Champion.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-028-219，逐字）：
 *   [Hidden] (Hide now for :rb_rune_rainbow: to react with later for
 *   :rb_energy_0:.)
 *   [Ganking] (I can move from battlefield to battlefield.)
 *   You may pay :rb_rune_fury: as an additional cost to play me.
 *   When you play me, if you paid the additional cost, ready me and give me
 *   +2 :rb_might: this turn.
 *
 * 规则依据（CR v1.5）：
 * - [Hidden]（811.1）：可选的能力关键词，允许先以 [A] 隐藏、之后再以免费用（[0]）
 *   从面朝下区域打出（811.1.d 的面朝下区域/位置限制属该关键词展开）；卡只声明 keyword。
 * - [Ganking]（810.1.b / 144.4.c.1）：为单位的标准移动增加“战场→战场”许可；同样只声明 keyword。
 * - “You may pay :rb_rune_fury: as an additional cost to play me.”：356.2 / 356.2.b / 356.2.b.1
 *   的可选附加费用，在打出流程的 Finalize 决定并支付（355.1.a）；355.10.c 规定只在费用里出现的
 *   对象不成为目标，本条费用没有对象，只有 1 点 Fury Power。
 * - “When you play me, if you paid the additional cost, ready me and give me +2 :rb_might: this turn.”：
 *   383.4.a 的 Play Effect；383.2.a.1 把紧随触发条件的 “if you paid …” 作为触发条件的一部分，
 *   在进链前按费用回执求值（356.4.f.1：可选附加费用只看玩家是否做出支付决定）。
 *   “ready me”（416.1 / 355.10.g）走 effect.ready 的缺省来源选择器；“give me +2 :rb_might: this turn”
 *   是本回合到期的临时 Might 修正（143.2.a / 475 / 478），属 layers 的 continuous.might，
 *   effect.buff（702 的 Buff 计数器）不可代替；两者都是“me”的自我指称，355.10.g 明确不是目标，
 *   因此都不写 TargetSpec（用 TargetSpec 会错误登记“成为目标”与目标税）。
 *
 * status = judge-required（缺口不近似实现）：
 * - [Hidden] 的展开需要 cost.hidden（Hide 动作、面朝下区域规则与免费用打出）与机内 Facedown Zone，
 *   两者都未合入（RIFT-89）；[Ganking] 的 continuous.movement 许可也缺移动系统消费方（RIFT-91）。
 * - 可选附加费用不可收取：已合入 cost/ 只消费调用方传入的费用计划，没有 CardProgram → CostPlan 的接线，
 *   effects/instructions/ 下也没有 cost.additional / cost.pay 原语（RIFT-89）。
 * - “if you paid the additional cost” 的费用回执没有绑定（356.4.f.1；Meditation/Clockwork Keeper 记录同一缺口），
 *   本程序按 Meditation 先例把条件写成描述性读取（fail-closed 的 ignored，不会误执行）。
 * 已合入并可真实执行的部分：effect.ready（ready me），golden 用解释器 + 参考内核执行。
 * 依赖：RIFT-89（cost.hidden / 可选附加费用与回执）、RIFT-91（layers-continuous、移动许可）、RIFT-84（Hidden 展开）。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "hidden" },
  { kind: "keyword", keyword: "ganking" },
  {
    kind: "play",
    // 356.2.b / 356.2.b.1："as an additional cost" + "may" = 可选附加费用（Optional Additional Cost）；
    // 本卡印刷没有 Power 费用（catalog power: null，不是 0），这是独立可选组件。
    cost: {
      kind: "additional-cost",
      optional: true,
      power: { kind: "constant", value: ["Fury"] }
    },
    // 费用本身不产生结算指令；效果在下面的 Play Effect 里。
    body: []
  },
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      // 383.4.a.1：“When you play me” 的 Play Effect。
      filter: { event: "card-played", filter: { source: "self" } },
      // 383.2.a.1："if you paid the additional cost" 是触发条件的一部分。
      // 356.4.f.1 的费用回执没有绑定，按 Meditation 先例保留描述性读取（fail-closed），
      // 见 judgeReason，不用无条件执行冒充。
      condition: {
        kind: "expression",
        value: {
          kind: "object-property",
          object: "source",
          property: "pyke.additional-cost-paid"
        }
      }
    },
    optional: false,
    body: [
      {
        // “ready me”：effect.ready 的缺省选择器是能力来源（355.10.g），不是目标。
        id: "pyke-dockside-butcher.ready-self",
        op: "effect.ready",
        args: { objects: { kind: "constant", value: { kind: "source" } } }
      },
      {
        // “give me +2 :rb_might: this turn.” —— 本回合到期的临时 Might 修正
        // （arithmetic 层，见 judgeReason）；不是 Buff 计数器。
        id: "pyke-dockside-butcher.grant-might-2",
        op: "continuous.might",
        args: {
          mode: { kind: "constant", value: "add" },
          layer: { kind: "constant", value: "arithmetic" },
          amount: { kind: "constant", value: 2 },
          duration: { kind: "constant", value: "this-turn" },
          // "me" 是自我指称（355.10.g），不是目标。
          target: { kind: "constant", value: "self" }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-29fe440bf64648cf3c6845485b73efbd8c2cae11e1cf26c7b3bb6a355351ebae",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "三处缺口，均不近似实现：(1) [Hidden]（811.1）的展开需要 cost.hidden（Hide 动作、面朝下区域规则与从面朝下免费用打出）" +
    "与机内 Facedown Zone，两者都未合入（RIFT-89）；[Ganking] 的 continuous.movement 许可也缺移动系统消费方（RIFT-91）。" +
    "(2)「You may pay :rb_rune_fury: as an additional cost to play me.」是 356.2.b.1 的可选附加费用，但已合入 cost/ " +
    "只消费调用方传入的费用计划，没有 CardProgram → CostPlan 的接线，effects/instructions/ 下也没有 cost.additional / " +
    "cost.pay 原语（RIFT-89）。(3)「if you paid the additional cost」（383.2.a.1 的触发条件部分，凭证见 356.4.f.1）" +
    "没有费用回执绑定——与 ogn/meditation、ogn/clockwork-keeper 记录同一缺口；本程序保留描述性读取，条件 fail-closed，" +
    "不会在未支付时误执行。「give me +2 :rb_might: this turn」是 arithmetic 层的本回合临时 Might 修正，" +
    "没有已注册的 continuous.might 指令入口（RIFT-91），不能用 Buff 计数器代替。" +
    "已可真实执行的部分：effect.ready（ready me），golden 用解释器 + 参考内核执行。依赖：RIFT-89、RIFT-91、RIFT-84。",
  abilities,
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "[Ganking] (I can move from battlefield to battlefield.)\n" +
    "You may pay :rb_rune_fury: as an additional cost to play me.\n" +
    "When you play me, if you paid the additional cost, ready me and give me +2 :rb_might: this turn."
} satisfies CardProgram;

export default program;
