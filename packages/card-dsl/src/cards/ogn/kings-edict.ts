import type { CardProgram } from "../../ir/index.js";

/**
 * King's Edict (ogn-237-298), CR v1.5 355.10.e / 355.18.
 * Other players choose at resolution in turn order starting with the next
 * player; maintain one spell-wide exclusion set before killing the selected
 * units. These are non-target picks. programs/ and effect.kill are merged,
 * but the IR still lacks a dynamic other-player loop, per-chooser binding, and
 * accumulated exclusions. The descriptive choice.each-other-player remains
 * blocked until such an operation exists; ordinary target-plan support does
 * not coordinate those choices.
 */
const kingsEdict = {
  canonicalCardId: "card.hash-b27ddd6f340335a3b0cd6b5ad2ba3cd49695bb3a7430d3cfe541271f528f0baf",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺按回合顺序的多玩家非目标选择：从下一位玩家开始逐位绑定 each other player，" +
    "并在同一法术内累计 hasn't been chosen for this spell 排除集合；当前 repeat/choice 节点不提供动态玩家迭代变量或累计集合。" +
    "CR 355.10.e / 355.18 要求对手在结算期作 pick；choice.each-other-player 仍为待实现描述，effect.kill 已可执行。",
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
