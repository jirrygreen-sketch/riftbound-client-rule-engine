import type { CardProgram } from "../../ir/index.js";

/**
 * Dragon's Rage, Lee Sin (ogn-258-298) — Spell, 4 energy + 1 Calm power
 * (Calm/Body, Lee Sin Signature).
 *
 * Printed text (packages/card-data/data/deck-catalog.json, ogn-258-298):
 *   Move an enemy unit. Then choose another enemy unit at its destination.
 *   They deal damage equal to their Mights to each other.
 *
 * Catalog note: the existing data-issue triage reports
 * that the official Origins errata adds a reflexive-trigger boundary here
 * ("Then do this:" after the Move) and that the refreshed catalog carries it;
 * the local snapshot (dataVersion 2026-10-12-official-gallery) still holds the
 * older standalone "Then choose ..." wording, used verbatim above per the task
 * requirement. The errata wording is what makes the second choice happen when
 * the reflexive item is finalized (355.5.b), so the structure below is the
 * post-errata one and the difference is reported as a data issue.
 *
 * Modeling notes (Core Rules v1.5):
 * - "Move an enemy unit" is a Move Effect: the unit is a target and the
 *   Destination is a separate choice among the runtime-legal Locations
 *   (355.4 / 355.4.a / 451.1).
 * - "Then choose another enemy unit at its destination" pairs the moved unit
 *   with a second enemy unit at the moved unit's Location ("another" is the
 *   exclude anchor, "at its destination" the sameLocationAs anchor).
 * - "They deal damage equal to their Mights to each other" is two Deal actions
 *   whose sources are the units themselves (418.6.b.3) with the amounts read
 *   from the units' Might at resolution (contract 3.6). Static IR cannot hold a
 *   runtime ObjectRef, so each source reads ObjectSnapshot.ref through an
 *   object-property expression over its selector.
 *
 * Status: judge-required — three dependencies are not merged:
 * - the second choice belongs to a Reflexive Trigger (388.1 / 388.2 / 389.1 /
 *   389.2): the errata boundary creates a new Pending Item that makes its own
 *   target selection, which is not the spell's Finalize selection (355.5.b).
 *   No merged ability or instruction form creates a reflexive Pending Item;
 *   the missing primitive is a reflexive Pending Item.
 * - the Move Destination cannot be expressed in the frozen IR (355.4.a): the
 *   merged effect.move destination accepts a static LocationRef, the literal
 *   "controller-base", a static option list, or an Expr that the primitive
 *   itself evaluates — and its static object expressions only accept runtime
 *   ObjectRefs, so "the destination the player chose for the Move" has no
 *   authorable form. The instruction carries the same fail-closed placeholder
 *   the merged Charm (ogn-043-298) uses instead of guessing a Location.
 * - "another enemy unit at its destination" is a target whose legality depends
 *   on the first Move's actual result; that ordering is the target/reflexive
 *   lifecycle work, not card data.
 * The mutual-damage clause itself uses only merged primitives (effect.damage
 * with dynamic amount and source) and is executed by the golden test. Not
 * approximated: the second unit is not chosen at the spell's Finalize and the
 * Move is not given a made-up destination.
 */
const dragonsRage = {
  canonicalCardId: "card.hash-5db2b31990da2ad96271bf74f4d78f1ae9ef9c614ec7bcec1735b3cc17f301ae",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三段依赖未合入：(1)「Then choose another enemy unit at its destination」按 S-ORIGINS 勘误属于反身触发" +
    "（388.1/388.2/389.1/389.2、355.5.b：第二个目标由新 Pending Item 自行 Finalize，不是在原咒语的 Finalize 选择），" +
    "已合入的 IR 没有任何创建反身 Pending Item 的能力/指令形态，需要新增 trigger.reflexive；" +
    "(2)「Move an enemy unit」的目的地无法表达：355.4/355.4.a 要求移动效果在 Finalize 从运行时合法 Location 中选择，" +
    "已合入的 effect.move 只接受静态 LocationRef、字面量 controller-base、静态候选列表，或其自身能求值的 Expr" +
    "（静态对象的 object-property 只接受运行时 ObjectRef），因此写成与已合入 Charm 相同的 fail-closed 占位符，不臆造目的地；" +
    "(3) 第二个单位的目标合法性依赖第一步 Move 的实际结果，属目标/反身生命周期工作。" +
    "本地目录仍是旧文本（无「Then do this:」），刷新目录带有勘误文本，而本地 catalog 仍是旧文本；这是资料问题。" +
    "互伤半段只用已合入的 effect.damage（动态 amount/source）并由 golden 执行，不近似实现缺失部分。",
  sourceText:
    "Move an enemy unit. Then choose another enemy unit at its destination. " +
    "They deal damage equal to their Mights to each other.",
  abilities: [
    {
      kind: "play",
      body: [
        {
          id: "move-enemy-unit",
          op: "effect.move",
          args: {
            objects: { kind: "constant", value: { target: "moved-unit" } },
            // "Move an enemy unit" — the Destination is a Finalize-time choice
            // among the runtime-legal Locations (355.4.a). The frozen IR cannot
            // enumerate them, so this is the merged Charm placeholder shape:
            // effect.move rejects it instead of moving the unit somewhere made up.
            to: {
              kind: "constant",
              value: {
                kind: "choose",
                id: "dragons-rage.destination",
                options: ["runtime:valid-move-destination"]
              }
            }
          },
          targets: [
            {
              id: "moved-unit",
              filter: { type: "unit", controller: "opponent" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          id: "damage-moved-unit",
          op: "effect.damage",
          linkedTo: "move-enemy-unit",
          args: {
            // "They deal damage equal to their Mights to each other" — the
            // moved unit's Might at resolution (contract 3.6).
            amount: {
              kind: "object-property",
              object: { target: "moved-unit" },
              property: "might"
            },
            // The unit itself is the source of its damage (418.6.b.3).
            source: {
              kind: "object-property",
              object: { target: "moved-unit" },
              property: "ref"
            },
            target: { kind: "constant", value: "other-unit-there" }
          },
          targets: [
            {
              id: "other-unit-there",
              // "another enemy unit at its destination": an enemy unit at the
              // moved unit's Location, excluding the moved unit itself.
              filter: {
                type: "unit",
                controller: "opponent",
                sameLocationAs: { target: "moved-unit" },
                exclude: { target: "moved-unit" }
              },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          id: "damage-other-unit",
          op: "effect.damage",
          linkedTo: "damage-moved-unit",
          args: {
            amount: {
              kind: "object-property",
              object: { target: "other-unit-there" },
              property: "might"
            },
            source: {
              kind: "object-property",
              object: { target: "other-unit-there" },
              property: "ref"
            },
            target: { kind: "constant", value: "moved-unit" }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

export default dragonsRage;

