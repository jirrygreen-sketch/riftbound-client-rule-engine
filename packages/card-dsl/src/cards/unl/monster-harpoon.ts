import type { CardProgram } from "../../ir/index.js";

/**
 * Monster Harpoon (unl-014-219) — Spell, 1 energy + 1 Fury power, Might null, Fury。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-014-219，逐字）：
 *   [Action] (Play on your turn or in showdowns.)
 *   Deal 2 to a unit at a battlefield. If you control a facedown card, deal 4 to it instead.
 *
 * 规则依据（CR v1.5）：
 * - [Action]（806）许可关键词，卡牌只声明。
 * - “Deal 2 to a unit at a battlefield”：418.1 的 Deal；355.10.b 说明 “at a battlefield”
 *   只限制目标单位；355.9.a.1 的 “unit” 指 Board 上的单位。
 * - “If you control a facedown card, deal 4 to it instead”：同一句里的 if 从句只作用于它所在的
 *   指令（135.2.b.5 的条件从句范围、契约 3.4），两支互为补集、共用同一个被选单位
 *   （与已合入 ogn/solari-chief 的 “If it is stunned … Otherwise …” 同形）。355.9.a.3 的
 *   “Facedown card” 是战场 Facedown Zone 里的牌（107.3.a/107.3.e）。
 *
 * status = judge-required（缺口不近似实现）：
 * - “you control a facedown card” 没有可求值的集合读数：Facedown Zone 不是 location
 *   （107.3.e），契约 ZoneId 没有 facedown 成员，隐藏牌的运行时表示也未合入；
 *   ObjectSnapshot.faceDown 只能按单个对象读（states: "face-down"），没有已合入查询把“你控制的隐藏牌”
 *   集合表示出来（ogn/mushroom-pouch 记录同一缺口）。因此两支的判别式不可求值，整卡保持 judge-required，
 *   在 facedown 表示落地前不得接线（本卡不硬编码任意一支作为事实）。
 * - 两条 effect.damage 本身已合入；golden 用参考内核分别真实执行 2 点与 4 点的伤害形状（含失效目标 ignored），
 *   并断言条件结构；判别式与分支选择留给 Facedown Zone 的查询与消费方。
 */
const facedownClause = {
  kind: "compare",
  left: {
    kind: "count",
    subject: "facedown-cards-you-control",
    filter: { controller: "controller", states: "face-down" }
  },
  operator: "gte",
  right: { kind: "constant", value: 1 }
} as const;

const monsterHarpoon = {
  canonicalCardId: "card.hash-dcd84bc6f139a59761dc429118b1fffa13bfd4f72bd4703bd4da2d06d4e6bd3d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「If you control a facedown card」没有可求值路径：CR 355.9.a.3 / 107.3.a / 107.3.e 的 Facedown Zone " +
    "是战场子区域、不是 location，契约 ZoneId 没有 facedown 成员，隐藏牌的运行时表示未合入；ObjectSnapshot.faceDown 只能按单个对象读（states: \"face-down\"），" +
    "没有任何已合入查询能把“你控制的隐藏牌”集合表示出来（ogn/mushroom-pouch 同一缺口）。" +
    "因此 “deal 2 / deal 4 to it instead” 的判别式不可求值（135.2.b.5 的条件从句范围、补集分支形状已按 " +
    "ogn/solari-chief 的写法声明），整卡在 facedown 表示落地前不得接线；本卡不硬编码任意一支。" +
    "两条 effect.damage 本身已合入并由 golden 以真实原语执行。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 1 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          // “Deal 2 to it”：判别式为假的一支（补集）。
          id: "monster-harpoon.deal-2",
          op: "effect.damage",
          condition: { kind: "not", condition: facedownClause },
          args: {
            amount: { kind: "constant", value: 2 },
            target: { kind: "constant", value: "monster-harpoon.unit" }
          },
          targets: [
            {
              id: "monster-harpoon.unit",
              filter: { type: "unit", zone: "board", location: { type: "battlefield" } },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // “…deal 4 to it instead”：判别式为真的一支；同一个 TargetSpec（同一单位，不重新选择）。
          id: "monster-harpoon.deal-4",
          op: "effect.damage",
          condition: facedownClause,
          args: {
            amount: { kind: "constant", value: 4 },
            target: { kind: "constant", value: "monster-harpoon.unit" }
          },
          targets: [
            {
              id: "monster-harpoon.unit",
              filter: { type: "unit", zone: "board", location: { type: "battlefield" } },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Deal 2 to a unit at a battlefield. If you control a facedown card, deal 4 to it instead."
} satisfies CardProgram;

export default monsterHarpoon;
