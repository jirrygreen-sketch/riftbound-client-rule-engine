import type { CardProgram } from "../../ir/index.js";

/**
 * Isolate (unl-124-219) — Spell, 2 energy, no printed power, Chaos.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-124-219, verbatim):
 *   "Move an enemy unit from a battlefield to its base. Then, if there's an
 *    enemy unit alone at that battlefield, draw 1."
 *
 * Rules evidence (Core Rules v1.5):
 * - "Move an enemy unit from a battlefield" is an effect Move whose object is a
 *   specific Board unit, so it is a target (355.7 / 355.9.a.1); "from a
 *   battlefield" restricts which units are legal rather than adding a target
 *   (355.10.b), and the merged `location: "battlefield"` spelling is the
 *   location restriction (ogn/gust, ogn/incinerate).
 * - "to its base" is the moved unit's own base: effect.move's `controller-base`
 *   destination routes to each object's controller's Base (107.1 / 152.1), so
 *   the move is a Move (421.1), not a Recall (457-460) — the card says "Move",
 *   so no Recall distinction is needed.
 * - "Then, if there's an enemy unit alone at that battlefield, draw 1" is a
 *   conditional instruction whose scope is that one instruction (contract 3.4).
 *   "alone" is defined by 740.2.a: no other friendly unit at the same location.
 *   Condition.compare/count can express a zero comparison; the missing part is
 *   the candidate-relative friendly count and a dynamic departure-location filter.
 *   effect.move already records movements.from, and target.location can read
 *   linked locations. Neither currently feeds that origin into a count filter.
 *   The authored draw remains descriptive; the judge-required registry guard
 *   blocks execution of the incomplete full body. Goldens execute each supported
 *   primitive and the ignored-target linkage, without claiming the gate works.
 * - "Draw 1" itself is the merged effect.draw primitive (414.1 / 414.3).
 * - The instruction is `linkedTo` the move: the draw's condition references the
 *   moved unit's departure site, so an ignored move ignores the draw too
 *   (359.3.e.14.a).
 *
 * status = judge-required (README section 2; current HEAD). The Move half is merged and
 * executed; the conditional draw is not approximated.
 *
 * Dependencies: candidate-relative alone counting and extraction/binding of
 * the move receipt's departure location into the draw condition (740.2.a).
 */
export default {
  canonicalCardId:
    "card.hash-8d444ce0c06f1ce192099e9e5c3536c1206c31baf2024d38fce35cd459545efc",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺结算时“有敌方单位 alone at that battlefield”的集合谓词接线（CR 740.2.a）：须对候选敌方单位检查该地点没有其他友方单位（740.1.a 包括同控制者及队友的单位），不能把所有玩家的单位总数当作友方数量。" +
    "ObjectFilter 缺动态地点 Expr 与候选相关的友方计数适配；还需从 effect.move receipt 的 movements.from 提取起点，并将地点值绑定到后续 count 过滤器。",
  abilities: [
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 }
      },
      body: [
        {
          id: "isolate.move-enemy-unit",
          op: "effect.move",
          args: {
            objects: {
              kind: "constant",
              value: { target: "isolate.enemy-unit-at-battlefield" }
            },
            // 「to its base」：各被移单位自己控制者的基地（107.1 / 152.1）。
            to: { kind: "constant", value: "controller-base" },
            amount: { kind: "constant", value: 1 },
            linkKey: { kind: "constant", value: "moved" }
          },
          targets: [
            {
              id: "isolate.enemy-unit-at-battlefield",
              // 「an enemy unit from a battlefield」：355.10.b 的 location 是限制，
              // 单位本身才是目标（355.7 / 355.9.a.1）。
              filter: {
                type: "unit",
                controller: "opponent",
                zone: "board",
                location: "battlefield"
              },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // 「Then, if there's an enemy unit alone at that battlefield, draw 1」：
          // 印刷的 if 闸门没有求值路径（见 judgeReason），本卡刻意不写条件，
          // 也不用恒真条件冒充（ogn/zaun-punk 同一口径）。linkedTo 是真实的指代
          // 关系（"that battlefield" 指上一条 Move 的战场），Move 被 ignored 时
          // 抽牌也 ignored（359.3.e.14.a）。
          id: "isolate.draw-if-alone",
          op: "effect.draw",
          linkedTo: "isolate.move-enemy-unit",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText:
    "Move an enemy unit from a battlefield to its base. " +
    "Then, if there's an enemy unit alone at that battlefield, draw 1."
} satisfies CardProgram;
