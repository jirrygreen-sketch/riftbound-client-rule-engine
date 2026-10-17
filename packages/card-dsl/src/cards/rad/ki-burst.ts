import type { CardProgram } from "../../ir/index.js";

/**
 * Ki Burst (rad-028-167) — Spell, 1 Energy, no printed Power, Calm.
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   As an additional cost to play this, exhaust a friendly unit.
 *   [Stun] a unit. (It doesn't deal combat damage this turn.)
 *
 * Rules evidence (Core Rules v1.5):
 * - 806 [Action] / 159.2.a default spell timing: declared as the merged
 *   { kind: "keyword", keyword: "action" }.
 * - "As an additional cost to play this, exhaust a friendly unit." — 356.2
 *   places mandatory additional costs in the cost plan (they use "as an
 *   additional cost" without "may", 356.2.b); 355.10.c.1 makes the exhaust a
 *   cost, NOT a target (the card names no target for it). The cost is declared
 *   on the play ability's CostSpec with kind "exhaust" and a non-targeting
 *   PickSpec over the controller's ready units, which is exactly the shape the
 *   merged cost planner accepts for nonstandard object costs (cost/plan-values
 *   readCost: "exhaust", with a choice PickSpec, non-targeting private choice).
 *   A cost object must be selectable, so the filter excludes already-exhausted
 *   units (415.1.b: an exhausted object cannot be exhausted again, so it could
 *   never satisfy 356.2's "must be able to be done" requirement).
 * - "[Stun] a unit." — 424.1 stuns one or more Board units; "a unit" is a
 *   target (355.7/355.10), which the merged effect.stun accepts as a TargetSpec
 *   (its own documentation names "Stun an enemy unit at a battlefield" as the
 *   target form). 424.1.b (a stunned unit deals no combat damage and is a
 *   defender exception) belongs to the combat layer, not to this card.
 *
 * Status: judge-required. The stun is executable today (the golden test drives
 * the real effect.stun primitive), but the mandatory additional cost cannot be
 * charged: the merged chain Finalize builds cost plans from CostPlanInput and
 * the card-facing path only ever supplies `{ kind: 'printed' }` (chain/engine.ts
 * finalize). There is no merged adapter that turns a card program's printed
 * "as an additional cost" clause into a CostPlanInput.mandatoryAdditional
 * entry, and no cost.additional / cost.pay primitive is merged either — the
 * cost-kind vocabulary and cost.pay / cost.modify belong to RIFT-261, and the
 * CardProgram binding to RIFT-257. Making the cost a body instruction instead
 * would resolve it at the wrong time (356.3/356.5) and would let the spell
 * resolve without paying, so that near-implementation is refused.
 */
const kiBurst = {
  canonicalCardId: "card.hash-9b0c4b851a4af3d330a6b22579433d60ad39e8bb85ccc33f1b28ab2189ce2062",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺「As an additional cost」的落地路径：CR 356.2 要求强制附加费用在费用计划阶段收取，但卡牌侧" +
    "只有 { kind: 'printed' } 会进入 buildCostPlan（chain/engine.ts finalize），没有已合入的适配器" +
    "把卡程序的附加费用子句转成 CostPlanInput.mandatoryAdditional，也没有 cost.additional / " +
    "cost.pay 原语（费用种类与 cost.pay / cost.modify 属 RIFT-261；卡程序绑定属 RIFT-257，" +
    "打出路径由协调任务的 describePlay 适配器持有）。写成 body 指令会在错误时机结算（356.3/356.5）" +
    "并允许不付费用就结算，故不近似实现。effect.stun 已合入并有 golden 执行证据；依赖：RIFT-261 + RIFT-257。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 1 },
        payments: [
          {
            // Mandatory additional cost (356.2): exhaust a friendly unit. Not a
            // target (355.10.c.1); the pick is resolved by the cost planner.
            kind: "exhaust",
            amount: { kind: "constant", value: 1 },
            choice: {
              id: "ki-burst.exhausted-unit",
              options: ["ready-friendly-unit"],
              min: 1,
              max: 1,
              selection: "one",
              zone: "board",
              type: "unit",
              controller: "self",
              states: "ready"
            }
          }
        ]
      },
      body: [
        {
          id: "ki-burst.stun-unit",
          op: "effect.stun",
          args: { target: { kind: "constant", value: "ki-burst.unit" } },
          targets: [
            {
              id: "ki-burst.unit",
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
    "As an additional cost to play this, exhaust a friendly unit.\n" +
    "[Stun] a unit. (It doesn't deal combat damage this turn.)"
} satisfies CardProgram;

export default kiBurst;
