import type { CardProgram } from "../../ir/index.js";

/**
 * Against the Odds (sfd-001-221) — Spell, 2 Energy, no printed Power, Fury.
 *
 * Printed text:
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Give a friendly unit at a battlefield +2 :rb_might: this turn for each
 *   enemy unit there.
 *
 * Catalog evidence (packages/card-data/data/deck-catalog.json, sfd-001-221):
 * cardType Spell, domains ["Fury"], energy 2, power null, might null, tags [].
 * power null means no printed Power and is never rewritten as 0.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Reaction] (813) is a Permissive keyword: 159.2.b grants the Closed-State
 *   play permission. The card declares the keyword only; the permission itself
 *   is owned by the keyword registry and the chain's timing query (contract
 *   3.5/3.7).
 * - "a friendly unit at a battlefield" is a Choice of a specific Game Object in
 *   a Public zone, so the unit is Targeted (355.5, 355.7, 355.10.a); "at a
 *   battlefield" is a targeting restriction on that unit and does not target a
 *   battlefield (355.10.b). It is carried as the TargetSpec's own `location`
 *   field — the merged target system's `TargetRequirement.location`
 *   (engine-core/src/target/target-plan.ts) — with the filter pinning the object
 *   to the Board (355.9.a.1). "friendly" is the controller relationship.
 * - "for each enemy unit there" is a set count, not a choice: the enemy units
 *   are programmatically selected by characteristics (and by the chosen unit's
 *   location), so they are not targets (355.10.d, 355.10.d.1). The count is
 *   expressed with the merged `count` expression plus the `sameLocationAs`
 *   anchor (contract 3.6), and the printed "+2 for each" is the merged
 *   arithmetic multiply of 2 by that count, so the amount is read at resolution
 *   exactly as 359.3.f.2 requires.
 * - "+2 :rb_might: this turn" is a temporary Might modification: 143.2.a /
 *   433.1.a modulate Might in the arithmetic layer, and 317.2.c expires all
 *   "this turn" effects in the end-of-turn cleanup. It is not a Buff: 702 makes
 *   Buffs counters, and effect.buff's own header states temporary Might changes
 *   "belong to continuous.might, never to this primitive".
 *
 * Status: judge-required. The chosen unit, its targeting restriction and the
 * per-enemy amount are recorded faithfully, but no merged instruction can apply
 * the Might modification: `effects/instructions/` registers no op that calls
 * ResolveContext.addContinuous with a continuous.might effect (the layers engine
 * merged under RIFT-91 evaluates arithmetic-layer Might effects, but no card
 * instruction reaches it), and contract 3.6's closed GameAction set has no
 * Might-modification action. Nothing is approximated: no Buff counter and no
 * fixed +2 are substituted for the per-enemy amount.
 */
export default {
  canonicalCardId: "card.hash-ce4f294fc93a34896d001feda8ba9d15d051f2ea01bf0c84a56036243102b3fa",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺可执行的原语「临时 Might 修正」：'Give a friendly unit … +2 :rb_might: this turn for each enemy unit there' " +
    "是带回合末到期的 continuous.might 持续效果（143.2.a / 433.1.a / 317.2.c），不是 Buff 计数（702；effect.buff 文件头明确" +
    "临时 Might 归 continuous.might）；effects/instructions/ 下没有任何已注册原语调用 ResolveContext.addContinuous 落地该效果，" +
    "契约 3.6 的封闭 GameAction 集合也没有 Might 修改动作（layers 求值侧已在 RIFT-91 合入，缺的是卡牌指令入口与到期接线）。" +
    "卡片的其余部分均已如实编码：目标（355.5/355.7/355.10.a，'at a battlefield' 是 355.10.b 的筛选限制）、" +
    "按『此处每个敌方单位』计数（355.10.d 的集合不是目标；用 count + sameLocationAs 锚点 + arithmetic 乘法表达），" +
    "以及 [Reaction] 声明。不近似实现（不用 Buff 冒充 Might，也不把『每个敌方单位』写成固定 +2）。" +
    "依赖：continuous.might 指令原语与 end-of-turn 期限接线（RIFT-91 后续）。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      // Printed cost (2 Energy, no Power) comes from the catalog; the Finalize
      // cost plan is its consumer.
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 }
      },
      body: [
        {
          // "Give a friendly unit at a battlefield +2 Might this turn for each
          // enemy unit there" — declared through the layers contract shape; no
          // merged op consumes it yet (see judgeReason). The amount is the
          // merged arithmetic expression (2 x enemy units at the chosen unit's
          // location), evaluated when the instruction would execute.
          id: "against-the-odds.grant-might",
          op: "continuous.might",
          args: {
            amount: {
              kind: "arithmetic",
              operator: "multiply",
              operands: [
                { kind: "constant", value: 2 },
                {
                  kind: "count",
                  subject: "units",
                  filter: {
                    type: "unit",
                    controller: "opponent",
                    sameLocationAs: { target: "against-the-odds.unit" }
                  }
                }
              ]
            },
            duration: { kind: "constant", value: "this-turn" }
          },
          targets: [
            {
              id: "against-the-odds.unit",
              filter: { type: "unit", controller: "controller" },
              // 355.10.b: "at a battlefield" restricts the unit; the merged
              // target system reads this as TargetRequirement.location.
              location: { type: "battlefield" },
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
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Give a friendly unit at a battlefield +2 :rb_might: this turn for each enemy unit there."
} satisfies CardProgram;
