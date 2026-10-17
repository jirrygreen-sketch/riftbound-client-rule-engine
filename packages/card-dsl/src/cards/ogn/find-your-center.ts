import type { CardProgram } from "../../ir/index.js";

/**
 * Find Your Center — CR v1.5 194.3/194.3.a, 356.4, 414.3 and 431.
 * Action timing, discount planning, Draw and Channel movement are merged.
 * Finalize still needs a static-discount adapter and a condition expression
 * reading the current per-mode Victory Score; never substitute a fixed 8.
 */
const findYourCenter = {
  canonicalCardId: "card.hash-e3ecc6164765d02357568348735bbb2eb8e6ed9a6a919fd16c4dde83bf5c765e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺静态 cost.modify 折扣到 Chain Finalize 的 CostPlanInput.discounts 绑定（CR 356.4）。条件还需读取当前 Victory Score 及对手分数：ResolveContext/Expr 未暴露 Victory Score 读数，命名条件尚无求值适配（CR 194.3/194.3.a），不能硬编码默认 8。channel-rune 的 exhausted 入场状态还缺执行证据：参考内核未应用该字段（CR 431.2）。",
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
        value: { kind: "constant", value: { energy: -2 } },
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
