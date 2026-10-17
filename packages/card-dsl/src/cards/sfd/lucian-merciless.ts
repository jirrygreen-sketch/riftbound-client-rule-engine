import type { CardProgram } from "../../ir/index.js";

/**
 * Lucian, Merciless (sfd-113-221) — Unit, fiora-sfd (M1).
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-113-221):
 *   [Weaponmaster] (When you play me, you may [Equip] one of your Equipment
 *   to me for :rb_rune_rainbow: less, even if it's already attached.)
 *   The first time I conquer each turn, ready me.
 *
 * - Weaponmaster expansion and cost.modify/cost.pay are merged, but the
 *   Equipment source branch lacks authoritative Equip costs (821.1.c.2) and
 *   original [A]/[C] provenance for the [A]-only reduction (821.1.c.3).
 * - 383.4.c.2.a applies "I conquer" to each participating Unit. TurnFlow's
 *   player/battlefield conquer emission has no Unit object for the self filter.
 *   The per-turn trigger registration and effect.ready body are merged.
 * Current status: judge-required; isolated ready execution is partial evidence.
 */
const lucianMerciless = {
  canonicalCardId: "card.hash-c403c2d9835df87cc0774a86145ef937226d5e7ebcfe75282053e23df744f5ef",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Weaponmaster expansion and cost.modify/cost.pay are merged, but the Equipment source branch still " +
    "blocks with judge-required: no authoritative Equip-cost binding (821.1.c.2), including the original " +
    "[A]/[C] symbol provenance needed by reduce-equip-cost (821.1.c.3). The conquer producer in turn/flow.ts " +
    "emits player/details.battlefieldId without participating Unit objects (383.4.c.2.a); programs/filters.ts " +
    "translates role:self to Lucian's objectId, which has no emitted object to match. effect.ready and " +
    "once-per-turn registration exist, but neither isolated execution nor registration proves a real conquer trigger. " +
    "Weaponmaster's original body also needs chain/interpreter-adapter.ts to decode constant modifier Exprs for cost.modify.",
  abilities: [
    { kind: "keyword", keyword: "weaponmaster" },
    {
      kind: "triggered",
      trigger: { at: "conquer", filter: { event: "conquered", role: "self" }, once: "per-turn" },
      optional: false,
      body: [{ id: "ready-self", op: "effect.ready", args: {} }]
    }
  ],
  sourceText:
    "[Weaponmaster] (When you play me, you may [Equip] one of your Equipment to me for :rb_rune_rainbow: less, even if it's already attached.)\n" +
    "The first time I conquer each turn, ready me."
} satisfies CardProgram;

export default lucianMerciless;
