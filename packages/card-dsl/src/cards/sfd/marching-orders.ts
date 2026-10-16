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
 *   only declares it (contract 3.7); the Showdown permission is expanded by
 *   effects/keywords/Action.ts and consumed by the chain's canAct.
 * - "[Repeat] :rb_energy_3:" (820.1.c) is an Optional Additional Cost. The
 *   Repeat KeywordDef is merged and the printed component remains declared on
 *   the play CostSpec, but the card-program adapter still has no Finalize path
 *   that collects the additional cost or feeds paid instances to resolution
 *   (RIFT-261); the Action play permission also still needs the RIFT-257 play adapter.
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
 * Status (cards/README.md §2): judge-required — the damage clause needs only
 * merged primitives and is executed by the golden test, but the printed
 * [Repeat] additional cost still has no card-program collection/count-to-extra-
 * execution path (RIFT-261), so the card cannot be played as printed yet.
 */
const marchingOrders = {
  canonicalCardId: "card.hash-7665f836ecbe39043d8dd42f110ad82560fe857373dbf87d7348d347e764617c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「[Repeat] :rb_energy_3:」的可选追加费用（820.1.c / 820.1.b / 356.2.b.1）仍没有卡牌侧收取/计数路径：" +
    "Repeat KeywordDef 已合入并读取该印刷费用，但 Finalize 的 OptionalCostInput（kind \"repeat\"）与 cost.pay 接线仍待 RIFT-261，" +
    "结算端把已付费实例数按 820.1.d / 820.2.a 接到额外执行也尚未接入。本文件按既有 CostSpec 形状声明该费用，属待接线声明；不写死第二次结算近似。" +
    "伤害半段（两个目标 + 418.6.b.3 的单位来源 + 结算时读 Might）只用已合入的 effect.damage 与 TargetSpec，golden 已真实执行。" +
    "依赖：RIFT-257、RIFT-261。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      cost: {
        // 印刷基础费用 3 Energy、无 Power（356.1.c：由卡牌身份在 Finalize 绑定）。
        // [Repeat] :rb_energy_3: 的可选追加费用（820.1.c / 356.2.b.1）按已合入
        // sfd/danger-zone 的同类形状声明为 additional-cost（无消费方，见 judgeReason）。
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
              // 限制本身不是第二个目标），用已合入的 location 过滤器键表达。
              filter: {
                type: "unit",
                zone: "board",
                controller: "opponent",
                location: "battlefield"
              },
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
