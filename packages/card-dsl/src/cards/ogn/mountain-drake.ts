import type { CardProgram } from "../../ir/index.js";

/**
 * Mountain Drake (ogn-142-298) — Unit, 9 Energy, 10 Might, Body, Dragon.
 *
 * sourceText：官方卡面无印刷能力文本（deck-catalog 的 ability 为空字符串；
 * effect-coverage 将该印刷标记为 no-ability）。校验器要求 sourceText 非空，故使用
 * 仓库统一的「无文本」哨兵 "[NO TEXT]"（与已合入的基本符文程序一致）。
 *
 * 规则依据（CR v1.5）：无能力文本的单位只由印刷特征与通用规则驱动，不需要
 * CardProgram 能力。按 README 第 2 节这是 no-ability（已确认无能力文本）；费用与
 * Might 等特征由 packages/card-data 的目录数据承载。
 */
const mountainDrake = {
  canonicalCardId:
    "card.hash-3da057e91cac9110282dafd16e8d7fb8c7bea131220ccfb510da18e1058ec4f2",
  rulesetVersion: "core-1.5",
  status: "no-ability",
  abilities: [],
  sourceText: "[NO TEXT]"
} satisfies CardProgram;

export default mountainDrake;
