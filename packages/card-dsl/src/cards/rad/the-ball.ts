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
 * - `[Deploy]`（830）/ `[Ganking]`（810）只声明关键词身份：830.1.b / 810.1.b 的展开分别属于
 *   `effects/keywords/deploy.ts`（未合入）与 `effects/keywords/Ganking.ts`（已合入：展开为
 *   `continuous.movement` 静态许可）。
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
 * - `deploy` 关键词展开未合入（关键词批次 RIFT-81~88 / RIFT-91 不含 Deploy）：830.1.b 的
 *   “只能打到战场”“对手在此固守时消灭”“非单位 Gear 清理不召回”都不生效；
 * - “Deal 2 to enemy units here” 在参考内核里未被 `effect.damage` 实测过（见测试说明），
 *   并依赖目标系统把 `sameLocationAs: "source"`（here 语义）正确解析；
 * - `object-moved` 触发需要移动动作发出该时点（421.1 / 449.1，移动管线）并对来源身份做锚定。
 *
 * 可执行部分：`[Ganking]` 已合入关键词；`choice.mode` + `effect.draw` 分支已在 golden 中用参考
 * 内核真实执行；damage 分支与 Deploy / object-moved 以 `test.todo` 标注依赖。
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
    "缺 [Deploy] 关键词展开（830.1.b：只能打到战场、对手在此固守时消灭、非单位 Gear 清理不召回）；" +
    "关键词批次 RIFT-81~88 / RIFT-91 不含 Deploy。另 “Deal 2 to enemy units here” 依赖目标系统把 " +
    "sameLocationAs:\"source\"（here）解析为来源当前所在战场并用 selection:\"all\" 程序化选定全部敌方单位" +
    "（355.10.d；参考内核只验证 choice.mode/draw 分支与锚点形状，见测试）；object-moved 触发需要移动" +
    "管线发出该时点（421.1/449.1）并按来源身份锚定。已可执行部分：Ganking 关键词（已合入）、" +
    "choice.mode + effect.draw 分支；不近似实现。",
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
