import type { CardProgram } from "../../ir/index.js";

/**
 * Find Your Center — CR v1.5 194.3/194.3.a, 356.4, 414.3 and 431.
 * Action timing, discount planning, Draw and Channel movement are merged.
 * The cost/discounts collector is merged; Finalize still needs its binding and a condition expression
 * reading the current per-mode Victory Score; never substitute a fixed 8.
 */
const findYourCenter = {
  canonicalCardId: "card.hash-e3ecc6164765d02357568348735bbb2eb8e6ed9a6a919fd16c4dde83bf5c765e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍有三处当前生产缺口：programs/statics.ts 的 layerFor 不接受 cost.modify，programs/play.ts 未绑定活跃费用来源，" +
    "chain/engine.ts 的 Finalize 仍直接调用 buildCostPlan，未接入已合入的 cost/discounts.finalizeCostPlan（CR 356.4）；" +
    "该收集器仍拒绝本卡的命名条件，对手 score 与模式 Victory Score 的差值没有已接线的状态适配，" +
    "不能把命名字符串当作成立或硬编码默认 8（CR 194.3/194.3.a）。" +
    "effect.channel 已提交 exhausted:true，但 effects/testing/test-kernel.ts 的 channel-rune 分支只换区、" +
    "未应用该入场状态，尚不能证明横置入场（CR 431.2）。",
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "If an opponent's score is within 3 points of the Victory Score, this costs " +
    ":rb_energy_2: less.\n" +
    "Draw 1 and channel 1 rune exhausted.",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      // "this costs [2] less" — declared as the cost-plan discount shape;
      // Finalize still needs to collect this static discount (see judgeReason).
      kind: "static",
      effect: {
        kind: "cost.modify",
        amount: { kind: "constant", value: -2 },
        resource: "energy",
        appliesTo: "play-cost"
      },
      // "If an opponent's score is within 3 points of the Victory Score" — a
      // named predicate with no merged provider (CR 194.3 / 194.3.a: the
      // Victory Score is per-mode state, defaulting to 8 and alterable). The
      // placeholder is deliberately not a comparison against a hard-coded 8.
      condition: {
        kind: "expression",
        value: { kind: "constant", value: "opponent-score-within-3-of-victory-score" }
      }
    },
    {
      kind: "play",
      body: [
        {
          id: "draw-1",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        },
        {
          id: "channel-1-exhausted",
          op: "effect.channel",
          args: {
            amount: { kind: "constant", value: 1 },
            exhausted: { kind: "constant", value: true }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

export default findYourCenter;
