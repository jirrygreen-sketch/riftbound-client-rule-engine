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
 *   played-from-zone 谓词已能读取 card-played 的来源记录；自身 spell body 尚缺该来源输入
 *   和当前回合玩家输入。choice.mode 仅保留两个受阻正文，不代表玩家可自由选择数量。
 *
 * The Waters' Wage — CR v1.5 187.5 (Gold token), 184.1 (entry state),
 * 811.1.b / 811.6 (Hidden), 440.2.c / 185.2.a (play new tokens).
 * played-from-zone and the Hidden Hide/play cost planners are merged. This spell
 * still lacks the resolution inputs for its deterministic one/three branch,
 * Gold's definition and entry overrides. choice.mode preserves only the two
 * blocked bodies; it does not implement the printed condition. See judgeReason.
 */
const theWatersWage = {
  canonicalCardId: "card.hash-98b3c6e4016c853f5b0a9bdc4963a2a929fcb2930a1f1484367e5c546015fe0c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "CR 187.5：effect.token 缺带自身 Reaction 启动能力的 Gold gear token 定义。CR 184.1 / 185.2.d：effect.token 无 entry override，不能分别声明一个 exhausted Gold 与三个 ready Gold。判别式缺当前回合玩家的条件输入，以及自身 spell body 结算时的原始打出区域绑定：played-from-zone 谓词与 card-played 的来源记录已存在，但 chain/engine.ts 只把 trigger.event 传入条件环境，自身 card-played 在 body 之后产生，且当前 ZoneId 没有 facedown 来源区域，仍缺 Hidden 打出事实的记录适配；choice.mode 不能替代此确定性判别。CR 811.1.b / 811.6：cost.hidden 已有 Hide 与 ignore-base play 费用计划，仍缺 Hide/隐藏打出权限、次回合 Reaction 与该费用计划的生产接线。",
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
          // 两个待绑定的互斥正文；玩家选模式不能代替卡面判别式，整卡保持 blocked。
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
