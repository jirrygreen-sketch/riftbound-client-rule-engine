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
 *   restricted by owner/controller/tag ("Teemo", CR 143.1 tags), drawn from
 *   the Champion Zone or the Board (CR 355.9.a.5: "unit in the Champion Zone"
 *   refers to a unit in the Champion Zone; 355.9.a.1: "unit" otherwise means a
 *   Board unit). "Put ... into your hand" is the return-to-hand game action.
 *
 * Status: judge-required:
 * - the Hide-cost replacement needs a replacement hook over cost payment: the
 *   merged RIFT-260 binding matches closed GameAction events (move-zone, kill,
 *   ready, damage, play, reveal...), and neither the EventPattern vocabulary nor
 *   the closed GameAction set has a cost-payment/hide action (CR 422.1), so the
 *   substitute cost cannot be enforced and the ability stays declarative;
 * - the return instruction needs a zone-set target (Champion Zone + Board is
 *   not one of the Zones named in the contract's ZoneId; CR 108.3 Champion
 *   Zones are distinct) — the march of Champion-zone support belongs to the
 *   parent contract; nothing is approximated.
 */
const program = {
  canonicalCardId:
    "card.hash-275c83714004b04a02ea1ff6f9f629c0b77b0d086f67110ebc98b8056b99b7a6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "第一句是 Hide 费用的替代改写（CR 811.1.b/c：Hidden 卡的 Hide 印刷费为 [A]，本卡允许改付 1 能量）：需要能拦截“支付 Hide 费用”的替代钩子；" +
    "RIFT-260 的替代绑定只匹配封闭 GameAction 事件（move-zone/kill/ready/damage/play/reveal 等），EventPattern 与 GameAction 集合都没有费用支付/Hide 动作（CR 422.1），因此替代费用无法强制执行，只能保留声明。" +
    "第二句需要“Champion Zone 或 Board”的跨区域目标集合：契约 ZoneId 与 ObjectFilter.zone 均无 Champion Zone（CR 108.3），effect.zone 只按 target/pick 的单一目的地结算；champion 区域与 owner 路由是契约缺口，不近似实现。" +
    "依赖：费用支付时点的替代接入（RIFT-260 后续）、Hide 行动与 Champion Zone 的契约扩展（见回复的契约变更请求）。",
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
          args: { energy: { kind: "constant", value: 1 } }
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
