import type { CardProgram } from "../../ir/index.js";

/**
 * Void Assault (unl-202-219) — Spell, 2 energy + 1 power, Body/Chaos,
 * tags Kha'Zix / Signature.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-202-219，逐字）：
 *   "Move a friendly unit, then move an enemy unit. "
 *   "(If they both move to a battlefield you don't control, you're the attacker.)"
 *
 * 规则依据（CR v1.5）：
 * - "Move a friendly unit, then move an enemy unit"：效果移动（451 的 Effect Move，不是
 *   Standard Move 144、也不是 Recall 457）。被移动的友方/敌方单位各自是目标
 *   （355.7 / 355.9.a.1、355.10：Board 上的单位在公开区域）。"then" 只是顺序词
 *   （055 / 359.3.e.11：能做什么做什么），两条指令彼此独立，没有任何 "it / its"
 *   指向另一条结果，因此不写 linkedTo（README 第 4 节）。
 * - 原文没有印刷目的地：每个 Move 的目的地按 355.4 / 355.4.a 在 Finalize 由该 Move 的
 *   控制者选择。已合入的 LocationTargetSpec + Expr.kind "location" +
 *   { kind: "target-location", target: <spec id> } 已合入，因此每条 effect.move 各自声明
 *   一个目的地 spec，在结算选择阶段从运行期候选集合取值；IR 不写死战场。
 * - 括号里的 "(If they both move to a battlefield you don't control, you're the attacker.)"
 *   是 reminder（466.2.c.1：把 Contested 状态施加到该战场的玩家成为 Attacker；466.2.c.2-c.3
 *   定义 Defender 与指定），不是本卡的独立指令；移动引发的 Showdown / Combat / Cleanup
 *   属 452-455 的流程，由内核负责。
 *
 * status = judge-required（2026-10-17 复核；缺口不近似实现）：
 * - 355.4.a 的两条候选/合法性谓词仍未合入：
 *   （a）候选集合不排除被移动单位当前所在的地点：chooseLocations（effects/interpreter/
 *   locations.ts）调 queryLocationCandidates 时不注入 LocationCandidateOptions.exclude，
 *   实测 type "any"/"battlefield" 的候选都包含当前战场，调用方回答当前战场也会被接受并执行
 *   （355.4.a 要求"the Units' current Location"以外）；
 *   （b）355.4.a 的"where they are allowed to be present"（含 451.2"不得移入已有另外两名
 *   玩家单位的战场"）没有消费方：实测 effect.move 会把单位移到这样的战场，生产
 *   move-location 也没有该谓词。
 *   两条都不能靠写死目的地或用目标过滤近似，故整卡保持 judge-required。
 * 已合入并已真实执行的部分：两条 effect.move 各自在结算选择阶段从运行期 LocationTargetSpec
 * 绑定目的地（含"友方/敌方各自为目标"与两次独立的 move-location 事件），golden 覆盖
 * 正常移动、同一地点不移动、以及目标离场被 ignored。
 */

export default {
  canonicalCardId: "card.hash-0dde19360e49952c6ec4a5b094d28bc2fde4ec115f51db8aa98e331b73edae1e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "目的地选择已改用合入的 LocationTargetSpec + Expr.kind \"location\" + target-location 绑定：每条 Move 各有独立目的地 spec，" +
    "在结算选择阶段从运行期候选集合取值，IR 不写死战场。仍缺 355.4.a 的两条候选/合法性谓词，均不近似实现：" +
    "(1) 候选集合不排除被移动单位的当前位置——chooseLocations（effects/interpreter/locations.ts）调 queryLocationCandidates 时不注入 " +
    "LocationCandidateOptions.exclude，实测 type \"any\"/\"battlefield\" 的候选包含当前战场，调用方回答当前战场也被接受并执行；" +
    "(2) 355.4.a 的「where they are allowed to be present」（含 451.2「不得移入已有另外两名玩家单位的战场」）没有消费方，" +
    "effect.move 会把单位移到这样的战场。两条都需要把位置候选谓词接入选择路径，不能靠写死目的地或目标过滤近似。" +
    "已真实执行的部分：两条 effect.move 各自绑定目的地（friendly / enemy 各自为目标、两条指令互相独立不写 linkedTo），" +
    "golden 覆盖双移动、同地点不移动与目标离场 ignored；括号里的 attacker reminder 是 466.2.c.1-c.3 的流程结果，由内核负责，不当作本卡指令。",
  abilities: [
    {
      kind: "play",
      body: [
        {
          id: "void-assault.move-friendly-unit",
          op: "effect.move",
          args: {
            objects: { kind: "constant", value: { target: "void-assault.friendly-unit" } },
            // 355.4 / 355.4.a：目的地由该 Move 的控制者在结算选择阶段选定；本指令的
            // LocationTargetSpec 提供运行期候选，target-location 读取该绑定。
            to: {
              kind: "location",
              value: { kind: "target-location", target: "void-assault.destination-1" }
            },
            amount: { kind: "constant", value: 1 }
          },
          locations: [
            {
              id: "void-assault.destination-1",
              type: "any",
              min: 1,
              max: 1,
              selection: "one"
            }
          ],
          targets: [
            {
              id: "void-assault.friendly-unit",
              filter: { type: "unit", controller: "self" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          id: "void-assault.move-enemy-unit",
          op: "effect.move",
          args: {
            objects: { kind: "constant", value: { target: "void-assault.enemy-unit" } },
            // 355.4：第二次 Move 有它自己的一次目的地选择（不是第一条的目的地）。
            to: {
              kind: "location",
              value: { kind: "target-location", target: "void-assault.destination-2" }
            },
            amount: { kind: "constant", value: 1 }
          },
          locations: [
            {
              id: "void-assault.destination-2",
              type: "any",
              min: 1,
              max: 1,
              selection: "one"
            }
          ],
          targets: [
            {
              id: "void-assault.enemy-unit",
              filter: { type: "unit", controller: "opponent" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "Move a friendly unit, then move an enemy unit. " +
    "(If they both move to a battlefield you don't control, you're the attacker.)"
} satisfies CardProgram;
