import type { CardProgram } from "../../ir/index.js";

/**
 * Primal Strength (ogn-154-298) — Spell, 4 energy + 1 Body power.
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Give a unit +7 :rb_might: this turn.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Action] (806) is declared as a keyword ability; the keyword registry
 *   owns its expansion (contract 3.7).
 * - "Give a unit +7 :rb_might: this turn" chooses one unit on the board
 *   (355.9.a.1: "unit" means an object on the board unless stated otherwise),
 *   so the instruction carries a one-unit TargetSpec.
 * - The modification itself is a temporary Might change. Contract 3.6's closed
 *   GameAction set has no Might-modification action, and effect.buff documents
 *   that Buff counters (702/703) are not temporary Might changes. The layers
 *   engine landed (RIFT-91) and its duration registry owns "this turn" expiry,
 *   but no merged instruction primitive registers a continuous.might effect
 *   through ctx.addContinuous, so this body cannot be executed. Recorded as
 *   judge-required; not approximated with Buff counters.
 */
const primalStrength = {
  canonicalCardId: "card.hash-973d0d5d514cd0b81080d51a93fd58adb4be5b542b6ac111f49c4202d30e1abf",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺注册 continuous.might 的指令原语：effects/instructions 下没有对应文件，契约 3.6 的封闭 GameAction 集合" +
    "也没有 Might 修改动作；图层引擎（RIFT-91）只消费 RegisteredContinuousEffect，卡牌 IR 没有把 Might 修正" +
    "注册进图层的 opcode，因此“Give a unit +7 M this turn”无法执行（this-turn 到期由 layers/duration 负责，" +
    "但仍需该原语才能落地）。effect.buff 边界明确只做 Buff 计数（702/703），不得用来近似临时 Might 修正。" +
    "依赖：continuous.might 指令原语。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          id: "primal-strength.give-plus-7",
          // Pending instruction primitive (continuous.might): +7 Might for the
          // rest of the turn, applied in the layers arithmetic layer and
          // expiring at cleanup.
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 7 },
            duration: { kind: "constant", value: "this-turn" }
          },
          targets: [
            {
              id: "primal-strength.unit",
              filter: { type: "unit", zone: "board" },
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
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Give a unit +7 :rb_might: this turn."
} satisfies CardProgram;

export default primalStrength;

