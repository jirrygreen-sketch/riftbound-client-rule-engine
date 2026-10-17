import type { CardProgram } from "../../ir/index.js";

/**
 * Drag Under (sfd-164-221) — Spell, 5 energy + 1 Order power, Order.
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   I cost :rb_energy_2: less to play from anywhere other than your hand.
 *   Kill a unit at a battlefield.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Action] (806) is declared as a keyword ability; the showdown permission
 *   is expanded by effects/keywords/Action.ts.
 * - "I cost 2 less to play from anywhere other than your hand" is a cost
 *   modification (366.2 / the cost-modify template): a static ability that
 *   alters the printed cost at Finalize while the card is outside the hand.
 *   The cost.modify instruction is merged, but programs/statics.ts has no
 *   layer mapping for it (layerFor throws judge-required), so a card's static
 *   cost effect never reaches CostPlanInput.discounts; the fromZone
 *   "any-except-hand" constraint also has no consumer, so the reduction
 *   cannot be applied as printed.
 * - "Kill a unit at a battlefield" is one target (355.10: "Kill a unit at a
 *   battlefield" targets the unit; "at a battlefield" is a restriction,
 *   355.10.b) executed with the merged effect.kill primitive.
 *
 * Status: judge-required because of the cost reduction only; the kill half is
 * fully expressible and is executed by the golden test.
 */
const dragUnder = {
  canonicalCardId: "card.hash-aaa1325feb0034c6e6408ff32eff79926e80a52b19fc29dfeffe6718b4ed6afe",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「I cost :rb_energy_2: less to play from anywhere other than your hand」是 Finalize 的印刷费用改写（CR v1.5 366.2，" +
    "ability-templates 的 cost-modify 模板）：cost.modify 指令原语本身已合入（runInstruction 可链接 reduce 折扣计划，本卡测试已执行），" +
    "但 statics.ts 的 layerFor 对 cost.modify 没有图层映射（直接 throw judge-required），" +
    "所以卡牌静态费用效果无法进入 CostPlanInput.discounts（缺静态能力→费用计划的图层/生产绑定），" +
    "且 fromZone: \"any-except-hand\" 这一打出区域约束也没有消费方；不近似实现。" +
    "「Kill a unit at a battlefield」半段用已合入的 effect.kill 表达并执行。",
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "I cost :rb_energy_2: less to play from anywhere other than your hand.\n" +
    "Kill a unit at a battlefield.",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "static",
      effect: {
        kind: "cost.modify",
        resource: "energy",
        amount: { kind: "constant", value: -2 },
        appliesTo: "self",
        fromZone: "any-except-hand"
      }
    },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 5 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          id: "drag-under.kill",
          op: "effect.kill",
          args: { target: { kind: "constant", value: "drag-under.unit" } },
          targets: [
            {
              id: "drag-under.unit",
              // "a unit at a battlefield": the location restriction, not a
              // separate battlefield target (355.10.b).
              filter: { type: "unit", locationType: "battlefield" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ]
} satisfies CardProgram;

export default dragUnder;
