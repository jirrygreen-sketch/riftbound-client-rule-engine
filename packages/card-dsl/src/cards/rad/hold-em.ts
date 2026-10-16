import type { CardProgram } from "../../ir/index.js";

/**
 * rad-070-167 Hold 'Em (Spell, 3 energy, Body).
 *
 * Catalog evidence (packages/card-data/data/deck-catalog.json,
 * dataVersion 2026-10-12-official-gallery, printing rad-070-167):
 * energy 3, power null, might null, domains ["Body"], tags [].
 * `power: null` means there is no printed power; the cost declares energy only
 * and never rewrites the missing power as 0 (cards README section 2).
 *
 * Printed text (verbatim, sourceText):
 *   "[Action] (Play on your turn or in showdowns.)
 *    This costs :rb_energy_2: less if you've played a unit or gear to a
 *    battlefield this turn.
 *    Give a unit +3 :rb_might: this turn."
 *
 * Rules reading (CR v1.5):
 * - [Action] (806) is declared as a keyword ability; the timing permission
 *   itself is owned by the keyword registry and the chain.
 * - "This costs :rb_energy_2: less if ..." is a cost modification of this
 *   card (356.x cost stages 5.1: the discount is applied while the plan is
 *   built), gated on an event history: "you've played a unit or gear to a
 *   battlefield this turn".
 * - "Give a unit +3 :rb_might: this turn" is a temporary Might modification
 *   with an end-of-turn duration (layers arithmetic, continuous.might; not a
 *   Buff counter, see CR 702 and effect.buff's stated boundary). "a unit" is a
 *   target (355.9.b); "this turn" is the duration of the modification.
 *
 * Status: judge-required. Two gaps:
 * - no merged instruction performs a temporary Might modification; the layers
 *   consumer (continuous.might) is unmerged (RIFT-91), so the body uses that
 *   descriptive, unregistered op;
 * - the discount gate needs an event history with an object filter ("a unit or
 *   gear") and the play destination ("to a battlefield"). `HistoryQuery`
 *   (contract 3.8) only has scope / action / timingPoint / player / object plus
 *   the proposed `exclude` and `objectFilter`, and the interpreter's
 *   history.ts rejects unknown fields, so neither the unit-or-gear filter nor
 *   "to a battlefield" can be stated yet (RIFT-89/90). The gate below is a
 *   descriptive constant that must not be executed.
 */
export default {
  canonicalCardId: "card.hash-6241ef3881abbc30d79cdaf37ca912ade70c601045279aed082fc727f4ace85c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺临时 Might 修正原语：“Give a unit +3 :rb_might: this turn”需要 continuous.might（图层 arithmetic，" +
    "end-of-turn 期限）；effect.buff 只加 CR 702 的 Buff 计数，不能代替 Might 值修改，layers 消费者未合入（依赖 RIFT-91）。" +
    "另缺减费条件的事件历史表达：“你本回合把单位或装备打到战场”需要带对象过滤（单位/装备）与落点（战场）的 " +
    "HistoryQuery；当前 HistoryQuery 只有 scope/action/timingPoint/player/object 且 history.ts 拒绝未知字段" +
    "（契约 3.8 的 objectFilter 尚未落地，依赖 RIFT-89/90），故减费条件只能写成描述性常量，不得执行。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      // "This costs :rb_energy_2: less if you've played a unit or gear to a
      // battlefield this turn." — an energy discount on this card, applied
      // while the cost plan is built. The condition is descriptive only: the
      // history query it needs is not expressible yet (see judgeReason), and a
      // wrong gate would silently apply or drop the discount.
      kind: "static",
      effect: {
        kind: "continuous.cost-modification",
        resource: "energy",
        amount: { kind: "constant", value: -2 },
        minimum: { kind: "constant", value: 0 },
        appliesTo: "self"
      },
      condition: {
        kind: "expression",
        value: {
          kind: "constant",
          value: {
            history: "cards-you-played-this-turn",
            scope: "turn",
            action: "play",
            player: "controller",
            objectTypes: ["unit", "gear"],
            to: "battlefield"
          }
        }
      }
    },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 3 }
      },
      body: [
        {
          // "Give a unit +3 Might this turn" — one positive temporary Might
          // modification; the layers op is not registered yet (judgeReason).
          id: "hold-em.give-plus-3-might",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 3 },
            duration: { kind: "constant", value: "this-turn" }
          },
          targets: [
            {
              id: "unit",
              filter: { type: "unit", zone: "board" },
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
    "[Action] (Play on your turn or in showdowns.)\n" +
    "This costs :rb_energy_2: less if you've played a unit or gear to a battlefield this turn.\n" +
    "Give a unit +3 :rb_might: this turn."
} satisfies CardProgram;
