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
 *   355.10.b) executed with the merged effect.kill primitive. The restriction
 *   now uses the merged TargetSpec.location filter (`{ type: "battlefield" }`,
 *   RIFT-357), which adds no target of its own, so no battlefield "becomes a
 *   target".
 *
 * Status: judge-required because of the cost reduction only; the kill half is
 * fully expressible and is executed by the golden test.
 */
const dragUnder = {
  canonicalCardId: "card.hash-aaa1325feb0034c6e6408ff32eff79926e80a52b19fc29dfeffe6718b4ed6afe",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺静态费用效果到 Finalize 费用计划的绑定（CR 366.2、356.4）：" +
    "cost.modify 指令已能生成折扣计划，但 programs/statics.ts 的 layerFor 对静态 kind \"cost.modify\" 直接抛出 " +
    "\"Static ability kind cost.modify has no layer mapping\"，卡牌静态折扣无法进入 CostPlanInput.discounts；" +
    "fromZone: \"any-except-hand\" 同样没有消费方，无法限定该效果只在此卡不在手牌时生效。" +
    "\"Kill a unit at a battlefield\" 已改用已合入的目标位置过滤（targets[].location: { type: \"battlefield\" }，355.10/355.10.b），" +
    "golden 经生产目标翻译与 Finalize 真实执行：战场单位被消灭、Base 单位被拒绝。不近似实现：不给战场本身另加选择目标，不把折扣写成固定费用。",
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
              // "a unit at a battlefield": the unit is the target and "at a
              // battlefield" is its location restriction, not a separate
              // battlefield target (355.10.b). The merged TargetSpec.location
              // filter carries it without adding another target.
              filter: { type: "unit" },
              location: { type: "battlefield" },
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
