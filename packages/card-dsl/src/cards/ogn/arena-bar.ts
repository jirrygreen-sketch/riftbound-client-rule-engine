import type { CardProgram } from "../../ir/index.js";

/**
 * Arena Bar (ogn-124-298) — Gear, 3 energy, Body.
 *
 * Printed text:
 *   :rb_exhaust:: Buff an exhausted friendly unit. (If it doesn't have a buff,
 *   it gets a +1 :rb_might: buff.)
 *
 * Rules evidence (Core Rules v1.5):
 * - 377.3 / 381: an activated ability without a permissive keyword may be
 *   activated only on its controller's turn in an Open State — the `action`
 *   speed the chain engine enforces (canAct 'action').
 * - 415.4 / 415.5: the leading :rb_exhaust: symbol is the cost "Exhaust this".
 * - 427.1 / 427.1.b / 427.1.b.1 / 427.3: "Buff a unit" places one Buff counter
 *   (and does not place a second one on a unit that already has one); the
 *   +1 Might a Buff contributes is derived by the layers system (703).
 * - "an exhausted friendly unit" is one target (355.10.a.2: "unit" means a
 *   board unit; 355.9.b: the state restriction is a targeting restriction),
 *   selection "one".
 *
 * Status: executable — every printed component has a merged, executable path:
 * the activation steps 400–407 (Pending → Finalize → Resolve) run on the
 * merged chain engine (RIFT-120), `payments: [{kind: "exhaust"}]` pays "Exhaust
 * this" through the cost plan (415.4/415.5, RIFT-89), and the buff body runs
 * through the merged effect.buff primitive plus the Finalize TargetPlan, whose
 * `states: "exhausted"` restriction excludes ready units (427.1 / 355.9.b).
 * The golden test drives the real ChainEngine with this card's own cost and
 * body and asserts the exhaustion and the placed Buff. Building the ChainDraft
 * from a card program (a `describeActivate` analogue of `describePlay`) is
 * integration wiring owned by the coordinating task, exactly like trigger
 * registration for the merged triggered-ability cards.
 */
const arenaBar = {
  canonicalCardId: "card.hash-37383a14ededcbaee2260e042ca4d77c596e88247ee1ca23ff0256f8eb8e3982",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "activated",
      // 377.3/381: activated abilities use the chain and are by default only
      // legal on their controller's turn in an Open State.
      cost: { kind: "activated", payments: [{ kind: "exhaust" }] },
      timing: "action",
      body: [
        {
          // "Buff an exhausted friendly unit." — one exhausted unit the
          // controller controls (427.1: placing a Buff is the effect).
          id: "buff-exhausted-friendly-unit",
          op: "effect.buff",
          args: {
            mode: { kind: "constant", value: "buff" },
            target: { kind: "constant", value: "exhausted-friendly-unit" }
          },
          targets: [
            {
              id: "exhausted-friendly-unit",
              // "friendly" is the ability controller; the engine's ObjectFilter
              // resolves the "self" player selector in Finalize (chain/engine.ts).
              filter: { type: "unit", controller: "self", states: "exhausted" },
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
    ":rb_exhaust:: Buff an exhausted friendly unit. (If it doesn't have a buff, it gets a +1 :rb_might: buff.)"
} satisfies CardProgram;

export default arenaBar;
