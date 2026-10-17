import type { CardProgram } from "../../ir/index.js";

/**
 * The Waters' Wage（rad-100-167）— Spell，1 能量，无印刷力量，领域 Chaos。
 *
 * 原文（packages/card-data/data/deck-catalog.json rad-100-167，逐字）：
 *   "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)
 *    Play a Gold gear token exhausted. If it's your turn and you played this from face down,
 *    play three ready Gold gear tokens instead. (Gold tokens have "[Reaction][>] Kill this,
 *    :rb_exhaust:: [Add] :rb_rune_rainbow:.")"
 *
 * 规则依据（CR v1.5）：
 * - [Hidden]（811）是关键词，effects/keywords/Hidden.ts 已合入并展开为 static cost.hidden；
 *   811.1.b 的手牌/冠军区隐藏许可、811.1.c 的 Hide 自重动作、811.6 隐藏次回合起的 Reaction
 *   许可仍归费用/区域/时机系统（见 judgeReason）。卡牌只声明。
 * - 「Play a Gold gear token exhausted」：Gold 是 CR 187.5 定义的 gear token（带
 *   "[Reaction][>] Kill this, [E]: [Add] [A]." 自身能力）；被「打出」的 token 按 440.2.c /
 *   185.2.a 先在链上生成再由 play 接手，185.2.d / 143.4 的入场状态由创建/打出动作负责。
 * - 「If it's your turn and you played this from face down」是决定两个互斥数量分支（"…instead"）
 *   的判别式：355.3 / 355.16 的 Finalize 决定与 811.1.d 的 facedown 信息由引擎记录。
 *   合并 IR 没有读取该结果的谓词，因此两个分支用 choice.mode 的两个模式保留结构
 *   （契约 3.9），判别式的缺口见 judgeReason 第 3 点，不写成 linkedTo 串联。
 *
 * status = judge-required（不近似实现）：
 * 1. Gold token 定义缺失：effect.token 的 DEFINITIONS 表不含 gold，带自身能力的 token
 *    被显式阻断（blockedReason: token-definition-or-abilities-judge-required）。依赖 token
 *    定义表扩充（CR 187.5）。
 * 2. exhausted 入场覆盖不可表达：effect.token 文档明确「Entry overrides are not supported」
 *    （143.4 / 185.2.d），"play … exhausted" 与 "ready" 的差别没有原语路径；entersExhausted
 *   不是 effect.token 的注册参数（fail-closed 拒绝），replacement.enter 只覆盖永久的入场方向，
 *    不覆盖单次 token 创建。
 * 3. 判别式「it's your turn and you played this from face down」（811.1.d）需要读取打出方式与
 *    当前回合玩家的可执行谓词，合并 Condition 只有 always/never/compare/all/any/not/
 *    expression，没有对应谓词（context.test 只求值 IR 条件），因此两个数量分支只保留
 *    choice.mode 结构，不写成可求值条件。
 *
 * 依赖：token 定义表扩充、RIFT-257（卡牌 static/关键词绑定）与 RIFT-261（费用指令）。
 * golden 只做校验与结构断言，并对已合入的 token 原语做真实执行边界（非黄金定义被显式 negated）。
 */
const theWatersWage = {
  canonicalCardId: "card.hash-98b3c6e4016c853f5b0a9bdc4963a2a929fcb2930a1f1484367e5c546015fe0c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处依赖未合入，均不近似实现：(1) Gold gear token 定义（CR 187.5，带自身的 " +
    '"[Reaction][>] Kill this, [E]: [Add] [A]" 能力）不在 effect.token 的 DEFINITIONS 表，' +
    "带能力的 token 被 effect.token 显式阻断（token-definition-or-abilities-judge-required）" +
    "（依赖 token 定义表扩充）。(2) exhausted 入场覆盖：effect.token 明确不支持 entry overrides（143.4 / 185.2.d），" +
    '"play … exhausted" 与 "ready" 的差别没有原语路径；replacement.enter 只覆盖永久物的入场方向，不覆盖单次 token 创建。' +
    "(3) 判别式「it's your turn and you played this from face down」" +
    "（811.1.d）需要读取打出方式与当前回合玩家的可执行谓词，合并 Condition 没有该谓词（context.test 只求值 IR 条件），" +
    "因此两个数量分支只保留 choice.mode 结构，不写成可求值条件。" +
    "另：[Hidden] 的 KeywordDef 已合入（effects/keywords/Hidden.ts），但卡牌关键词 → 打出/费用管线的绑定仍待 RIFT-257，" +
    "Hide 动作与隐藏次回合 Reaction 许可依赖 RIFT-261（cost.hidden/cost.pay 未合入）。不近似实现上述缺口。",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 1 }
      },
      body: [
        {
          // 两个互斥分支（原文 "instead"）：用 choice.mode 表达，不用 linkedTo 串联。
          id: "the-waters-wage.choose-amount",
          op: "choice.mode",
          args: {
            count: { kind: "constant", value: 1 },
            different: { kind: "constant", value: true },
            modes: {
              kind: "constant",
              value: [
                {
                  id: "the-waters-wage-one",
                  body: [
                    {
                      id: "the-waters-wage.play-gold-exhausted",
                      op: "effect.token",
                      args: {
                        token: { kind: "constant", value: "gold" },
                        amount: { kind: "constant", value: 1 },
                        mode: { kind: "constant", value: "play" },
                        location: {
                          kind: "constant",
                          value: { type: "base", player: "controller" }
                        },
                        // 185.2.d / 143.4 的入场状态由创建/打出动作负责；effect.token 不支持该
                        // 覆盖（见 judgeReason 第 2 点）。
                        entersExhausted: { kind: "constant", value: true },
                        linkKey: { kind: "constant", value: "goldToken" }
                      }
                    }
                  ]
                },
                {
                  id: "the-waters-wage-three",
                  body: [
                    {
                      id: "the-waters-wage.play-3-ready-gold",
                      op: "effect.token",
                      args: {
                        token: { kind: "constant", value: "gold" },
                        amount: { kind: "constant", value: 3 },
                        mode: { kind: "constant", value: "play" },
                        location: {
                          kind: "constant",
                          value: { type: "base", player: "controller" }
                        },
                        entersExhausted: { kind: "constant", value: false },
                        linkKey: { kind: "constant", value: "goldTokens" }
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
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "Play a Gold gear token exhausted. If it's your turn and you played this from face down, " +
    "play three ready Gold gear tokens instead. (Gold tokens have \"[Reaction][>] Kill this, " +
    ":rb_exhaust:: [Add] :rb_rune_rainbow:.\")"
} satisfies CardProgram;

export default theWatersWage;
