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
 * 1. the Equip activation cannot execute: contract 3.5 wiring from the CardProgram
 *    to effects/keywords/Equip.ts is unmerged, the printed cost cannot reach
 *    KeywordDef.expand (contract 3.8.3 params.cost is not implemented), and the
 *    merged expansion's payments [{ kind: "equip" }] is blocked by
 *    cost/plan-values.ts readCost ("Unsupported payment kind: equip", RIFT-89).
 * 2. the activated cost's "Banish this" is a banish-as-cost payment; readCost's
 *    nonstandard kinds are exhaust/discard/recycle/kill/reveal/spend-buff, so
 *    "banish" is blocked.
 * 3. "Play all units banished with this" has no merged Linked Ability tracker
 *    (CR 394-398), and the ignored-cost play needs the per-card finalized
 *    zero-cost plan that effect.play documents as caller-owned (RIFT-89).
 * 4. "Use only if unattached" is a Restriction with no consumer mapping a
 *    CardProgram restriction onto chain legality.
 *
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
    "(1) [Equip] cannot execute: the card-program -> keyword-expansion -> chain wiring (contract 3.5) is unmerged, the printed " +
    "Equip cost (1 Energy + 1 Mind Power, CR 818.1.c) cannot reach KeywordDef.expand because the merged signature only carries " +
    "value/host (contract 3.8.3 params.cost is not implemented), and the merged effects/keywords/Equip.ts cost.payments " +
    "[{ kind: \"equip\" }] is rejected by cost/plan-values.ts readCost (\"Unsupported payment kind: equip\", RIFT-89). " +
    "(2) The activated cost \"[3][Mind], Banish this\" needs a banish-as-cost payment; readCost's nonstandard kinds are " +
    "exhaust/discard/recycle/kill/reveal/spend-buff, so \"banish\" is blocked. " +
    "(3) \"Play all units banished with this, ignoring their costs\" is a Linked Ability scope (CR 394-398) with no merged tracker, " +
    "and the ignored-cost play must be given a finalized zero-cost plan per card (CR 356.1.b.1; plan generation is RIFT-89). " +
    "(4) \"Use only if unattached\" has no consumer that turns a CardProgram Restriction into chain legality. " +
    "Data note: the local catalog sourceText lacks the \"[Deathknell][>] Banish me.\" line that CR v1.5 396/398 attributes to this card; " +
    "the text is not edited and no line is invented. The merged effect.attach and effect.play sub-effects are exercised by the golden test.",
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
      // "Use only if unattached." — activation restriction, descriptive shape;
      // no consumer maps CardProgram restrictions onto chain legality.
      restriction: { kind: "use-only-if-unattached" },
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
            // zero plan is submitted by the caller; generating it is RIFT-89.
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
