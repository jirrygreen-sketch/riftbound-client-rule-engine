import type { CardProgram } from "../../ir/index.js";

/**
 * rad-082-167 Primordial Roar (Spell, 4 energy + 2 power, Body).
 *
 * Catalog evidence (packages/card-data/data/deck-catalog.json,
 * dataVersion 2026-10-12-official-gallery, printing rad-082-167):
 * energy 4, power 2, might null, domains ["Body"], tags [].
 *
 * Printed text (verbatim, sourceText):
 *   "[Show Off] a unit. (As you play this, you may reveal a unit from hand or
 *    pick a friendly unit.)
 *    If you showed off a unit, deal damage equal to that unit's Might to a
 *    unit."
 *
 * Rules reading (CR v1.5):
 * - [Show Off] (832) is a Passive Ability keyword, formatted "[Show Off]
 *   [Object]" (832.1.b) and functionally "As you play [me/this], you may reveal
 *   [Object] from your hand and/or pick [Object] from among friendly game
 *   objects on the board" (832.1.c). The decision is made by the controller
 *   during finalization (832.1.c.2), and the referenced characteristics are
 *   locked at that moment (832.1.d.1: later changes are not considered).
 * - "If you showed off a unit, deal damage equal to that unit's Might to a
 *   unit" is a linked instruction that reads the locked Might of the shown-off
 *   object (832.1.d); the link refers to the Show Off instance on the same
 *   source (832.2.a).
 * - The damaged "a unit" is a target (355.9.b), while the shown-off unit is not
 *   (355.10.a: cards revealed from hand are private; a unit picked from the
 *   board is a pick, not a target).
 *
 * Status: judge-required (rechecked 2026-10-17). Current gaps:
 * - RIFT-268 merged effects/keywords/ShowOff.ts, but its expansion is a static
 *   `cost.reveal` declaration with no consumer: chain Finalize does not read it,
 *   no instruction and no op produce the shown-off link, and nothing captures the
 *   locked characteristic at the `objects-shown-off` timing point (832.1.c.2,
 *   832.1.d.1). RIFT-261 owns the cost.pay/kind work still in progress.
 * - `effect.show-off` is still not a registered instruction op (RIFT-269 merged
 *   Predict/Burn/Add; Show Off's Finalize choice is not among them), so the
 *   program's Show Off instruction cannot execute; the descriptive op and its
 *   link keys are kept as reviewable structure only.
 * - `KeywordDef.expand` has no card-side parameter channel for the printed
 *   [Object] clause (contract 3.8.3 params is not carried by KeywordAbility),
 *   so "a unit" cannot be handed to the keyword expansion.
 * - Reading the damaged unit's current Might with object-property would use the
 *   post-change value and is explicitly not equivalent to 832.1.d.1, so the
 *   amount stays a linked locked value and is not executed.
 * The damage instruction itself executes with the locked value supplied (golden
 * covers it); nothing is approximated.
 */
export default {
  canonicalCardId: "card.hash-8b6deb587569a3df7032c50ff6c443facba501038a4e6e1fb77f5aedbedb57cf",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Show Off] 仍不可执行：(1) RIFT-268 的 effects/keywords/ShowOff.ts 只发布 static " +
    "cost.reveal 声明，没有消费方——chain Finalize 不读它，832.1.c.2 的展示选择、" +
    "832.1.d.1 在 objects-shown-off 锁定特征、以及产出的展示链接值都没有实现（RIFT-261 " +
    "进行中的 cost.pay/费用种类与 RIFT-120 接线）。(2) effect.show-off 仍不是已注册指令 op" +
    "（RIFT-269 合入的是 Predict/Burn/Add），因此程序里保留的展示指令无法执行。" +
    "(3) KeywordDef.expand 没有卡牌侧的印刷 [Object] 参数通道（契约 3.8.3 的 params 未被 " +
    "KeywordAbility 承载），\"a unit\" 无法传给关键词展开。伤害半段必须读取展示时锁定的 Might" +
    "（832.1.d.1：之后变化不考虑），object-property 现读当前 Might 不等价；golden 在锁定值" +
    "给定时真实执行该伤害指令，不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "show-off", value: 1 },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 4 },
        power: { kind: "constant", value: 2 }
      },
      body: [
        {
          // "[Show Off] a unit." — the finalization-time choice of whether to
          // show off, reveal a unit from hand or pick a friendly unit, and lock
          // that unit's Might (832.1.c/832.1.c.2/832.1.d.1). Op is not
          // registered yet (judgeReason); the two link keys are the contract the
          // damage instruction below consumes.
          id: "primordial-roar.show-off",
          op: "effect.show-off",
          args: {
            source: { kind: "constant", value: { from: ["hand", "board"], type: "unit", controller: "you" } },
            optional: { kind: "constant", value: true },
            linkKey: { kind: "constant", value: "shown" },
            lockedProperty: { kind: "constant", value: "might" },
            lockedKey: { kind: "constant", value: "shownMight" }
          }
        },
        {
          // "If you showed off a unit, deal damage equal to that unit's Might to
          // a unit." The gate is "you showed off" (the show-off link), the
          // amount is the Might locked when showing off (832.1.d.1), and the
          // damaged unit is the instruction's only target (355.9.b).
          id: "primordial-roar.deal-shown-might",
          op: "effect.damage",
          linkedTo: "primordial-roar.show-off",
          condition: {
            kind: "expression",
            value: {
              kind: "linked-value",
              instructionId: "primordial-roar.show-off",
              key: "shown"
            }
          },
          args: {
            amount: {
              kind: "linked-value",
              instructionId: "primordial-roar.show-off",
              key: "shownMight"
            },
            target: { kind: "constant", value: "damaged-unit" }
          },
          targets: [
            {
              id: "damaged-unit",
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
    "[Show Off] a unit. (As you play this, you may reveal a unit from hand or pick a friendly unit.)\n" +
    "If you showed off a unit, deal damage equal to that unit's Might to a unit."
} satisfies CardProgram;
