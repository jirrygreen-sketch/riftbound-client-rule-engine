import type { CardProgram } from "../../ir/index.js";

/**
 * Energy Conduit (ogn-098-298) — Gear, 3 energy, Mind.
 *
 * Printed text:
 *   :rb_exhaust:: [Reaction] — [Add] :rb_energy_1:. (Abilities that add
 *   resources can't be reacted to.)
 *
 * Rules evidence (Core Rules v1.5):
 * - 415.4 / 415.5: the leading :rb_exhaust: symbol is the cost "Exhaust this".
 * - 430.1 / 430.5: [Add] :rb_energy_1: adds 1 Energy.
 * - 813.1 / 813.1.c.2: [Reaction] on an activated ability grants the
 *   Closed-State activation permission (declared for the keyword registry).
 * - 430.2 / 430.3: an Add activated ability finalizes and resolves
 *   immediately, without passing Priority or Focus, and a Reaction Add may be
 *   activated whenever costs are being paid. The chain owns that timing.
 *
 * Status: executable — the exhaust cost is paid by the merged cost plan
 * (415.4/415.5, RIFT-89), the `add` chain kind finalizes and resolves
 * immediately without passing Priority or Focus (430.2/430.2.a, RIFT-120),
 * and a Reaction Add is admissible during payment through the merged
 * `activateAddDuringPayment` gate (430.3). 430.4.a holds because the card's
 * own ability directs the Add. The golden test drives the real ChainEngine
 * with this card's own cost and body. Reaction's `continuous.timing`
 * expansion has no layer consumer (RIFT-91), but the ability's own
 * `timing: "reaction"` field is what the chain engine reads.
 */
const energyConduit = {
  canonicalCardId: "card.hash-473f0936b54f6477d3322f55f1fe879abf504bfae19635447ff433313c86bb17",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "activated",
      cost: { kind: "activated", payments: [{ kind: "exhaust" }] },
      timing: "reaction",
      body: [
        {
          // "[Add] :rb_energy_1:" — one Energy (430.1/430.5).
          id: "add-energy-1",
          op: "effect.resources",
          args: { energy: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText:
    ":rb_exhaust:: [Reaction] — [Add] :rb_energy_1:. (Abilities that add resources can't be reacted to.)"
} satisfies CardProgram;

export default energyConduit;
