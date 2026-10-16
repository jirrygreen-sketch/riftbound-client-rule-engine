import type { CardProgram } from "../../ir/index.js";

/**
 * Find Your Center (ogn-047-298) — Spell, 3 energy (Calm).
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   If an opponent's score is within 3 points of the Victory Score, this
 *   costs :rb_energy_2: less.
 *   Draw 1 and channel 1 rune exhausted.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Action] (806) is a keyword ability expanded by the keyword registry
 *   (contract 3.7): the card only names the speed permission.
 * - "Draw 1" is effect.draw (414.3) and "channel 1 rune exhausted" is
 *   effect.channel with the entry stipulation passed to the channel-rune
 *   action (431.1 / 431.2). Both primitives are merged and are executed by
 *   the golden test.
 *
 * Status: judge-required — the conditional cost reduction is not expressible:
 * - "If an opponent's score is within 3 points of the Victory Score, this
 *   costs [2] less." is a printed-cost discount evaluated during Finalize
 *   (CR 356.4 discounts; 356.1.c: effects that refer to the Base Cost use the
 *   printed cost). No cost.modify primitive exists under
 *   effects/instructions/, and the frozen CostSpec has no discount field, so
 *   the reduction cannot be declared on the play ability.
 * - The condition itself needs the current Victory Score, which is per-mode
 *   state (CR 194.3 / 194.3.a: 8 by default and alterable by game mode or
 *   card effects). ResolveContext exposes each player's score but no victory
 *   score, so "within 3 points of the Victory Score" cannot be evaluated
 *   without inventing the threshold.
 * The cost half is preserved descriptively as a static cost.modify ability so
 * downstream tooling can see the intended delta and condition; the card stays
 * judge-required rather than hard-coding 8 points or dropping the discount.
 */
const findYourCenter = {
  canonicalCardId: "card.hash-e3ecc6164765d02357568348735bbb2eb8e6ed9a6a919fd16c4dde83bf5c765e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "减费无法表达：CR 356.4 的印刷费用折扣在 Finalize 结算，但 effects/instructions 下没有 cost.modify 原语，" +
    "冻结的 CostSpec 也没有折扣字段，无法在 play 上声明 [2] 减费；同时条件“对手分数在胜利分数 3 分以内”" +
    "需要当前 Victory Score（CR 194.3/194.3.a：默认 8，可被游戏模式或卡牌效果改变），" +
    "ResolveContext 只暴露各自分数、没有 victoryScore，硬编码 8 就是臆造。" +
    "依赖：RIFT-89（batch3 cost-plan 的 cost.modify 折扣入口）与暴露 Victory Score 的读数接口。" +
    "Draw 1（414.3）与 channel 1 rune exhausted（431.1/431.2）已合入并由 golden 执行。",
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "If an opponent's score is within 3 points of the Victory Score, this costs " +
    ":rb_energy_2: less.\n" +
    "Draw 1 and channel 1 rune exhausted.",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      // "this costs [2] less" — declared as the cost-plan discount shape; no
      // merged consumer reads it (see judgeReason).
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
