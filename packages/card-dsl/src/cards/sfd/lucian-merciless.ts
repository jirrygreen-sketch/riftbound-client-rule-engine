import type { CardProgram } from "../../ir/index.js";

/**
 * Lucian, Merciless (sfd-113-221) — Unit, fiora-sfd (M1).
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-113-221):
 *   [Weaponmaster] (When you play me, you may [Equip] one of your Equipment
 *   to me for :rb_rune_rainbow: less, even if it's already attached.)
 *   The first time I conquer each turn, ready me.
 *
 * Official evidence checked 2026-10-23 against Core Rules v1.5 (dated
 * 2026-10-09, effective 2026-10-16):
 * https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
 * https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/
 * The applicable Spiritforged errata contains no Lucian-specific replacement;
 * its Yone entry repeats the ordinary [Weaponmaster] reminder text at [A]:
 * https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/
 *
 * Production evidence: the real card-played trigger locks one controlled
 * Equipment; cost.modify reads that object's authoritative Equip.params.cost
 * and discounts one original [A] (CR 821.1.c.2-.3). A named-domain Equip cost
 * pays in full. Remaining [A] can now be committed from an actual Universal
 * Power lot, and an already attached Equipment is reattached. The Conquer
 * trigger receives the exact Unit incarnation; a second real Conquer in the
 * same turn produces another event but cannot consume the per-turn trigger
 * again (CR 383.3.e.1).
 *
 * The Weaponmaster body locks its Equipment in Finalize, then pays the
 * determined Equip cost during Resolve (CR 204.3.a / 821.1.c.2) and attaches
 * only after successful payment. Named and Universal Power both follow the
 * real resource path. A selected Equipment without an Equip ability, or whose
 * Equip cost cannot be paid, remains in its current location and existing
 * attachment while the trigger completes (CR 821.1.c.1, .c.4-.5). A failed
 * payment rolls back its resource actions and leaves no payment receipt.
 * Malformed or ambiguous authoritative Equip data still fails closed. Neither
 * branch is approximated as free attachment or with a substituted Domain.
 */
const lucianMerciless = {
  canonicalCardId: "card.hash-c403c2d9835df87cc0774a86145ef937226d5e7ebcfe75282053e23df744f5ef",
  rulesetVersion: "core-1.5",
  status: "executable",
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
