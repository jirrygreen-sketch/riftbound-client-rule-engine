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
 * - "Give a unit +3 :rb_might: this turn" is a temporary Might modification
 *   with an end-of-turn duration: the merged layers arithmetic effect
 *   `continuous.might` (RIFT-258) with duration "this-turn". It is not a Buff
 *   counter (CR 702; effect.buff keeps that boundary). "a unit" is a target
 *   (355.9.b); "this turn" is the duration of the modification.
 * - "This costs :rb_energy_2: less if ..." is a cost modification of this card
 *   (356.x cost stages 5.1: the discount is applied while the plan is built),
 *   gated on an event history: "you've played a unit or gear to a battlefield
 *   this turn".
 *
 * Status: judge-required — the Might clause is executable and covered by the
 * golden test, but the printed discount cannot be installed or gated yet:
 * - the card-static cost modification has no consumer: cost/cost-plan.ts only
 *   applies discounts supplied by the caller in CostPlanInput.discounts, and
 *   the current static-program binder does not translate this effect into that
 *   per-play cost plan;
 * - the gate needs an event history with an object filter ("a unit or gear")
 *   and the play destination ("to a battlefield"). HistoryQuery (contract 3.8)
 *   carries `objectFilter` and is reachable only through the
 *   `condition.history` instruction, which cannot gate a static cost effect;
 *   the play destination is still not part of the query. The gate below stays
 *   a descriptive constant that must not be executed.
 * Dependencies: a CardProgram-static-to-CostPlan discount binding plus a
 * play-destination history predicate for the discount gate.
 * Not approximated: the discount is declared, never silently applied.
 */
export default {
  canonicalCardId: "card.hash-6241ef3881abbc30d79cdaf37ca912ade70c601045279aed082fc727f4ace85c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Give a unit +3 :rb_might: this turn」已可执行（continuous.might 的 arithmetic 图层 + end-of-turn 期限，RIFT-258；golden 用解释器 + 图层引擎真实执行）。" +
    "整卡仍不可执行：「This costs :rb_energy_2: less if you've played a unit or gear to a battlefield this turn」需要两件当前缺口——" +
    "(1) 把卡牌 static 减费安装进打出时的费用计划：cost/cost-plan.ts 只在调用方显式提供 CostPlanInput.discounts 时应用折扣，" +
    "当前 static-program binder 尚未把该效果翻译成每次打出的费用计划；" +
    "(2) 减费条件的事件历史表达：「本回合把单位或装备打到战场」需要带对象过滤（单位/装备）与落点（战场）的 HistoryQuery；" +
    "契约 3.8 的 objectFilter 只经 condition.history 指令可达，无法门控 static 费用效果，落点谓词也仍缺失，故减费条件只能写成描述性常量（不得执行）。" +
    "依赖：CardProgram-static-to-CostPlan 绑定与打出落点历史谓词。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      // "This costs :rb_energy_2: less if you've played a unit or gear to a
      // battlefield this turn." — an energy discount on this card, applied
      // while the cost plan is built. The condition is descriptive only: the
      // static cost binding and the history query it needs are not expressible
      // yet (see judgeReason), and a wrong gate would silently apply or drop
      // the discount.
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
          // "Give a unit +3 Might this turn": one positive temporary Might
          // modification in the arithmetic layer, expiring at end of turn.
          id: "hold-em.give-plus-3-might",
          op: "continuous.might",
          args: {
            objects: { kind: "constant", value: { kind: "target", id: "unit" } },
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
