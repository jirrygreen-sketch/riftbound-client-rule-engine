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
 * - [Vision] (817.1.b/c) is merged (effects/keywords/Vision.ts, RIFT-83); its
 *   Predict steps (effect.inspect + effect.recycle, 437.1) execute through the
 *   interpreter and the reference kernel (engine-core Vision goldens), but the
 *   card's keyword-to-trigger subscription is still the pending CardProgram
 *   binding (RIFT-257).
 * - [Shield] (814) is printed without a value, so X is presumed 1
 *   (814.1.b.3) and it is functionally "+1 [M] while I am a defender"
 *   (814.1.c). Its expansion (effects/keywords/Shield.ts, RIFT-81) is a static
 *   continuous.might gated on the defender designation (814.1.d/814.1.d.1);
 *   continuous.might itself is merged (RIFT-258), but (1) nothing registers a
 *   card's static/keyword expansion into the layers engine (RIFT-257), (2)
 *   layers/engine.ts conditionMatches does not evaluate compare conditions and
 *   treats unrecognised kinds as true, so registering the expansion as-is
 *   would apply +1 Might unconditionally, and (3) the Defender designation of
 *   814.1.d is not an ObjectSnapshot characteristic (contract 3.8 combatRole
 *   has not reached effects/contract.ts). Not approximated.
 */
export default {
  canonicalCardId: "card.hash-a75119cac76964b2306b7307a1b7afb6e2430ddfb481d73052d03049f0694722",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Shield]（814）已声明但不可执行：effects/keywords/Shield.ts 的展开是依赖防守者身份（designation）的 static continuous.might " +
    "（814.1.c / 814.1.d.1）。continuous.might 指令（RIFT-258）已合入，但 (1) 没有消费方把卡牌静态能力/关键词展开注册进图层（RIFT-257），" +
    "(2) layers/engine.ts 的 conditionMatches 不求值 compare 条件、未识别的条件按 true 处理（直接注册会把 +1 Might 无条件套用），" +
    "(3) 814.1.d 的 Defender designation 不在 ObjectSnapshot 特征里（契约 3.8 的 combatRole 未落地）。" +
    "印刷文本省略 Shield 数值，按 814.1.b.3 用 X=1，不近似实现。" +
    "[Vision]（817，RIFT-83）的 Predict 展开可在参考内核执行（engine-core Vision 测试），但卡牌的 keyword→触发订阅属 RIFT-257。",
  abilities: [
    { kind: "keyword", keyword: "vision" },
    { kind: "keyword", keyword: "shield" }
  ],
  sourceText:
    "[Vision] (When you play me, look at the top card of your Main Deck. You may recycle it.)\n" +
    "[Shield] (+1 :rb_might: while I'm a defender.)"
} satisfies CardProgram;
