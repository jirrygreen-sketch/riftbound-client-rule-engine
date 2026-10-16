import type { CardProgram } from "../../ir/index.js";

/**
 * Ahri, Alluring (ogn-066-298) — Unit, 5 energy + 1 Calm power, Might 4.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-066-298):
 *   When I hold, you score 1 point.
 *
 * Rules evidence (Core Rules v1.5):
 * - "When I hold" is a Hold Effect (383.4.d, 383.4.d.1): the unit must be
 *   present at a Battlefield while its controller maintains control and gains
 *   a Victory Point during their Beginning Phase (383.4.d.2.a; 471.2, 473.2.b).
 *   The merged closed timing enum has `hold` for exactly this, and the
 *   eligibility wording ("must have been present during the Hold") is the
 *   trigger filter's job.
 * - "you score 1 point" grants one point to the ability's controller; the
 *   merged GameAction vocabulary has a `score` action ({ player, amount }),
 *   and the survey maps "score 1 point" to the effect.score primitive
 *   (22 identities). Reward/points accounting (470.1, 470.2) stays in the
 *   engine.
 *
 * Status: judge-required. Both halves are missing from the merged code:
 * - the `hold` timing point has no emitter: the merged scoring path
 *   (scoring/scoring.ts scoreDuelBattlefield) returns a scoring outcome and
 *   emits no trigger timing, and the duel turn executor treats hold as its own
 *   internal step name — nothing emits the pipeline `hold` event, so the
 *   trigger cannot enter the chain (P0 contract 7.2 batch 5 / scoring).
 * - there is no effect.score instruction file: effects/instructions/ has no
 *   score primitive (running under a separate workstream), so the "score 1
 *   point" instruction has no registered opcode. The description below names
 *   `effect.score` per the survey so reviewers can see the intended shape; it is
 *   deliberately NOT registered here, and the golden test keeps it as a
 *   documented TODO rather than approximating points with another action
 *   (e.g. gain-energy or a direct state write would both be wrong).
 */
export default {
  canonicalCardId: "card.hash-4f9cef9a5292a16fac59206baa263b0654606faa95119ee4a76583f82b2a4dac",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "(1) hold 时点（383.4.d、471.2/473.2.b）没有已合入的发射方：scoring/scoring.ts 的 scoreDuelBattlefield 不发射触发管线时点，" +
    "duel 侧只把 hold 当作自己的内部步骤名，触发无法进入链；" +
    "(2) 没有 effect.score 原语文件（effects/instructions/ 无 score 定义，由独立任务实现），「you score 1 point」没有可注册的 opcode，" +
    "下方按调研（ability-templates.md 的 effect.score，22 个身份）写出目标形状，绝不拿 gain-energy 或直接改状态冒充点数。" +
    "依赖：hold/scoring 时点发射（P0 契约 7.2 批 5 / scoring 工作流）与 effect.score 原语。不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "hold",
        filter: { event: "hold", filter: { source: "self" } }
      },
      optional: false,
      body: [
        {
          // "you score 1 point" — the survey's effect.score shape (game action
          // `score`); the opcode has no merged implementation yet (judgeReason).
          id: "ahri-alluring.score-1",
          op: "effect.score",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText: "When I hold, you score 1 point."
} satisfies CardProgram;
