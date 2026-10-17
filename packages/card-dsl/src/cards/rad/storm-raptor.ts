import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Storm Raptor (rad-036-167) — Unit, 6 energy, no printed Power, 6 Might, Calm.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, rad-036-167）：
 *   [Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)
 *   When a stunned enemy unit dies here, draw 1.
 *
 * 规则依据（CR v1.5）：
 * - [Deflect]（809.1 / 809.1.b.3 省略数值按 1 / 809.1.c 的功能文本“对手用咒语或能力选择我时
 *   额外支付 1 点任意域力量”）：KeywordDef 已合入（effects/keywords/Deflect.ts，展开为
 *   static target.tax），卡文件只声明，不重复展开。
 * - “When a stunned enemy unit dies here, draw 1.”：死亡触发（时点 object-killed；429.1
 *   定义消灭），object-killed 由 events/action-adapter.ts 产生并携带换区前快照（RIFT-270）。
 *   - “a stunned enemy unit”：被消灭者是敌方单位且处于 Stunned 状态（424.1.a 的二元状态）；
 *     matchesTriggerObject 实现 states 的 stunned 谓词；
 *   - “here”：053.3 明确 Battlefields 才说 “here”，本卡是单位，因此按 421.1 的位置指称
 *     读作“本单位当前所在的位置”（同一战场）；
 *   - “draw 1.”：414.3，抽牌者是触发能力控制者（190.6.d 的隐含 "you"），原语已合入。
 *
 * status = judge-required（见 judgeReason，2026-10-17 逐条实测）：“here” 要求把被消灭对象的
 * 位置与本单位位置比较。触发注册的生产链已合入（programs/triggers.ts 经 attachProgramLifecycle 注册），
 * 但 translateTriggerFilter/translateObjectFilter 遇到 sameLocationAs 锚点直接抛
 * judge-required（实测 "Unsupported filter field sameLocationAs"），绑定即失败；
 * events/pipeline-match.ts 的 matchesTriggerObject 也不实现该锚点、且对未识别的过滤器键
 * 静默放行（实测「别处战场的 stunned 敌方单位」返回 true）——任何路径都会近似实现，故保持 judge-required。
 * 可用的替代锚点也缺一环：TargetSpec.location 的 { kind: "source-location" } 已由
 * interpreter/selectors 与 target-plan 支持，但它只作用于目标（355.7 的目标选择），
 * 触发的事件对象不是目标，无法用它给死亡事件加位置条件。
 * [Deflect] 的 KeywordDef 展开为 target.tax，RIFT-360 已合入可执行的 target-tax 规划
 * （target/tax/collect.ts 的 deflectCost 产出任意域 Power 要求），但 programs/statics.ts 的
 * layerFor 没有该映射，生产绑定实测抛 "Static ability kind target.tax has no layer mapping"；
 * 即使补上映射，chain/engine.ts finalize 仍把税写成 { energy: amount } 常量，
 * 而非消费 TargetTaxCostAdapter 的 CostPlan，809.1.c.1 的任意域 Power 仍无法如实收取。
 * 可执行半段：effect.draw 的 Draw 1（414.3），golden 真实执行。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "deflect" },
  {
    kind: "triggered",
    trigger: {
      at: "object-killed",
      // “a stunned enemy unit dies here” — 被消灭对象是敌方单位、处于 Stunned 状态、
      // 且与本单位同处一个位置（位置锚点缺口见 judgeReason）。
      filter: {
        event: "object-killed",
        filter: {
          type: "unit",
          controller: "opponent",
          states: "stunned",
          sameLocationAs: "source"
        }
      }
    },
    optional: false,
    body: [
      {
        // “draw 1.” — 414.3；触发能力的控制者抽牌（190.6.d）。
        id: "storm-raptor.draw-1",
        op: "effect.draw",
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-f595b4941f399b2ac63a4066a8805f35b600f3bf7ad4bf6a5b2c66ac8e4d9a21",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "当前缺口，均不近似实现：" +
    "(1)「dies here」的位置条件无法如实判定：053.3 说明 “here” 是 Battlefields 的自我指称，" +
    "本卡是单位，按 421.1 读作“本单位当前所在的位置”；该条件需要把被消灭对象的位置与来源单位的位置比较。" +
    "触发注册的生产链已合入（programs/triggers.ts 经 attachProgramLifecycle 注册），" +
    "但 translateTriggerFilter/translateObjectFilter 的白名单不含 sameLocationAs，绑定期实测抛 " +
    "Unsupported filter field sameLocationAs；events/pipeline-match.ts 的 matchesTriggerObject 也不实现该锚点、" +
    "且对未识别的过滤器键静默放行（实测别处战场的 stunned 敌方单位也返回 true），任何接线都会把别处死亡的敌方单位也算成 “dies here”。" +
    "TargetSpec.location 的 source-location 选择器只作用于目标（355.7），触发的事件对象不是目标，无法用它替代。" +
    "「a stunned enemy unit」部分本身是可读的（424.1.a 的二元状态；object-killed 由 action-adapter 产生并取换区前快照，" +
    "matchesTriggerObject 实现 states 的 stunned 谓词），不构成阻塞项。" +
    "(2) [Deflect]：RIFT-360 的 target-tax 规划器已合入（deflectCost 产出任意域 Power 的 mandatory-additional 组件），" +
    "但 programs/statics.ts 的 layerFor 没有 target.tax 映射，原 IR 生产绑定实测抛 " +
    "Static ability kind target.tax has no layer mapping；即使补上映射，" +
    "chain/engine.ts finalize 仍把收集到的税写成 { energy: amount } 常量，不消费 TargetTaxCostAdapter 的 CostPlan，" +
    "809.1.c.1 的任意域 Power 无法如实收取。" +
    "可执行半段：effect.draw 的 Draw 1（414.3），golden 真实执行；不据此宣称整卡可执行。",
  abilities,
  sourceText:
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
    "When a stunned enemy unit dies here, draw 1."
} satisfies CardProgram;

export default program;
