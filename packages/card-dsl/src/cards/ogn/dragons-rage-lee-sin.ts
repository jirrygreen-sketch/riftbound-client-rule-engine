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
 * Status: judge-required — measured 2026-10-17:
 * - 388.1/388.2/389.1/389.2, 355.5.b: the second choice belongs to a Reflexive
 *   Trigger that creates its own Pending Item. No merged ability or instruction
 *   form creates one: `trigger.reflexive` is not in the instruction registry
 *   (the interpreter throws "Unregistered instruction opcode: trigger.reflexive").
 * - "another enemy unit at its destination" uses the sameLocationAs and exclude
 *   target anchors, and programs/filters.ts translateObjectFilter still throws
 *   "Unsupported filter field sameLocationAs" when this card's own program goes
 *   through describePlay, so the mutual-damage half cannot be bound as written:
 *   no producer resolves the moved unit's destination or excludes the moved unit
 *   during Finalize/Resolve.
 * The Move Destination now uses the merged target.location selector: the
 * instruction declares a runtime Location choice and consumes it through a
 * LocationExpr. It is covered by the golden execution below; this removes the
 * former static-placeholder gap without claiming the missing reflexive item.
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
    "两段缺口（均为 2026-10-17 实测，不近似实现）：" +
    "(1) 反身触发无创建者：「Then choose another enemy unit at its destination」按 S-ORIGINS 勘误属于反身触发" +
    "（388.1/388.2/389.1/389.2、355.5.b：第二个目标由新 Pending Item 自行 Finalize，不是在原咒语的 Finalize 选择），" +
    "而已合入的 IR 没有任何创建反身 Pending Item 的能力/指令形态——trigger.reflexive 不在指令注册表中" +
    "（解释器抛 Unregistered instruction opcode: trigger.reflexive）。" +
    "(2) 第二个单位的目标合法性依赖第一步 Move 的实际结果：目标过滤器使用 sameLocationAs 与 exclude 锚点，" +
    "而 programs/filters.ts 的 translateObjectFilter 对本卡自己的程序抛" +
    "「Unsupported filter field sameLocationAs」，describePlay 无法产出可定案的草稿，" +
    "也没有生产者把「被移动单位的目的地」与「排除被移动单位」接入 Finalize/Resolve。" +
    "本地目录仍是旧文本（无「Then do this:」），刷新目录带有勘误文本；这是资料问题。" +
    "Move 的 runtime 目的地选择（target.location）与互伤半段的 effect.damage（动态 amount/source）本身已合入并由 golden 执行。",
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
            // 355.4 / 355.4.a: choose a runtime-valid destination, then feed
            // the selected LocationRef into effect.move.
            to: {
              kind: "location",
              value: { kind: "target-location", target: "dragons-rage.destination" }
            }
          },
          locations: [
            {
              id: "dragons-rage.destination",
              type: "any",
              controller: "opponent",
              min: 1,
              max: 1,
              selection: "one"
            }
          ],
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
              // moved unit's Location, excluding the moved unit itself. Both
              // anchors are rejected by the production binder today (see
              // judgeReason), so this target cannot be finalized in production.
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

