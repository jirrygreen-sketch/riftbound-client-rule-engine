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
 * Status: judge-required (revalidated 2026-10-17). The stun is executable
 * today (the golden test drives the real effect.stun primitive), but the
 * mandatory additional cost still cannot be charged on the merged path:
 * programs/play.ts translateCost only accepts kinds printed/activated/explicit
 * and explicitly rejects an `additional`/`additional-cost` kind or an
 * `additional` cost field, so it folds this clause into the *base* cost rather
 * than CostPlanInput.mandatoryAdditional (356.2.a vs 356.1). chain/engine.ts
 * finalize does consume `input.mandatoryAdditional` for target taxes, but
 * nothing produces that entry from a card program. Making the cost a body
 * instruction instead would resolve it at the wrong time (356.3/356.5) and
 * would let the spell resolve without paying, so that near-implementation is
 * refused. The declared payment also keeps cost/plan-values.ts' exact-ObjectRef
 * requirement: a static placeholder option throws "Cost requires an exact
 * object reference" during plan construction (RIFT-358 owns the pending
 * filter/ordered pick shape and is still unmerged).
 */
const kiBurst = {
  canonicalCardId: "card.hash-9b0c4b851a4af3d330a6b22579433d60ad39e8bb85ccc33f1b28ab2189ce2062",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处未合入依赖：(1)「As an additional cost to play this, exhaust a friendly unit.」在 356.2.a.1 下" +
    "是强制附加费用，但 programs/play.ts 的 translateCost 只接受 printed/activated/explicit，且显式拒绝 " +
    "additional / additional-cost kind 与 additional 字段（“Additional costs are not bound”），" +
    "因此这条被并入**基础**费用（356.1）而不是 CostPlanInput.mandatoryAdditional；chain/engine.ts 的 finalize " +
    "确实消费 input.mandatoryAdditional（当前只由 target-tax 生产），但没有把卡牌程序的附加费用子句转成该条目的生产方。" +
    "写成 body 指令会在错误时机结算（356.3/356.5）并允许不付费用就结算，故不近似实现。" +
    "(2) 费用内的非目标动态选择（355.10.c.1）仍缺：cost/plan-values.ts 的 choiceObjects 只读取精确 ObjectRef 的 options，" +
    "静态占位选项在构造费用计划时抛 “Cost requires an exact object reference”，不消费 choice.filter 中的友方就绪单位条件" +
    "（RIFT-358 的 filter/ordered pick 形状尚未合入）。effect.stun 已合入并有 golden 执行证据。",
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
