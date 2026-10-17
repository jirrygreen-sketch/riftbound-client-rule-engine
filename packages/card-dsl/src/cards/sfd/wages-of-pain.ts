import type { CardProgram } from "../../ir/index.js";

/**
 * Wages of Pain — sfd-070-221 (Spell, Mind, Rumble SFD champion precon).
 *
 * Printed text:
 *   [Hidden] (Hide now for [A] to react with later for [0].)
 *   [Action] (Play on your turn or in showdowns.)
 *   Deal 3 to a unit at a battlefield. Play a Gold gear token exhausted.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Hidden] (811) / [Action] (806) are keyword abilities expanded by the
 *   keyword registry (contract 3.7).
 * - "Deal 3 to a unit at a battlefield" is one targeted effect.damage
 *   instruction; the target filter pins the unit to a battlefield location
 *   (location.type "battlefield"). When this card is played from facedown,
 *   811.1.d.2 further restricts the target to the battlefield it was hidden
 *   at; that restriction is enforced by the target system at Finalize
 *   (RIFT-90), not by this data.
 * - "Play a Gold gear token exhausted." is NOT expressible with merged
 *   primitives, so this card stays judge-required:
 *   - effect.token (RIFT-63) resolves definition ids through its frozen table,
 *     which deliberately excludes a Gold gear token because CR 187.5 gives it
 *     its own printed ability "[Reaction][>] Kill this, [E]: [Add] [A]"; the
 *     primitive documents such definitions as blocked/judge-required and returns
 *     blockedReason "token-definition-or-abilities-judge-required".
 *   - "exhausted" is an entry stipulation (184.1 / 185.2.d), and the creation/play
 *     actions do not support entry overrides (143.4); a later effect.exhaust is
 *     not equivalent.
 *   The chain-create + play handoff itself is merged (RIFT-62), so the token half's
 *   remaining gap is the Gold definition plus the entry state.
 *   The damage half is fully described and executed by the golden test.
 */
const wagesOfPain = {
  canonicalCardId: "card.hash-431738fdce44471075e7d0f77a009dde71d56c7be7e2c9ef022d6b124a857a3c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    '"Play a Gold gear token exhausted." 仍无原语：CR 187.5 的 Gold gear token 自带印刷能力 “[Reaction][>] Kill this, [E]: [Add] [A]”，' +
    "effect.token 的冻结定义表刻意排除带能力的 token，对该定义会以 negated + blockedReason " +
    '"token-definition-or-abilities-judge-required" 拒绝；“exhausted”是入场状态规定（184.1/185.2.d），' +
    "create-token/play 不支持入场改写（143.4，事后 effect.exhaust 不等价）。" +
    "链上创建 + play 接手本身已合入（RIFT-62），因此该半段剩余缺口就是 Gold 定义与入场状态；" +
    "「Deal 3 to a unit at a battlefield」半段用已合入的 effect.damage 表达（含目标失效 ignored 的边界），golden 真实执行。" +
    "token 半段改用已合入的 effect.token 记录真实参数（token/amount/mode/location + entersExhausted），不再用不存在的占位 opcode；" +
    "entersExhausted 会被原语 schema 明确拒绝（fail-closed），golden 记录该行为。依赖：Gold 定义（187.5）与入场状态改写（184.1/185.2.d）。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          id: "deal-3",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 3 },
            target: { kind: "constant", value: "damaged-unit" }
          },
          targets: [
            {
              id: "damaged-unit",
              filter: { type: "unit", location: "battlefield" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "Play a Gold gear token exhausted." — authored with the token args
          // the merged primitive consumes, plus the entry-stipulation argument
          // the primitive's schema rejects. The Gold definition itself is absent
          // from the frozen table (see judgeReason).
          id: "play-gold-token",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "gold" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            location: { kind: "constant", value: { type: "base", player: "controller" } },
            entersExhausted: { kind: "constant", value: true },
            linkKey: { kind: "constant", value: "goldToken" }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Deal 3 to a unit at a battlefield. Play a Gold gear token exhausted."
} satisfies CardProgram;

export default wagesOfPain;
