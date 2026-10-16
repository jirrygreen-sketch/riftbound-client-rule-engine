import type { CardProgram } from "../../ir/index.js";

/**
 * En Garde (ogn-046-298) — Spell, 1 energy (Calm).
 *
 * Printed text:
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Give a friendly unit +1 :rb_might: this turn, then an additional
 *   +1 :rb_might: this turn if it is the only unit you control there.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Reaction] (813) is a keyword ability expanded by the keyword registry
 *   (contract 3.7); the card only names it.
 * - "a friendly unit" is a target (355.7 / 355.9.b: a named unit the player
 *   controls); "there" is that target's Location, so the follow-up condition
 *   is a count of the controller's units at the target's Location
 *   ("the only unit you control there"). The count expression anchors on the
 *   target with `sameLocationAs` and excludes the target itself, which the
 *   interpreter's set-query anchors support (contract 3.6 selectors).
 *
 * Status: judge-required — both Might clauses use the merged continuous.might
 * instruction, but the complete Reaction play still needs card-program and
 * timing integration:
 * - "+1 Might this turn" / "an additional +1 Might this turn" are temporary
 *   Might modifications. The closed GameAction set of contract 3.6 has no
 *   Might-modification action, and effect.buff's own header states that
 *   temporary Might changes belong to continuous.might, never to the Buff
 *   primitive (CR 703: a Buff contributes +1 Might because it is a counter,
 *   which is not the same object as a temporary Might modification). The
 *   merged layers engine evaluates arithmetic-layer continuous.might
 *   registrations and expires end-of-turn durations; the instruction is
 *   registered under effects/instructions/continuous.might.ts.
 * - The two clauses are sequential and the second is conditional (CR 158.1:
 *   a spell's text executes top to bottom), so the shape is two consecutive
 *   continuous.might instructions with the second carrying the condition;
 *   neither can execute today. Not approximated with effect.buff counters.
 */
const enGarde = {
  canonicalCardId: "card.hash-9e538f0004c80732dc1212c4b54ff1803de134cd9a4b8e1bb91a6c710b43a73a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "continuous.might 原语与 end-of-turn 图层消费已经合入（RIFT-258/259），两条 +1 Might 子句可由解释器真实注册；" +
    "仍缺 Reaction 卡牌从 CardProgram 到 Chain 的速度、目标绑定与条件查询接线，尤其是“唯一友方单位”条件在正式 Finalize/Resolve 上下文的生命周期接入" +
    "（RIFT-257；CR 158.1、355.9.b）。不近似实现。",
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Give a friendly unit +1 :rb_might: this turn, then an additional +1 :rb_might: this turn " +
    "if it is the only unit you control there.",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      body: [
        {
          id: "grant-plus-1",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 1 },
            duration: { kind: "constant", value: "this-turn" },
            target: { kind: "constant", value: "friendly-unit" }
          },
          targets: [
            {
              id: "friendly-unit",
              filter: { type: "unit", controller: "controller" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "then an additional +1 Might this turn if it is the only unit you
          // control there" — the same target, gated on the location count:
          // the controller's units at the target's location, excluding the
          // target itself, must be zero. The condition is per-instruction
          // (contract 3.4).
          id: "grant-plus-1-conditional",
          op: "continuous.might",
          condition: {
            kind: "compare",
            left: {
              kind: "count",
              subject: "units",
              filter: {
                type: "unit",
                controller: "controller",
                sameLocationAs: { target: "friendly-unit" },
                exclude: { target: "friendly-unit" }
              }
            },
            operator: "eq",
            right: { kind: "constant", value: 0 }
          },
          args: {
            amount: { kind: "constant", value: 1 },
            duration: { kind: "constant", value: "this-turn" },
            target: { kind: "constant", value: "friendly-unit" }
          },
          targets: [
            {
              id: "friendly-unit",
              filter: { type: "unit", controller: "controller" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ]
} satisfies CardProgram;

export default enGarde;
