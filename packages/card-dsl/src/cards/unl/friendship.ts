import type { CardProgram } from "../../ir/index.js";

/**
 * Friendship（unl-046-219）— Spell，1 能量，无印刷力量，领域 Calm。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-046-219，逐字）：
 *   "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
 *   "Choose a unit. Give it +1 :rb_might: this turn for each of the following tags " +
 *   "among your units — Bird, Cat, Dog, and Poro."
 *
 * 规则依据（CR v1.5）：
 * - [Reaction]（813）按契约 3.7 只声明 keyword；时机合法性（随时可打、结算前）由
 *   已合入的 chain canAct speed "reaction" 消费（chain/engine.ts）。
 * - 「Choose a unit」按 355.5 / 355.7 是 Choice → Targeted（355.5.a 的“基于条件影响”例外
 *   不适用于此处的显式选择），写成 TargetSpec（min=max=1、selection "one"）。
 * - 「Give it +1 :rb_might: this turn」是带回合期限的临时 Might 修正：143.2.a 规定卡面
 *   “Might” 指算上所有 Might 修改后的有效值，continuous.might 原语注册 arithmetic 层
 *   修改并由 317.2.c 的回合结束清理让它同时到期（702/703 的 Buff 计数器是另一种对象，
 *   不用作近似）。
 * - 「for each of the following tags among your units — Bird, Cat, Dog, and Poro」：
 *   数量 = 你的单位里出现过的下列标签中**不同标签**的个数（上限 4），而不是单位个数；
 *   「among your units」的作用域是能力控制者的单位。合入 IR 没有“一组指定标签中出现过
 *   几种”的集合谓词，因此按“该标签在你的单位里出现至少一次”把每张 +1 写成一条独立的
 *   continuous.might 指令：amount 是常量 1，指令级 condition 用 count gte 1 检查该标签
 *   是否出现 —— 0 张时跳过该张（355.13：0 增量不发生，不注册 +0 图层效果），2 张及
 *   以上也只有这一张生效，每张不同标签各贡献一次 +1。
 *
 * status = executable（README 第 2 节）：所有能力都由已合入原语表达并通过解释器
 * 执行（continuous.might 指令、instruction 级 condition、TargetSpec、end-of-turn
 * 期限、reaction 时序），无遗留裁定依赖。
 */
const friendship = {
  canonicalCardId: "card.hash-380c1a7758d95d28f1a1ab46065c44a878dd909f52f43900cdf66c7669153512",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 1 }
      },
      body: [
        {
          id: "friendship.grant-might-bird",
          op: "continuous.might",
          condition: {
            kind: "compare",
            left: {
              kind: "count",
              subject: "units-with-tag",
              filter: { type: "unit", zone: "board", controller: "self", tags: ["Bird"] }
            },
            operator: "gte",
            right: { kind: "constant", value: 1 }
          },
          args: {
            objects: { kind: "constant", value: { kind: "target", id: "friendship.chosen-unit" } },
            amount: { kind: "constant", value: 1 },
            duration: { kind: "constant", value: "end-of-turn" }
          },
          targets: [
            {
              id: "friendship.chosen-unit",
              filter: { type: "unit", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          id: "friendship.grant-might-cat",
          op: "continuous.might",
          condition: {
            kind: "compare",
            left: {
              kind: "count",
              subject: "units-with-tag",
              filter: { type: "unit", zone: "board", controller: "self", tags: ["Cat"] }
            },
            operator: "gte",
            right: { kind: "constant", value: 1 }
          },
          args: {
            objects: { kind: "constant", value: { kind: "target", id: "friendship.chosen-unit" } },
            amount: { kind: "constant", value: 1 },
            duration: { kind: "constant", value: "end-of-turn" }
          },
          targets: []
        },
        {
          id: "friendship.grant-might-dog",
          op: "continuous.might",
          condition: {
            kind: "compare",
            left: {
              kind: "count",
              subject: "units-with-tag",
              filter: { type: "unit", zone: "board", controller: "self", tags: ["Dog"] }
            },
            operator: "gte",
            right: { kind: "constant", value: 1 }
          },
          args: {
            objects: { kind: "constant", value: { kind: "target", id: "friendship.chosen-unit" } },
            amount: { kind: "constant", value: 1 },
            duration: { kind: "constant", value: "end-of-turn" }
          },
          targets: []
        },
        {
          id: "friendship.grant-might-poro",
          op: "continuous.might",
          condition: {
            kind: "compare",
            left: {
              kind: "count",
              subject: "units-with-tag",
              filter: { type: "unit", zone: "board", controller: "self", tags: ["Poro"] }
            },
            operator: "gte",
            right: { kind: "constant", value: 1 }
          },
          args: {
            objects: { kind: "constant", value: { kind: "target", id: "friendship.chosen-unit" } },
            amount: { kind: "constant", value: 1 },
            duration: { kind: "constant", value: "end-of-turn" }
          },
          targets: []
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Choose a unit. Give it +1 :rb_might: this turn for each of the following tags " +
    "among your units — Bird, Cat, Dog, and Poro."
} satisfies CardProgram;

export default friendship;
