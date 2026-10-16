import type { CardProgram } from "../../ir/index.js";

/**
 * Decisive Strike, Garen (ogs-024-024) — Spell, 5 energy + 1 Order power
 * (Body/Order), tags Garen/Signature.
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Give friendly units +2 :rb_might: this turn.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Action] (806) is declared as a keyword ability; the registry owns the
 *   Showdown permission (806.1.b/806.1.c, 159.2.a).
 * - "friendly units" is an unfiltered set of every unit the controller
 *   controls: no choice is ever made, so the units are not Targeted
 *   (355.10.d, 355.10.d.1 - the rule's own example is "Kill all units at
 *   battlefields", which targets nothing). The set is therefore declared with
 *   the resolve-time query descriptor shape merged primitives use, while
 *   "this turn" fixes the duration as the end of the turn.
 * - "+2 [M] this turn" is a temporary Might modification, not a Buff counter
 *   (702: a Buff counter is a distinct object that contributes +1 Might; it is
 *   not a Might value change).
 *
 * Status: judge-required — there is no merged instruction for a temporary
 * continuous Might modification: effects/instructions exposes no opcode that
 * registers `ResolveContext.addContinuous`, so the merged arithmetic layer
 * (RIFT-91) cannot be reached from a card program, and effect.buff only places
 * Buff counters. Approximating +2 Might with Buff counters would change the
 * unit's Buff state and would be wrong for other effects that read it, so the
 * instruction is authored through the layers contract shape and the card stays
 * judge-required. The same gap keeps sfd-097-221 Punch First and ogn-145-298
 * Primal Strength judge-required.
 */
const decisiveStrikeGaren = {
  canonicalCardId: "card.hash-8ede68abdc12ce7e49e3fb3df89263c308b4405bac8deb070fc67b27cf1b3a30",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺临时 Might 修正指令原语：“Give friendly units +2 Might this turn”是带 end-of-turn 期限、" +
    "作用于“你控制的所有单位”的 continuous.might 持续效果；契约 3.6 的封闭 GameAction 集合没有 Might 修改动作，" +
    "effect.buff 只放置 Buff 计数（CR 702：Buff 计数不是 Might 修改），effects/instructions 下没有任何指令通过 " +
    "ResolveContext.addContinuous 注册该持续效果（layers 引擎已能求值算术层，RIFT-91，但没有指令入口）。" +
    "不近似实现（用 Buff 计数顶替会改变单位的 Buff 状态）。依赖：continuous.might 指令原语（RIFT-91 求值侧已合入，缺指令接线）。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 5 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          // "Give friendly units +2 [M] this turn" — described through the
          // layers contract shape; no merged primitive consumes it yet (see
          // judgeReason). The units are a programmatic set, not targets
          // (355.10.d), so the instruction declares no TargetSpec.
          id: "decisive-strike-garen.grant-plus-2-might",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 2 },
            duration: { kind: "constant", value: "end-of-turn" },
            objects: {
              kind: "constant",
              value: {
                kind: "query",
                filter: { type: "unit", controller: "self" }
              }
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Give friendly units +2 :rb_might: this turn."
} satisfies CardProgram;

export default decisiveStrikeGaren;
