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
 *
 * Status: judge-required, with both gaps named:
 * - the [Assault 2] grant has no merged execution path: no registered op in
 *   `effects/instructions/` calls `ResolveContext.addContinuous` to grant a
 *   keyword for a duration, and the merged Assault expansion
 *   (`effects/keywords/Assault.ts`) is itself a static `continuous.might`
 *   ability conditioned on the host's attacker designation — a characteristic
 *   that contract 3.8 adds to `ObjectSnapshot` but that is not merged
 *   (RIFT-91 / contract 3.8). Declaring an Assault keyword ability here would
 *   describe this spell instead of the chosen unit, which is not done.
 * - the [Repeat] additional cost cannot be charged or read back: no code turns
 *   a card program's declared optional additional cost into the merged cost
 *   planner's `optionalAdditional` input, and the paid-instance count has no
 *   binding for the resolution (820.1.c.1 / 820.1.d.1, RIFT-86 / RIFT-89).
 * The unit target and the Assault 2 value it would receive are recorded for
 * review; nothing is approximated (no Buff counter stands in for Assault's
 * conditional +2 Might).
 */
export default {
  canonicalCardId: "card.hash-01042b9eeb52d036e7ddeb7a52f785ab5acaf5fc08d6923554a753376d2b7529",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入，均不近似实现：(1)「Give a unit [Assault 2]」是限时关键词授予，没有任何已注册原语调用 " +
    "ResolveContext.addContinuous 完成它；已合入的 Assault 展开（effects/keywords/Assault.ts）是条件于宿主 attacker designation 的 " +
    "static continuous.might，而该 designation（契约 3.8 的 ObjectSnapshot.combatRole）仍未合入（RIFT-91 图层 / 契约 3.8）。" +
    "把 [Assault 2] 声明成这张法术自身的关键词会描述错误的对象，故不这样写。" +
    "(2) [Repeat] :rb_energy_1: 的可选附加费用无法收取或回读：没有把卡牌程序声明的可选附加费用接进已合入 cost 计划 " +
    "optionalAdditional 的接线，已付实例数也没有供结算读取的绑定（820.1.c.1 / 820.1.d.1；RIFT-86 只合入了 Repeat 关键词声明与 " +
    "effect.repeat 原语，RIFT-89 负责费用计划）。" +
    "卡片保留可审查的结构：目标单位（355.5/355.7/355.9.a.1）、Assault 2 数值、820.1.c 的 1 能量印刷费用与显式 pay/decline 选择。" +
    "不用 Buff 计数冒充 Assault 的条件 +2 Might。依赖：continuous.grant-keyword 指令原语 + attacker designation（RIFT-91、契约 3.8）、" +
    "Repeat 费用接线（RIFT-86 / RIFT-89）。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      // [Repeat] :rb_energy_1: (820.1.c): the printed additional cost is
      // declared with an explicit pay/decline choice (820.1.b makes paying
      // optional). The consumer is the cost plan (RIFT-89); no merged code
      // reads this today, which is part of judgeReason.
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
          // value and the chosen unit are stated for review; the op is the
          // pending duration-bounded keyword grant (see judgeReason).
          id: "blood-rush.grant-assault-2",
          op: "continuous.grant-keyword",
          args: {
            keyword: { kind: "constant", value: "Assault" },
            value: { kind: "constant", value: 2 },
            // 807.1.d.1: Assault applies only while the host holds the
            // Attacker designation, so the grant has no separate end-of-turn
            // lifetime of its own; "while it's an attacker" is stated by the
            // keyword's own expansion.
            duration: { kind: "constant", value: "end-of-turn" }
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
