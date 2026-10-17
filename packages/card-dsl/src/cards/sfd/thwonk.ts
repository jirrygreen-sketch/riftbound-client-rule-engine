import type { CardProgram } from "../../ir/index.js";

/**
 * Thwonk! — sfd-040-221 (Spell, 2 energy, power null, Calm, tags []).
 *
 * Printed text (packages/card-data/data/deck-catalog.json, sfd-040-221, verbatim):
 *   [Action] (Play on your turn or in showdowns.)
 *   [Repeat] :rb_energy_2: (You may pay the additional cost to repeat this spell's effect.)
 *   Stun an attacking unit. (It doesn't deal combat damage this turn.)
 *
 * Catalog evidence: energy 2, power null, might null, domains ["Calm"], tags [].
 *
 * Modeling notes (Core Rules v1.5):
 * - [Action] (806) is a Permissive keyword; the card only declares it and the
 *   merged KeywordDef (effects/keywords/Action.ts) owns the Showdown permission
 *   expansion (contract 3.7); admission is the chain's canAct check (3.5).
 * - [Repeat] (820) is an Optional Additional Cost keyword on Spells (820.1.a);
 *   the printed cost is 2 Energy (820.1.c, 820.1.c.1) and may be paid once
 *   (820.1.c.3). It is declared on the play ability as the optional additional
 *   payment in the merged CostSpec vocabulary; the expansion itself belongs to
 *   effects/keywords/Repeat.ts.
 * - "Stun an attacking unit": 355.5 uses "Stun a unit at a battlefield" as an
 *   example of a Choice made while finalizing the spell, so the unit is a
 *   target (355.7). The printed restriction is the Attacker designation:
 *   740.2.c defines a unit in combat through its designation, 461/466.2.c.3
 *   grant the Attacker designation during Combat, and ObjectSnapshot.combatRole
 *   plus ObjectFilter.characteristics now carry that designation through the
 *   merged target matcher.
 * - "It doesn't deal combat damage this turn" is reminder text for the Stunned
 *   status (424.1: the unit does not contribute its Might to combat damage;
 *   424.1.a.1: already-Stunned units cannot be Stunned again); both are engine
 *   behaviour, not separate card instructions.
 *
 * Status: judge-required. The Stun clause and Attacker target predicate are
 * merged and exercised by the golden tests. The remaining blocker is the
 * Finalize collection of the optional [Repeat] additional cost and the
 * paid-count to interpreter-repeat wiring (820.1.c.1, 820.1.d.1):
 * programs/play.ts still rejects an `additional` play cost, and no resolver
 * feeds the paid instance count into the repeat instruction.
 */
const thwonk = {
  canonicalCardId: "card.hash-e524222421455ebe13a4bfa061de0e5c349605918aaa2b3745828fe2443798e1",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Stun（424.1/424.1.a.1）与 Attacker 过滤（740.2.c/461/466.2.c.3，" +
    "ObjectSnapshot.combatRole + ObjectFilter.characteristics）已合入并有执行测试；当前唯一阻断是「[Repeat] :rb_energy_2:」" +
    "的附加费用未被 programs/play.ts 的 Finalize 接受，且已付实例数尚未接入解释器 repeat 结算（820.1.c.1、820.1.d.1）。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      // 印刷基础费用（2 energy、无 power）由 catalog 在 Finalize 绑定；此处 cost
      // 只声明 [Repeat] 的可选附加费用（820.1.c.1）。
      cost: {
        kind: "additional",
        keyword: "repeat",
        optional: true,
        payments: [
          {
            kind: "energy",
            amount: { kind: "constant", value: 2 },
            choice: {
              id: "thwonk.repeat-payment",
              options: ["pay", "decline"],
              selection: "one"
            }
          }
        ]
      },
      body: [
        {
          // "Stun an attacking unit" — effect.stun and the combatRole target
          // predicate are both part of the merged target vocabulary.
          id: "thwonk.stun-attacking-unit",
          op: "effect.stun",
          args: { target: { kind: "constant", value: "thwonk.attacking-unit" } },
          targets: [
            {
              id: "thwonk.attacking-unit",
              filter: { type: "unit", zone: "board", characteristics: { combatRole: "attacker" } },
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
    "[Repeat] :rb_energy_2: (You may pay the additional cost to repeat this spell's effect.)\n" +
    "Stun an attacking unit. (It doesn't deal combat damage this turn.)"
} satisfies CardProgram;

export default thwonk;
