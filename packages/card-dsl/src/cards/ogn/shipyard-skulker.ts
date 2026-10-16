import type { CardProgram } from "../../ir/index.js";

/**
 * Shipyard Skulker (ogn-175-298) — Unit, Chaos, Pirate/Bilgewater.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-175-298) 的
 * 印刷原文为空字符串：本地 deck-catalog 的 ability 字段是 ""（不是上游
 * showcase Rune 那种 "[NO TEXT]" 占位符），effect-coverage 同样把它记为
 * no-ability / "No ability text is available to compile."。
 *
 * validateCardProgram 要求 sourceText 为非空字符串（README 第 4 节第 1 层
 * 的身份校验），因此这里用与卡面一致的占位符 "[NO TEXT]"（README 第 2 节
 * 对基本符文使用的口径），并保留上面的目录原文说明。
 *
 * status 判定（README 第 2 节）：经目录原文确认没有能力文本，能力列表为空 →
 * `no-ability`，不是「还没实现」的占位状态。
 */
const shipyardSkulker = {
  canonicalCardId: "card.hash-26b6496677401782ccd8026209ea073522a10c2606cf1c4abc1ecc56a88c6e83",
  rulesetVersion: "core-1.5",
  status: "no-ability",
  abilities: [],
  sourceText: "[NO TEXT]"
} satisfies CardProgram;

export default shipyardSkulker;
