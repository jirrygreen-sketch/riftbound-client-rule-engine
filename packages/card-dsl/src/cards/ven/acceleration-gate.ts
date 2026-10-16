import type { CardProgram } from "../../ir/index.js";

/**
 * Acceleration Gate (ven-150-166) — Spell, 3 Energy + 1 Mind/Body Power, tags
 * Jayce/Signature. Might null（法术没有印刷 Might）。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-150-166，逐字）:
 *   "Ready up to 4 units, gear, and/or runes."
 *
 * 规则依据（CR v1.5）:
 * - 无 [Action]/[Reaction] 印刷行：法术按默认时机（159.2.a），卡程序不声明速度关键词。
 * - 「units, gear, and/or runes」是类别列举（133.3）：133.3.a 规定未限定区域时按特征
 *   "on the board" 指称游戏对象；Runes 位于其控制者的 Base（107.1.c），本项目冻结的 ZoneId
 *   用 rune-zone 表示该符文区。原文没有任何 "you control" 限定，因此集合是所有玩家的
 *   单位 / 装备 / 符文（对照 355.10.g 的 "your legend" vs "a friendly legend" 用法：
 *   限定词才引入归属）。类型在任意区域都保持有效（141.2.b/148.2.b），所以必须同时给出
 *   区域过滤，否则牌库/弃牌堆里的装备牌也会成为候选。
 * - 「Ready up to 4 …」：玩家指名要重置的对象，因此是目标；"up to" 允许选择任意数量、
 *   含 0（355.12 / 355.13，"Ready" 是可指定若干对象执行的 Game Action）。
 * - 416.1 / 416.1.b / 416.1.c：已经就绪的对象不再重置、也不产生事件（"nothing additional
 *   happens"）；已合入的 effect.ready 原语按该边界提交 { type: "ready", object }。
 *
 * status 判定（cards/README.md 第 2 节）：executable —— 整张卡只有这一条无关键词、无期限、
 * 无 Might 修改的就绪指令：原语（effect.ready，416.1–416.3）、解释器、链的 Finalize 目标锁定
 * （chain/engine.ts 从 body 的 TargetSpec 建 TargetPlan）与生产过滤器（layers/filter.ts 的
 * matchesObjectFilter 支持数组型 type/zone）都已合入；golden 用已合入原语 + 参考内核真实执行，
 * 并用生产过滤器核对候选集合。
 */
const accelerationGate = {
  canonicalCardId: "card.hash-d573cd36f7b306449a231dfbdee312b3b2f66f62fa38f092efed53512ac63fc0",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "play",
      body: [
        {
          // 「Ready up to 4 units, gear, and/or runes.」——355.12/355.13 的 up-to 选目标；
          // 「and/or」就是可混合选择这三类（不是 355.3 的模式列表）。
          id: "acceleration-gate.ready-up-to-four",
          op: "effect.ready",
          args: {
            objects: {
              kind: "constant",
              value: { kind: "target", id: "acceleration-gate.chosen-objects" }
            },
            amount: { kind: "constant", value: 4 },
            linkKey: { kind: "constant", value: "readied" }
          },
          targets: [
            {
              id: "acceleration-gate.chosen-objects",
              // 133.3.a + 107.1.c：未限定归属的单位 / 装备在 Board、符文在符文区；
              // 区域过滤不可省——类型在任意区域都有效（141.2.b/148.2.b）。
              filter: { type: ["unit", "gear", "rune"], zone: ["board", "rune-zone"] },
              min: 0,
              max: 4,
              selection: "up-to"
            }
          ]
        }
      ]
    }
  ],
  sourceText: "Ready up to 4 units, gear, and/or runes."
} satisfies CardProgram;

export default accelerationGate;
