import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Shimmering Swimmer (rad-014-167) — Unit, Fury, 3 energy / 3 Might.
 *
 * 原文（deck-catalog rad-014-167，逐字）：
 *   "You may kill a friendly unit or gear as an additional cost to play me.\nWhen you play
 *    me, if you paid the additional cost, deal 2 to a unit."
 *
 * Rule basis (CR v1.5):
 * - The optional additional cost (356.2.b) is declared in the play CostSpec as
 *   kind "additional" with a kill payment; the in-cost object choice is not a
 *   target (355.10.c) and uses a PickSpec.
 * - "if you paid the additional cost" (356.2.b.1) now reads the finalized cost
 *   plan/receipt through the merged Condition kind "result"
 *   (selectedAdditional / declinedAdditional); the instruction is not rewritten
 *   as a player choice.
 * - "When you play me, if you paid ..." is a separate mandatory card-played
 *   trigger. Its payment predicate belongs to the trigger condition, not the
 *   damage instruction (383.2.a.1 / 383.4.a / 420.4.a).
 * - "deal 2 to a unit": one-unit TargetSpec plus effect.damage 2 (418.1.c).
 * - The catalog has energy 3, power null: no Power cost is invented.
 *
 * Status: judge-required, re-reviewed 2026-10-17. The merged payment
 * predicate: the golden test builds a real optional cost plan, pays it (or
 * declines it), and evaluates this program's condition against the real
 * plan/receipt, so both branches are honestly decided. Remaining gaps include
 * the play-side translation bridge: buildCostPlan already supports
 * optionalAdditional and cost/payment.ts supports kill payments, and
 * chain/engine.ts finalize already calls buildCostPlan/payCostPlan, but
 * programs/play.ts translateCost rejects the optional field and additional
 * kind, so a CardProgram's declared optional cost
 * still cannot enter the play cost plan. The original play plan/receipt also
 * is not carried into the subsequent card-played trigger's condition context.
 * Dependencies: additional-cost translation in programs/play.ts and carrying
 * the original play cost result into the event trigger condition context.
 */
const abilities: Ability[] = [
  {
    kind: "play",
    cost: {
      kind: "additional",
      optional: true,
      payments: [
        {
          kind: "kill",
          choice: {
            id: "shimmering-swimmer.additional-cost",
            options: ["friendly-unit-or-gear"],
            filter: { controller: "controller", type: ["unit", "gear"], zone: "board" },
            min: 1,
            max: 1,
            selection: "one"
          }
        }
      ]
    },
    body: []
  },
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { self: true },
      condition: {
        kind: "result",
        result: "additional-cost-paid",
        id: "shimmering-swimmer.additional-cost"
      }
    },
    optional: false,
    body: [
      {
        id: "shimmering-swimmer.deal-2",
        op: "effect.damage",
        args: {
          amount: { kind: "constant", value: 2 },
          target: { kind: "constant", value: "shimmering-swimmer.unit" }
        },
        targets: [
          {
            id: "shimmering-swimmer.unit",
            filter: { zone: "board", type: "unit" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-05acd78d132bf8780fd8fba892925f17226694182298a6fdeac69e8a824941e1",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺打出侧的可选附加费用翻译桥（不近似实现）：buildCostPlan 支持 optionalAdditional、" +
    "cost/payment.ts 支持 kill 付款、chain/engine.ts 的 finalize 已调用 buildCostPlan/payCostPlan，" +
    "但 programs/play.ts 的 translateCost 拒绝 optional 字段（Unsupported play cost field optional），且 kind:\"additional\" 也未绑定，" +
    "CardProgram 声明的附加费用仍无法进入打出费用计划。已合入的费用结果谓词（condition.result）让" +
    "“if you paid the additional cost”可执行（condition.result + id 读取 selectedAdditional/declinedAdditional），" +
    "golden 用真实费用计划验证支付/未支付两侧；effect.kill 与 effect.damage 也已由真实解释器执行。" +
    "383.2.a.1/383.4.a/420.4.a 要求付款条件属于独立 card-played 触发条件，IR 已修正；" +
    "chain/engine.ts 的 card-played 事件没有原打出费用计划/回执，触发项的 condition.result 无法读取该次付款。" +
    "依赖：附加费用翻译桥及打出付款结果向 Play Effect 的传递；模板 play-effect-damage-659 的整卡场景仍 pending。",
  abilities,
  sourceText:
    "You may kill a friendly unit or gear as an additional cost to play me.\n" +
    "When you play me, if you paid the additional cost, deal 2 to a unit."
} satisfies CardProgram;

export default program;
