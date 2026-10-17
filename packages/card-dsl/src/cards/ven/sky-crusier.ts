import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Sky Crusier (ven-060-166) — Unit, Mind, Piltover.
 *
 * 原文："Discard a gear, :rb_energy_1:, :rb_exhaust:: Deal 4 to a unit at a
 * battlefield."
 *
 * 规则依据（Core Rules v1.5）：
 * - 145.1 / 145.2 / 376：单位可以有 Activated Ability，格式为"费用后接冒号，再接
 *   效果"；默认在控制者 Main Phase 的 Open State、非 Showdown 时执行，即
 *   timing: "action"。费用在 Finalize 检查并向链上项支付（349 的步骤、
 *   cost/payment 的"费用必须能完整支付"）。
 * - "Discard a gear"：423.1 规定 Discard 是把牌从手牌直接放进其 Trash
 *   （不执行其规则文本）；423.3 规定当 Discard 作为费用时，该动作必须能够完成。
 *   所以这是 cost 里的 discard 支付分量（423.1.a 的"执行动作的玩家选择弃哪些牌"
 *   是结算期选择，不是目标），用 payments 里的 discard 选择项表达，而不是
 *   effect.discard。
 * - ":rb_energy_1:"：1 点 Energy 费用（163.2 的 Power 与 Energy 区分）。
 * - ":rb_exhaust:"：横置本单位作为费用（424 之外的通用费用形式；本卡不涉及
 *   Stun）。exhaust 作为费用由支付的 checkAction 校验"控制者拥有、在 Board 上、
 *   且未横置"。
 * - "Deal 4 to a unit at a battlefield"：effect.damage（418 定义 Deal；原语已合入）
 *   取战场上的单位为目标（355.10，目标经 Finalize 锁定、Resolve 重验）。数额是
 *   印刷的固定 4，不来自其它对象的特征，故用 constant 表达式。位置过滤写
 *   ObjectFilter 的 location: "battlefield"，这是生产匹配器
 *   （layers/filter.ts 的 matchesObjectFilter：location 是字符串时比较
 *   object.location.type）支持的拼法，排除基地里的单位。
 *
 * 结构说明：
 * - 三条印刷费用（discard / 1 energy / exhaust）都写在 ActivatedAbility.cost 里，
 *   不在 body 里重复实现；body 只有一条伤害指令。
 * - 目标 filter 用 type + zone: "battlefield"（契约 3.6 的位置表达；"at a
 *   battlefield" 指战场上的单位，排除基地中的单位）。
 * - 引用只用契约 3.6 的形状：不写运行时 ObjectRef。
 */
const abilities: Ability[] = [
  {
    kind: "activated",
    timing: "action",
    cost: {
      kind: "activated",
      energy: { kind: "constant", value: 1 },
      payments: [
        {
          kind: "discard",
          choice: {
            id: "sky-crusier.gear",
            options: ["gear-in-controller-hand"],
            min: 1,
            max: 1,
            selection: "one",
            filter: { type: "gear", zone: "hand" }
          }
        },
        { kind: "exhaust" }
      ]
    },
    body: [
      {
        id: "sky-crusier.damage",
        op: "effect.damage",
        args: {
          amount: { kind: "constant", value: 4 },
          target: { kind: "constant", value: "sky-crusier.battlefield-unit" }
        },
        targets: [
          {
            id: "sky-crusier.battlefield-unit",
            filter: { type: "unit", location: "battlefield" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-d2def5066902e970298a380b5ed4f78dba819d6944f7212828d31b3876d8f1a2",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "唯一当前缺口是「Discard a gear」的费用选择没有运行时落点（复核 2026-10-17，RIFT-618；不近似实现）：" +
    "423.1.a 规定弃哪张牌由执行动作的玩家在结算期选择，但 cost/plan-values.ts 的 choiceObjects 只接受 " +
    "精确的 ObjectRef 候选（本任务实测 buildCostPlan 对 choice.options: [\"gear-in-controller-hand\"] 抛 " +
    "CostPlanError \"Cost requires an exact object reference\"），静态卡牌程序写不了运行时手牌身份；" +
    "也没有已合入路径在 Finalize 时从付款者手牌解析 PickSpec 描述性候选再交给 discard 付费种类。" +
    "已合入且有真实执行证据：1 Energy + 横置 + discard 的费用计划与支付（显式 ObjectRef 候选下 " +
    "buildCostPlan/payCostPlan 真实扣能量、弃牌、横置，golden 断言）、目标锁定与 effect.damage（418.1）" +
    "（含位置过滤与目标失效的 ignored 边界）。不把「弃一张装备」改成固定弃某张、" +
    "不用 effect.discard 代替费用、不放宽 423.3 的「费用必须能完成」。" +
    "依赖：费用计划的运行时候选解析接线（手牌 PickSpec → 支付者选择）。",
  abilities,
  sourceText: "Discard a gear, :rb_energy_1:, :rb_exhaust:: Deal 4 to a unit at a battlefield."
} satisfies CardProgram;
