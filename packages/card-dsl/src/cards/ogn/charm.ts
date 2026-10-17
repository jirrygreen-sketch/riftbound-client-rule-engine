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
 * Destination still cannot be enumerated in the frozen IR:
 * - "Move an enemy unit" is a Move Effect: the enemy unit is a target
 *   (CR 355.7 / 355.10: an object named by the spell's text on the public
 *   board is Targeted), while the Destination is a separate choice made by
 *   the controller in Make Relevant Choices (CR 355.4 / 355.4.a: "choose a
 *   valid Location as the Move Destination"; a valid Location is one other
 *   than the Unit's current Location where it is allowed to be present).
 * - That Destination is only known at Finalize from the runtime board, and the
 *   merged effect.move still only
 *   accepts a static LocationRef, the literal "controller-base", or a static
 *   option list of LocationRefs in `{ kind: "choose", id, options }` —
 *   ObjectSelector only covers objects, not locations. The target/location
 *   candidate helpers exist, but effect.move's card-facing Finalize path does
 *   not consume them. The destination is therefore declared descriptively as a
 *   pending runtime choice, and legality of that choice (CR 449.2 / 451.1 /
 *   452, now structurally present in combat/flow.ts) has no card-facing
 *   destination provider. Not approximated with a fixed destination.
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
    "缺 Move Destination（目的地）的枚举路径：CR 355.4/355.4.a 要求移动效果在 Finalize 时由控制者从“当前位置之外、" +
    "且该单位被允许出现”的合法 Location 中选择目的地。已合入的 effect.move 的 to 只接受静态 LocationRef、字面量 " +
    "controller-base 或静态 LocationRef 候选列表（{ kind: \"choose\", id, options } 的 options 必须在 IR 里写死）；" +
    "ObjectSelector 只覆盖对象；虽然 target/location 已有候选计算，effect.move 的卡牌侧 Finalize 路径仍没有把这些候选接入，运行期合法集合无法表达。" +
    "combat/flow.ts 的 Standard Move/Contested 结构也不提供卡牌侧目的地枚举接口。" +
    "目标半段用已合入的 effect.move 表达并由 golden 真实执行；依赖 effect.move 的地点选择接线与卡牌侧目的地提供方。不近似实现目的地。",
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
