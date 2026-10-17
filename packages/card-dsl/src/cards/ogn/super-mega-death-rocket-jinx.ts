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
 *   [return this]" makes the discard a COST paid inside the instruction
 *   (355.10.c.1), and the return is the effect (423.3 vs 423.4 for the cost/effect
 *   distinction).
 *
 * Status: judge-required. The conquer ability cannot be executed with merged
 * pieces:
 * - the ability functions from the Trash (CR 366.1: passive/triggered abilities of
 *   cards outside the Board self-describe their context). The card IR has no
 *   activation-zone field for an ability: `TriggerSpec` carries only
 *   at/filter/condition/once, and the trigger pipeline defaults a source's active
 *   zone to `board` (events/pipeline.ts), so "from your trash" cannot be declared;
 * - there is still no `cost.discard` instruction opcode (the cost plan supports a
 *   discard *payment* through buildCostPlan, but no registered primitive consumes
 *   it from an ability body; effect.discard is the effect-discard form of 423.4
 *   and must not stand in for the cost of 423.3);
 * - "return this ... to your hand" references the ability's own source card while
 *   it sits in the Trash. effect.zone only accepts `target`/`pick` ids
 *   (TargetSpec/PickSpec), so contract 3.6's symbolic `source`/`self` selector has
 *   no path into a zone-moving primitive.
 */
const superMegaDeathRocket = {
  canonicalCardId: "card.hash-a5df5886eb5ce4de01ecdbffd7bd2e4840f75ad0546a27a1428d719100e5f2ad",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "从弃牌堆起作用的触发能力缺声明位：CR 366.1 的自述区域在卡程序里没有字段" +
    "（TriggerSpec 只有 at/filter/condition/once，events/pipeline.ts 的触发源区域默认 ['board']），无法声明「在 trash 中生效」；" +
    "缺已注册的 cost.discard 指令原语：费用模块能以 buildCostPlan 规划 discard 支付，但没有原语供能力 body 调用" +
    "（423.3 的费用式弃牌不能用 423.4 的 effect.discard 代替）；" +
    "「return this ... to your hand」指向来源卡自身，而 effect.zone 只接受 target/pick 的 id，" +
    "契约 3.6 的 source/self 选择器没有进入移区原语的路径。" +
    "Deal 5 部分已用 effect.damage 表达并有执行测试。依赖：RIFT-257（CardProgram 触发绑定）、" +
    "RIFT-261（cost.discard 指令化）与 trash 自述区域的触发注册。不近似实现。",
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
      // your hand." The may is the trigger's optionality; the body is the cost
      // (missing primitive) followed by the return (needs a source selector).
      kind: "triggered",
      trigger: { at: "conquer", filter: { event: "conquer", player: "controller" } },
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
