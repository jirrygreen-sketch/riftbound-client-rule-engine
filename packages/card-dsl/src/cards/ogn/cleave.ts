import type { CardProgram } from "../../ir/index.js";

/**
 * Cleave (ogn-004-298) — Spell, 1 Energy, Fury.
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Give a unit [Assault 3] this turn. (+3 :rb_might: while it's an attacker.)
 *
 * Catalog evidence (packages/card-data/data/deck-catalog.json, dataVersion
 * 2026-10-12-official-gallery): energy 1, power null (no printed Power), might
 * null, tags [].
 *
 * Status: judge-required. "Give a unit [Assault 3] this turn" is a
 * duration-bounded keyword grant, and no merged instruction can create one:
 * - The only keyword-grant spelling in the merged code base is a static
 *   ability's ContinuousEffect ("grant-keyword", used by sfd/breakneck-mech.ts,
 *   sfd/gem-jammer.ts and sfd/forecaster.ts). Static abilities are card layer
 *   features evaluated by the layers engine; a resolving spell cannot create one,
 *   and no merged primitive calls ctx.addContinuous for a keyword grant.
 * - continuous.keyword is explicitly outside the RIFT-9 candidate route
 *   (docs/plans/survey/ability-templates.md states that effect.shuffle and
 *   continuous.keyword never enter the candidate route), so the missing
 *   primitive is tracked rather than merely unassigned in this workstream.
 * - The grant must also carry an end-of-turn duration: 317.2.c makes all
 *   "this turn" effects expire simultaneously, which is the timing-driven
 *   duration contract 3.4 assigns to ctx.addContinuous.
 * - Granting Assault additionally pulls the merged Assault expansion
 *   (engine-core/src/effects/keywords/Assault.ts, CR 807): it is a static
 *   continuous.might ability conditioned on the host's attacker designation, and
 *   the merged interpreter's ObjectSnapshot has no "designation" characteristic.
 * The program keeps the intended shape (keyword, value, duration, one target) so
 * the card can be completed without re-deriving it. Nothing is approximated: a
 * Buff counter (CR 702) is a different object state, not a Might modification.
 *
 * Dependencies: a duration-bounded continuous keyword-grant primitive and
 * attacker-designation support for the Assault expansion. RIFT-91
 * (layers-continuous) is already merged.
 */
const cleave = {
  canonicalCardId: "card.hash-e946abd159c3e001431a6266172cc524d41158117457180e81e85ef7690a4354",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 duration 限定的连续关键词授予原语：没有任何已注册 instruction 能实现「Give a unit [Assault 3] this turn」。" +
    "已合入代码里唯一的关键词授予形态是 static 能力的 grant-keyword 持续效果（sfd/breakneck-mech.ts、gem-jammer.ts、forecaster.ts），" +
    "它属于卡牌自身的图层特征，正在结算的法术无法创建，也没有原语调用 ctx.addContinuous 来授予关键词；" +
    "ability-templates 已把 continuous.keyword 排除在 RIFT-9 候选路线之外。授予还须带 end-of-turn 期限（317.2.c）。" +
    "此外 Assault 展开（CR 807，effects/keywords/Assault.ts）是条件于宿主 attacker designation 的 static continuous.might，" +
    "而 designation 尚未进入 ObjectSnapshot。不近似实现（不用 Buff 计数代替 Might 修改）。" +
    "依赖：duration 限定的连续关键词授予原语 + attacker designation 支持（RIFT-91 已合入）。",
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Give a unit [Assault 3] this turn. (+3 :rb_might: while it's an attacker.)",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      // Printed cost is 1 Energy; this printing has no Power value (null in the
      // catalog), so no Power component is declared. null is never rewritten
      // as 0.
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 1 }
      },
      body: [
        {
          // The granted keyword, its value and the end-of-turn duration are
          // stated for review; this op is not registered (see judgeReason).
          id: "cleave.grant-assault-3",
          op: "continuous.grant-keyword",
          args: {
            keyword: { kind: "constant", value: "Assault" },
            value: { kind: "constant", value: 3 },
            duration: { kind: "constant", value: "end-of-turn" }
          },
          targets: [
            {
              id: "cleave.unit",
              filter: { type: "unit", zone: "board" },
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

export default cleave;
