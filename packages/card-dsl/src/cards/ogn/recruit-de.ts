import type { CardProgram } from "../../ir/index.js";

/**
 * Recruit (DE) (ogn-271-298) — Colorless Recruit unit token.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-271-298) 的印刷
 * 原文为空字符串：本地 deck-catalog 的 ability 字段是 ""（不是上游 showcase
 * Rune 那种 "[NO TEXT]" 占位符），effect-coverage 同样把它记为 no-ability /
 * "No ability text is available to compile."。
 *
 * 规则依据（CR v1.5）：187.1 规定 1 [M] Recruit token 是无领域（domainless）
 * 单位 token，1 Might、带 Recruit 标签；token 的 Might/标签等特征由产生它的
 * 法术或能力的定义给出（187），不属于本卡自身的能力文本。
 *
 * validateCardProgram 要求 sourceText 为非空字符串（README 第 4 节第 1 层
 * 的身份校验），因此这里用与卡面一致的占位符 "[NO TEXT]"（README 第 2 节
 * 对基本符文使用的口径），并保留上面的目录原文说明。
 *
 * status 判定（README 第 2 节）：经目录原文确认没有能力文本，能力列表为空 →
 * `no-ability`，不是「还没实现」的占位状态。
 */
const recruitDe = {
  canonicalCardId: "card.hash-a1488e943c6c92d892414a146fbf3fff172049ed362c2c8e77f631f50456eedc",
  rulesetVersion: "core-1.5",
  status: "no-ability",
  abilities: [],
  sourceText: "[NO TEXT]"
} satisfies CardProgram;

export default recruitDe;
