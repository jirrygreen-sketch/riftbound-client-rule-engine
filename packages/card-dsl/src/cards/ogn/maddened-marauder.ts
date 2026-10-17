import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Maddened Marauder (ogn-191-298) — Unit, 5 energy, 4 Might.
 *
 * Printed text:
 *   [Tank] (I must be assigned combat damage first.)
 *   When you play me, move a unit from a battlefield to its base.
 *
 * 规则依据（CR v1.5）：
 * - [Tank]（815）是被动关键词：815.1.b 功能上是“我必须比同控制者、没有 [Tank] 的单位
 *   更早被分配致命伤害”，815.1.c 改写战斗伤害分配，815.2 多个实例冗余。按契约 3.7
 *   只声明 `{ kind: "keyword", keyword: "tank" }`，战斗伤害分配归 combat/。
 * - “When you play me” 是 Play Effect（383.4.a.1、383.4.a.2：单位 Finalize 并进入
 *   Board 后作为 Pending Item 入链），时点 card-played，事件过滤指向本源。
 * - “move a unit from a battlefield to its base”：被移动对象在文本中被指名，因此是目标
 *   （355.7 / 355.9.a：“Unit” 指 Board 上的对象；355.10.d 的“按特征自动选定”不适用，
 *   因为需要玩家挑一个单位）。`to` 解析为 Move（448.1 / 421），不是 Recall（457：
 *   Recall 是无指令的校正移动）。“its base” 是该单位控制者的 Base（107.1.a），
 *   原语用 `"controller-base"` 表达；`effect.move` 已合入并可由解释器执行。
 *
 * status 判定（README 第 2 节）：judge-required。Tank 的 KeywordDef、CardProgram static
 * 生命周期和 `continuous.combat` 注册已合入（`effects/keywords/Tank.ts` 展开为
 * damage-assignment 要求），但 `continuous.combat` 仍没有 combat 消费方：
 * combat/base-combat-allocation.ts 明确不绑定 assignment-priority，而战斗伤害分配
 * 就是 Tank 的全部功能。Play Effect 本体与 effect.move 已合入，golden 测试真实执行。
 */
const abilities: Ability[] = [
  {
    kind: "keyword",
    keyword: "tank"
  },
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { self: true } },
    optional: false,
    body: [
      {
        id: "maddened-marauder.move-to-base",
        op: "effect.move",
        args: {
          objects: { kind: "constant", value: { target: "unit-at-a-battlefield" } },
          to: { kind: "constant", value: "controller-base" },
          linkKey: { kind: "constant", value: "movedUnit" }
        },
        targets: [
          {
            id: "unit-at-a-battlefield",
            filter: { type: "unit", location: "battlefield" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-2d06f94837d653adf51bb1fb5541dac6094ae71dd39819fa776457688cf8a87b",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "[Tank]（815）的 KeywordDef 与 static continuous.combat 注册已合入（展开为致命分配要求），但仍没有消费 " +
    "continuous.combat 的战斗伤害分配路径（815.1.b/.c 的“先分配致命伤害”无法落地）：combat/base-combat-allocation.ts " +
    "不绑定 assignment-priority，layers/ops 只登记该 kind；而这就是 Tank 的全部功能。" +
    "Play Effect 本体与 effect.move 均已合入，golden 测试用解释器 + 参考内核真实执行；" +
    "依赖：combat 分配器消费 assignment-priority（continuous.combat）。不近似实现。",
  abilities,
  sourceText:
    "[Tank] (I must be assigned combat damage first.)\n" +
    "When you play me, move a unit from a battlefield to its base."
} satisfies CardProgram;

export default program;
