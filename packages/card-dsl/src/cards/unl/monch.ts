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
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - 减费没有可执行路径：cost/cost-plan.ts 只在调用方显式提供 CostPlanInput.discounts 时应用折扣，
 *   没有任何已合入路径把卡牌的静态/持续减费装进这次打出的费用计划，effects/instructions/ 下也没有
 *   cost.modify 原语（RIFT-9 清单项；同 sfd/ornns-forge、ogn/eager-apprentice 的缺口）。
 * - 入场就绪缺 replacement.enter 的消费方：events/pipeline.ts 有替代注册表，但没有读取 CardProgram
 *   replacement 能力并注册的入口（同 sfd/xin-zhao-vigilant、sfd/dunebreaker 记录的批次缺口）。
 * - 条件求值也未接线：layers/engine.ts 的 conditionMatches 只识别 always/never/type/has-tag/has-keyword，
 *   未识别的 compare 条件按 true 处理（ogn/staunch-survivor 记录同一现象），因此即使减费/替代注册
 *   落地，“对手控制着 Stunned 单位”的条件也会被静默当成成立。
 * 依赖：RIFT-89（费用计划的减费安装）、RIFT-9/RIFT-120（replacement.enter 替代管线）、
 * RIFT-91（layers 条件求值与卡牌接线）。不近似实现：不用事后 effect.ready 代替入场替代。
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
    replaces: { event: "object-enters-board", filter: { source: "self", exhausted: true } },
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
    "两处缺口，均不近似实现：(1) “I cost :rb_energy_2: less” 属 356.4 的 Finalize 减费阶段，" +
    "但 cost/cost-plan.ts 只在调用方显式提供 CostPlanInput.discounts 时应用折扣，没有任何已合入路径把卡牌的" +
    "静态/持续减费装进这次打出的费用计划，effects/instructions/ 下也没有 cost.modify 原语（RIFT-9 清单项；" +
    "同 sfd/ornns-forge、ogn/eager-apprentice 的缺口）。(2) “I enter ready” 是入场替代（143.4/359.2.c/369.3 的" +
    "Master Yi, Honed 示例），缺 replacement.enter 的消费方：events 有替代注册表但没有读取 CardProgram replacement " +
    "能力并注册的入口，用事后 effect.ready 代替会产生多余的“成为就绪”事件（effect.ready 文档明确不参与入场替代）。" +
    "此外条件 “If an opponent controls a stunned unit”（424.1.a）即使在注册落地后也无法诚实求值：" +
    "layers/engine.ts 的 conditionMatches 只识别 always/never/type/has-tag/has-keyword，未识别的 compare 条件按 true 处理" +
    "（ogn/staunch-survivor 记录同一现象）。依赖：RIFT-89（费用计划减费安装）、RIFT-9/RIFT-120（replacement.enter）、" +
    "RIFT-91（layers 条件求值）。effect.ready 已合入，golden 用解释器 + 参考内核真实执行声明的替代体。",
  abilities,
  sourceText: "If an opponent controls a stunned unit, I cost :rb_energy_2: less and enter ready."
} satisfies CardProgram;

export default program;
