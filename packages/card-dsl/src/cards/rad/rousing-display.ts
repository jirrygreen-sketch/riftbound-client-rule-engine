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
 * 2026-10-17 再复核：整卡仍为 judge-required；当前缺口见 judgeReason。
 * 已合入原语与关键词声明不等于生产链路可执行；局部执行证据见同名单卡测试。
 */
const rousingDisplay = {
  canonicalCardId: "card.hash-e1dc41d23789b8f4890d5cd59e5dc7e12c0c0d447b2f09fd7acf63729930c55d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Show Off]（CR 832.1）仍缺印刷 Object 条件「Energy cost 7 or more」与每实例标识的参数通道，及 Finalize 对 cost.reveal 的展示选择、objects-shown-off 结果/快照生产。" +
    "show-off slug 与注册键 Show Off 不一致，programs/keywords.ts 报 no executable KeywordDef；印刷空格拼写又不通过小写 symbol 校验。" +
    "condition.result 已合入，缺的不是通用「If you showed off」谓词，而是该关键词实际产生的每实例结果。当前 choice.mode 只是两种数量的待迁移结构，不能由玩家任选数量，生产 Finalize 也仍缺 choice-plan adapter。" +
    "effect.token 的 Recruit play 已可执行（187.1），两张与四张的生成/打出已有真实证据，但参考 TestWorld 的 play 未应用单位默认横置入场（359.2.c），入场状态仍需生产链路验证；这些局部证据不证明 Show Off 及其二/四互斥数量选择已完成。",
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
          // 先将「your base」按能力控制者求值，再交给仅接受既有 Expr 的 token schema。
          id: "rousing-display.controller-base",
          op: "condition.value",
          args: {
            value: { kind: "location", value: "ability-controller-base" }
          }
        },
        {
          // 「Play two … If you showed off, play four … instead」：展示结果尚无生产者，
          // 两个模式仅保留待迁移结构，不代表玩家可以任选数量（见 judgeReason）。
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
                          kind: "linked-value",
                          instructionId: "rousing-display.controller-base",
                          key: "value"
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
                          kind: "linked-value",
                          instructionId: "rousing-display.controller-base",
                          key: "value"
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
