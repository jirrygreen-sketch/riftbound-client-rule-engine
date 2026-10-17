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
 * status = judge-required（缺口不近似实现）。已合入并可 golden 执行：continuous.might
 * （143.2.a / 475 / 478 的本回合算术层修正，this-turn 到期 315.4）、effect.ready、
 * [Hidden]/[Ganking] 的 KeywordDef（RIFT-264～268）、CardProgram 绑定（RIFT-257），
 * 以及 cost.pay 原语本体（settle 356–357 的 finalized CostPlan，探针验证可真实扣费）。
 *
 * 仍缺三处（不近似实现）：
 * 1. [Hidden]（811.1）的展开虽已合入（effects/keywords/Hidden.ts），但其 static cost.hidden 没有消费方：封闭 GameAction
 *    集合没有 Hide 动作、契约 ZoneId 没有面朝下区域成员，811.1.d 的免费用打出与 811.1.b 的
 *    [A] 隐藏费用因此无处执行（依赖 cost.hidden 消费方，RIFT-261 系列）。
 * 2. “You may pay :rb_rune_fury: as an additional cost to play me.”（356.2.b.1 的可选附加费用）
 *    不可收取：cost.pay 已合入但只支付调用方已 finalize 的 CostPlan，programs/play.ts 的
 *    translateCost 对 additional/additional-cost/optional 字段直接 judgeRequired，没有生产方
 *    在 Finalize 生成含本可选附加费用的计划（cost/ 也只消费调用方传入的 optionalAdditional）。
 * 3. “if you paid the additional cost”（383.2.a.1 的触发条件，凭证见 356.4.f.1）没有费用回执绑定，
 *    与 ogn/meditation、ogn/clockwork-keeper 同一缺口；本程序保留描述性读取，条件 fail-closed。
 * [Ganking] 的 continuous.movement 许可也没有移动系统消费方（movement() 查询已合入，但没有调用方）。
 * 依赖：cost.hidden 消费方（RIFT-261 系列）、附加费用计划与回执的生成/绑定、移动系统接线。
 * 不近似实现。
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
          amount: { kind: "constant", value: 2 },
          duration: { kind: "constant", value: "this-turn" },
          // "me" 是自我指称（355.10.g），不是目标：合并原语的选择符经 objects
          // 指向能力来源自身（契约 3.6 的 ObjectSelector；layer 固定为 arithmetic）。
          objects: { kind: "constant", value: { kind: "source" } }
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
    "已合入并可真实执行：continuous.might（RIFT-258）按 143.2.a/475 注册 arithmetic 层修正、按 315.4 以 this-turn " +
    "到期；effect.ready、[Hidden]/[Ganking] 的 KeywordDef（RIFT-264～268）与 CardProgram 绑定（RIFT-257）已合入；" +
    "cost.pay 原语本体已合入（settle 356–357 的 finalized CostPlan，探针验证可真实扣费并产生支付回执）。" +
    "仍缺三处，均不近似实现：" +
    "(1) [Hidden]（811.1）的展开虽已合入（effects/keywords/Hidden.ts），但其 static cost.hidden 没有消费方——封闭 GameAction 集合没有 " +
    "Hide 动作、契约 ZoneId 没有面朝下区域成员，811.1.b 的 [A] 隐藏费用与 811.1.d 的从面朝下免费用打出无处执行；" +
    "(2)「You may pay :rb_rune_fury: as an additional cost to play me.」（356.2.b.1 的可选附加费用）不可收取：" +
    "cost.pay 只支付调用方已 finalize 的 CostPlan，programs/play.ts 的 translateCost 对 additional/additional-cost/" +
    "optional 字段直接 judgeRequired，cost/ 也只消费调用方传入的 optionalAdditional，没有在 Finalize 生成含该可选附加费用计划的生产方；" +
    "(3)「if you paid the additional cost」（383.2.a.1 的触发条件，凭证见 356.4.f.1）没有费用回执绑定——" +
    "没有表达式能读取 356.4.f.1 的支付决定记录，与 ogn/meditation、ogn/clockwork-keeper 同一缺口，" +
    "本程序保留描述性读取（fail-closed，不会在未支付时误执行）。" +
    "另外 [Ganking] 的许可没有移动系统消费方（movement() 已合入但没有调用方）。" +
    "依赖：cost.hidden 消费方（RIFT-261 系列）、附加费用计划与回执的生成/绑定、移动系统接线。",
  abilities,
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "[Ganking] (I can move from battlefield to battlefield.)\n" +
    "You may pay :rb_rune_fury: as an additional cost to play me.\n" +
    "When you play me, if you paid the additional cost, ready me and give me +2 :rb_might: this turn."
} satisfies CardProgram;

export default program;
