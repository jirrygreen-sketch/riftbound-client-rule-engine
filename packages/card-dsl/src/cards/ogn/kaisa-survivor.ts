import type { CardProgram } from "../../ir/index.js";

/**
 * Kai'Sa, Survivor (ogn-039-298) — Unit, Fury, Kai'Sa/The Void/Champion.
 * energy 4, power: none printed (no power cost), Might 4.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-039-298):
 *   "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost
 *    to have me enter ready.)\nWhen I conquer, draw 1."
 *
 * 规则依据（CR v1.5）：
 * - [Accelerate]（805）：可选附加费用关键词；展开（accelerate.cost 声明 +
 *   入场就绪替代）由 effects/keywords/Accelerate.ts（RIFT-86/RIFT-89 接线）
 *   提供，卡只声明 keyword。该印刷无力量费（power: null，见卡数据）——这里不写
 *   任何 power 费用，也不把 null 改写成 0。
 * - "When I conquer, draw 1."：Conquer Effect（383.4.c，时点 conquer，filter
 *   指向自身）；body 是已合入的 effect.draw（数额为印刷常量 1，玩家缺省为能力
 *   控制者）。
 *
 * status：executable——触发结构与绘制均用已合入能力，keyword 展开已合入；
 * golden 测试对 draw 体做真实执行（参考内核），并断言触发时点与 filter。
 */
const kaisaSurvivor = {
  canonicalCardId: "card.hash-6109f0c3bc10309b97f11204acad6c44060c1d502ba47608e1a7e5f37dc4f87f",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "accelerate" },
    {
      kind: "triggered",
      trigger: { at: "conquer", filter: { source: "self" } },
      optional: false,
      body: [
        {
          id: "kaisa-survivor.draw-1",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)\n" +
    "When I conquer, draw 1."
} satisfies CardProgram;

export default kaisaSurvivor;
