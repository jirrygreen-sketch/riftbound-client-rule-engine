import type { CardProgram } from "../../ir/index.js";

/**
 * Seal of Focus (ogn-081-298) — Gear, 0 energy + 1 Calm power.
 *
 * Printed text:
 *   :rb_exhaust:: [Reaction] — [Add] :rb_rune_calm:. (Abilities that add
 *   resources can't be reacted to.)
 *
 * Rules evidence (Core Rules v1.5):
 * - 415.4 / 415.5: the leading :rb_exhaust: symbol is the cost "Exhaust this";
 *   the cost must be completable for the ability to be played.
 * - 430.1 / 430.3 / 430.5: [Add] :rb_rune_calm: adds one Calm Power.
 * - 813.1 / 813.1.c.2: [Reaction] on an activated ability grants the
 *   Closed-State activation permission (declared for the keyword registry).
 * - 430.2: an Add activated ability finalizes and resolves immediately; it is
 *   not reactable. The chain owns that timing (chain/ Finalize + addition of
 *   the Add chain kind), not this data file.
 *
 * Status: executable — every printed component runs on merged kernel paths,
 * and the golden test drives them with this card's own cost and body:
 * - the exhaust cost is paid by the cost plan against the source gear
 *   (415.4/415.5, RIFT-89), and a second activation with an exhausted source
 *   fails closed instead of approximating (probed via CostPlanError);
 * - the `add` chain kind finalizes and resolves immediately without passing
 *   Priority or Focus (430.2/430.2.a, chain/engine.ts `advance`);
 * - a Reaction Add is admissible while costs are being paid through the merged
 *   `activateAddDuringPayment` gate (430.3), and 430.4.a is satisfied because
 *   the card's own ability directs the Add.
 * Reaction's `continuous.timing` keyword expansion has no layer consumer
 * (RIFT-91); the ability's own `timing: "reaction"` field is what the chain
 * engine reads, so this card does not depend on that consumer.
 */
const sealOfFocus = {
  canonicalCardId: "card.hash-70378362a6ae7f5743042bfaa2d0a3ae223efaa8532f19d9aaad4ee8f6c47a1f",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "activated",
      // ":rb_exhaust:" — the printed exhaust symbol is the cost "Exhaust this"
      // (415.5); the cost system pays it against the source gear (415.4).
      cost: { kind: "activated", payments: [{ kind: "exhaust" }] },
      timing: "reaction",
      body: [
        {
          // "[Add] :rb_rune_calm:" — one Calm Power (430.1/430.5).
          id: "add-calm-power",
          op: "effect.resources",
          args: { power: { kind: "constant", value: ["Calm"] } }
        }
      ]
    }
  ],
  sourceText:
    ":rb_exhaust:: [Reaction] — [Add] :rb_rune_calm:. (Abilities that add resources can't be reacted to.)"
} satisfies CardProgram;

export default sealOfFocus;
