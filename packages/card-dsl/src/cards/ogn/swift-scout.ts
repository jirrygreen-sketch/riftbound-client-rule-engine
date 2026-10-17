import type { CardProgram } from "../../ir/index.js";

/**
 * Swift Scout (ogn-263-298) — Legend, Mind/Chaos, tag Teemo.
 *
 * Printed text:
 *   You may pay :rb_energy_1: to hide a card with [Hidden] instead of
 *   :rb_rune_rainbow:.
 *   :rb_energy_1:, :rb_exhaust:: Put a Teemo unit you own into your hand from
 *   your Champion Zone or the board.
 *
 * Structure (contract 3.1/3.2):
 * - the first sentence is a replacement that rewrites the Hide cost of cards
 *   with [Hidden] (CR 811.1.b/c: Hide is a Discretionary Action whose printed
 *   cost is [A]); the hidden keyword itself is declared on the affected cards,
 *   not granted by this legend, so the legend hosts a replacement ability over
 *   the cost-payment event with the printed substitute cost 1 energy;
 * - the second sentence is an activated ability at action speed: cost = 1
 *   energy + exhaust this legend; "a Teemo unit you own" is a target
 *   restricted by owner/tag ("Teemo", CR 143.1 tags), drawn from
 *   the Champion Zone or the Board (CR 355.9.a.5: "unit in the Champion Zone"
 *   refers to a unit in the Champion Zone; 355.9.a.1: "unit" otherwise means a
 *   Board unit). "Put ... into your hand" is the return-to-hand game action.
 *
 * Status: judge-required.
 * cost.pay can pay the printed substitute of one energy. GameAction already
 * includes pay, but replacement/pattern.ts does not match a Hide-cost payment
 * and there is no complete Hide action/facedown lifecycle.
 * Returning an owned Teemo from the board works, including owner hand routing;
 * the Champion Zone is still absent from ZoneId/ObjectFilter.zone.
 */
const program = {
  canonicalCardId:
    "card.hash-275c83714004b04a02ea1ff6f9f629c0b77b0d086f67110ebc98b8056b99b7a6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Hide 费用替代仍缺拦截入口（CR 811.1.b/c）：GameAction 已有 pay，cost.pay 也能支付 1 能量，cost/kinds/hidden.ts " +
    "可规划 Hide 费用；但 replacement/pattern.ts 不接受 pay/hide/cost-payment 匹配，没有完整 Hide 行动与 " +
    "facedown 生命周期，故无法把该支付接入本卡的可选替代。第二句仍缺 Champion Zone（108.3/355.9.a.5）：ZoneId 与 " +
    "ObjectFilter.zone 无此区域，当前目标声明只覆盖 board。effect.zone 的 owner 手牌路由与 board 返回半段已可执行；不近似实现 " +
    "Champion Zone 或 Hide。",
  abilities: [
    {
      kind: "replacement",
      // The replaces.event discriminant is the survey's replacement.event
      // shape for the Hide cost payment; "cost-payment" is NOT a merged event
      // id (see judgeReason) and must be replaced by the real cost-pipeline
      // event before this ability is executable.
      replaces: {
        event: "cost-payment",
        filter: {
          kind: "hide",
          keyword: "Hidden",
          printedCost: "rune-rainbow"
        }
      },
      with: [
        {
          id: "swift-scout.substitute-hide-cost",
          op: "cost.pay",
          args: { payments: { kind: "constant", value: { energy: 1 } } }
        }
      ]
    },
    {
      kind: "activated",
      timing: "action",
      cost: {
        energy: { kind: "constant", value: 1 },
        payments: [{ kind: "exhaust" }]
      },
      body: [
        {
          id: "swift-scout.return-teemo",
          op: "effect.zone",
          args: {
            target: { kind: "constant", value: "teemo-unit" },
            to: { kind: "constant", value: "hand" }
          },
          targets: [
            {
              id: "teemo-unit",
              filter: {
                type: "unit",
                tags: ["Teemo"],
                owner: "controller",
                // Champion Zone + Board, per CR 355.9.a.5 / 108.3; the
                // contract has no Champion Zone id yet, so the zone set is the
                // missing piece recorded in judgeReason and the TODO.
                zone: ["board"]
              },
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
    "You may pay :rb_energy_1: to hide a card with [Hidden] instead of :rb_rune_rainbow:.\n" +
    ":rb_energy_1:, :rb_exhaust:: Put a Teemo unit you own into your hand from your Champion Zone or the board."
} satisfies CardProgram;

export default program;
