import type { CardProgram } from "../../ir/index.js";

/**
 * Life from Stone (rad-029-167) — Spell, 1 Energy, no printed Power, Calm.
 *
 * Printed text:
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   As an additional cost to play this, exhaust a friendly unit.
 *   Draw 1 and channel 1 rune exhausted.
 *
 * Rules evidence (Core Rules v1.5):
 * - 813 [Reaction] is a Permissive keyword (merged keywords/Reaction.ts); the
 *   card only declares it.
 * - "As an additional cost to play this, exhaust a friendly unit." — 356.2
 *   (mandatory additional cost, no "may") charged during the cost plan;
 *   355.10.c.1: a cost clause is not a target. Declared on the play ability's
 *   CostSpec as an "exhaust" payment with a non-targeting PickSpec over the
 *   controller's ready units — the merged cost planner's accepted shape for
 *   nonstandard object costs. Already-exhausted units are excluded because
 *   415.1.b forbids exhausting them again, so they could never pay 356.2's
 *   "must be able to be done" requirement.
 * - "Draw 1 and channel 1 rune exhausted." — one sentence with two joined
 *   actions: effect.draw (414.1) and effect.channel with the printed exhausted
 *   stipulation (431.1/431.2, "Channel 1 rune exhausted" is 431.2's own example).
 *   The channel is linked to the draw because "and" keeps them one clause.
 *   431.3 covers a short Rune Deck (channel as many as possible).
 *
 * Status: judge-required. Draw + channel are merged and executed for real in the
 * golden test, but the mandatory additional cost has no card-facing charging
 * path: chain Finalize builds cost plans from CostPlanInput and only ever
 * supplies `{ kind: 'printed' }` for a card's printed cost (chain/engine.ts),
 * so a card program's additional-cost clause is never turned into
 * mandatoryAdditional. No cost.additional / cost.pay primitive is merged
 * either — cost kinds and cost.pay / cost.modify are RIFT-261, and the
 * CardProgram cost binding is RIFT-257. Moving the cost into the body would
 * resolve it at the wrong time (356.3/356.5), so that near-implementation is
 * refused.
 */
const lifeFromStone = {
  canonicalCardId: "card.hash-0b434d5de4e3431420a6dddfc3ed5c57570643467c671f4efae850ed1f9905ea",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺「As an additional cost」的落地路径：CR 356.2 要求强制附加费用在费用计划阶段收取，但卡牌侧" +
    "只有 { kind: 'printed' } 会进入 buildCostPlan（chain/engine.ts finalize），没有已合入的适配器" +
    "把卡程序的附加费用子句转成 CostPlanInput.mandatoryAdditional，也没有 cost.additional / " +
    "cost.pay 原语（费用种类与 cost.pay / cost.modify 属 RIFT-261，卡程序绑定属 RIFT-257，" +
    "打出路径由协调任务的 describePlay 适配器持有）。写成 body 指令会在错误时机结算（356.3/356.5）" +
    "并允许不付费用就结算，故不近似实现。" +
    "Draw 1（effect.draw）与 channel 1 rune exhausted（effect.channel，CR 431.2）已合入并有" +
    "golden 执行证据；依赖：RIFT-261 + RIFT-257。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 1 },
        payments: [
          {
            // Mandatory additional cost (356.2): exhaust a friendly unit; not a
            // target (355.10.c.1). Resolved by the cost planner's pick path.
            kind: "exhaust",
            amount: { kind: "constant", value: 1 },
            choice: {
              id: "life-from-stone.exhausted-unit",
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
          id: "life-from-stone.draw-1",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        },
        {
          id: "life-from-stone.channel-1",
          op: "effect.channel",
          args: {
            amount: { kind: "constant", value: 1 },
            exhausted: { kind: "constant", value: true }
          },
          linkedTo: "life-from-stone.draw-1"
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "As an additional cost to play this, exhaust a friendly unit.\n" +
    "Draw 1 and channel 1 rune exhausted."
} satisfies CardProgram;

export default lifeFromStone;
