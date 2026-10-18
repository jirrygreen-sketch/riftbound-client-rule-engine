import type { CardProgram } from "../../ir/index.js";

/**
 * Blood Rush (sfd-003-221) — Spell, 1 Energy, no printed Power, Fury.
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   [Repeat] :rb_energy_1: (You may pay the additional cost to repeat this
 *   spell's effect.)
 *   Give a unit [Assault 2]. (+2 :rb_might: while it's an attacker.)
 *
 * Catalog evidence (packages/card-data/data/deck-catalog.json, sfd-003-221):
 * cardType Spell, domains ["Fury"], energy 1, power null, might null, tags [].
 * power null means no printed Power and is never rewritten as 0.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Action] (806) is a Permissive keyword declared on the card; 806.1.c grants
 *   the Showdown timing permission. The keyword registry and the chain's timing
 *   query own the expansion (contract 3.5/3.7).
 * - [Repeat] (820) is an Optional Additional Cost keyword. 820.1.c formats it
 *   "Repeat [Cost]", 820.1.c.1 makes that cost an Additional Cost paid during
 *   the steps of playing the spell, and 820.1.d.1 has the paid instance execute
 *   the effect one additional time during resolution. 820.2 / 820.2.a let the
 *   additional execution re-make its choices. The card declares the keyword,
 *   the printed cost (1 Energy, 820.1.c) and a play CostSpec carrying the
 *   optional additional energy payment with an explicit pay/decline choice
 *   (contract 3.1 CostSpec; the same shape the merged Frigid Touch / Danger Zone
 *   programs use while the Repeat KeywordDef has no card-to-cost wiring).
 * - "Give a unit [Assault 2]" is a keyword grant on a chosen Game Object in a
 *   Public zone, so the unit is Targeted (355.5, 355.7, 355.9.a.1); the printed
 *   reminder "(+2 :rb_might: while it's an attacker.)" is the functional text of
 *   Assault 2 (807.1.b.2 / 807.1.c), not a second ability, so it is not encoded
 *   as a separate instruction.
 * - No duration is printed for the grant: 801.3.a.3 keeps it for this Board
 *   existence. The permanent layer registration is scoped to the target's
 *   zone-entry identity; Assault's attacker condition is a separate gate.
 *
 * Status: judge-required, with one remaining gap (re-probed 2026-10-18):
 * - the [Repeat] additional cost cannot be charged or read back: the Repeat
 *   keyword, effect.repeat and the cost-plan `optionalAdditional` input exist,
 *   but no code turns a card program's declared optional additional cost into
 *   the spell-play Finalize collection, and the paid-instance count has no
 *   binding for the resolution (820.1.c.1 / 820.1.d.1).
 * The merged KeywordGrantLayerEngine now expands the runtime Assault 2 grant,
 * aliases the printed designation condition to ObjectSnapshot.combatRole, and
 * produces the attacker-only +2 Might in the card's execution golden.
 *
 * Execution evidence: test/cards/templates/
 * keyword-play-continuous-grant-keyword-681.test.mjs runs the printed base cost
 * and the Assault 2 grant row through the generic scenario harness, and pins the
 * declared [Repeat] cost failing closed in translateCost. The program stays
 * judge-required for that remaining gap.
 */
export default {
  canonicalCardId: "card.hash-01042b9eeb52d036e7ddeb7a52f785ab5acaf5fc08d6923554a753376d2b7529",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仅剩一处依赖未合入，不近似实现（2026-10-18 复核；执行 golden 已覆盖 Assault 运行时展开）：" +
    "[Repeat] :rb_energy_1: 的附加费用无法收取：programs/play.ts 的 translateCost 对 kind:\"additional\" fail-closed" +
    "（\"Additional costs are not bound\"），卡牌程序声明的可选附加费用因此进不了 CostPlanInput.optionalAdditional，" +
    "已付实例数也没有供结算读取以额外执行一次的绑定（820.1.c.1 / 820.1.d.1）；golden 直接订住该 fail-closed 行为。" +
    "[Assault 2] 的 continuous.grant-keyword 已由 KeywordGrantLayerEngine 经过 KeywordDef 展开，" +
    "并将 Assault 的 designation 条件映射到 ObjectSnapshot.combatRole；执行测试证明攻击者获得 +2 Might，" +
    "因此不再把该路径列为缺口。依赖：Repeat 附加费用的 Finalize 收取与已付实例绑定。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      // [Repeat] :rb_energy_1: (820.1.c): the printed additional cost is
      // declared with an explicit pay/decline choice (820.1.b makes paying
      // optional). The consumer is the spell-play cost plan; no merged code
      // reads this today, which is the remaining judgeReason.
      cost: {
        kind: "additional",
        payments: [
          {
            kind: "energy",
            amount: { kind: "constant", value: 1 },
            choice: {
              id: "blood-rush.repeat-payment",
              options: ["pay", "decline"],
              selection: "one"
            }
          }
        ]
      },
      body: [
        {
          // "Give a unit [Assault 2]" — the granted keyword id, its printed
          // value and the chosen unit use the merged keyword-grant primitive;
          // KeywordGrantLayerEngine re-expands this runtime grant through the
          // Assault KeywordDef; the Repeat payment remains the only blocker.
          id: "blood-rush.grant-assault-2",
          op: "continuous.grant-keyword",
          args: {
            objects: { kind: "constant", value: { kind: "target", id: "blood-rush.unit" } },
            keyword: { kind: "constant", value: "Assault" },
            value: { kind: "constant", value: 2 },
            // 801.3.a.3: no printed duration means the grant lasts until the
            // target leaves its zone; per-target zoneEntryId scopes the effect.
            // 807.1.d.1 separately gates Might on the Attacker designation.
            duration: { kind: "constant", value: "permanent" }
          },
          targets: [
            {
              id: "blood-rush.unit",
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
    "[Repeat] :rb_energy_1: (You may pay the additional cost to repeat this spell's effect.)\n" +
    "Give a unit [Assault 2]. (+2 :rb_might: while it's an attacker.)"
} satisfies CardProgram;
