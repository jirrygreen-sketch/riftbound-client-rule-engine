import type { CardProgram } from "../../ir/index.js";

/**
 * King's Edict (ogn-237-298), CR v1.5 355.10.e / 355.18.
 * 当前复核：effect.kill 的非目标 picks 通道可执行；仍缺按回合顺序绑定其他玩家、
 * 累计本法术已选对象并把完整选择集交给 kill 的生产方。
 */
const kingsEdict = {
  canonicalCardId: "card.hash-b27ddd6f340335a3b0cd6b5ad2ba3cd49695bb3a7430d3cfe541271f528f0baf",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺按回合顺序的多玩家非目标选择：从下一位起逐位绑定 each other player，累计 hasn't been chosen for this spell" +
    "排除集合，在所有选择结束后将完整集合交给 effect.kill 的 picks（355.10.e/355.18）。" +
    "choice.each-other-player 未注册，解释器在此抛 Unregistered instruction opcode；" +
    "当前 choice/repeat 没有玩家迭代变量或跨迭代累计集合，dynamic:units-chosen-for-this-spell 也无生产方。",
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
