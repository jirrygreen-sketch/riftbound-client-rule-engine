import type { CardProgram } from "../../ir/index.js";

/**
 * Brawl (rad-004-167) — Spell, 3 Energy + 1 Chaos Power, Chaos domain.
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Give a unit [Assault] this turn equal to its Might. (+1 :rb_might: for each
 *   instance of Assault while it's an attacker.)
 *
 * Rules evidence (Core Rules v1.5):
 * - 806 [Action] is a Permissive keyword and 159.2.a makes Action the default
 *   spell timing; both are owned by the merged keywords/Action.ts, so the card
 *   only declares { kind: "keyword", keyword: "action" }.
 * - 807.2: "grants Assault from an additional source sums into one Assault
 *   Value"; 807.3 makes Assault (and whether a unit has it) a readable
 *   characteristic. The granted value is therefore dynamic, not a printed
 *   constant: the card text fixes it at the target unit's current Might.
 * - 801.3.a / 801.3.a.2: a granting effect carries its own duration; "this
 *   turn" is the printed duration.
 * - "Give a unit ..." names one game object and is a target (355.7 / 355.10),
 *   not a pick.

 * Status: judge-required. The grant half needs two unmerged pieces:
 * - a duration-bounded keyword grant (contract 3.7 / ability-templates list
 *   "continuous.keyword"; the merged layers/evaluate only consumes continuous
 *   effects registered through ctx.addContinuous, and no registered
 *   instruction op accepts a keyword grant);
 * - a way to read the *target's* Might as the granted Assault Value. Contract
 *   3.2's object-property expression can read a selector, but the value has to
 *   be locked onto the granted continuous effect at resolution (the layers
 *   effect amount must carry the resolved number, not a re-read that could
 *   change later), and the layers engine has no consumer for a granted
 *   keyword today. Writing a static amount or reusing effect.buff (CR 702 Buff
 *   counters) would be a near-implementation, which the red line forbids.

 * The card therefore keeps the exact structure (keyword + play ability + one
 * targeted instruction) with the instruction's op and args recording the
 * missing semantic; the golden test asserts the structure and only executes
 * what the merged primitives can honestly run.
 */
const brawl = {
  canonicalCardId: "card.hash-cad809540cf272ccc60c72a21f1a6766f3fdc07a03fa01da81c97bd46c428af7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺带期限的关键词授予原语（continuous.keyword / grant-keyword）：契约 3.7 与 " +
    "ability-templates 列出的 continuous.keyword 尚无实现，layers/ 也没有消费 Granted " +
    "keyword 的路径；同时需要把「被选单位的当前 Might」锁定为该授予的 Assault 数值" +
    "（CR 807.2/807.3，数值随授予时的单位 Might 而定），当前 expression 只能在结算时读取、" +
    "无法随持续效果锁定进图层；依赖 RIFT-81（kw-assault-shield 关键词展开）与 " +
    "RIFT-91（layers-continuous 持续效果层）。不近似实现（不用固定数值，也不把 Assault " +
    "改写成 CR 702 的 Buff 指示物）。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          id: "brawl.grant-assault",
          op: "continuous.grant-keyword",
          args: {
            keyword: { kind: "constant", value: "Assault" },
            amount: {
              kind: "object-property",
              object: { target: "brawl.unit" },
              property: "might"
            },
            duration: { kind: "constant", value: "end-of-turn" }
          },
          targets: [
            {
              id: "brawl.unit",
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
    "Give a unit [Assault] this turn equal to its Might. (+1 :rb_might: for each instance of Assault while it's an attacker.)"
} satisfies CardProgram;

export default brawl;
