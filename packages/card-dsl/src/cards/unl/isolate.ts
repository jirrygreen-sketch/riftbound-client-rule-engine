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
 *   "alone" is defined by 740.2.a (a unit is alone when there are no other
 *   friendly units at the same location), and "that battlefield" refers back to
 *   the battlefield the moved unit came from. Two things are unmerged:
 *   1. "alone" is not a filter key: the frozen ObjectFilter can compare
 *      type/tag/controller/zone/location and the merge's anchor keys, but there
 *      is no "no other friendly unit at the same location" predicate, and no
 *      Condition form expresses emptiness of a set (rad/demon-shade records the
 *      same gap for "if there are no open battlefields");
 *   2. "that battlefield" must be read from the first instruction's actual
 *      result. The frozen IR has object-valued selectors only, and the merge has
 *      no location-valued linked read (sfd/azir-sovereign reads a source's own
 *      location through a condition.value, which does not name the site the
 *      moved unit left).
 *   The draw instruction is therefore deliberately left ungated instead of
 *   carrying an invented condition that would always evaluate true (the same
 *   choice ogn/zaun-punk and ogn/clockwork-keeper record for their unreadable
 *   gates). The golden test executes the Move half and the merged effect.draw
 *   primitive, and the printed gate stays a test.todo.
 * - "Draw 1" itself is the merged effect.draw primitive (414.1 / 414.3).
 * - The instruction is `linkedTo` the move: the draw's condition references the
 *   moved unit's departure site, so an ignored move ignores the draw too
 *   (359.3.e.14.a).
 *
 * status = judge-required (README section 2; current HEAD). The Move half is merged and
 * executed; the conditional draw is not approximated.
 *
 * Dependencies: an "alone" (740.2.a) / set-emptiness predicate and a
 * location-valued result read from a previous instruction (the current
 * condition and linked-result contracts still lack both shapes; the same gap
 * rad/demon-shade records).
 */
export default {
  canonicalCardId:
    "card.hash-8d444ce0c06f1ce192099e9e5c3536c1206c31baf2024d38fce35cd459545efc",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Then, if there's an enemy unit alone at that battlefield, draw 1」的从句无法求值，两处缺口均不近似实现：" +
    "(1)「alone」按 740.2.a 是「同一地点没有其他友方单位」的判定：冻结的 ObjectFilter 只能逐键比较 " +
    "type/tag/controller/zone/location 与合并的锚点键，没有该谓词；Condition 也没有表达集合为空的形态" +
    "（rad/demon-shade 记录了「if there are no open battlefields」的同一缺口）。本文件不写恒真 condition，" +
    "golden 只执行 Move 与 Draw 原语并保持该门控待接线，而不是无条件抽牌；" +
    "不删掉「alone」冒充无条件抽牌，也不用位置计数替代 740.2.a 的只算友方口径。" +
    "(2)「that battlefield」需要读取上一条 Move 的实际起止地点：冻结 IR 只有对象选择符，合并内核没有“地点值”的链接读取" +
    "（sfd/azir-sovereign 只能读来源自身的位置，命名不了被移单位离开的战场）。" +
    "依赖：740.2.a 的 alone / 集合空判定谓词与上一条指令的地点结果读取；当前 condition 与 linked-result 契约仍缺这两种形态。" +
    "已合入并由 golden 真实执行的部分：effect.move（421.1，enemy unit → controller-base）与 effect.draw（414.1/414.3）；" +
    "两条指令保持 linkedTo（359.3.e.14.a：Move 被 ignored 时抽牌也 ignored）。",
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
