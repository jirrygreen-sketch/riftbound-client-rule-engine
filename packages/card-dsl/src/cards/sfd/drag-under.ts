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
 *   No cost.modify instruction primitive is merged in this checkout (the
 *   cost.* op batch is RIFT-261, unmerged HEAD), and the Finalize cost plan
 *   reads discounts only from caller-supplied CostPlanInput.discounts, never
 *   from a card's static ability (RIFT-257 binding), so the reduction cannot
 *   be applied.
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
    "ability-templates 的 cost-modify 模板）：当前没有已合入的 cost.modify 指令原语（cost.* 指令批次 RIFT-261 未合入 HEAD），" +
    "Finalize 的费用计划只从调用方提供的 CostPlanInput.discounts 读取折扣（cost/cost-plan.ts），没有把卡牌静态费用效果接进计划的" +
    "生产方（卡牌程序绑定 RIFT-257），也没有能宣告「来源不在手牌」这一打出区域的持续效果消费方；不近似实现。" +
    "依赖：RIFT-261（cost.modify/cost.pay 指令）、RIFT-257（卡牌静态效果→费用计划的绑定）。" +
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
