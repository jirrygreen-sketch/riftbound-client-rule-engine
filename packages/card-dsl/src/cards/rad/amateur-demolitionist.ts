import type { CardProgram } from "../../ir/index.js";

/**
 * Amateur Demolitionist (rad-001-167) — Unit, Chaos, 2 energy / 1 Might.
 *
 * 原文（deck-catalog rad-001-167，逐字）：
 *   "When you play me, play a Bomb gear token to a battlefield. (It has [Deploy].
 *    When it dies, deal 2 to an enemy there and kill your other Bombs there.)"
 *
 * 规则依据（CR v1.5）：
 * - "When you play me" = Play Effect（383.4.a），时点 card-played；
 * - "play a … token" = 新 token 经链上生成后打出（440.2.c、185.2.a、350.2、354），
 *   对应 effect.token 的 mode: "play"（契约 3.6 GameAction create-token to: "chain"）；
 * - "to a battlefield"：战场是地点选择，不是目标（355.10.b “Play a unit from your hand
 *   to a battlefield doesn't target a battlefield”），因此用非目标 pick 提供目的地
 *   （effect.token 的 pick 形式：所选 Board 对象的 location 即目的地），不写成 TargetSpec；
 * - Bomb gear token = CR 187.12（domainless gear token，带 "[Deploy]" 与
 *   "[Deathknell][>] Deal 2 to an enemy unit here and kill all other Bombs you control here."）。
 *
 * status: judge-required（不近似实现）：
 * - effect.token 的定义表（recruit / sand-soldier / mech / reflection / tentacle）不含
 *   Bomb；带自身能力的 token 定义按该原语文件说明保持 blocked
 *   （negated + blockedReason "token-definition-or-abilities-judge-required"），
 *   Bomb 的 Deploy / Deathknell 展开依赖关键词注册表（Deploy 无 KeywordDef）与
 *   事件/替代管线；
 * - "play" mode 的链上生成 + 打出流程需要链管线的 token 接手（RIFT-62/RIFT-66 之后仍在
 *   收敛中）。
 */
const program = {
  canonicalCardId: "card.hash-19dbd19038a6e261cba3253b41f902ba0a6e7533f33da771cc4fd6b644de55ec",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Bomb gear token 定义缺失：effect.token 的冻结定义表不含 bomb（含自身能力的 token 按原语" +
    "说明保持 blocked，返回 blockedReason \"token-definition-or-abilities-judge-required\"），" +
    "且 Bomb 的 [Deploy] / [Deathknell] 展开依赖关键词注册表与事件/替代管线" +
    "（Deploy 无 KeywordDef；依赖 RIFT-83/RIFT-84 与 RIFT-91）。effect.token mode \"play\" " +
    "（440.2.c / 185.2.a 链上生成 + 打出）由链管线接手，卡牌侧只声明形状；" +
    "战场目的地选择（355.10.b 非目标地点选择）已按 pick 表达。不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: { at: "card-played", filter: { self: true } },
      optional: false,
      body: [
        {
          id: "amateur-demolitionist.play-bomb",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "bomb" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            pick: { kind: "constant", value: "amateur-demolitionist.battlefield" }
          },
          picks: [
            {
              id: "amateur-demolitionist.battlefield",
              options: ["battlefield-in-play"],
              filter: { type: "battlefield" },
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
    "When you play me, play a Bomb gear token to a battlefield. (It has [Deploy]. When it dies, deal 2 to an enemy there and kill your other Bombs there.)"
} satisfies CardProgram;

export default program;
