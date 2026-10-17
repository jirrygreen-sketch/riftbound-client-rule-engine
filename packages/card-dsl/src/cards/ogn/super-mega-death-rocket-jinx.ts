import type { CardProgram } from "../../ir/index.js";

/**
 * ogn-252-298 Super Mega Death Rocket!, Jinx (Spell, Fury/Chaos,
 * 4 energy + 1 power, tags Jinx / Signature) — RIFT-143 shard 8.
 *
 * Catalog evidence (deck-catalog.json, dataVersion 2026-10-12-official-gallery):
 * cardType Spell, domains ["Fury", "Chaos"], energy 4, power 1, might null.
 *
 * Printed text:
 *   Deal 5 to a unit.
 *   When you conquer, you may discard 1 to return this from your trash to your hand.
 *
 * Modeling notes (Core Rules v1.5):
 * - "Deal 5 to a unit" is a normal targeted damage instruction (355.7 on the
 *   Board, 418.1.c/418.6.a) and is executable; it is covered by a real test.
 * - The second sentence is a triggered ability whose "you may" is the optionality
 *   of the whole clause (contract 3.1 `triggered.optional`): "[discard 1] to
 *   [return this]" makes the discard a leading COST paid before Finalize
 *   (383.3.b/b.1), and the return is the effect (423.3 vs 423.4 for the cost/effect
 *   distinction).
 *
 * Status: judge-required.
 * Deal 5 to a unit is executable as a targeted play effect (355.7/418.1).
 * The optional conquer ability functions from trash (385.1/385.2, whose
 * example names this card). Its leading discard cost must be paid before
 * Finalize (383.3.b/b.1), rather than while resolving the body (423.3/423.4).
 * cost.pay and discard CostPlans exist; triggered-cost extraction and trash
 * activation-zone declarations do not. The source return remains unbound.
 * The conquer event uses the supported conquered pattern. The blocked body
 * records printed intent without moving payment into resolution.
 */
const superMegaDeathRocket = {
  canonicalCardId: "card.hash-a5df5886eb5ce4de01ecdbffd7bd2e4840f75ad0546a27a1428d719100e5f2ad",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 trash 自述区域的触发声明与程序绑定（CR 385.1/385.2）：Spell 的 conquer 触发仍默认 activeZones:chain，" +
    "TriggeredAbility 无区域字段。discard 1 作为领先费用必须在 Finalize 前支付（383.3.b/383.3.b.1、423.3）；" +
    "虽有 TriggerRegistration.cost 与 discard CostPlan，TriggeredAbility 仍无费用声明，programs/triggers.ts 也不提取领先费用。" +
    "cost.discard 仅为占位，不能改为结算期 cost.pay/effect.discard。effect.zone 只收 target/pick，仍缺 source/self " +
    "非目标返回选择器绑定；dynamic:this-card-in-trash 不是可执行选择。不近似实现。",
  abilities: [
    {
      kind: "play",
      body: [
        {
          id: "rocket-damage",
          op: "effect.damage",
          args: {
            amount: { kind: "literal", value: 5 },
            target: { kind: "literal", value: "rocket-unit" }
          },
          targets: [
            { id: "rocket-unit", filter: { type: "unit" }, min: 1, max: 1, selection: "one" }
          ]
        }
      ]
    },
    {
      // "When you conquer, you may discard 1 to return this from your trash to
      // your hand." The may is optionality. These blocked placeholders record
      // the leading cost (must move to Finalize) and the source return.
      kind: "triggered",
      trigger: { at: "conquer", filter: { event: "conquered", player: "controller" } },
      optional: true,
      body: [
        {
          id: "rocket-discard-cost",
          op: "cost.discard",
          args: {
            amount: { kind: "literal", value: 1 },
            player: { kind: "literal", value: "controller" },
            choiceId: { kind: "literal", value: "rocket-discard" }
          }
        },
        {
          id: "rocket-return",
          op: "effect.zone",
          linkedTo: "rocket-discard-cost",
          args: {
            pick: { kind: "literal", value: "rocket-source" },
            to: { kind: "literal", value: "hand" }
          },
          picks: [
            {
              id: "rocket-source",
              options: ["dynamic:this-card-in-trash"],
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
    "Deal 5 to a unit.\n" +
    "When you conquer, you may discard 1 to return this from your trash to your hand."
} satisfies CardProgram;

export default superMegaDeathRocket;
