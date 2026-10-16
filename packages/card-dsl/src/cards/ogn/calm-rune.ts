import type { CardProgram } from "../../ir/index.js";

/**
 * Calm Rune — basic Rune (Origins, printing ogn-042-298).
 *
 * sourceText：官方卡面无印刷能力文本（deck-catalog 的 ability 为空字符串；
 * effect-coverage 将该印刷标记为 no-ability）。CardProgram 的校验器要求 sourceText
 * 为非空字符串，本仓库已有基本符文程序统一使用官方「无文本」哨兵 "[NO TEXT]"
 * （见 ogn/body-rune.ts 等），此处沿用同一约定。
 *
 * 规则依据（CR v1.5）：
 * - 103.4：基本符文属于符文牌组（Rune Deck），不属于主牌组；
 * - 164.2/164.2.a/164.2.b：基本符文的两条能力是规则赋予的（[Reaction][>][E]: Add [1]、
 *   [Reaction][>] Recycle this: Add [C]），不是印刷在卡面上的能力文本；
 * - 430：Add 是游戏动作，由回合结构或其他效果引导，不是符文印刷的能力。
 * 因此本程序是 no-ability（README 第 2 节）：abilities 为空，规则赋予的能力由引擎的
 * 基本符文路径处理，不在这里近似实现。
 */
const calmRune = {
  canonicalCardId:
    "card.hash-efe5e5f4811f4089cd86b83cd6b8385613b0f469b2c2ae9f6b74a55ceb5cf0ed",
  rulesetVersion: "core-1.5",
  status: "no-ability",
  abilities: [],
  sourceText: "[NO TEXT]"
} satisfies CardProgram;

export default calmRune;
