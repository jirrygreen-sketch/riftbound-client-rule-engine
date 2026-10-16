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
 * - [Reaction]（813）是许可类关键词，按契约 3.7 只声明。
 * - 「Choose a unit」按 355.5 / 355.7 是 Choice → Targeted（355.5.a 的“基于条件影响”例外
 *   不适用于此处的显式选择），写成 TargetSpec（min=max=1、selection "one"）。
 * - 「Give it +1 :rb_might: this turn」是带回合期限的临时 Might 修正：143.2.a 规定卡面
 *   “Might” 指算上所有 Might 修改后的有效值，477.1/475 的算术图层负责求值，317.2.c 的
 *   回合结束清理让它同时到期。effect.buff 文件头明确临时 Might 归 continuous.might、不是
 *   Buff 计数器（702/703 是另一回事），因此不用 Buff 近似。
 * - 「for each of the following tags among your units — Bird, Cat, Dog, and Poro」：数量 =
 *   你的单位里出现过的下列标签中**不同标签**的个数（上限 4），而不是单位个数；
 *   「among your units」的作用域是能力控制者的单位。
 *
 * status = judge-required（README 第 2 节），两处依赖未合入，均不近似实现：
 * 1. 临时 Might 修改没有可执行路径：契约 3.6 的封闭 GameAction 集合没有 Might 修改动作，
 *    effects/instructions/ 下也没有注册 continuous.might 的原语（图层求值侧属 RIFT-91，
 *    但把结算中的持续效果经 ResolveContext.addContinuous 落地的指令仍未合入）。
 * 2. 「for each … tags among your units」的计数形状不可求值：合并 IR 的 count 只统计
 *    「匹配某个 ObjectFilter 的对象个数」，没有「一组指定标签中在你单位里出现过的不同
 *    标签个数」这种集合谓词，condition.value 的算术也只能组合已求值的数值；
 *    用 unit 计数或单一 tag 过滤都是错误的近似，因此不提成可执行表达式。
 * 依赖：continuous.might 指令原语 + end-of-turn 期限（RIFT-91 后续）、RIFT-89/90（条件与谓词管线）。
 * golden 只做校验与结构断言，未合入依赖写成 test.todo。
 */
const friendship = {
  canonicalCardId: "card.hash-380c1a7758d95d28f1a1ab46065c44a878dd909f52f43900cdf66c7669153512",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入，均不近似实现：(1)「Give it +1 :rb_might: this turn」是带回合期限的临时 Might 修正，" +
    "契约 3.6 的封闭 GameAction 没有 Might 修改动作，effects/instructions/ 也没有注册 continuous.might 原语" +
    "（把结算中的持续效果经 ResolveContext.addContinuous 落地的指令未合入；effect.buff 明确只管 702/703 的 Buff 计数器，" +
    "不用它近似 Might）。(2)「for each of the following tags among your units — Bird, Cat, Dog, and Poro」要数的是" +
    "你的单位里出现过的**不同标签**个数：合并 IR 的 count 只统计匹配 ObjectFilter 的对象数量，没有「一组指定标签中出现过几个」" +
    "的集合谓词，condition.value 只能组合已求值的数值；amount 因此保留为描述性形状，不写成错误的 unit 计数。" +
    "依赖：continuous.might 指令原语 + end-of-turn 期限（RIFT-91 后续）、RIFT-89/90（条件/谓词管线）。",
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
          id: "friendship.grant-might",
          // 临时 Might 修正：算术图层的 continuous.might（见 judgeReason 第 1 点）。
          op: "continuous.might",
          args: {
            // 「+1 for each of the following tags among your units」：描述性形状，
            // 不是可求值 Expr（见 judgeReason 第 2 点）。
            amount: {
              kind: "constant",
              value: {
                kind: "per-matching-tag",
                amountPerTag: 1,
                tags: ["Bird", "Cat", "Dog", "Poro"],
                among: { type: "unit", controller: "controller", zone: "board" }
              }
            },
            duration: { kind: "constant", value: "this-turn" },
            target: { kind: "constant", value: "friendship.chosen-unit" }
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
