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
 *   grant the Attacker designation during Combat, and contract 3.8 item 1
 *   plans ObjectSnapshot.combatRole for exactly this test. That field has not
 *   reached effects/contract.ts, so the filter's combatRole key is descriptive
 *   and is not evaluated by the merged target matcher.
 * - "It doesn't deal combat damage this turn" is reminder text for the Stunned
 *   status (424.1: the unit does not contribute its Might to combat damage;
 *   424.1.a.1: already-Stunned units cannot be Stunned again); both are engine
 *   behaviour, not separate card instructions.
 *
 * Status: judge-required. The Stun clause itself is merged (effect.stun,
 * RIFT-119) and is executed by the golden test with a Finalize-locked target,
 * but two dependencies are unmerged and not approximated:
 * - Attacker designation / combatRole on ObjectSnapshot and its filter
 *   vocabulary (740.2.c; contract 3.8 item 1, RIFT-91 / RIFT-105 follow-up);
 * - the Finalize collection of the optional [Repeat] additional cost and the
 *   paid-count to interpreter-repeat wiring (820.1.c.1, 820.1.d.1; RIFT-89,
 *   effects/keywords/Repeat.ts).
 */
const thwonk = {
  canonicalCardId: "card.hash-e524222421455ebe13a4bfa061de0e5c349605918aaa2b3745828fe2443798e1",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入，均不近似实现：(1)「Stun an attacking unit」的 Attacker 限制无法求值——740.2.c/461/466.2.c.3 " +
    "要求单位处于 Combat 且持有 Attacker designation，契约 3.8 第 1 条规划的 ObjectSnapshot.combatRole 尚未进入 " +
    "effects/contract.ts，target filter 只能比较现有字段，因此 combatRole: \"attacker\" 是描述性键、不参与匹配" +
    "（依赖 RIFT-91 图层/战斗指定与 RIFT-90 目标系统）。effect.stun（424.1/424.1.a.1）本体已合入并有 golden 执行测试。" +
    "(2)「[Repeat] :rb_energy_2:」的附加费用已按 CostSpec 声明（820.1.c.1），但 Finalize 收取与解释器 repeat 节点的接线未合入" +
    "（RIFT-89；effects/keywords/Repeat.ts 头部同款说明）。",
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
          // "Stun an attacking unit" — effect.stun 已合入；combatRole 过滤键是
          // 描述性的（见 judgeReason），golden 用 Finalize 锁定的真实引用执行。
          id: "thwonk.stun-attacking-unit",
          op: "effect.stun",
          args: { target: { kind: "constant", value: "thwonk.attacking-unit" } },
          targets: [
            {
              id: "thwonk.attacking-unit",
              filter: { type: "unit", zone: "board", combatRole: "attacker" },
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
