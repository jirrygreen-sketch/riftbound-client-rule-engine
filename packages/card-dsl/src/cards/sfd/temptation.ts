import type { CardProgram } from "../../ir/index.js";

/**
 * Temptation (sfd-129-221) — Spell, 2 energy, no printed power, Chaos.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-129-221, verbatim):
 *   "[Repeat] :rb_energy_2: (You may pay the additional cost to repeat this
 *    spell's effect.)
 *    Move an enemy unit to a location where there's a unit with the same
 *    controller."
 *
 * Rules evidence (Core Rules v1.5):
 * - "[Repeat] :rb_energy_2:" (820.1.c) is an Optional Additional Cost: the
 *   printed component is declared on the play ability's CostSpec in the merged
 *   sfd/danger-zone / sfd/frigid-touch shape (356.2.b.1). The merged program
 *   play binding does not collect it: programs/play.ts translateCost rejects
 *   kind "additional-cost" and the detached `keyword`/`additional` fields, so
 *   describePlay cannot produce a payable Repeat component. Cost-plan
 *   optionalAdditional has no card-program producer.
 * - "Move an enemy unit" is an effect Move (451, not the Standard Move of 144
 *   and not a Recall of 457/458): the named unit is chosen by the spell's
 *   controller in the public Board zone, so it is a Target (355.7 /
 *   355.9.a.1), and "enemy" is its targeting restriction (355.9.b).
 * - "to a location where there's a unit with the same controller" is the Move
 *   Destination: 355.4/355.4.a has the controller choose a valid runtime
 *   Location, and the merged LocationTargetSpec/LocationExpr path now supplies
 *   that choice to effect.move. The remaining gap is the per-Location occupant
 *   test that must compare the occupants' controller with the moved unit's
 *   controller; the location declaration therefore conservatively enumerates
 *   occupied Locations and keeps that relation in judgeReason.
 * - The spell has no [Action]/[Reaction] line: spells default to Action timing
 *   (159.2.a), so no speed keyword is declared.
 *
 * Status (cards/README.md §2): judge-required. The enemy target and effect.move
 * body are executable when a Finalize-selected LocationRef is supplied. Two
 * printed details still lack production consumers: the same-controller
 * occupant predicate for the destination, and the optional Repeat
 * additional-cost collector. The program uses the merged runtime Location
 * choice and never substitutes a fixed Location.
 */

/**
 * 该地点声明使用已合入的运行期 Location 选择；`hasUnits` 覆盖当前可表达的占用地点半段，
 * 同控制者占用者关系仍记录在 judgeReason 中。
 */
const temptation = {
  canonicalCardId: "card.hash-472f50f62c82089c0d50baa218635f3214bbef1e2eb24fc259ec1761a6a9eb19",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍有两个真实缺口：(1)「to a location where there's a unit with the same controller」的运行期 Location " +
    "枚举与 effect.move 动态目的地解释已经合入，但 LocationTargetSpec 仍不能按被移动单位的 controller " +
    "筛选地点占用者；(2) [Repeat] :rb_energy_2: 的可选追加费用" +
    "尚未由 play Finalize 收取并把已付费实例数接到结算重复执行。enemy 目标、effect.move 本体与程序绑定已合入，" +
    "地点选择使用已合入的运行期 LocationTargetSpec，不固定目的地，也不手工执行第二次效果。",
  abilities: [
    {
      kind: "play",
      cost: {
        // 印刷基础费用 2 Energy、无 Power 由卡牌身份在 Finalize 绑定（356.1.c）；
        // 这里只声明 [Repeat] :rb_energy_2:（820.1.c）的可选追加费用（无消费方，见 judgeReason）。
        kind: "additional-cost",
        keyword: "repeat",
        energy: { kind: "literal", value: 2 }
      },
      body: [
        {
          id: "temptation.move-enemy-unit",
          op: "effect.move",
          locations: [
            {
              id: "temptation.destination",
              type: "any",
              hasUnits: true,
              min: 1,
              max: 1,
              selection: "one"
            }
          ],
          args: {
            objects: {
              kind: "constant",
              value: { target: "temptation.enemy-unit" }
            },
            // Runtime Location choice is supplied by Finalize; the missing
            // same-controller occupant predicate remains in judgeReason.
            to: {
              kind: "location",
              value: { kind: "target-location", target: "temptation.destination" }
            },
            amount: { kind: "constant", value: 1 }
          },
          targets: [
            {
              id: "temptation.enemy-unit",
              filter: { type: "unit", zone: "board", controller: "opponent" },
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
    "[Repeat] :rb_energy_2: (You may pay the additional cost to repeat this spell's effect.)\n" +
    "Move an enemy unit to a location where there's a unit with the same controller."
} satisfies CardProgram;

export default temptation;
