import type { Ability, CardProgram, TriggerSpec } from "../../ir/index.js";

/**
 * The Ball (rad-146-167) — Gear, 5 Energy, 1 Order power, might null,
 * Calm/Mind, Device / Orianna / Signature.
 *
 * Printed text:
 *   [Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)
 *   [Ganking] (While this is a unit, it can move from battlefield to battlefield.)
 *   When you play or move this, choose one —
 *   Draw 1. Deal 2 to enemy units here.
 *
 * 规则依据（CR v1.5）：
 * - `[Deploy]`（830）与 `[Ganking]`（810）只声明关键词身份：两文件的 KeywordDef 都已合入
 *   （effects/keywords/Deploy.ts、effects/keywords/Ganking.ts），展开分别落在 ability 图层的
 *   continuous.location（许可/限制/清理豁免/固守消灭触发）与 continuous.movement（移动许可）。
 * - “When you play or move this”：两个触发条件共用同一效果——card-played 时点（383.4.a / 407，
 *   自指用 `self: true`）与 object-moved 时点（421.1 / 449.1，filter 的对象锚点用契约 3.6 的
 *   符号选择器 `"self"`）。各写成一个 triggered ability。
 * - “choose one — Draw 1. / Deal 2 to enemy units here.”：契约 3.9 的 `choice.mode`（count 1、
 *   different true），两个模式各自把指令包在 `body` 里。
 * - “Draw 1”＝ `effect.draw`（414.3，默认抽牌者为能力控制者，190.6.d）。
 * - “Deal 2 to enemy units here”＝ `effect.damage`；355.10.d 的 “all units” 类效果按特征程序化
 *   选定，所以用 `selection: "all"` 的目标规范承载“此处所有敌方单位”，controller 锚点为 opponent。
 *   “here” 目前只能写在过滤器的 sameLocationAs 锚点上；解释器集合查询支持它，但生产
 *   translateObjectFilter 拒绝该键、生产 Finalize 的 matchesObjectFilter 又静默放行。
 *   引擎的 TargetSpec.location 符号选择器是更合适的形状，但 CardProgram 校验器
 *   （ir/validation.ts）还不接受（见 judgeReason 与最终回复的契约变更请求）。
 *
 * 缺口（2026-10-17 实测；不近似实现，故 judge-required）：
 * - Deploy 的展开声明 continuous.location 与 hold 触发，但 continuous.location 没有
 *   layerFor 映射（programs/statics.ts 绑定卡牌 static 实测抛 judge-required
 *   “Static ability kind continuous.location has no layer mapping”），也没有
 *   Finalize 位置校验调用方；hold 触发的 { here: true } 过滤器会被
 *   translateTriggerFilter/translateObjectFilter 拒绝（实测 Unsupported filter field here）。
 *   turn/flow.ts 的清理召回已有 Deploy 豁免，无需卡侧近似。
 * - choice.mode 会被 chain/engine.ts 的 assertFinalizationSurface 与
 *   programs/play.ts 的 validateSurface 拒绝（“Mode choices require a Finalize/Resolve
 *   choice-plan adapter”），两个 card-played/object-moved 触发都过不了 Play 管线绑定。
 * - “Deal 2 to enemy units here” 的 “here”：引擎侧已经支持两种位置锚点，但都不是可用形式——
 *   (a) 过滤器的 sameLocationAs 锚点由解释器集合查询实现，生产 translateObjectFilter 拒绝该键
 *   （绑定即失败），生产 Finalize 的 matchesObjectFilter 又对未识别键静默放行，直接把别处
 *   敌方单位也算进来（355.10.d / 421.1）；
 *   (b) TargetSpec.location 的符号选择器 `{ kind: "source-location" }` 由 target/target-plan.ts
 *   与 interpreter/selectors.ts 支持并按来源地点求值，但 CardProgram 校验器
 *   （packages/card-dsl/src/ir/validation.ts 的 validateTargetSpec）把非具体 LocationRef 的
 *   location 一律交给 validateLocationFilter，实测抛 invalid-location-kind ——
 *   属共享契约缺口（契约变更请求见最终回复）。
 *   另外 selection: "all" 的 TargetSpec 会在 Finalize 锁定并逐个发 became-target，而 355.10.d 的
 *   all-units 效果不构成目标选择——Resolve 期非目标集合的生命周期仍缺（同类缺口见 ogn/peak-guardian 的 TODO）。
 *
 * 可执行部分：`[Ganking]` 已合入关键词（生产 binder 可登记 continuous.movement）；
 * `choice.mode` + `effect.draw` / `effect.damage` 分支已在 golden 中用解释器 + 参考内核真实执行
 * （含 source-location 锚点把集合限制在来源所在地点）。
 */
const modeAbility = (id: string, trigger: TriggerSpec): Ability => ({
  kind: "triggered",
  trigger,
  optional: false,
  body: [
    {
      id,
      op: "choice.mode",
      args: {
        count: { kind: "constant", value: 1 },
        different: { kind: "constant", value: true },
        modes: {
          kind: "constant",
          value: [
            {
              id: "the-ball.draw-mode",
              body: [
                {
                  id: "the-ball.draw",
                  op: "effect.draw",
                  args: { amount: { kind: "constant", value: 1 } }
                }
              ]
            },
            {
              id: "the-ball.damage-mode",
              body: [
                {
                  id: "the-ball.damage",
                  op: "effect.damage",
                  args: {
                    amount: { kind: "constant", value: 2 },
                    target: { kind: "constant", value: "the-ball.enemy-units-here" }
                  },
                  targets: [
                    {
                      id: "the-ball.enemy-units-here",
                      filter: {
                        type: "unit",
                        controller: "opponent",
                        // 355.10.d / 421.1 的“here”：解释器集合查询支持该锚点，
                        // 生产绑定与 Finalize 过滤尚不支持（见 judgeReason）。
                        sameLocationAs: "source"
                      },
                      selection: "all"
                    }
                  ]
                }
              ]
            }
          ]
        }
      }
    }
  ]
});

const program = {
  canonicalCardId: "card.hash-a086d5c18c686d7dd38aba3317931635118d024917313da10f92dd9561df0e57",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "两处当前缺口，均不近似实现：" +
    "(1) [Deploy]（830.1.b）：触发注册（programs/triggers.ts 经 attachProgramLifecycle）与 keyword 展开" +
    "（programs/keywords.ts）已合入，但 Deploy 展开的 continuous.location 没有 layerFor 映射" +
    "（卡牌 static 绑定实测抛 judge-required \"Static ability kind continuous.location has no layer mapping\"），" +
    "也没有 Finalize 位置校验调用方；hold 触发的 { here: true } 过滤器被 " +
    "translateTriggerFilter/translateObjectFilter 拒绝（实测 Unsupported filter field here）。" +
    "turn/flow.ts 的清理召回已有 Deploy 豁免。" +
    "(2) choice.mode 被 chain/engine.ts 的 assertFinalizationSurface 与 programs/play.ts 的 validateSurface 拒绝" +
    "（需要 Finalize/Resolve choice-plan 适配器），两个 card-played/object-moved 触发都过不了 Play 管线绑定。" +
    "“Deal 2 to enemy units here” 的 here 锚点无可用形式：过滤器的 sameLocationAs 被 translateObjectFilter 拒绝" +
    "（绑定即失败），生产 Finalize 的 matchesObjectFilter 又对未识别键静默放行（别处单位也命中）；" +
    "TargetSpec.location 的 { kind: \"source-location\" } 已被 target-plan/interpreter 支持按来源地点求值，" +
    "但 CardProgram 校验器（ir/validation.ts 的 validateTargetSpec）实测抛 invalid-location-kind，" +
    "属共享契约缺口（见最终回复的契约变更请求）。" +
    "另 selection: \"all\" 的 TargetSpec 会在 Finalize 锁定并逐个发 became-target，" +
    "而 355.10.d 的 all-units 效果不构成目标选择——Resolve 期非目标集合生命周期仍缺。" +
    "已可执行部分：Ganking 关键词（生产 binder 可登记 continuous.movement）、choice.mode + effect.draw / " +
    "effect.damage 分支（golden 真实执行）。",
  abilities: [
    { kind: "keyword", keyword: "deploy" },
    { kind: "keyword", keyword: "ganking" },
    modeAbility("the-ball.play-mode", { at: "card-played", filter: { event: "card-played", self: true } }),
    modeAbility("the-ball.move-mode", { at: "object-moved", filter: { event: "object-moved", self: true } })
  ],
  sourceText:
    "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)\n" +
    "[Ganking] (While this is a unit, it can move from battlefield to battlefield.)\n" +
    "When you play or move this, choose one —\nDraw 1.Deal 2 to enemy units here."
} satisfies CardProgram;

export default program;
