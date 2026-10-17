import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Shady Spectacles (ven-137-166) — Gear, 4 Energy, no printed Power, Might 0,
 * Order, tag Equipment.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-137-166，逐字）：
 *   "[Equip] :rb_energy_1::rb_rune_order: (:rb_energy_1::rb_rune_order:: Attach this
 *    to a unit you control.)
 *    As this is attached to a unit, choose another friendly unit. The equipped unit
 *    becomes a copy of that unit for as long as this is attached to it."
 *
 * 规则依据（Core Rules v1.5）：
 * - 818.1 / 818.1.a / 818.1.b / 818.1.b.1 / 818.1.c / 818.1.c.2：Equipment 上的
 *   [Equip] 是启动式能力关键词，印刷费用为 1 Energy + 1 个 Order 符文，功能等价于
 *   "[费用]：把此装备附着到你控制的一个单位上"；所选单位是 Target。
 * - 435 / 435.1 / 718 / 719：Attach 与 Top-Most Card 的状态；装备附着后该单位是
 *   "the equipped unit"（719.1 的 Effect Text 与 718 的状态定义）。
 * - 446.1 / 446.2 / 446.4.a / 479.1 / 479.1.d：复制（Copy）是 copy 图层结算的效果；
 *   479.1.d 以同为 Equipment 的 Svellsongur 为示例说明"附着期间复制"属于该层。
 * - "choose another friendly unit"：额外选择一个是选择（355.5），"another" 排除装备所
 *   附着的那个单位；本句与附着同时发生，因此在附着事件的处理中完成选择。
 * - "for as long as this is attached to it"：期限与附着状态同步，脱离时结束（718.1）。
 *
 * 当前状态与剩余接线见 judgeReason；不以原语存在代替整卡执行证据。
 * 1. Equip 启动费用不可支付：已合入的 effects/keywords/Equip.ts 展开声明
 *    cost.payments [{ kind: "equip" }]，cost/plan-values.ts 的 readCost 对未知支付种类
 *    调用 blocked——实测 buildCostPlan 抛 CostPlanError（reason "judge-required"，
 *    message "Unsupported payment kind: equip"）；印刷费用也无法送达 KeywordDef.expand
 *    （programs/keywords.ts 只传 value/host，没有契约 3.8.3 的 params.cost）。
 *    programs/activate.ts 已能把 Equip 展开的 activated 能力转换为带目标与费用的 ChainDraft；
 *    缺口是印刷费用的传参/支付，而非关键词展开到启动能力的通用接线。
 * 2. "As this is attached to a unit, choose another friendly unit" 没有卡牌侧的
 *    附着时选择路径：IR 没有"附着事件 → 选另一个友方单位"的声明形态，选择生命周期
 *    归目标/选择系统（355.5；同时 chain/engine.ts 的 assertFinalizationSurface 阻断嵌套目标）。
 * 3. "The equipped unit becomes a copy of that unit for as long as this is attached to it"
 *    没有可执行路径：卡牌侧没有"复制现有对象的可复制特征、期限绑定附着状态、脱离即结束"
 *    的声明与消费方（effect.copy 的 mode "effect" 在合并代码里显式 blocked，返回
 *    blockedReason "copy-layer-traits-exceptions-and-attachment-duration-unavailable"；
 *    layers/copy.ts 也无附着事件驱动的注册路径）。
 * golden 覆盖身份/结构、Equip 展开的 effect.attach 本体真实执行；绑定检查覆盖关键词经
 * programs/activate.ts 生成 ChainDraft。费用与复制语义仍由 test.todo 记录。
 */
const equip = {
  // 印刷 "Equip :rb_energy_1::rb_rune_order:"：2 个资源符号（1 Energy + 1 Order Power）。
  // value 记录印刷符号数，costDomain 记录 Power 符文的领域（与 sfd/boneshiver 同一约定）。
  kind: "keyword",
  keyword: "equip",
  value: 2,
  costDomain: "Order"
} as const;

const abilities: Ability[] = [
  // 只声明关键词身份（cards/README.md 第 5 节）。"As this is attached … becomes a copy …"
  // 是 446/479.1 的 copy 图层效果，卡牌层不手写它的结算，也不为它捏造 IR 声明
  // （同 sfd/svellsongur 的处理：缺口在 judgeReason 与 test.todo 中列明）。
  equip
];

export default {
  canonicalCardId: "card.hash-0b22da1f55c97313d8b71cfe7bc85b5b13ccca85dda9b92eea0b197fde0ed543",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1) Equip 启动费用不可支付：已合入的 effects/keywords/Equip.ts 展开声明 " +
    "cost.payments [{ kind: \"equip\" }]，cost/plan-values.ts 的 readCost 对未知支付种类调用 blocked——实测 " +
    "buildCostPlan 抛 CostPlanError（reason \"judge-required\"，message \"Unsupported payment kind: equip\"）；" +
    "印刷费用（1 Energy + 1 Order 符文，CR 818.1.c/135.2.e.4）也无法送达 KeywordDef.expand（契约 3.8.3 的 " +
    "params.cost 未由 programs/keywords.ts 转发，调用方只传 value/host）。programs/activate.ts 已将 Equip 展开为" +
    "带目标和费用的 ChainDraft，通用启动绑定已合入；阻塞在印刷费用的传参与支付。" +
    "(2)「As this is attached to a unit, choose another friendly unit」没有卡牌侧的附着时选择路径：" +
    "IR 没有「附着事件 → 选另一个友方单位」的声明形态，选择生命周期归目标/选择系统（355.5）；" +
    "chain/engine.ts 的 assertFinalizationSurface 也阻断嵌套目标选择。" +
    "(3)「The equipped unit becomes a copy of that unit for as long as this is attached to it」无可执行路径：" +
    "卡牌侧没有「复制现有对象的可复制特征 + 期限绑定附着状态 + 脱离即结束」的声明与消费方（本卡不为该句手写 IR " +
    "声明，也不把复制近似成新建对象）；effect.copy 的 " +
    "mode \"effect\" 在合并代码里显式 blocked（blockedReason " +
    "\"copy-layer-traits-exceptions-and-attachment-duration-unavailable\"），layers/copy.ts 亦无附着事件驱动的注册路径。" +
    "golden 覆盖身份/结构与 Equip 展开的 effect.attach 本体真实执行，绑定检查覆盖 programs/activate.ts 的 ChainDraft。" +
    "依赖：equip 费用支付种类、印刷费用传参、附着事件驱动的选择与复制图层；不把 copy mode=effect 的 blocked 误报成已执行。",
  abilities,
  sourceText:
    "[Equip] :rb_energy_1::rb_rune_order: (:rb_energy_1::rb_rune_order:: Attach this to a unit you control.)\n" +
    "As this is attached to a unit, choose another friendly unit. The equipped unit becomes a copy of that unit for as long as this is attached to it."
} satisfies CardProgram;
