import type { CardProgram } from "../../ir/index.js";

/**
 * Mega-Mech (ogn-088-298) — Unit, 7 Energy, 8 Might, Mind, Mech/Bandle City.
 *
 * sourceText：官方卡面无印刷能力文本（deck-catalog 的 ability 为空字符串；
 * effect-coverage 标记 no-ability，RIFT-9 调研的 no-ability-text 模板亦以本印刷为
 * 例）。校验器要求 sourceText 非空，故使用仓库统一的「无文本」哨兵 "[NO TEXT]"。
 *
 * 规则依据（CR v1.5）：无能力文本的单位只由印刷特征与通用规则驱动，不需要
 * CardProgram 能力。按 README 第 2 节这是 no-ability；费用/Might/域/标签由
 * packages/card-data 的目录数据承载。
 */
const megaMech = {
  canonicalCardId:
    "card.hash-013b8118d566bc866a5d38ab100291257ea7bcfbae2ffeecf5be16658ee2061d",
  rulesetVersion: "core-1.5",
  status: "no-ability",
  abilities: [],
  sourceText: "[NO TEXT]"
} satisfies CardProgram;

export default megaMech;
