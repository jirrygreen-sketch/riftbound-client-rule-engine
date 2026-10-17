import type { CardProgram } from "../../ir/index.js";

/**
 * Marching Orders (sfd-114-221) — Spell, 3 energy, no printed power, Body.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-114-221, verbatim):
 *   "[Action] (Play on your turn or in showdowns.)
 *    [Repeat] :rb_energy_3: (You may pay the additional cost to repeat this
 *    spell's effect.)
 *    Choose a friendly unit anywhere and an enemy unit at a battlefield. They
 *    deal damage equal to their Mights to each other."
 *
 * Rules evidence (Core Rules v1.5):
 * - "[Action]" (806.1.b/806.1.c, 159.2.a) is a permissive keyword: the card
 *   only declares it (contract 3.7). The merged program adapter's
 *   abilitySpeed already derives "action", but a full play draft is still
 *   blocked by the unsupported [Repeat] additional-cost field below, so the
 *   chain's canAct/Showdown path cannot be exercised end to end yet.
 * - "[Repeat] :rb_energy_3:" (820.1.c) is an Optional Additional Cost. The
 *   Repeat KeywordDef is merged, but expandProgram passes only keyword/value/
 *   host, not its printed cost. programs/play.ts rejects this additional-cost
 *   CostSpec (translateCost: "Unsupported play cost field keyword"), so no
 *   paid-instance count reaches resolution.
 * - "Choose a friendly unit anywhere and an enemy unit at a battlefield": the
 *   spell's controller chooses both units, so both are Targets (355.7 /
 *   355.9.a.1 / 355.9.b) locked at Finalize (355.5). "Anywhere" adds no
 *   restriction (Base or battlefield); "at a battlefield" is a targeting
 *   restriction for the enemy unit (355.10.b), not a second target.
 * - "They deal damage equal to their Mights to each other" is one Deal action
 *   per direction with the chosen unit as the source: 418.6.b.3 uses this exact
 *   shape in its Challenge example, and 418.6.b.4 makes that unit's controller
 *   responsible. effect.damage takes `source` as an Expr evaluating to the
 *   unit's runtime ObjectRef and reads the Might at resolution (contract 3.6).
 *   The two instructions are not linked to each other: each reads the other's
 *   locked target through its own selector, and 359.3.e.7/.12 keeps an
 *   unavailable unit from being replaced by last-known Might values.
 * - Null Might is never coerced: 418.1.e/418.1.e.1 deals no damage when the
 *   read amount is not a positive number, and no fixed amount is authored here.
 *
 * Current status: judge-required. Damage, TargetSpec.location and Action speed
 * are supported; the golden executes the card's own damage body through the
 * production adapter. Repeat's printed-cost/Finalize/paid-instance binding is
 * still missing.
 */
const marchingOrders = {
  canonicalCardId: "card.hash-7665f836ecbe39043d8dd42f110ad82560fe857373dbf87d7348d347e764617c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Repeat] :rb_energy_3:（820.1.c）仍缺卡牌侧 Finalize 接线：Repeat KeywordDef 已合入，" +
    "但 programs/keywords.ts 的 expandProgram 只传 keyword/value/host，未传印刷 Repeat cost；" +
    "本卡 CostSpec 的 additional-cost 也被 programs/play.ts 的 translateCost 拒绝" +
    "（实测 judge-required: Unsupported play cost field keyword）；" +
    "尚不能收取可选追加费用、记录已付实例并按 820.1.d / 820.2.a 额外执行与重选。" +
    "伤害正文的两个 TargetSpec、418.6.b.3 的单位来源、355.9.b 的战场限制与结算时 Might 均已合入，" +
    "golden 已用生产链适配器真实执行（含 355.10.b 与失效目标）。" +
    "[Action] 速度可由 abilitySpeed 推导，但上述费用缺口仍阻断整卡打出。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      cost: {
        // 印刷基础费用 3 Energy、无 Power（356.1.c：由卡牌身份在 Finalize 绑定）。
        // [Repeat] :rb_energy_3: 的可选追加费用（820.1.c / 356.2.b.1）仍是
        // additional-cost 描述；programs/play.ts 尚未收取该费用。
        kind: "additional-cost",
        keyword: "repeat",
        energy: { kind: "literal", value: 3 }
      },
      body: [
        {
          id: "marching-orders.friendly-deals",
          op: "effect.damage",
          args: {
            amount: {
              kind: "object-property",
              object: { target: "marching-orders.friendly-unit" },
              property: "might"
            },
            source: {
              kind: "object-property",
              object: { target: "marching-orders.friendly-unit" },
              property: "ref"
            },
            target: { kind: "constant", value: "marching-orders.enemy-unit" }
          },
          targets: [
            {
              id: "marching-orders.enemy-unit",
              // 「an enemy unit at a battlefield」：355.9.b 的目标限制（355.10.b 说明
              // 限制本身不是第二个目标），由 TargetSpec.location 在解释器重验。
              filter: {
                type: "unit",
                zone: "board",
                controller: "opponent"
              },
              location: { type: "battlefield" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          id: "marching-orders.enemy-deals",
          op: "effect.damage",
          args: {
            amount: {
              kind: "object-property",
              object: { target: "marching-orders.enemy-unit" },
              property: "might"
            },
            source: {
              kind: "object-property",
              object: { target: "marching-orders.enemy-unit" },
              property: "ref"
            },
            target: { kind: "constant", value: "marching-orders.friendly-unit" }
          },
          targets: [
            {
              id: "marching-orders.friendly-unit",
              // 「a friendly unit anywhere」：只限定控制者，不加 Location 限制。
              filter: { type: "unit", zone: "board", controller: "self" },
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
    "[Repeat] :rb_energy_3: (You may pay the additional cost to repeat this spell's effect.)\n" +
    "Choose a friendly unit anywhere and an enemy unit at a battlefield. " +
    "They deal damage equal to their Mights to each other."
} satisfies CardProgram;

export default marchingOrders;
