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
 * status = judge-required（不近似实现），2026-10-17 按已合入源码逐条实测：
 * 1. 关键词 id 今天写不出来：契约校验器要求小写 symbol id（SYMBOL_PATTERN，不含空格），
 *    而已合入的 KeywordDef 在注册表键与 keyword 字段都写成 \"Show Off\"（effects/keywords/ShowOff.ts），
 *    programs/keywords.ts 的 definitionFor 只做大小写不敏感比较、不归一化空格/连字符差异。
 *    实测 \"show-off\" 通过 validateCardProgram 但 describePlay 抛 judge-required
 *    「Keyword show-off has no executable KeywordDef」；印刷拼写 \"Show Off\" 能展开却被校验器以
 *    「Expected a lowercase keyword id」拒绝。打出流程在关键词展开处就中断，
 *    已合入的 effects/keywords/ShowOff.ts 的 cost.reveal 展开根本产生不了
 *    （需要共享契约层的关键词 id 归一化决定）。
 * 2. 打出体的 choice.mode 结构被 Finalize 拒绝：实测 programs/play.ts 的 validateSurface 与
 *    chain/engine.ts 的 assertFinalizationSurface 都抛 ChainContractBlockedError
 *    「Mode choices require a Finalize/Resolve choice-plan adapter」。
 * 3. 「If you showed off」的判别式没有可执行谓词：合并 Condition 只有 always/never/compare/
 *    all/any/not/expression，没有读取 Finalize 展示结果的谓词，也没有它的链接值生产者；
 *    本卡用 choice.mode 的两个模式（showed-off / not-showed-off）保留结构，与已合入的
 *    ravenbloom-conservatory 处理不可表达分支的写法一致，不冒充可执行决策。
 * 4. cost.reveal / objects-shown-off 的消费方仍缺（全仓库只有 ShowOff.ts 自己提到
 *    cost.reveal），KeywordDef.expand 也仍拿不到印刷的 Object 子句（ShowOffParams.object
 *    无人填），展开里 object 仍是 null。
 *
 * 可执行部分：effect.token 的 play 路径（recruit，187.1）已合入，golden 用参考内核真实执行
 * 「play two 1 Might Recruit unit tokens to your base」；这不足以宣称整卡可执行。
 * 依赖：关键词 slug 与注册表键的一致性、cost.reveal / objects-shown-off 的 Finalize 消费方
 * 与 ShowOffParams 的印刷 Object 子句（无已分配任务号）、Finalize/Resolve choice-plan 适配器、
 * 「If you showed off」判别式谓词（进行中：RIFT-359 条件谓词）。
 */
const rousingDisplay = {
  canonicalCardId: "card.hash-e1dc41d23789b8f4890d5cd59e5dc7e12c0c0d447b2f09fd7acf63729930c55d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口，均实测，不近似实现：(1) 关键词 id 今天写不出来：契约校验器要求小写 symbol id" +
    "（SYMBOL_PATTERN，不含空格），而已合入的 KeywordDef 在注册表键与 keyword 字段都写成 \"Show Off\"" +
    "（effects/keywords/ShowOff.ts），programs/keywords.ts 的 definitionFor 只做大小写不敏感比较、" +
    "不归一化空格/连字符差异；实测 \"show-off\" 通过 validateCardProgram 但 describePlay 抛 judge-required" +
    "「Keyword show-off has no executable KeywordDef」，印刷拼写 \"Show Off\" 能展开却被校验器以" +
    "「Expected a lowercase keyword id」拒绝。打出流程在关键词展开处就中断，" +
    "effects/keywords/ShowOff.ts 已合入的 cost.reveal 展开根本产生不了（需要共享契约层的关键词 id 归一化决定）。" +
    "(2) 打出体的 choice.mode 被 Finalize 拒绝：实测 programs/play.ts 的 validateSurface 与 chain/engine.ts 的 " +
    "assertFinalizationSurface 都抛 ChainContractBlockedError「Mode choices require a Finalize/Resolve choice-plan adapter」。" +
    "(3)「If you showed off」的判别式没有可执行谓词：合并 Condition 没有读取 Finalize 展示结果的谓词，也没有产生该链接值的原语；" +
    "本卡用 choice.mode 的两个模式保留结构（与 ravenbloom-conservatory 处理不可表达分支的写法一致），不把玩家选择冒充为该判别式。" +
    "(4) cost.reveal / objects-shown-off 的消费方仍缺（全仓库只有 ShowOff.ts 自己提到 cost.reveal），" +
    "KeywordDef.expand 也仍拿不到印刷的 Object 子句（object 仍为 null）。" +
    "「play two 1 Might Recruit unit tokens to your base」的 effect.token play 路径已合入并由 golden 真实执行" +
    "（Recruit 定义 see CR 187.1），但局部执行不构成整卡证据。依赖：关键词 slug 与注册表键的一致性、" +
    "cost.reveal / objects-shown-off 的 Finalize 消费方与 ShowOffParams 的印刷 Object 子句（无已分配任务号）、" +
    "Finalize/Resolve choice-plan 适配器、「If you showed off」判别式谓词（进行中：RIFT-359 条件谓词）。",
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
