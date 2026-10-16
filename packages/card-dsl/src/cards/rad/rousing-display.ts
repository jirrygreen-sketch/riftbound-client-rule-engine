import type { CardProgram } from "../../ir/index.js";

/**
 * Rousing Display（rad-127-167）— Spell，5 能量，无印刷力量，领域 Order。
 *
 * 原文（packages/card-data/data/deck-catalog.json rad-127-167，逐字；结尾的 "disa" 是本地数据里
 * 的截断残留，见任务回复的「数据问题」，此处按要求逐字保留、不改数据）：
 *   "[Show Off] a card with Energy cost :rb_energy_7: or more. (As you play this, you may reveal
 *    such a card from hand or pick a friendly one.)\nPlay two 1 :rb_might: Recruit unit tokens to
 *    your base. If you showed off, play four to your base instead.disa"
 *
 * 规则依据（CR v1.5）：
 * - [Show Off]（832.1）是被动能力关键词，格式为 "[Show Off] [Object]"（832.1.b），此处 [Object]
 *   是「Energy cost 7 或更高的牌」；832.1.c 是功能释义（打出时可以从手牌展示和/或从友方场上对象中
 *   选取），832.1.c.2 说明是否 Show Off 由该链项的控制者在 Finalize 期间决定（355）。
 * - Recruit 是 CR 187.1 定义的 1 Might、无领域、带 Recruit 标签的单位 token；
 *   「play … tokens to your base」按 440.2.c / 185.2.a 先在链上生成再由 play 接手，
 *   185.2.d / 143.4 决定入场状态（单位默认以 exhausted 入场，本卡原文没有额外状态改写）。
 * - 「If you showed off, play four to your base instead」是取决于 Finalize 展示结果的互斥数量
 *   （832.1.d 的同源链接引用），不是玩家在结算时的新选择。
 *
 * status = judge-required（不近似实现）：
 * 1. Show Off 没有 KeywordDef：effects/keywords/ 的 16 个已注册关键词不含 Show Off。按契约 3.4，
 *    展示时要把被引用的特征值锁定进链接值（Show Off 行），调研表把 kw-show-off 归到
 *    cost.reveal / condition.result（依赖 RIFT-9 原语清单与 RIFT-89 费用计划）。
 * 2. 「If you showed off」的判别式没有可执行谓词：合并 Condition 只有 always/never/compare/all/
 *    any/not/expression，没有读取 Finalize 展示结果的谓词，也没有 cost.reveal 指令；本卡用
 *    choice.mode 的两个模式（showed-off / not-showed-off）保留完整结构，与已合入的
 *    ravenbloom-conservatory 处理不可表达分支的写法一致，不冒充可执行决策。
 *
 * 可执行部分：effect.token 的 play 路径（recruit，187.1）已合入，golden 用参考内核真实执行
 * 「play two 1 Might Recruit unit tokens to your base」；这不足以宣称整卡可执行。
 * 依赖：RIFT-9（Show Off / cost.reveal）、RIFT-89（费用计划）、RIFT-91（图层与链接值）。
 */
const rousingDisplay = {
  canonicalCardId: "card.hash-e1dc41d23789b8f4890d5cd59e5dc7e12c0c0d447b2f09fd7acf63729930c55d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入，均不近似实现：(1) Show Off（CR 832）没有 KeywordDef（effects/keywords 的 16 个关键词不含它），" +
    "按契约 3.4 展示时要把被引用特征锁进链接值，调研表把 kw-show-off 归到 cost.reveal / condition.result" +
    "（依赖 RIFT-9 与 RIFT-89）。(2)「If you showed off」的判别式没有可执行谓词：合并 Condition 没有读取 " +
    "Finalize 展示结果的谓词，也没有 cost.reveal 指令；本卡用 choice.mode 的两个模式保留结构（与 " +
    "ravenbloom-conservatory 处理不可表达分支的写法一致），不把玩家选择冒充为该判别式。" +
    "「play two 1 Might Recruit unit tokens to your base」的 effect.token play 路径已合入并由 golden 真实执行" +
    "（Recruit 定义 see CR 187.1），但局部执行不构成整卡证据。",
  abilities: [
    // 832.1：印刷的 [Show Off]；其对象说明（Energy cost 7 或更高的牌）记录在 judgeReason。
    { kind: "keyword", keyword: "show-off" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 5 }
      },
      body: [
        {
          // 「Play two … If you showed off, play four … instead」：判别式不可表达，
          // 用两个互斥模式保留结构（见 judgeReason 第 2 点）。
          id: "rousing-display.choose-count",
          op: "choice.mode",
          args: {
            count: { kind: "constant", value: 1 },
            different: { kind: "constant", value: true },
            modes: {
              kind: "constant",
              value: [
                {
                  id: "rousing-display-showed-off",
                  body: [
                    {
                      id: "rousing-display.play-4-recruits",
                      op: "effect.token",
                      args: {
                        token: { kind: "constant", value: "recruit" },
                        amount: { kind: "constant", value: 4 },
                        mode: { kind: "constant", value: "play" },
                        location: {
                          kind: "constant",
                          value: { type: "base", player: "controller" }
                        },
                        linkKey: { kind: "constant", value: "recruitTokens" }
                      }
                    }
                  ]
                },
                {
                  id: "rousing-display-not-showed-off",
                  body: [
                    {
                      id: "rousing-display.play-2-recruits",
                      op: "effect.token",
                      args: {
                        token: { kind: "constant", value: "recruit" },
                        amount: { kind: "constant", value: 2 },
                        mode: { kind: "constant", value: "play" },
                        location: {
                          kind: "constant",
                          value: { type: "base", player: "controller" }
                        },
                        linkKey: { kind: "constant", value: "recruitTokens" }
                      }
                    }
                  ]
                }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Show Off] a card with Energy cost :rb_energy_7: or more. (As you play this, you may reveal such a card " +
    "from hand or pick a friendly one.)\nPlay two 1 :rb_might: Recruit unit tokens to your base. " +
    "If you showed off, play four to your base instead.disa"
} satisfies CardProgram;

export default rousingDisplay;
