import type { CardProgram } from "../../ir/index.js";

/**
 * Deathgrip (sfd-163-221) — Spell, 2 energy, Order.
 *
 * Printed text:
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Kill a friendly unit to give +:rb_might: equal to its Might to another
 *   friendly unit this turn. Draw 1.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Reaction] (813) is declared as a keyword ability; the timing permission
 *   itself is owned by effects/keywords/Reaction.ts and the chain module.
 * - "Kill a friendly unit" is a cost within the instruction (355.10.c.1,
 *   "[do X] to [do Y]"): it is not a target selection, so the killed unit is
 *   a non-target pick. The kill is executed with the merged effect.kill
 *   primitive through its `picks` argument (429.1 / 429.6).
 * - "give +[M] equal to its Might to another friendly unit this turn" is a
 *   temporary Might modification of a target, sized by the killed unit's
 *   Might. The amount read is expressible (the interpreter resolves the
 *   linked `killed` reference and 359.3.e.13 lets it look back at the Might
 *   the unit had before dying); what is missing is the instruction primitive
 *   itself: no merged op performs a temporary Might modification, and
 *   effect.buff only places CR 702 Buff counters, which its own header says
 *   are never a Might change.
 * - "Draw 1." is a separate sentence and stays unlinked: it still happens when
 *   the Might grant cannot (359.3.e.11 / 359.3.e.14.b).
 *
 * Status: judge-required. The kill cost, the target declaration, the linked
 * Might instruction and the independent draw are all described, and the draw
 * half is covered by the golden test; the Might half is not approximated with
 * Buff counters.
 */
const deathgrip = {
  canonicalCardId: "card.hash-1f41363528139c43d205b49bf3880604480befbe9f8d033db61f0618cecdf389",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺临时 Might 修正原语：契约 3.6 封闭 GameAction 集合没有 might 修改动作，effect.might-modify 未注册；" +
    "effect.buff 只处理 CR 702 Buff 计数，其文件头明确临时 Might 归 layers 的 continuous.might（图层系统未实现）。" +
    "「+[M] equal to its Might」的取值本身可经 effect.kill 的 killed 链接引用 + 359.3.e.13 回看表达，缺失的只是消费它的原语；" +
    "依赖：RIFT-83/84 与 RIFT-91（layers-continuous）。不近似实现。Draw 1 半段只用已合入的 effect.draw。",
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Kill a friendly unit to give +:rb_might: equal to its Might to another friendly unit this turn. Draw 1.",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      body: [
        {
          // "Kill a friendly unit to ...": the cost half of 355.10.c.1, read
          // as a non-target pick and submitted through effect.kill.
          id: "deathgrip.kill",
          op: "effect.kill",
          args: { picks: { kind: "constant", value: "deathgrip.fodder" } },
          picks: [
            {
              id: "deathgrip.fodder",
              options: ["friendly-unit-you-control"],
              min: 1,
              max: 1,
              selection: "one",
              filter: { type: "unit", controller: "controller" }
            }
          ]
        },
        {
          // "give +[M] equal to its Might to another friendly unit this turn" —
          // described with the layers contract shape and the amount read from
          // the kill result; no merged primitive consumes it (judgeReason).
          id: "deathgrip.grant-might",
          op: "effect.might-modify",
          linkedTo: "deathgrip.kill",
          args: {
            amount: {
              kind: "object-property",
              object: { linked: "deathgrip.kill" },
              property: "might"
            },
            duration: { kind: "constant", value: "this-turn" }
          },
          targets: [
            {
              id: "deathgrip.gifted-unit",
              // "another friendly unit": the killed unit is excluded through
              // the documented `exclude` anchor (contract 3.6 selectors).
              filter: {
                type: "unit",
                controller: "controller",
                exclude: { pick: "deathgrip.fodder" }
              },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "Draw 1." — a separate sentence, deliberately not linked to the
          // Might instruction (359.3.e.11: resolve as much as possible).
          id: "deathgrip.draw",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ]
} satisfies CardProgram;

export default deathgrip;
