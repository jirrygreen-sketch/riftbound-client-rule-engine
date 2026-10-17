import type { CardProgram } from "../../ir/index.js";

/**
 * Meditation (ogn-048-298) — Spell, 2 energy (Calm).
 *
 * Printed text:
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   As an additional cost to play this, you may exhaust a friendly unit.
 *   If you do, draw 2. Otherwise, draw 1.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Reaction] (813) is a keyword ability expanded by the keyword registry
 *   (contract 3.7); the card only names it.
 * - "As an additional cost to play this, you may exhaust a friendly unit" is an
 *   Optional Additional Cost (CR 204.2 / 356.2.b) chosen in Make Relevant
 *   Choices (355.1.a), and exhausting as a cost must be able to be completed
 *   for the cost to be paid (CR 415.4). The cost-to-effect binding is not a
 *   chain instruction: effect.exhaust's own header states that this scenario
 *   (415.4, naming this card) belongs to cost.exhaust and the finalized cost
 *   plan, not to the effect primitive. The merged cost planner accepts
 *   `exhaust` payments and optional additional components (the golden builds
 *   and pays the real plan), but `programs/play.ts` still rejects `cost.additional`
 *   instead of converting the declaration to a CostPlanInput.optionalAdditional entry,
 *   so the play pathway cannot see it even though the planner and receipt path can.
 * - "If you do, draw 2. Otherwise, draw 1." is the 359.2-style branch on the
 *   finalized cost result. The merged `condition.result` predicate reads the
 *   optional-additional receipt, so both draw branches are executable once a
 *   CostPlan and receipt are supplied. The remaining production gap is the
 *   play binder that must produce that plan from this card's declaration.
 */
const meditation = {
  canonicalCardId: "card.hash-5f2d6f607453430a6a4ce49c58ea5afd8af16815ac3b16ed3cdf9526ba7f074f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺“可选追加费用（Optional Additional Cost）”的表达：CR 204.2/356.2.b 与 355.1.a 规定它在 Finalize 的选择阶段决定，" +
    "且按 CR 415.4 必须以“能够完成”为前提（费用式横置属于 cost.exhaust，effect.exhaust 文件头也把这场景划给费用计划）；" +
    "合并的费用计划能构造并支付 exhaust 支付动作与 optional-additional 组件（golden 已验证真实支付），" +
    "但 programs/play.ts 仍拒绝本卡的 cost.additional 声明，没有把它转换成 CostPlanInput.optionalAdditional 条目，" +
    "打出流程因此看不到这条可选费用。" +
    "费用结果分支已由 condition.result（CR 359.2）与已合入的费用回执读取支持，golden 可真实执行付费/拒付两条 draw 分支；" +
    "仍缺 programs/play.ts 将 cost.additional 转换为 CostPlanInput.optionalAdditional，打出流程因此不能从本卡声明生成该费用计划。" +
    "依赖：cost.additional → CostPlanInput.optionalAdditional 的生产接线。不近似实现。",
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "As an additional cost to play this, you may exhaust a friendly unit. " +
    "If you do, draw 2. Otherwise, draw 1.",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      // "you may exhaust a friendly unit" as an additional cost (CR 204.2 /
      // 356.2.b / 415.4). Declared with the cost-plan payment vocabulary so
      // the intent is reviewable; the merged planner accepts the component,
      // while the play binder still does not construct it from this declaration.
      cost: {
        kind: "cost.additional",
        payments: [
          {
            kind: "cost.exhaust",
            choice: {
              id: "meditation.exhaust-choice",
              // Options are exact ObjectRefs at Finalize; the printed cost
              // names "a friendly unit", so the choice is over the
              // controller's units and the frozen IR cannot enumerate them
              // statically. The placeholder records the intended selection
              // shape only.
              options: ["runtime:controller-units"],
              selection: "one",
              filter: { type: "unit", controller: "controller" }
            }
          }
        ]
      },
      body: [
        {
          // “If you do, draw 2” — the paid additional cost is the gate
          // (CR 359 result branch); condition.result reads the finalized
          // optional-cost receipt supplied by the chain resolver.
          id: "draw-2-if-paid",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 2 } },
          condition: {
            kind: "result",
            result: "additional-cost-paid",
            id: "meditation.exhaust"
          }
        },
        {
          // “Otherwise, draw 1” — the decline branch. The two branches stay
          // mutually exclusive through the negated receipt predicate.
          id: "draw-1-otherwise",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } },
          condition: {
            kind: "not",
            condition: {
              kind: "result",
              result: "additional-cost-paid",
              id: "meditation.exhaust"
            }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

export default meditation;
