import type { CardProgram } from "../../ir/index.js";

/**
 * Piltovan Forge (ven-161-166) — Battlefield, Colorless.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-161-166，逐字）：
 *   "While you control this battlefield, the first friendly gear activated ability
 *    played each turn costs :rb_energy_1: less."
 *
 * 规则依据（Core Rules v1.5）：
 * - 190.6.a / 190.6.d：战场能力的控制者是战场控制者，"you" / "friendly" 因此都指该控制者；
 *   "While you control this battlefield" 是该控制者窗口。
 * - 151 / 151.1 / 151.2：Gear 可以拥有激活能力（"费用 : 效果"，377.1 的识别方式）。
 * - 377 / 377.1 / 377.2：激活能力的"使用/打出"（"use" / "play"）指它进入链并结算；
 *   377.2 明确卡牌文本用 "use" 或 "play" 指激活能力。
 * - 356.4 / 356.4.b / 356.4.f / 356.6："costs :rb_energy_1: less" 是折扣（356.4.b），
 *   可以减到 0（356.4.f），且 Energy 费用不得低于 0（356.6）。
 * - 356.4.a：折扣可以由别的牌提供（此处由战场提供）。
 * - "the first … each turn" 是每回合一次的窗口：383.1 / 383.3.e.1 的 "the [Nth] time" 形状
 *   属触发识别，但这里的窗口作用在费用上，需要一个「本回合首次符合条件的激活」的历史门控。
 *
 * status = judge-required（复核 2026-10-17；缺口均不近似实现）：
 * 1. cost.modify（RIFT-258/89 批次）已合入：它把 {kind:"reduce",resource:"energy",amount,minimum}
 *    锁存成完整 CostPlan（link 键 cost），golden 继续用 buildCostPlan 真实执行折扣与 0 下限。
 *    仍缺的是把这笔折扣安装到「后续那次激活」的费用计划上——没有已合入路径读取 CardProgram 的
 *    static continuous.cost-modification 并生成那次激活的 discounts（依赖 RIFT-89 接线）。
 * 2. 「the first … each turn」一次性窗口没有可求值形状：需要按回合重置、按玩家/来源计数的
 *    「本回合首次符合条件的激活」历史门控；冻结的 HistoryQuery 只有
 *    {scope, action, timingPoint, player, object}（契约 3.6），没有"某类激活已发生几次"
 *    的 subject，也没有把"这是本回合第一次"写成持续效果期限的形状（同 sfd/ornns-forge、
 *    rad/hunters-circle 的一次性窗口缺口）。
 * 3. 「gear activated ability played」需要把该次激活与它所属的 gear 关联（377.1），
 *    ResolveContext 与图层都没有暴露激活来源的通道。
 * 依赖：RIFT-89（static 费用改写 → 激活计划接线）、一次性窗口的历史门控任务。
 * 不近似实现，不把窗口写成常驻折扣。
 */
export default {
  canonicalCardId: "card.hash-be867d899429959061bfc2cece46b8a8f554894791ea014d6a288b4075a635e9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1) cost.modify（RIFT-258/89 批次）已合入并能把 {kind:\"reduce\",resource:\"energy\"," +
    "amount,minimum} 锁存成完整 CostPlan（link 键 cost），但仍没有已合入路径读取 CardProgram 的 static " +
    "continuous.cost-modification 并把这笔折扣安装到「后续那次 gear 激活」的费用计划 discounts 上（RIFT-89 接线）；" +
    "(2) 「the first … each turn」的一次性窗口没有 IR 形状：需要按回合重置的「本回合首次符合条件的激活」门控，" +
    "冻结的 HistoryQuery 只有 {scope, action, timingPoint, player, object}（契约 3.6），没有「某类激活已发生几次」的 subject，" +
    "Duration 也没有 one-shot 窗口（同 sfd/ornns-forge、rad/hunters-circle 的缺口）；" +
    "(3) 「gear activated ability played」需要把该次激活与所属 gear 关联（151.1/377.1），" +
    "ResolveContext 与图层都没有暴露激活来源的通道。" +
    "已合入并真实执行：buildCostPlan 应用本卡声明的 -1 Energy 折扣（356.4.b/356.4.f/356.6，含 0 下限与非标准付款不受影响）。" +
    "依赖：RIFT-89（static 费用改写 → 激活计划接线）与 per-turn first-play 一次性窗口门控。不近似实现，不写成常驻折扣。",
  abilities: [
    {
      kind: "static",
      effect: {
        // 356.4.b："costs :rb_energy_1: less" 是减费；356.6 的下限 0 由费用计划钳制。
        kind: "continuous.cost-modification",
        resource: "energy",
        amount: { kind: "constant", value: -1 },
        minimum: { kind: "constant", value: 0 },
        appliesTo: "activated-ability-cost",
        // "the first … each turn" 窗口（383.1 / 383.3.e.1 的 Nth-time 形状）尚无消费方；
        // 写成 per-turn-first-activation 是描述性的 fail-closed 形态，不是可执行窗口
        // （见 judgeReason 缺口 2）。
        duration: "per-turn-first-activation",
        // "the first friendly gear activated ability"：151.1 的 gear 激活能力，
        // 属主为战场控制者（190.6.d 的 "friendly"）。
        filter: { type: "gear", controller: "self" }
      },
      // "While you control this battlefield"：190.6.a 的控制者窗口；
      // 战场的在用/离场到期（652.2.c）与能力控制者解析未接线（同 trifarian-war-camp）。
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "objects",
          filter: { object: "self", controller: "self" }
        },
        operator: "gte",
        right: { kind: "constant", value: 1 }
      }
    }
  ],
  sourceText:
    "While you control this battlefield, the first friendly gear activated ability played each turn " +
    "costs :rb_energy_1: less."
} satisfies CardProgram;
