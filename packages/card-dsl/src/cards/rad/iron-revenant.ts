import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Iron Revenant (rad-143-167) — Legend, Fury/Order, tag Mordekaiser.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, rad-143-167，逐字）：
 *   [Reaction][>] Banish a unit or gear from your trash, :rb_exhaust:: [Add]
 *   :rb_rune_rainbow:. Spend this Power only to play units or gear. (Abilities
 *   that add resources can't be reacted to.)
 *
 * 规则依据（CR v1.5）：
 * - 813.1.a / 813.1.d：能力上的 “[Reaction][>]” 是许可类关键词的速度声明，
 *   IR 用 activated.timing = "reaction" 表达（813.1.c 的功能等价）。
 * - 377.1 / 404.1.a / 415.5：冒号之前是费用——“Banish a unit or gear from your
 *   trash” 与横置来源。355.9.a / 355.10.a.1 规定 Trash 是公开区域，从 Trash 选择
 *   是目标（“Recycle a unit from your trash” targets a unit card in your trash），
 *   且这是能力费用的一部分，所以在 Finalize 选择（355.10.c）。
 * - 430.1 / 430.5 / 135.2.e.5：“[Add] :rb_rune_rainbow:” 是 Add 动作，把 1 点 [A]
 *   （任意域）Power 放进符文池；430.2.a 规定 Add 能力 Finalize 后立即结算、不传递
 *   Priority / Focus，430.3 允许带 Reaction 的 Add 在需要支付资源时启动。
 * - 括号里的提醒文本（430.2.a / 204.4.b.1）不是另一条能力。
 *
 * status = judge-required（2026-10-17 复核，逐个保留证据，不近似实现），当前缺口：
 * - “Banish a unit or gear from your trash” 作为费用的表达不完整：
 *   cost/plan-values.ts 的 nonstandard 支付种类只有 exhaust / discard / recycle / kill /
 *   reveal / spend-buff，没有 banish（实测 buildCostPlan 抛 “Unsupported payment kind: banish”）；
 *   417.6 证明“从 Trash 回收”可以建模为带区域的选择，但 banish 种类当前仍缺失。
 *   把 banish 放进结算正文会把它变成效果而不是费用（355.10.c.1 的
 *   “[do X] to [do Y]” 中 X 是费用，付不出就不能激活，415.4 同理）。
 * - “[A] 任意域 Power” 不可表达：契约与内核的 Domain 是 Fury/Calm/Mind/Body/Chaos/Order
 *   六域封闭集合，effect.resources 明确记录 163.2.b 的 Universal Power 不可表达、绝不用
 *   某个域近似；本卡把 [A] 记为描述性的 power: ["rainbow"]，原语对其返回
 *   negated(impossible)。
 * - “Spend this Power only to play units or gear” 是该资源的用途限制：内核没有带约束的资源池
 *   （src 内没有 use-only-to / restricted-power 一类消费键），programs/play.ts 的
 *   translateRestriction 只把 condition/value 形状转成 Finalize 的合法性 Condition，
 *   本卡的 descriptive restriction kind 会抛 “needs a rules adapter”；430.3 的 Add
 *   Reaction 支付窗口虽有 chain/engine.ts 的 activateAddDuringPayment，但没有把本卡的
 *   Add 能力接入该窗口的生产调用方。
 * - 印刷差异：同身份的 rad-170-167 删去了 “only”（“Spend this Power to play units or
 *   gear.”）。两者语义不同（区域/用途限制），目录未说明应按印刷号分别执行还是按官方
 *   勘误统一；本程序按任务指定的 rad-143-167 原文书写，差异本身不是本卡可裁定的（见
 *   docs/plans/survey/unclassified-rad-sfd.md 第 4 条）。
 * - Legend Zone（107.4.a–d）：ZoneId/ZoneDestination 没有 legend-zone，费用支付只接受
 *   board/rune-zone 的横置对象（415.4/415.5），传奇无法在真实区域支付 :rb_exhaust:；
 *   golden 的 Board 装置只是部分证据。
 * 已合入并已有执行证据的部分：effect.banish 的 Banish 动作本身与横置费用形状，见 golden。
 */
const abilities: Ability[] = [
  {
    kind: "activated",
    // 813.1.d：“[Reaction][>]” 是能力上的速度许可，IR 直接声明 reaction。
    timing: "reaction",
    cost: {
      kind: "activated",
      // 355.10.c.1：费用里的 “Banish a unit or gear from your trash” 在 Finalize
      // 从公开的 Trash 中选择（355.10.a.1），不是能力目标。cost.banish 是待合入的
      // 费用种类（见 judgeReason）；choice 的 zone/type/owner 描述候选集合。
      payments: [
        {
          kind: "banish",
          choice: {
            id: "iron-revenant.banished-card",
            options: ["unit-or-gear-in-controller-trash"],
            min: 1,
            max: 1,
            selection: "one",
            zone: "trash",
            type: ["unit", "gear"],
            owner: "controller"
          }
        },
        { kind: "exhaust", object: "self" }
      ]
    },
    // “Spend this Power only to play units or gear.”：保留为限制声明；合并内核尚无
    // 带约束资源池的消费路径（见 judgeReason）。
    restriction: { kind: "use-only-to-play-units-or-gear" },
    body: [
      {
        id: "iron-revenant.add-universal-power",
        op: "effect.resources",
        args: {
          // [A]：任意域 Power。六域封闭集合下没有可执行值，保留描述性记号。
          power: { kind: "constant", value: ["rainbow"] }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-265aafa041fadfb8711bb9cb71cfbe3b22843b0d19b59642dd156252990e13e0",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "(1) 缺费用种类的 banish：「Banish a unit or gear from your trash」是 377.1 / 355.10.c.1 的费用" +
    "（付不出就不能激活，415.4），但 cost/plan-values.ts 的 nonstandard 支付种类只有 exhaust / discard / recycle / kill / " +
    "reveal / spend-buff，没有 banish（实测 buildCostPlan 先抛 “Unsupported payment kind: banish”；即便换成受支持的种类，" +
    "choice 的静态占位选项也会触发 “Cost requires an exact object reference”）；把 banish 放进结算正文会把它变成效果。" +
    "(2)「[Add] :rb_rune_rainbow:」的 [A] 任意域 Power（135.2.e.5 / 163.2.b）不可表达：契约与内核的 Domain 是六域封闭集合，" +
    "effect.resources 明确记录 Universal Power 不可表达、绝不用某个域近似，本卡以 power: [\"rainbow\"] 保留记号（实测原语返回 negated impossible）。" +
    "(3)「Spend this Power only to play units or gear.」是资源的用途限制：内核没有带约束的资源池（src 内没有 use-only-to / " +
    "restricted-power 一类消费键），programs/play.ts 的 translateRestriction 只接受 condition/value 形状" +
    "（本卡的 descriptive kind 会抛 “needs a rules adapter”）；430.3 的 Add Reaction 支付窗口" +
    "（chain/engine.ts 的 activateAddDuringPayment）没有接入本卡 Add 能力的生产调用方。" +
    "(4) 缺 CR 107.4.a–d 的 Legend Zone：ZoneId/ZoneDestination 没有 legend-zone，费用支付只接受 board/rune-zone 的横置对象" +
    "（415.4/415.5），传奇无法在真实区域支付 :rb_exhaust:；golden 的 Board 装置只是部分证据。" +
    "另外同身份的 rad-170-167 删去了 “only”，两种印刷语义不同且目录未给出按印刷号执行还是" +
    "勘误统一的依据，本卡按任务指定的 rad-143-167 原文书写。已合入并有执行证据：effect.banish 的 Banish 动作与横置费用形状，见 golden。不近似实现。",
  abilities,
  sourceText:
    "[Reaction][>] Banish a unit or gear from your trash, :rb_exhaust:: [Add] :rb_rune_rainbow:. " +
    "Spend this Power only to play units or gear. (Abilities that add resources can't be reacted to.)"
} satisfies CardProgram;

export default program;
