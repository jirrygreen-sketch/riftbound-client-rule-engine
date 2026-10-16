import type { CardProgram } from "../../ir/index.js";

/**
 * Gentlemen's Duel (ogs-008-024) — Spell, 6 energy + 1 Body power (Body).
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Give a friendly unit +3 :rb_might: this turn. Then choose an enemy unit.
 *   They deal damage equal to their Mights to each other.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Action] (806) is declared as a keyword ability; the registry owns the
 *   Showdown permission (806.1.b/806.1.c, 159.2.a).
 * - "Give a friendly unit +3 [M] this turn" is a temporary continuous Might
 *   modification: it is not a Buff (702: a Buff counter is not a Might value
 *   change) and it expires at the end of the turn (continuous.might with an
 *   end-of-turn duration).
 * - "Then choose an enemy unit" is a targeting choice, not the 388.1 reflexive
 *   "do this" marker: both objects are chosen while this spell is finalized on
 *   the chain (355.5, 355.7), so the friendly unit and the enemy unit are
 *   TargetSpecs of this program.
 * - "They deal damage equal to their Mights to each other" is two Deal actions
 *   whose source is the unit, not this spell (418.6.b.3), and whose amounts are
 *   read at execution time (359.3.f.2). Both are ordinary effect.damage
 *   instructions: one with the friendly unit as source and amount, one with the
 *   enemy unit as source and amount. 418.1.d allows damage to more than one unit
 *   at the same time, and the whole spell finishes resolving before cleanup, so
 *   neither instruction is skipped because the other already dealt lethal
 *   damage (158.3.a, 323.4). The +3 Might grant and the first Deal are separate
 *   instructions executed top to bottom (359.3.d) with no reference between
 *   them, so they are not linked. The two Deals do reference each other ("they
 *   deal damage equal to their Mights to each other" reads both units), so the
 *   second is linked to the first: a first Deal that is ignored also ignores the
 *   second (359.3.e.14.a).
 *
 * Status: judge-required — the +3 Might half has no merged primitive:
 * effects/instructions exposes no instruction that registers a
 * ResolveContext.addContinuous Might modification (the merged layers engine can
 * evaluate arithmetic-layer Might effects, but no opcode reaches it; RIFT-91),
 * and effect.buff only places Buff counters. Without the +3 the Deal amounts
 * would be read from the wrong Mights, so the card cannot execute as printed.
 * The two Deal instructions themselves are fully expressible and are executed by
 * the golden test with the real primitive; nothing is approximated (the source
 * of the damage is never rewritten to the spell and the amounts are never
 * replaced by fixed values).
 */
const gentlemensDuel = {
  canonicalCardId: "card.hash-2837500ae259cc6b529efd728cf65b05c957555d4e133c0d55310df08cf1b7d7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺临时 Might 修正指令原语：“Give a friendly unit +3 Might this turn”是带 end-of-turn 期限的 " +
    "continuous.might 持续效果（effect.buff 文档明确临时 Might 归属 layers，Buff 计数不是 Might 修改，CR 702），" +
    "effects/instructions 下没有任何指令通过 ResolveContext.addContinuous 注册它（layers 引擎已合入算术层，但没有指令入口，RIFT-91）。" +
    "缺少这 +3 时，“They deal damage equal to their Mights to each other”会读到错误的 Might，整卡不能按原文执行，故不近似实现。" +
    "已可执行并测试的部分：两条 effect.damage（来源是该单位本身而不是本咒语，418.6.b.3；数额在结算时读取，359.3.f.2），" +
    "后一条 linkedTo 前一条以保留 359.3.e.14.a 的失去目标语义。依赖：continuous.might 指令原语（RIFT-91 求值侧已合入，缺指令接线）。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 6 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          // "Give a friendly unit +3 [M] this turn" — declared through the
          // layers contract shape; no merged primitive consumes it yet
          // (see judgeReason). The chosen unit is a target (355.7).
          id: "gentlemens-duel.give-plus-3-might",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 3 },
            duration: { kind: "constant", value: "end-of-turn" },
            target: { kind: "constant", value: "gentlemens-duel.friendly-unit" }
          },
          targets: [
            {
              id: "gentlemens-duel.friendly-unit",
              filter: { type: "unit", controller: "self" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "They deal damage equal to their Mights to each other." First half:
          // the friendly unit deals damage equal to its Might (418.6.b.3: the
          // unit is the source, read with the { target } selector; the amount is
          // the unit's current Might, read on execution per 359.3.f.2). "Then
          // choose an enemy unit" declares the second target here.
          id: "gentlemens-duel.friendly-unit-strikes",
          op: "effect.damage",
          args: {
            amount: {
              kind: "object-property",
              object: { target: "gentlemens-duel.friendly-unit" },
              property: "might"
            },
            source: {
              kind: "object-property",
              object: { target: "gentlemens-duel.friendly-unit" },
              property: "ref"
            },
            target: { kind: "constant", value: "gentlemens-duel.enemy-unit" }
          },
          targets: [
            {
              id: "gentlemens-duel.enemy-unit",
              filter: { type: "unit", controller: "opponent" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // Second half: the enemy unit deals damage equal to its Might back.
          // Linked to the first Deal so a mistargeted friendly unit ignores this
          // instruction too (359.3.e.14.a).
          id: "gentlemens-duel.enemy-unit-strikes",
          op: "effect.damage",
          linkedTo: "gentlemens-duel.friendly-unit-strikes",
          args: {
            amount: {
              kind: "object-property",
              object: { target: "gentlemens-duel.enemy-unit" },
              property: "might"
            },
            source: {
              kind: "object-property",
              object: { target: "gentlemens-duel.enemy-unit" },
              property: "ref"
            },
            target: { kind: "constant", value: "gentlemens-duel.friendly-unit" }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Give a friendly unit +3 :rb_might: this turn. Then choose an enemy unit. They deal damage equal to their Mights to each other."
} satisfies CardProgram;

export default gentlemensDuel;
