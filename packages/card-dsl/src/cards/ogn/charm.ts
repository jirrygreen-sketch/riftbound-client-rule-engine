import type { CardProgram } from "../../ir/index.js";

/**
 * Charm (ogn-043-298) — Spell, 1 energy + 1 Calm power (Calm).
 *
 * Printed text:
 *   Move an enemy unit.
 *
 * Catalog evidence (packages/card-data/data/deck-catalog.json, ogn-043-298):
 * cardType Spell, domains [Calm], energy 1, power 1, might null, tags [].
 * There is no [Action]/[Reaction] keyword on this printing, so the program
 * declares no speed keyword (CR v1.5 159.2 / 308.1.a: default spell timing).
 *
 * Status: judge-required — the instruction shape is authored, but the Move
 * Destination cannot be expressed in the frozen IR:
 * - "Move an enemy unit" is a Move Effect: the enemy unit is a target
 *   (CR 355.7 / 355.10: an object named by the spell's text on the public
 *   board is Targeted), while the Destination is a separate choice made by
 *   the controller in Make Relevant Choices (CR 355.4 / 355.4.a: "choose a
 *   valid Location as the Move Destination"; a valid Location is one other
 *   than the Unit's current Location where it is allowed to be present).
 * - That Destination is only known at Finalize from the runtime board, and
 *   the frozen IR has no way to enumerate it: effect.move's `to` accepts a
 *   static LocationRef, the literal "controller-base", or a static option
 *   list of LocationRefs (ObjectSelector only covers objects, not locations,
 *   and ResolveContext exposes no "legal move destinations" query). The
 *   destination is therefore declared descriptively as a pending runtime
 *   choice, and legality of that choice (CR 449.2 / 451.1 / 452) is not
 *   executable. Not approximated with a fixed destination.
 * - The Move pipeline itself (Destination restriction checks, Contested on
 *   452, Move-triggered Showdown/Combat on 453-454, Cleanup on 455) belongs to
 *   the turn/combat workstream (contract 7.2 batch 5); effect.move only
 *   submits the move-location GameAction.
 * The target half ("an enemy unit" → effect.move's objects selector) is
 * covered by the golden test through the merged effect.move primitive with a
 * caller-supplied Finalize destination, as the production caller must do.
 */
const charm = {
  canonicalCardId: "card.hash-cb202ce740ea23b09a039a51724a26f05a05cbd44cb1fb5692f72a7c406b4201",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 Move Destination（目的地）的表达：CR 355.4/355.4.a 要求移动效果在 Finalize 时由控制者" +
    "从“当前位置之外、且该单位被允许出现”的合法 Location 中选择目的地，而冻结的 IR 无法枚举它——" +
    "effect.move 的 to 只接受静态 LocationRef、字面量 controller-base 或静态 LocationRef 候选列表" +
    "（ObjectSelector 只覆盖对象，ResolveContext 也没有“合法移动目的地”查询）；" +
    "依赖 target.location 原语（ability-templates 的原语清单）与 Move 管线（CR 449.2/451.1/452/453-455，" +
    "契约 7.2 引擎批 5 Turn/Combat；当前无对应任务号）。目标半段用已合入的 effect.move 表达，不近似实现目的地。",
  sourceText: "Move an enemy unit.",
  abilities: [
    {
      kind: "play",
      body: [
        {
          id: "move-enemy-unit",
          op: "effect.move",
          args: {
            // "an enemy unit" — an ordinary target on the board.
            objects: { kind: "constant", value: { target: "enemy-unit" } },
            // "Move ..." — the Destination is chosen at Finalize from the
            // runtime-legal Locations (355.4.a). The frozen IR can only carry
            // this descriptive placeholder; effect.move would reject it, so
            // the instruction fails closed instead of picking a destination
            // for the player (see judgeReason).
            to: {
              kind: "constant",
              value: { kind: "choose", id: "charm.destination", options: ["runtime:valid-move-destination"] }
            }
          },
          targets: [
            {
              id: "enemy-unit",
              filter: { type: "unit", controller: "opponent" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ]
} satisfies CardProgram;

export default charm;
