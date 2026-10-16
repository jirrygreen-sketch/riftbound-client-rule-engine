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
    "「Discard a gear」这条费用没有可落地的静态表达：423.1.a 规定弃哪张牌由执行动作的玩家选择" +
    "（结算期选择），但 cost/plan-values.ts 的 PaymentObjectReference 要求 CostSpec 里直接列出" +
    "精确的 ObjectRef 候选（choice.options），静态卡牌程序无法知道运行时手牌身份；当前只能像" +
    "Assembly Rig 那样写占位候选项，plan-values 会以 invalid-cost-plan（Cost requires an exact " +
    "object reference）拒绝，或者由调用方经 ctx.picks 注入候选——该注入约定尚未进入契约（依赖 " +
    "RIFT-89 费用计划、RIFT-102 的对象引用收口）。另外 1 Energy + 横置 + Deal 4 的目标与伤害原语" +
    "均已合入，可单独执行验证。不近似实现：不把『弃一张装备』改成固定弃某张、不用 effect.discard " +
    "代替费用、不放宽 423.3 的“费用必须能完成”。",
  abilities,
  sourceText: "Discard a gear, :rb_energy_1:, :rb_exhaust:: Deal 4 to a unit at a battlefield."
} satisfies CardProgram;
