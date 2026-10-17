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
 *   控制者选择（"该单位当前地点以外的合法 Location"）。
 * - 括号里的 "(If they both move to a battlefield you don't control, you're the attacker.)"
 *   是 reminder（466.2.c.1：把 Contested 状态施加到该战场的玩家成为 Attacker；466.2.c.2–c.3
 *   定义 Defender 与指定），不是本卡的独立指令；移动引发的 Showdown / Combat / Cleanup
 *   属 452–455 的流程，由内核负责。
 *
 * status = judge-required（不近似实现）：
 * 1. 目的地是运行期 Location 选择（355.4 / 355.4.a / 451.1），合并 IR 仍没有运行期
 *    Location 选择器（target.location 仍待 RIFT-357）；effect.move 的 to 只接受静态 LocationRef /
 *    controller-base / 静态候选列表，写死一个战场就是替玩家发明选择（与
 *    rad/sirens-song、ogn/ride-the-wind 的判定一致，依赖 RIFT-357）。
 * 2. 两次 Move 的 Finalize 选择（各自一个目的地）需要目标/目的地计划的顺序与重选支持；
 *    链的 Finalize 面目前只处理 instruction.targets 的 TargetSpec，并阻断嵌套目标
 *    （chain/engine.ts assertFinalizationSurface），依赖 RIFT-357 / RIFT-358。
 *
 * 可执行部分：effect.move 本身已合入；golden 用参考内核真实执行两条移动（含
 * "friendly / enemy 各自为目标" 的结构断言与调用方锁定的目的地）。
 */

/** 描述性目的地标记，不是可执行 LocationRef（见 judgeReason 第 1 点）。 */
const CHOSEN_DESTINATION = {
  kind: "destination-selector",
  filter: { type: "location" }
} as const;

export default {
  canonicalCardId: "card.hash-0dde19360e49952c6ec4a5b094d28bc2fde4ec115f51db8aa98e331b73edae1e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入，均不近似实现：(1) 原文没有印刷目的地，每个 Move 的目的地按 CR 355.4 / 355.4.a / 451.1 在 Finalize 由控制者选择，" +
    "合并 IR 仍没有运行期 Location 选择器（target.location 仍待 RIFT-357），effect.move 的 to 只接受静态 LocationRef / controller-base / 静态候选列表；" +
    "本卡只保留描述性目的地标记，解释器会拒绝该形状而不是把单位移到错误地点（与 rad/sirens-song、ogn/ride-the-wind 同一缺口）。" +
    "(2) 两次 Move 各自的目的地选择属于目标/目的地计划，链 Finalize 面目前只处理 instruction.targets 的 TargetSpec 并阻断嵌套目标" +
    "（chain/engine.ts assertFinalizationSurface），依赖 RIFT-357 / RIFT-358。" +
    "两次移动的被移动单位已按 355.7 / 355.9.a.1 / 355.10 声明为目标（friendly / enemy 各自的过滤条件），两条指令互相独立不写 linkedTo；" +
    "括号里的 attacker reminder 是 466.2.c.1–c.3 的流程结果，由内核负责，不当作本卡指令。effect.move 本身已合入，golden 真实执行两条移动。",
  abilities: [
    {
      kind: "play",
      body: [
        {
          id: "void-assault.move-friendly-unit",
          op: "effect.move",
          args: {
            objects: { kind: "constant", value: { target: "void-assault.friendly-unit" } },
            to: { kind: "constant", value: CHOSEN_DESTINATION },
            amount: { kind: "constant", value: 1 }
          },
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
            to: { kind: "constant", value: CHOSEN_DESTINATION },
            amount: { kind: "constant", value: 1 }
          },
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
