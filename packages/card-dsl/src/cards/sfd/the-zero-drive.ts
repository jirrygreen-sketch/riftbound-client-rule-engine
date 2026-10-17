import type { CardProgram } from "../../ir/index.js";

/**
 * The Zero Drive (sfd-090-221) — Gear, 3 Energy, no printed Power, Might 2,
 * Mind, tag Equipment.
 *
 * sourceText (verbatim from packages/card-data/data/deck-catalog.json sfd-090-221):
 *   "[Equip] :rb_energy_1::rb_rune_mind: (:rb_energy_1::rb_rune_mind:: Attach this
 *    to a unit you control.)
 *    :rb_energy_3::rb_rune_mind:, Banish this: Play all units banished with this,
 *    ignoring their costs. (Use only if unattached.)"
 *
 * Rules (CR v1.5):
 * - 818.1 / 818.1.c.2: the printed "Equip [1][Mind]" is an Activated Ability
 *   keyword, functionally short for "[1][Mind]: Attach this gear to a unit you
 *   control."
 * - 377.1: the second line is a second Activated Ability whose cost is
 *   "[3][Mind], Banish this" and whose effect plays the linked banished units.
 * - 420.3 / 420.3.b.1: the effect is a Limited Play Effect. "Ignoring their costs"
 *   is CR 356.1.b.1: the base Energy and base Power costs are set to zero.
 * - 394-398: "all units banished with this" is a Linked Ability scope; CR 396/398
 *   uses this card as the printed example and notes the granted
 *   "[Deathknell][>] Banish me." ability is linked with the activated ability.
 *
 * status: judge-required. Nothing below is approximated:
 * 1. Equip cannot execute because the printed Equip cost cannot be passed through
 *    the current keyword expansion call and the resulting `equip` payment is
 *    rejected by cost/plan-values.ts.
 * 2. The activated cost's "Banish this" is a banish-as-cost payment; the cost
 *    reader has no banish payment branch.
 * 3. "Play all units banished with this" needs a Linked Ability tracker that
 *    produces the pick set, plus a production path that supplies the finalized
 *    zero-cost plan for each play. The effect.play primitive itself is merged.
 * Data note (reported, not edited): the local deck-catalog sourceText contains
 * only the Equip and activated-ability lines; CR v1.5 396/398 additionally quotes
 * "[Deathknell][>] Banish me." for this card. Per the task rules the catalog text
 * is used verbatim and no card text is invented.
 */
const equip = {
  // Printed "Equip [1][Mind]": two resource symbols (1 Energy + 1 Mind Power).
  // value counts the printed resource symbols and costDomain records the Power rune.
  kind: "keyword",
  keyword: "equip",
  value: 2,
  costDomain: "Mind"
} as const;

export default {
  canonicalCardId: "card.hash-91fa755a4f2e1cf5d93c1792c1f0be8e6c8af0d26bda9b82049276b62ce94102",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前有三处真实缺口：(1) Equip 的印刷费用尚不能通过关键词展开调用传入，且展开后的 payments: [{ kind: \"equip\" }] " +
    "会被 cost/plan-values.ts 拒绝；(2) 启动费用中的 Banish this 没有 banish-as-cost 支付分支；" +
    "(3) CR 394–398 的“all units banished with this”需要 Linked Ability tracker 产生 pick 集合，并由生产打出流程" +
    "为每张牌提供 finalized zero-cost plan，effect.play 本体已经合入；" +
    "Data note: local catalog sourceText lacks the Deathknell line quoted by CR 396/398; sourceText is kept verbatim and not invented.",
  abilities: [
    equip,
    {
      kind: "activated",
      timing: "action",
      cost: {
        kind: "activated",
        energy: { kind: "constant", value: 3 },
        power: { kind: "constant", value: ["Mind"] },
        // CR 428.1: "Banish this" is the second part of the printed activation
        // cost; no merged cost-payment kind performs it (see judgeReason 2).
        payments: [{ kind: "banish", object: "self" }]
      },
      // "Use only if unattached." — activation restriction consumed by the
      // chain legality path through its live attachedTo condition.
      restriction: {
        kind: "use-only-if-unattached",
        condition: {
          kind: "compare",
          left: { kind: "object-property", object: "self", property: "attachedTo" },
          operator: "eq",
          right: { kind: "constant", value: null }
        }
      },
      body: [
        {
          id: "the-zero-drive.play-banished-units",
          op: "effect.play",
          args: {
            // Non-target choice: the set of units banished with this source
            // (CR 394-398). The Finalize/pick pipeline has no Linked Ability
            // tracker; the golden test supplies this pick as an engine input.
            pick: { kind: "constant", value: "the-zero-drive.banished-units" },
            // CR 356.1.b.1: ignoring costs sets the base Energy/Power costs to
            // zero. effect.play accepts only an already-finalized plan, so the
            // zero plan is submitted by the caller; generating it is owned by the play Finalize cost path.
            cost: { kind: "constant", value: { finalized: true, energy: 0, power: [] } },
            linkKey: { kind: "constant", value: "played" }
          },
          picks: [
            {
              id: "the-zero-drive.banished-units",
              // Descriptive placeholder: the real members come from the Linked
              // Ability scope, not from a zone-set query (CR 394-398).
              options: ["units-banished-with-this-source"],
              filter: { zone: "banishment", type: "unit" },
              selection: "all"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Equip] :rb_energy_1::rb_rune_mind: (:rb_energy_1::rb_rune_mind:: Attach this to a unit you control.)\n" +
    ":rb_energy_3::rb_rune_mind:, Banish this: Play all units banished with this, ignoring their costs. (Use only if unattached.)"
} satisfies CardProgram;
