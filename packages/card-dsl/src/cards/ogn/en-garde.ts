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
 * Status: judge-required — both Might clauses need a primitive that is not
 * merged:
 * - "+1 Might this turn" / "an additional +1 Might this turn" are temporary
 *   Might modifications. The closed GameAction set of contract 3.6 has no
 *   Might-modification action, and effect.buff's own header states that
 *   temporary Might changes belong to continuous.might, never to the Buff
 *   primitive (CR 703: a Buff contributes +1 Might because it is a counter,
 *   which is not the same object as a temporary Might modification). The
 *   merged layers engine does evaluate arithmetic-layer continuous.might
 *   registrations and expires end-of-turn durations, but no file under
 *   effects/instructions/ registers one through ResolveContext.addContinuous,
 *   so no merged opcode reaches that engine path for a resolving spell.
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
    "缺临时 Might 修正原语：“+1 Might this turn”与“若它是你在那里的唯一单位则再 +1 Might this turn”" +
    "都是带回合期限的临时 Might 修改；契约 3.6 的封闭 GameAction 集合没有 Might 修改动作，" +
    "effect.buff 文件头也明确临时 Might 归 continuous.might（layers 引擎已能求值 arithmetic 层持续效果，" +
    "但 effects/instructions 下没有任何注册该持续效果的原语通过 ResolveContext.addContinuous 落地），" +
    "CR 703 的 Buff 计数与它是两回事。两条子句顺序执行、第二条带条件（CR 158.1），" +
    "因此写成两条 continuous.might，第二条带“你在目标所在地只有它一个单位”的 count 条件；" +
    "依赖 continuous.might 指令原语（RIFT-9 清单；RIFT-91 已合入 layers 求值侧）。不近似实现。",
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
            duration: { kind: "constant", value: "this-turn" }
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
            duration: { kind: "constant", value: "this-turn" }
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
