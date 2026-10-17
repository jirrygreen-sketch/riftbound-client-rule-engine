import type { Ability, CardProgram, Condition } from "../../ir/index.js";

/**
 * Monch (unl-035-219) — Unit, 6 Energy, Might 6, Calm, tag Bandle City.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-035-219，逐字）：
 *   If an opponent controls a stunned unit, I cost :rb_energy_2: less and enter ready.
 *
 * 规则依据（CR v1.5）：
 * - “If an opponent controls a stunned unit”：触发条件式从句（383.2.a.1 的“紧跟在能力文本后的
 *   条件”），这里作用于整句的两个效果；Stunned 是 424.1.a 的二元状态，按 424.1.a.1 已 Stunned
 *   的单位不会被再次 Stun。对手控制的判定用既有 ObjectFilter 的 controller: "opponent"，
 *   状态用 trigger-spec 的 states 键（与 ogn/solari-shrine、ogn/dune-drake 同款写法）。
 * - “I cost :rb_energy_2: less”：356.4 的减费在 Finalize 构建费用计划时应用（356.4.a 允许由
 *   任何卡或效果应用），属于打出费用的静态改写。
 * - “enter ready”：单位默认横置入场（143.4 / 359.2.c），369.3 的官方示例（Master Yi, Honed
 *   “I enter ready.”）说明这是入场替代效果，把「横置入场」替换为「就绪入场」；按契约 3.1 的
 *   replacement 形状表达，不能用事后的 effect.ready 近似（effect.ready 文档明确不参与入场替代，
 *   会产生多余的“成为就绪”事件）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required（按 2026-10-16 合入批次复核）。
 * - 减费没有可执行路径：cost/cost-plan.ts 只在调用方显式提供 CostPlanInput.discounts 时应用折扣，
 *   没有任何已合入路径把卡牌的静态/持续减费装进这次打出的费用计划；programs/play.ts 的 translateCost
 *   明确对 additional/discount 字段 judgeRequired，静态 cost.modify 尚未接入费用计划
 *   （同类缺口见 sfd/ornns-forge、ogn/eager-apprentice）。
 * - replacement/bind.ts 已能绑定
 *   { replaces, with } 形状并改写入场取向，golden 用真实链 fixture 绑定卡程序声明的替代体验证；
 *   但绑定时的条件不会在 entry interception 前求值；本卡的 entry filter 必须使用
 *   replacement 绑定器读取的 self 形状。
 * - 条件既不参与图层也不参与入场替代：layers/engine.ts 的 conditionMatches 只识别
 *   always/never/type/has-tag/has-keyword（未识别的 compare 按 true，ogn/staunch-survivor 同一现象），
 *   而 replacement/bind.ts 的 registration.matches 对入场替代在 matchesEnterAction 命中后直接
 *   返回 true，根本不调用 testCondition —— 实测把 condition 换成 never 仍会就绪入场。
 *   因此“对手控制着 Stunned 单位”这个门槛在已合入路径上被完全跳过。
 * 依赖：费用计划的减费安装、entry replacement 的条件求值、图层 compare 条件求值。
 * 不近似实现：不用事后 effect.ready 代替入场替代。
 */
const OPPONENT_STUNNED_UNIT: Condition = {
  kind: "compare",
  left: {
    kind: "count",
    subject: "units",
    // “an opponent controls a stunned unit”：敌方（740.1.b）且当前 Stunned（424.1.a）。
    filter: { type: "unit", zone: "board", controller: "opponent", states: "stunned" }
  },
  operator: "gte",
  right: { kind: "constant", value: 1 }
};

const abilities: Ability[] = [
  {
    kind: "static",
    // 356.4 的减费属于 Finalize 费用计划阶段（本形状是声明的持续费用改写，无合并消费方）。
    effect: {
      kind: "continuous.cost-modification",
      resource: "energy",
      amount: { kind: "constant", value: -2 },
      appliesTo: "self-play-cost"
    },
    condition: OPPONENT_STUNNED_UNIT
  },
  {
    kind: "replacement",
    // 143.4 / 359.2.c / 369.3：把单位的横置入场替换为就绪入场（不产生“成为就绪”事件的补发）。
    replaces: { event: "object-enters-board", filter: { self: true, exhausted: true } },
    condition: OPPONENT_STUNNED_UNIT,
    with: [
      {
        id: "monch.enter-ready",
        op: "effect.ready",
        args: { objects: { kind: "constant", value: { kind: "source" } } }
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-f6fc6f5dbe6ceebe1e128bfe16a67f81a7cc149370db212b7fbda2bbd71599e4",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "三处缺口，均不近似实现（已按 2026-10-16 合入批次复核）：" +
    "(1) “I cost :rb_energy_2: less” 属 356.4 的 Finalize 减费阶段，但 cost/cost-plan.ts 只在调用方显式提供 " +
    "CostPlanInput.discounts 时应用折扣，没有任何已合入路径把卡牌的静态/持续减费装进这次打出的费用计划；" +
    "programs/play.ts 的 translateCost 对 additional/discount 字段直接 judgeRequired，静态 cost.modify 尚未接入费用计划。" +
    "(2) “I enter ready” 是入场替代（143.4/359.2.c/369.3）：replacement/bind.ts 已能绑定 " +
    "{ replaces, with } 并改写入场取向（golden 用真实链 fixture 绑定卡程序声明的替代体验证，无多余“成为就绪”事件），" +
    "但 entry interception 会先于 ability.condition 命中，条件不会阻止不满足门槛的就绪入场；" +
    "本卡的 replacement filter 已按绑定器契约使用 self 形状。" +
    "(3) 条件 “If an opponent controls a stunned unit”（424.1.a）在两条已合入路径上都不成立：layers/engine.ts 的 conditionMatches " +
    "只识别 always/never/type/has-tag/has-keyword（未识别的 compare 按 true，ogn/staunch-survivor 同一现象），" +
    "而 replacement/bind.ts 的 registration.matches 对入场替代在 matchesEnterAction 命中后直接返回 true、" +
    "不调用 testCondition（实测把 condition 换成 never 仍就绪入场）。" +
    "依赖：费用计划减费安装、entry replacement 的条件求值、图层 compare 条件求值。",
  abilities,
  sourceText: "If an opponent controls a stunned unit, I cost :rb_energy_2: less and enter ready."
} satisfies CardProgram;

export default program;
