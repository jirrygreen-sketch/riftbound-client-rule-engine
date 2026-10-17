import type { CardProgram } from "../../ir/index.js";

/**
 * Party Favors (ogn-071-298) — Spell, 3 energy, Calm.
 *
 * Printed text (packages/card-data/data/deck-catalog.json, ogn-071-298):
 *   Each other player chooses Cards or Runes. For each player that chooses
 *   Cards, you and that player each draw 1. For each player that chooses Runes,
 *   you and that player each channel 1 rune exhausted.
 *
 * Modeling notes (Core Rules v1.5):
 * - No [Action]/[Reaction] is printed, so the spell keeps default spell timing
 *   (159.2.a / 308.1.a); no speed keyword is declared.
 * - "Each other player chooses Cards or Runes" is a resolution-time choice
 *   made by OTHER players. Two rules decide its shape: 355.10.e (a set of
 *   objects "chosen in whole or in part by other players" is not Targeted) and
 *   355.18/355.5.a (choices made at resolution rather than during
 *   finalization). ResolveContext.choose (contract 3.6) takes exactly one
 *   chooser per request, and choice.mode's chooser is a single static id, so
 *   the table-wide chooser set and its one-per-other-player iteration have no
 *   merged node; 355.10 targets are not involved. The placeholder opcode
 *   choice.each-other-player below is likewise unregistered in the merged
 *   instruction registry (a run would throw the unregistered-opcode error).
 * - The two outcome clauses are ordinary merged primitives: "each draw 1" is
 *   effect.draw (414.3) and "each channel 1 rune exhausted" is effect.channel
 *   with the printed entry stipulation (431.1/431.2). Which player draws or
 *   channels is per-choice data (the caster and the choosing player), which is
 *   why the whole effect depends on the missing chooser step first.
 * - Where the catalog line is unambiguous, the printed pairing is preserved:
 *   each clause acts on the caster and the choosing player together, so the
 *   instruction carries both seats rather than only the caster.
 *
 * Status: judge-required. The choice step is the blocker: choice.each-other-player
 * is an unregistered opcode in the merged instruction registry, the merged IR has no
 * node that queries the other seats, no Expr that yields a player list, and no
 * repetition over choosers, so "for each player that chooses ..." can neither
 * be decided nor counted. Without the choice results the two effect clauses
 * cannot be gated, and emitting them unconditionally would invent the outcome.
 */
const partyFavors = {
  canonicalCardId: "card.hash-545730428f68ed4f654f780ffcb9e3789ff51480ea2f17983910893660b0dc3f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺「其他玩家各选一次」的多玩家选择与逐选定玩家分支：CR 355.10.e 规定由其他玩家（全部或部分）选出的对象集合不取目标，" +
    "355.18/355.5.a 规定这类选择在结算时进行；占位指令 choice.each-other-player 未注册，" +
    "契约 3.6 的 choose 每次只支持一个 chooser，" +
    "choice.mode 的 chooser 是单个静态 id，IR 也没有能产出「其他玩家」席位列表的 Expr 或按席位重复的控制结构，" +
    "因此「Each other player chooses Cards or Runes.」无法声明；后续「For each player that chooses X」需要按上述选择结果分支" +
    "（且计数逐玩家），没有该结果绑定就无法判定两个分支。effect.draw（414.3）与 effect.channel（431.1/431.2，含 exhausted 入场）" +
    "本身已合入，但只能在一个确定的玩家上执行。依赖：多玩家选择/逐玩家结果协调与 player-list " +
    "表达式。不近似实现。",
  abilities: [
    {
      kind: "play",
      body: [
        {
          // "Each other player chooses Cards or Runes." One mode choice per
          // other player, at resolution: no merged node enumerates the
          // choosers or repeats the choice (see judgeReason). The chosen
          // option drives which of the two clauses below applies.
          id: "party-favors.each-other-player-chooses",
          op: "choice.each-other-player",
          args: {
            choosers: { kind: "constant", value: "each-other-player" },
            different: { kind: "constant", value: true },
            modes: {
              kind: "constant",
              value: [
                {
                  id: "cards",
                  body: []
                },
                {
                  id: "runes",
                  body: []
                }
              ]
            }
          }
        },
        {
          // "For each player that chooses Cards, you and that player each
          // draw 1." Two seats, one draw each: the caster's is the merged
          // default (190.6.d), the choosing player's is the per-choice seat.
          id: "party-favors.draw-per-cards-chooser",
          op: "effect.draw",
          linkedTo: "party-favors.each-other-player-chooses",
          args: {
            amount: { kind: "constant", value: 1 },
            player: { kind: "constant", value: "choice.player" }
          }
        },
        {
          // "For each player that chooses Runes, you and that player each
          // channel 1 rune exhausted" (431.1/431.2).
          id: "party-favors.channel-per-runes-chooser",
          op: "effect.channel",
          linkedTo: "party-favors.each-other-player-chooses",
          args: {
            player: { kind: "constant", value: "choice.player" },
            amount: { kind: "constant", value: 1 },
            exhausted: { kind: "constant", value: true }
          }
        }
      ]
    }
  ],
  sourceText:
    "Each other player chooses Cards or Runes. For each player that chooses Cards, " +
    "you and that player each draw 1. For each player that chooses Runes, " +
    "you and that player each channel 1 rune exhausted."
} satisfies CardProgram;

export default partyFavors;

