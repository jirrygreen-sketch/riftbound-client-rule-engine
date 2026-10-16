import type { CardProgram } from "../../ir/index.js";

/**
 * Treasure Hoard (sfd-220-221) — Battlefield, Rumble precon.
 *
 * "When you conquer here, you may pay {1 energy} to play a Gold gear token
 *  exhausted."
 *
 * Status rationale (contract §3.1): the trigger, the optional wrapper, the
 * energy-1 pay and the chain-create + play shape are all expressible, but the
 * card cannot honestly be marked "executable" because:
 * - the Gold gear token definition (a Gear token with its own activated
 *   ability, CR v1.5 187.x) is deliberately NOT in the frozen effect.token
 *   definition table — effect.token.ts documents that "definitions requiring
 *   other abilities, including Gold, remain blocked/judge-required";
 * - "play a … token" must create the token on the Chain (v1.5 440.2.c /
 *   185.2.a / 350.2 / 354, contract GameAction create-token to "chain"), then
 *   let the chain's play flow take it over with the printed cost waived —
 *   effect.token blocks mode "play" and effect.play requires an already
 *   existing object plus a FinalizedCostPlan computed by the cost system
 *   (cost.printed / cost.pay are not merged primitives);
 * - "exhausted" is an entry override (143.4 / 185.2.d) that the create-token
 *   action explicitly does not support ("Entry overrides are not supported").
 *
 * The abilities below still encode the full intended shape so downstream
 * tooling can see the trigger, cost and play structure; execution is judged.
 */
export default {
  canonicalCardId: "card.hash-77763eae5320de558954776a37677e8638b6d4af73399e5a7c4f5d5321a2b564",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Gold gear token definition (with its own ability, CR v1.5 187.x) is absent from the effect.token definition table (blocked there by design); playing a new token requires the chain-create + cost-waived play flow (v1.5 440.2.c/185.2.a/350.2/354), which needs cost.printed/cost.pay primitives and a FinalizedCostPlan not yet merged; the create-token action also does not support the 'exhausted' entry override (143.4/185.2.d).",
  sourceText: "When you conquer here, you may pay :rb_energy_1: to play a Gold gear token exhausted.",
  abilities: [
    {
      kind: "triggered",
      trigger: { at: "conquer", filter: { event: "conquer", here: true, player: "controller" } },
      optional: true,
      body: [
        {
          id: "treasure-hoard.opt-in",
          op: "choice.optional",
          args: { prompt: { kind: "constant", value: "Pay 1 energy to play a Gold gear token exhausted?" } }
        },
        {
          id: "treasure-hoard.pay",
          op: "cost.pay",
          linkedTo: "treasure-hoard.opt-in",
          args: { energy: { kind: "constant", value: 1 } }
        },
        {
          id: "treasure-hoard.create",
          op: "effect.token",
          linkedTo: "treasure-hoard.pay",
          args: {
            token: { kind: "constant", value: "gold" },
            mode: { kind: "constant", value: "chain" },
            amount: { kind: "constant", value: 1 },
            linkKey: { kind: "constant", value: "goldToken" }
          }
        },
        {
          id: "treasure-hoard.play",
          op: "effect.play",
          linkedTo: "treasure-hoard.create",
          args: {
            object: { kind: "linked-value", instructionId: "treasure-hoard.create", key: "goldToken.objects" },
            cost: { kind: "constant", value: { finalized: true, energy: 0, power: [], xp: 0 } },
            // Location is nominal: the real location is decided by the chain
            // play flow (440.2.c / 185.2.a); object-property cannot express
            // "the source battlefield's location" without a static ref, and
            // the IR validator currently requires a string id (not ObjectRef)
            // for object-property, which is a known IR-layer mismatch.
            location: { kind: "constant", value: { type: "battlefield", id: "battlefield-1" } }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;
