import type { CardProgram } from "../../ir/index.js";

/**
 * Recruit (ven-t04) — Colorless Recruit unit token.
 * 无印刷费用（deck-catalog 的 `energy` 与 `power` 均为 null，表示没有印刷值，
 * 绝不写成 0）、Might 1、标签 Recruit/Token，目录 localizedName 为 "Recruit (NX)"。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-t04）：印刷能力字段是
 * 空字符串 ""（本地目录里除 localizedName 外没有任何能力文本；effect-coverage
 * 也把该印刷记为 no-ability / "No ability text is available to compile."）。
 * validateCardProgram 要求 sourceText 非空（README 第 4 节第 1 层的身份校验），
 * 因此沿用仓库既有口径（ogn/recruit-de、ogn/recruit-nx、ogn/playful-phantom、
 * ogn/vanguard-sergeant）写官方「无文本」占位 "[NO TEXT]"；目录原文为空这一事实
 * 记录在这里，不改动卡牌数据。
 *
 * 规则依据（Core Rules v1.5）：187.1 规定 1 [M] Recruit token 是无领域
 * （domainless）单位 token，1 Might、带 Recruit 标签；token 的费用、Might 与
 * 标签等特征由创建它的法术或能力的定义给出（187），不是本卡自身的能力文本。
 * 无能力文本的单位只由印刷特征与通用规则（回合结构、战斗、计分）驱动，不产生
 * 需要 CardProgram 表达的能力。
 *
 * status 判定（README 第 2 节）：经目录原文确认没有能力文本、能力列表为空 →
 * `no-ability`（已确认无文本，不是「还没实现」的占位状态）。
 */
export default {
  canonicalCardId: "card.hash-3803d5d84b49f4d89171869c436061efb615d7b53a0c14cab12b663b7f50542b",
  rulesetVersion: "core-1.5",
  status: "no-ability",
  abilities: [],
  sourceText: "[NO TEXT]"
} satisfies CardProgram;
