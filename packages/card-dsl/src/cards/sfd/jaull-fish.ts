import type { CardProgram } from "../../ir/index.js";

/**
 * Jaull-Fish (sfd-103-221) — Unit, fiora-sfd (M1).
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-103-221):
 *   [Accelerate] (You may pay :rb_energy_1::rb_rune_body: as an additional
 *   cost to have me enter ready.)
 *   I cost :rb_energy_2: less for each of your [Mighty] units. (A unit is
 *   Mighty while it has 5+ :rb_might:.)
 *
 * 表达说明：
 * - [Accelerate] 按契约 3.1 表示为 keyword 能力（805，可选附加费 [1][Body]，
 *   该卡域为 Body）。其展开（费用改写 + 入场就绪替代）由
 *   effects/keywords/accelerate.ts 负责，卡牌本身不再重复展开。
 * - “I cost 2 less for each of your Mighty units” 是静态费用改写
 *   （cost-modify 模板，见 ability-templates.md 的 cost-modify 行），该原语
 *   尚未定义，故整条能力保持 judge-required，不做近似实现（契约 1.5 红线）。
 */
const jaullFish = {
  canonicalCardId: "card.hash-db90e8eaf24230cfbc3b68d99971c58f465f65465b5c52be37ae1564d6e86732",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Missing primitive: cost.modify (cost reduction 'I cost 2 less for each of your Mighty units', " +
    "catalog cost-modify template). The Accelerate keyword is expressed but its expansion also " +
    "requires the unimplemented keywords/accelerate.ts (cost.additional + replacement.enter).",
  abilities: [{ kind: "keyword", keyword: "accelerate" }],
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_body: as an additional cost to have me enter ready.)\n" +
    "I cost :rb_energy_2: less for each of your [Mighty] units. (A unit is Mighty while it has 5+ :rb_might:.)"
} satisfies CardProgram;

export default jaullFish;
