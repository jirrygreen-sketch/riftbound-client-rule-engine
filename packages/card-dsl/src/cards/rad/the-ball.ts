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
 *   选定，不构成目标，所以用 `selection: "all"` 的目标规范承载“此处所有敌方单位”（损坏集合），
 *   并用 `sameLocationAs: "source"` 锚点把集合限制在“here”，controller 锚点为 opponent。
 *
 * 缺口（不近似实现，故 judge-required）：
 * - Deploy 的展开虽然已声明，但消费者未合入：continuous.location 的 play-location/限制检查没有
 *   Finalize 位置校验调用方，清理流程（turn/flow.ts）对非单位 Gear 的 Deploy 召回豁免与 hold 触发
 *   注册都仍缺（Deploy.ts 文件头记录同一缺口）。
 * - “Deal 2 to enemy units here” 的 sameLocationAs 锚点只在解释器集合查询中实现，生产链的
 *   目标系统（target/target-plan.ts）不读取该锚点；object-moved 触发的注册依赖 RIFT-257。
 *
 * 可执行部分：`[Ganking]` 已合入关键词；`choice.mode` + `effect.draw` / `effect.damage` 分支已在
 * golden 中用解释器 + 参考内核真实执行（含 sameLocationAs 锚点在解释器集合查询中的行为）。
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
    "缺 [Deploy] 展开的消费者（830.1.b：只能打到战场、对手在此固守时消灭、非单位 Gear 清理不召回）：" +
    "effects/keywords/Deploy.ts 已合入并声明 continuous.location 与 hold 消灭触发，但 continuous.location " +
    "的 play-location/限制检查没有 Finalize 位置校验调用方、清理流程（turn/flow.ts）没有非单位 Deploy " +
    "召回豁免、hold 时点也没有把该关键词展开注册成事件订阅；卡牌程序 → TriggerRegistration/图层注册的" +
    "生产接线属 RIFT-257（进行中）。" +
    "另 “Deal 2 to enemy units here” 的 sameLocationAs（here）锚点只在解释器的集合查询里实现" +
    "（interpreter/selectors.ts），生产目标系统（target/target-plan.ts）不读取该锚点，直接接线会把别处" +
    "的敌方单位也算进来（355.10.d / 421.1）。object-moved 触发同样依赖 RIFT-257 的注册接线。" +
    "已可执行部分：Ganking 关键词、choice.mode + effect.draw / effect.damage 分支（golden 真实执行）；不近似实现。",
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
