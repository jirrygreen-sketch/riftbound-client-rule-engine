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
 * status: judge-required（复核 2026-10-17；不近似实现）：
 * - effect.token 的冻结定义表（recruit / sand-soldier / mech / reflection / tentacle）不含
 *   Bomb（CR 187.12 的带 [Deploy] / [Deathknell] 定义）：带自身能力的 token 定义按该
 *   原语文件说明保持 blocked（实测 negated + blockedReason
 *   "token-definition-or-abilities-judge-required"）。Deploy / Deathknell 的 KeywordDef
 *   已合入（RIFT-267 / RIFT-265），但 token 定义表本身仍是闭集，卡牌侧不能新增定义；
 * - 生产链上的打出还缺接线：chain/engine.ts 对 Play 动作要求调用方提供 describePlay，
 *   effect.token 的 mode "play" 只能提交 { type: "play" } 动作，而当前 host
 *   （apps/game-server 的 EngineRuntimeHost）对该动作返回 impossible，所以链上生成 +
 *   打出的整段只能在参照内核里执行。
 * RIFT-257 的 CardProgram 绑定与 RIFT-261 的费用种类/cost.pay 已合入，不再是缺口。
 */
const program = {
  canonicalCardId: "card.hash-19dbd19038a6e261cba3253b41f902ba0a6e7533f33da771cc4fd6b644de55ec",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "(1) Bomb gear token 定义缺失：effect.token 的冻结定义表不含 bomb（CR 187.12 的带自身能力" +
    "定义按原语说明保持 blocked，返回 blockedReason \"token-definition-or-abilities-judge-required\"）；" +
    "Deploy / Deathknell 的 KeywordDef 虽已合入（RIFT-267 / RIFT-265），卡牌侧仍不能为 Bomb 补定义。" +
    "(2) mode \"play\" 的链上生成 + 打出（440.2.c / 185.2.a）缺生产接线：chain/engine.ts 的" +
    "Play 动作要求调用方提供 describePlay 卡牌程序适配器，而 EngineRuntimeHost 对 { type: \"play\" }" +
    " 返回 impossible，整段只能在参照内核执行。" +
    "RIFT-257 的 CardProgram 绑定与 RIFT-261 的费用种类/cost.pay 已合入，不再是缺口；" +
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
