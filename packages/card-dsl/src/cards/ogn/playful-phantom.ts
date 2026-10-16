import type { CardProgram } from "../../ir/index.js";

/**
 * Playful Phantom (ogn-049-298) — Unit, 5 Energy, 5 Might, Calm, Spirit/Shadow Isles.
 *
 * sourceText：官方卡面无印刷能力文本（deck-catalog 的 ability 为空字符串；
 * effect-coverage 将该印刷标记为 no-ability）。校验器要求 sourceText 非空，故使用
 * 仓库统一的「无文本」哨兵 "[NO TEXT]"（与已合入的基本符文程序一致）。
 *
 * 规则依据（CR v1.5）：无能力文本的单位只由印刷特征（费用、Might、域、标签）与通用
 * 规则（回合结构、战斗、计分）驱动，不产生需要 CardProgram 表达的能力。按 README
 * 第 2 节，这是 no-ability（已确认无能力文本），不是「尚未实现」的占位状态；其费用与
 * Might 等特征存放在 packages/card-data 的目录数据中，CardProgram 不重复声明。
 */
const playfulPhantom = {
  canonicalCardId:
    "card.hash-0c30d89586c6f97097bcf06afbf4ce2ce7cdedb38ca96c30510f807c7811d024",
  rulesetVersion: "core-1.5",
  status: "no-ability",
  abilities: [],
  sourceText: "[NO TEXT]"
} satisfies CardProgram;

export default playfulPhantom;
