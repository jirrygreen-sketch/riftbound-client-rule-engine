import type { CardProgram } from "../../ir/index.js";

/**
 * Jeweled Colossus (ogn-086-298): Vision and unvalued Shield (defaults to 1).
 * CR v1.5 817.1.c / 437.1 and 814.1.b.3 / 814.1.c-d.1.
 * programs/ already expands keywords and binds static/triggered abilities.
 * Shield still reads `designation` instead of the available `combatRole`;
 * Vision still fixes player A and requires resolution-time ordered vision-top
 * picks. Keep the keyword declarations until those shared consumers are fixed.
 */
export default {
  canonicalCardId: "card.hash-a75119cac76964b2306b7307a1b7afb6e2430ddfb481d73052d03049f0694722",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Shield] 按 CR 814.1.b.3 默认为 1，但展开条件读取 designation，ObjectSnapshot 提供的是 combatRole；" +
    "需要防守者条件适配（RIFT-359，814.1.c / 814.1.d.1）。[Vision] 展开的 object.id=self 入场过滤还需 programs/filters 适配；effect.inspect 仍固定 player=A，" +
    "programs/ 未注入真实控制者与每次结算的有序 vision-top picks（RIFT-358；817.1.c、437.1）。",
  abilities: [
    { kind: "keyword", keyword: "vision" },
    { kind: "keyword", keyword: "shield" }
  ],
  sourceText:
    "[Vision] (When you play me, look at the top card of your Main Deck. You may recycle it.)\n" +
    "[Shield] (+1 :rb_might: while I'm a defender.)"
} satisfies CardProgram;
