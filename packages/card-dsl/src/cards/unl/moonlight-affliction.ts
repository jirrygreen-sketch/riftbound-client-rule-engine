import type { CardProgram } from "../../ir/index.js";

/**
 * Moonlight Affliction（unl-066-219）— Spell，7 能量，无印刷力量，领域 Mind。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-066-219，逐字）：
 *   "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
 *   "Give a unit -10 :rb_might: this turn."
 *
 * 规则依据（CR v1.5）：
 * - [Reaction]（813）是许可类关键词，按契约 3.7 只声明。
 * - 「Give a unit -10 :rb_might: this turn」："a unit" 按 355.5 / 355.5.a 是 Choice →
 *   Targeted（355.7），写成 TargetSpec（min=max=1、selection "one"）；-10 是带回合期限
 *   的临时 Might 修正（143.2.a 的有效 Might；143.2.c 的“低于 0 只按 0 引用”是求值口径；
 *   到期由 317.2.c 的回合结束清理处理）。
 *
 * status = judge-required（README 第 2 节）：契约 3.6 的封闭 GameAction 集合没有 Might
 * 修改动作，effects/instructions/ 也没有注册 continuous.might 原语（图层求值侧属 RIFT-91，
 * 缺的是把结算中的持续效果经 ResolveContext.addContinuous 落地的指令）；effect.buff 明确
 * 只管 702/703 的 Buff 计数器，不能用来近似 Might。没有可执行的已支持部分，golden 只做
 * 校验与结构断言，缺口写成 test.todo。依赖：continuous.might 指令原语 + end-of-turn 期限（RIFT-91 后续）。
 */
const moonlightAffliction = {
  canonicalCardId: "card.hash-3dfe95c2b5760342ff53da5b907465cf7b0aa40a27553cfdfa36e7a449d7530b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "临时 Might 修正无执行路径：「Give a unit -10 :rb_might: this turn」属算术图层的 continuous.might" +
    "（143.2.a 的有效 Might、143.2.c 的低于 0 按 0 引用、317.2.c 的回合结束到期），契约 3.6 的封闭 GameAction 集合没有 " +
    "Might 修改动作，effects/instructions/ 下也没有注册 continuous.might 原语（图层求值侧 RIFT-91 已合入，缺的是把结算中的" +
    "持续效果经 ResolveContext.addContinuous 落地的指令）；effect.buff 文件头明确临时 Might 归 continuous.might、" +
    "不是 702/703 的 Buff 计数器，不能近似。依赖：continuous.might 指令原语 + end-of-turn 期限（RIFT-91 后续）。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 7 }
      },
      body: [
        {
          id: "moonlight-affliction.give-minus-10-might",
          // 临时 Might 修正：算术图层的 continuous.might（见 judgeReason）。
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: -10 },
            duration: { kind: "constant", value: "this-turn" },
            target: { kind: "constant", value: "moonlight-affliction.chosen-unit" }
          },
          targets: [
            {
              id: "moonlight-affliction.chosen-unit",
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
    "Give a unit -10 :rb_might: this turn."
} satisfies CardProgram;

export default moonlightAffliction;
