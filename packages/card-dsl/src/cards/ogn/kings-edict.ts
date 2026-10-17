import type { CardProgram } from "../../ir/index.js";

/**
 * King's Edict (ogn-237-298), CR v1.5 355.10.e / 355.18.
 * 复核（2026-10-17，第三轮 M2 覆盖率复核）：
 * - 已合入：effect.kill 原语（含 picks 通道，355.10.e 的非目标选择）与 RIFT-257 的程序绑定；
 *   golden 用真实原语把 picks 里的单位杀掉并断言 Trash 与事件数。
 * - 仍缺（整卡不可执行）：`choice.each-other-player` 不是已注册原语——已实测
 *   instructionDefinitionsById 不含该 op，用解释器执行本卡正文直接抛
 *   “Unregistered instruction opcode: choice.each-other-player”。
 *   355.10.e / 355.18 要求：从下一位玩家开始按回合顺序**逐位**绑定 each other player，
 *   并在同一法术内累计 hasn't been chosen for this spell 的排除集合。当前 repeat/choice
 *   节点没有动态玩家迭代变量，也没有跨迭代的累计集合；target-plan 也不协调这种多选者流程。
 *   该原语不在本任务 write scope。
 */
const kingsEdict = {
  canonicalCardId: "card.hash-b27ddd6f340335a3b0cd6b5ad2ba3cd49695bb3a7430d3cfe541271f528f0baf",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺按回合顺序的多玩家非目标选择原语：CR 355.10.e / 355.18 要求从下一位玩家开始逐位绑定 " +
    "each other player，并在同一法术内累计 hasn't been chosen for this spell 排除集合。" +
    "choice.each-other-player 未注册——已实测 instructionDefinitionsById 不含该 op，解释器执行本卡正文抛 " +
    "Unregistered instruction opcode；当前 repeat/choice 节点没有动态玩家迭代变量或跨迭代累计集合，" +
    "target-plan 也不协调多选者流程。该原语不在本卡 write scope。" +
    "已合入并真实执行：effect.kill 的 picks 通道（355.10.e 的非目标选择）与程序绑定（RIFT-257）。不近似实现。",
  abilities: [
    {
      kind: "play",
      body: [
        {
          // "Starting with the next player, each other player chooses a unit you
          // don't control that hasn't been chosen for this spell." The chooser
          // order, the chooser set and the per-spell exclusion are the pending
          // primitive's payload; the chosen objects are picks, not targets.
          id: "kings-edict-choose",
          op: "choice.each-other-player",
          args: {
            startingWith: { kind: "literal", value: "next-player" },
            choosers: { kind: "literal", value: "each-other-player" },
            setKey: { kind: "literal", value: "kings-edict-chosen" },
            choose: {
              kind: "literal",
              value: {
                type: "unit",
                controller: "opponent",
                notChosenForThisSpell: true
              }
            }
          }
        },
        {
          // "Kill those units." — merged effect.kill consuming the units the
          // other players chose (non-target picks).
          id: "kings-edict-kill",
          op: "effect.kill",
          linkedTo: "kings-edict-choose",
          args: { picks: { kind: "literal", value: "kings-edict-units" } },
          picks: [
            {
              id: "kings-edict-units",
              options: ["dynamic:units-chosen-for-this-spell"],
              min: 0,
              max: null,
              selection: "any",
              filter: { type: "unit", controller: "opponent" }
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "Starting with the next player, each other player chooses a unit you don't control " +
    "that hasn't been chosen for this spell. Kill those units."
} satisfies CardProgram;

export default kingsEdict;
