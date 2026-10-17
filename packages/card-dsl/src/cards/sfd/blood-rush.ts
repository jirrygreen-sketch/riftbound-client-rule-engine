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
 * Status: judge-required, with both gaps named:
 * - the [Assault 2] grant now has a merged instruction op
 *   (`effects/instructions/continuous.grant-keyword.ts`) that registers an
 *   ability-layer keyword for a duration, but runtime granted keywords are not
 *   passed through the KeywordDef expansion path that turns Assault into its
 *   attacker-conditioned `continuous.might` effect. The existing Assault
 *   expansion also names the `designation` property while ObjectSnapshot
 *   exposes `combatRole`; no safe runtime Might result can be claimed.
 * - the [Repeat] additional cost cannot be charged or read back: the Repeat
 *   keyword, effect.repeat and the cost-plan `optionalAdditional` input exist,
 *   but no code turns a card program's declared optional additional cost into
 *   the spell-play Finalize collection, and the paid-instance count has no
 *   binding for the resolution (820.1.c.1 / 820.1.d.1).
 * The unit target and the Assault 2 value it would receive are recorded for
 * review; nothing is approximated (no Buff counter stands in for Assault's
 * conditional +2 Might).
 */
export default {
  canonicalCardId: "card.hash-01042b9eeb52d036e7ddeb7a52f785ab5acaf5fc08d6923554a753376d2b7529",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入，均不近似实现：(1)「Give a unit [Assault 2]」的 continuous.grant-keyword 指令原语" +
    "（ability 图层 + 时限）已合入并能登记授予的关键词，但运行时授予关键词没有进入 KeywordDef 展开路径，" +
    "无法把 Assault 转成攻击者期间的 continuous.might；现有 Assault 展开还读取 designation，而 ObjectSnapshot " +
    "提供的是 combatRole，特征字段也未对齐，故不能声称已有安全的 Might 结果。把 [Assault 2] 声明成这张法术自身的关键词会描述错误的对象，故不这样写。" +
    "(2) [Repeat] :rb_energy_1: 的可选附加费用无法收取或回读：Repeat 关键词、effect.repeat 与 cost 计划的 optionalAdditional 输入已合入，" +
    "但没有把卡牌程序声明的可选附加费用接进法术打出 Finalize 收取的接线，已付实例数也没有供结算读取的绑定（820.1.c.1 / 820.1.d.1）。" +
    "卡片保留可审查的结构：目标单位（355.5/355.7/355.9.a.1）、Assault 2 数值、820.1.c 的 1 能量印刷费用与显式 pay/decline 选择。" +
    "不用 Buff 计数冒充 Assault 的条件 +2 Might。依赖：运行时授予关键词的 KeywordDef/Assault 消费路径与 " +
    "designation/combatRole 特征对齐、" +
    "Repeat 附加费用的 Finalize 收取与已付实例绑定。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      // [Repeat] :rb_energy_1: (820.1.c): the printed additional cost is
      // declared with an explicit pay/decline choice (820.1.b makes paying
      // optional). The consumer is the spell-play cost plan; no merged code
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
          // value and the chosen unit use the merged keyword-grant primitive;
          // the keyword's Might behavior still needs its consumer (see judgeReason).
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
