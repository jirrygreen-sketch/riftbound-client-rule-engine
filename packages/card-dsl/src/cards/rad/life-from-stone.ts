import type { CardProgram } from "../../ir/index.js";

/**
 * Life from Stone — CR v1.5 356.2.a.1, 355.10.c.1, 414.1, 431.2/431.3.
 * Reaction and the draw/channel body are supported. Both remaining boundaries
 * were re-probed against the merged source on 2026-10-17:
 * - programs/play.ts translateCost() turns cost.printed with payments into one
 *   explicit base cost ("cost.printed" loses its kind and keeps energy plus the
 *   payments), so the mandatory additional component cannot be separated from
 *   the base CostPlanInput entry; CR 356.5's base-only / all-cost distinctions
 *   and ignore-base mods therefore cannot tell them apart.
 * - cost/plan-values.ts choiceObjects() still maps choice.options through
 *   reference(), which only accepts "self" or a complete runtime ObjectRef, and
 *   never reads choice.filter; building the plan with the card's
 *   "ready-friendly-unit" placeholder throws "Cost requires an exact object
 *   reference". RIFT-358's ordered picks cover zoneSlice / linked sources, not
 *   this filtered board-object cost pick.
 * Keep the card judge-required until both bindings are present.
 */
const lifeFromStone = {
  canonicalCardId: "card.hash-0b434d5de4e3431420a6dddfc3ed5c57570643467c671f4efae850ed1f9905ea",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 CR 356.2.a.1 的强制附加费用绑定：programs/play.ts translateCost 把带 payments 的 cost.printed 转为 explicit " +
    "基础费用，未把横置费用分离为 mandatoryAdditional，无法保持 356.5 的基础费用/全部费用豁免区别。" +
    "另缺费用的非目标动态选择（355.10.c.1）：cost/plan-values.ts choiceObjects 仍只接受精确 ObjectRef 的 options，不消费 " +
    "choice.filter 中的友方就绪单位条件，用本卡的 ready-friendly-unit 占位符构造计划会抛 “Cost requires an exact object reference”；" +
    "RIFT-358 已合入的 ordered pick 只覆盖 zoneSlice/linked 来源，不含此处按 board filter 的费用选择。",
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
              filter: { zone: "board", type: "unit", controller: "self", states: "ready" }
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
