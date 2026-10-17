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
 *   and pays the real plan), but the frozen CostSpec (contract 3.1) has no
 *   field for an "optional additional exhaust one friendly unit" component and
 *   no merged producer reads the card's `cost.additional` declaration into a
 *   CostPlanInput.optionalAdditional entry, so the play pathway cannot see it
 *   (RIFT-257/261).
 * - "If you do, draw 2. Otherwise, draw 1." is the 359.2-style branch on the
 *   cost result: effect.draw x2 and effect.draw x1 are both merged (and both
 *   execute in the golden), but the discriminator needs the paid-cost result
 *   (condition.result, 46 identities in the survey) plus the branch container,
 *   which the frozen IR has no binding for. Not approximated: neither the
 *   unconditional draw nor a guessed draw amount is written as the card's
 *   effect.
 */
const meditation = {
  canonicalCardId: "card.hash-5f2d6f607453430a6a4ce49c58ea5afd8af16815ac3b16ed3cdf9526ba7f074f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺“可选追加费用（Optional Additional Cost）”的表达：CR 204.2/356.2.b 与 355.1.a 规定它在 Finalize 的选择阶段决定，" +
    "且按 CR 415.4 必须以“能够完成”为前提（费用式横置属于 cost.exhaust，effect.exhaust 文件头也把这场景划给费用计划）；" +
    "合并的费用计划能构造并支付 exhaust 支付动作与 optional-additional 组件（golden 已验证真实支付），" +
    "但冻结的 CostSpec（契约 3.1）没有承载“可选：横置一个友方单位”组件的位置，也没有生产方读取本卡的 cost.additional 声明" +
    "生成 optionalAdditional 条目（RIFT-257/261 程序/费用绑定），打出流程因此看不到这条可选费用。" +
    "后续“If you do, draw 2. Otherwise, draw 1.”需要按费用结果分支" +
    "（condition.result 一类结果绑定，调研 46 个身份），当前 IR 没有该绑定；effect.draw 本身已合入但分支无法判定。" +
    "依赖：RIFT-257/261（费用绑定与原语）+ 费用回执结果绑定（condition.result 属原语清单未合入项）。不近似实现。",
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
      // the intent is reviewable; no merged consumer accepts an optional
      // additional exhaust component (see judgeReason).
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
          // "If you do, draw 2" — the paid additional cost is the gate
          // (CR 359 result branch); condition.result / the cost receipt
          // binding is not merged, so this instruction cannot be executed.
          id: "draw-2-if-paid",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 2 } },
          condition: {
            kind: "expression",
            // "If you do" reads whether the optional additional cost was
            // paid (CR 355.1.a / 356.2.b). The cost receipt is not exposed to
            // ResolveContext, so this descriptive characteristic read fails
            // closed (MissingInformation → ignored) instead of drawing.
            value: {
              kind: "object-property",
              object: "source",
              property: "meditation.additional-cost-paid"
            }
          }
        },
        {
          // "Otherwise, draw 1" — the decline branch. The two branches must
          // stay mutually exclusive; the merged IR has no result binding to
          // express that, so this stays descriptive as well.
          id: "draw-1-otherwise",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } },
          condition: {
            kind: "not",
            condition: {
              kind: "expression",
              value: {
                kind: "object-property",
                object: "source",
                property: "meditation.additional-cost-paid"
              }
            }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

export default meditation;
