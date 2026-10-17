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
 * Destination still cannot be bound to the moving target's runtime candidate set:
 * - "Move an enemy unit" is a Move Effect: the enemy unit is a target
 *   (CR 355.7 / 355.10: an object named by the spell's text on the public
 *   board is Targeted), while the Destination is a separate choice made by
 *   the controller in Make Relevant Choices (CR 355.4 / 355.4.a: "choose a
 *   valid Location as the Move Destination"; a valid Location is one other
 *   than the Unit's current Location where it is allowed to be present).
 * - That Destination is only known at Finalize from the runtime board. Location
 *   selectors and candidate queries are merged, but the card-facing effect.move
 *   path still does not bind a destination selector to the chosen unit, exclude
 *   its current Location, or enforce the CR 449.2 / 451.1 legal-presence rules.
 *   The destination is therefore declared descriptively as a pending runtime
 *   choice, and legality of that choice has no production destination provider.
 *   Not approximated with a fixed destination.
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
    "缺 Move Destination（目的地）与移动目标的动态绑定：CR 355.4/355.4.a 要求移动效果在 Finalize 时由控制者从“当前位置之外、" +
    "且该单位被允许出现”的合法 Location 中选择目的地。LocationSelector 与候选查询已合入，但卡牌侧 effect.move 仍没有把目的地选择绑定到被移动目标、" +
    "排除其当前位置并接入 CR 449.2/451.1 的合法地点检查；当前 IR 只能保留描述性的 runtime choice。" +
    "Move 后的 Contested/Showdown/Combat/Cleanup 生产流程也仍属 combat/turn workstream。" +
    "目标半段用已合入的 effect.move 表达并由 golden 真实执行；依赖动态目的地桥接与 Move pipeline 接线。不近似实现目的地。",
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
            // this descriptive placeholder until a destination provider
            // (target/location candidates) enumerates real LocationRefs; the card
            // never picks a destination for the player (see judgeReason).
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
