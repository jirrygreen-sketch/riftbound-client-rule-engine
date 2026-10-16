import type { CardProgram } from "../../ir/index.js";

/**
 * Jeweled Colossus (ogn-086-298) — Unit, 5 energy, 5 Might, Mind, Mount Targon.
 *
 * Printed text:
 *   [Vision] (When you play me, look at the top card of your Main Deck. You
 *   may recycle it.)
 *   [Shield] (+1 :rb_might: while I'm a defender.)
 *
 * Both halves are keyword declarations (contract 3.1 / 3.7): the card only
 * names vision and shield; expansion stays in effects/keywords/<keyword>.ts.
 *
 * Status: judge-required.
 * - [Vision] (817.1.b/c) is merged (effects/keywords/Vision.ts); its Predict
 *   steps (effect.inspect + effect.recycle, 437.1) execute through the
 *   interpreter and the reference kernel, and the golden test runs them.
 * - [Shield] (814) is printed without a value, so X is presumed 1
 *   (814.1.b.3) and it is functionally "+1 [M] while I am a defender"
 *   (814.1.c). Its expansion is a static continuous.might ability gated on the
 *   defender designation (814.1.d/814.1.d.1), which is not a characteristic of
 *   the merged ObjectSnapshot and is not evaluated by the merged layer engine,
 *   so the Shield half is not executable (RIFT-91). Not approximated.
 */
export default {
  canonicalCardId: "card.hash-a75119cac76964b2306b7307a1b7afb6e2430ddfb481d73052d03049f0694722",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Shield]（814）已声明但不可执行：effects/keywords/Shield.ts 的展开是依赖防守者身份（designation）的 static continuous.might " +
    "（814.1.c / 814.1.d.1），而防守者身份不在合并后的 ObjectSnapshot 特征里、层引擎也不求值该 compare 条件；" +
    "印刷文本省略 Shield 数值，按 814.1.b.3 用 X=1。" +
    "依赖：RIFT-91（layers-continuous）。[Vision]（817）半已合入并可在参考内核执行。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "vision" },
    { kind: "keyword", keyword: "shield" }
  ],
  sourceText:
    "[Vision] (When you play me, look at the top card of your Main Deck. You may recycle it.)\n" +
    "[Shield] (+1 :rb_might: while I'm a defender.)"
} satisfies CardProgram;
