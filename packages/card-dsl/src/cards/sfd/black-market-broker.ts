import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Black Market Broker (sfd-121-221) — Unit, Chaos, tag Zaun.
 * energy 3, power: none printed, Might 3.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-121-221，逐字）:
 *   "When you play a card from face down, play a Gold gear token exhausted."
 *
 * 规则依据（CR v1.5）：
 * - 383.1 / 383.2.a："When you play a card from face down" 是触发条件，时点为打出
 *   （封闭时点 card-played，ruleRefs 359/383.4.a/407；"you" 用 PlayerSelector
 *   "self" 表达为能力控制者，190.6.d）。
 * - "from face down" 指从 Facedown Zone 打出（355.9.a.3 定义 "Facedown card"；
 *   107.3.a 每个战场有一个 Facedown Zone，107.3.e 它不是 location；422.2.a 与
 *   811.1.c.3 规定从面朝下打出会开启链）。
 * - "play a Gold gear token exhausted"：440.2.c / 185.2.a 规定被"打出"的 token
 *   先在链上生成再由打出流程接手（350.2/354）；184.1 / 185.2.d 允许效果规定该
 *   token 以横置状态入场。Gold gear token 的印刷定义见 187.5。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。两处当前真实缺口：
 * - 触发条件 "from face down" 已用 RIFT-359 合入的 played-from-zone 谓词表达，
 *   读取 card-played 的来源区域事实；但当前 ZoneId/Hidden 打出路径没有 Facedown Zone
 *   的生产接线，真实游戏事件无法产生该来源值，故仍 fail-closed。
 * - token 体：Gold 定义（187.5，自带 "[Reaction][>] Kill this, [E]: [Add] [A]"）不在
 *   effect.token 的冻结定义表里——该文件明确 Gold 等自带能力的定义保持 blocked/judge-required；
 *   mode "play" 的链上创建与交接本身已由原语支持并执行；"exhausted" 是入场规定
 *   （184.1/185.2.d），但当前 effect.token 不支持入场状态改写，effect.exhaust 的事后横置
 *   会多一次「成为横置」事件、错过 143.4，故不近似。
 * 依赖：Facedown Zone/Hidden 打出路径、exhausted 入场状态、Gold 冻结定义。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      // "when you play a card from face down"：必须是你打出的牌；来源区域由
      // played-from-zone 条件读取 card-played 的事件载荷，而不是把普通打出算进去。
      filter: {
        event: "card-played",
        player: "self"
      },
      condition: { kind: "played-from-zone", zone: "facedown", object: "object" }
    },
    optional: false,
    body: [
      {
        id: "black-market-broker.play-gold-token",
        op: "effect.token",
        args: {
          token: { kind: "constant", value: "gold" },
          amount: { kind: "constant", value: 1 },
          // 440.2.c / 185.2.a：被「打出」的 token 先在链上生成。
          mode: { kind: "constant", value: "play" },
          // 名义上的装备 token 目的地；"exhausted" 是入场规定（184.1/185.2.d），
          // 从不写成事后的 effect.exhaust（143.4）。
          location: { kind: "constant", value: { type: "base", player: "controller" } },
          entersExhausted: { kind: "constant", value: true },
          linkKey: { kind: "constant", value: "goldToken" }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-d7a7aec53d72022d855ed2a7d4b387ece5fe5cdc5097de61bdb909825242b5dd",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "触发条件「when you play a card from face down」已改用 played-from-zone 谓词读取 card-played 来源事实，" +
    "对应 CR 355.9.a.3 / 107.3.a / 107.3.e；但当前 ZoneId/Hidden 打出路径没有 CR 107.3 的 Facedown Zone 生产接线，真实游戏事件不会产生 " +
    "zone=facedown 的来源值，因此该条件仍按 fail-closed 处理，不能把普通 card-played 当成满足。" +
    "token 体仍不可完整执行：Gold gear token（CR 187.5 自带 [Reaction][>] Kill this, [E]: [Add] [A]）" +
    "不在 effect.token 的冻结定义表里（该文件明确 Gold 等自带能力的定义保持 blocked/judge-required）；" +
    "mode \"play\" 按 440.2.c/185.2.a/350.2/354 的链上创建与交接本身已可执行；但「exhausted」是入场规定（184.1/185.2.d），" +
    "当前 effect.token 不支持入场状态改写，effect.exhaust 的事后横置会多一次「成为横置」事件并错过 143.4，故不近似。" +
    "依赖：Facedown Zone/Hidden 打出生产接线、Gold token 冻结定义、exhausted 入场状态。",
  abilities,
  sourceText: "When you play a card from face down, play a Gold gear token exhausted."
} satisfies CardProgram;

export default program;
