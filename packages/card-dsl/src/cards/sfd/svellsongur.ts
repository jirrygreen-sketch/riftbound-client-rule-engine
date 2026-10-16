import type { CardProgram } from "../../ir/index.js";

/**
 * Svellsongur (sfd-059-221) — Gear, 3 energy + 1 Calm power, Might 0, 领域 Calm,
 * 标签 Equipment。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json sfd-059-221）：
 *   "[Equip] :rb_energy_1::rb_rune_calm: (:rb_energy_1::rb_rune_calm:: Attach this to a
 *    unit you control.)
 *    As this is attached to a unit, copy that unit's text to this Equipment's effect
 *    text for as long as this is attached to it."
 *
 * 规则依据（CR v1.5）：
 * - 818.1 / 818.1.a / 818.1.c / 818.1.c.2：Equipment 上的 [Equip] 是启动式能力关键词，
 *   印刷费用为 1 能量 + 1 个 Calm 符文，功能上等于「[费用]: Attach this to a unit you
 *   control.」。展开由已合入的 effects/keywords/Equip.ts 负责。
 * - 479.1 / 479.1.a / 479.1.d：复制效果在 copy 图层结算；479.1.d 的示例直接点名本卡
 *   （“Svellsongur is an Equipment that reads in part ‘As this is attached to a unit, copy
 *   that unit's text to this Equipment's effect text for as long as this is attached to
 *   it.’ This is a copy effect that is applied in this layer.”）。
 * - 435.1.c / 435.1.e：附着后的 Top-Most Card 获得所附着牌的 Effect Text；装备自身印刷的
 *   Rules Text 在附着期间 Inactive。本卡的复制把被附着单位的文本写入本装备的 effect text，
 *   期限与附着状态同步（“for as long as this is attached to it”）。
 *
 * status = judge-required（两处依赖未合入，均不近似实现）：
 * 1. Equip 启动费用不可支付：cost/plan-values.ts 的 readCost 对 Equip 展开声明的
 *    payments: [{ kind: "equip" }] 调用 blocked——实测 buildCostPlan 抛 CostPlanError
 *    （reason "judge-required"，message "Unsupported payment kind: equip"）。
 * 2. 附着期文本复制没有可执行路径：
 *    - 没有把「As this is attached…」表达成卡牌静态 / 替代能力的 IR 形状：契约 3.1 的
 *      ContinuousEffect 只有 kind/value/duration 开放字段，没有「附着事件 → 把被附着
 *      对象的 text 写进本对象 effectText，并在脱离时结束」的声明，也没有该声明的消费方；
 *    - effect.copy 的 mode "effect"（正是本卡这类“复制对象文本到现有对象”的复制效果）
 *      在合并代码里显式 blocked：返回 negated，blockedReason
 *      "copy-layer-traits-exceptions-and-attachment-duration-unavailable"（该文件注释说明
 *      契约无法表达附着期期限与复制文本例外的冻结）；
 *    - layers/copy.ts 的 copyCharacteristics 只覆盖 cardId/name/types/tags/keywords/
 *      might/energy/power，不含 text/effectText，也没有附着事件驱动的注册路径；
 *    - 缺少卡牌程序 → 关键词展开 → 时点/链的接线（契约 3.5）。
 * 依赖：layers-continuous 的 copy 图层文本复制与附着期期限（RIFT-91）、Equip 费用支付种类
 * （RIFT-89 后续）。不把复制近似成 effect.copy 的 create（那会新建对象）或一条裸
 * continuous.copy-text 声明（没有消费方，且 479.1.d 要求它在 copy 图层结算）。
 */
export default {
  canonicalCardId: "card.hash-b789f6d844c0da0576802aca0c36d51a7475c3c3c62c21b9ef4092438971fafe",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入：(1) Equip 启动费用无法支付——已合入的 Equip 展开（RIFT-87）声明 " +
    "payments: [{ kind: \"equip\" }]，cost/plan-values.ts 的 readCost 对未知支付种类调用 blocked，实测 " +
    "buildCostPlan 抛 CostPlanError（reason \"judge-required\"，message \"Unsupported payment kind: equip\"）；" +
    "(2) 附着期文本复制无可执行路径——CR 479.1/479.1.a/479.1.d 明确本卡是 copy 图层的复制效果（479.1.d 以本卡为示例），" +
    "但卡牌侧没有「附着事件 → 把被附着对象文本写入本对象 effect text，并在脱离时结束」的 IR 形状与消费方" +
    "（ContinuousEffect 无该声明；layers/copy.ts 的 copyCharacteristics 不含 text/effectText，也无附着事件注册路径）；" +
    "effect.copy 的 mode \"effect\" 在 effects/instructions/effect.copy.ts 里显式 blocked，按该文件说明返回 negated、" +
    "blockedReason \"copy-layer-traits-exceptions-and-attachment-duration-unavailable\"；同时缺少卡牌程序 → 关键词展开 → " +
    "时点/链的接线（契约 3.5）。印刷 Equip 费用为 1 能量 + 1 个 Calm 符文；契约 3.1 的 KeywordAbility 没有承载印刷费用" +
    "组成的字段，故只以 value: 2 记录印刷符号数。依赖：RIFT-91（layers-continuous 的 copy 图层文本复制与附着期期限）、" +
    "RIFT-89 后续（Equip 费用支付种类）。不近似实现。",
  abilities: [
    // 818.1.c：印刷费用为 1 能量 + 1 个 Calm 符文；value 记录印刷符号数 2（能量 1 + 符文 1）。
    { kind: "keyword", keyword: "equip", value: 2 }
  ],
  sourceText:
    "[Equip] :rb_energy_1::rb_rune_calm: (:rb_energy_1::rb_rune_calm:: Attach this to a unit you control.)\n" +
    "As this is attached to a unit, copy that unit's text to this Equipment's effect text for as long as this is attached to it."
} satisfies CardProgram;
