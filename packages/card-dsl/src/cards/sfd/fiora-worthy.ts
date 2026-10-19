import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Fiora, Worthy (sfd-180-221 / sfd-180a-221).
 *
 * Official text checked 2026-10-19 against the merged manifest and the cached
 * Core Rules v1.5 (updated 2026-10-09, effective 2026-10-16):
 * https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
 * "When a unit you control becomes [Mighty], you may pay :rb_rune_order: to
 * ready it. (A unit is Mighty while it has 5+ :rb_might:.)"
 *
 * The trigger is mandatory: the controller must add a legal trigger to the
 * Chain. "You may pay" is the leading may inside the ability, so the existing
 * authoring shape is one choice.optional whose body begins with cost.pay and
 * ends with effect.ready. The leading-choice adapter moves the decision and
 * cost to Finalize (CR 383.3.a / 383.3.b.1); Resolve receives only the ready
 * instruction. No top-level TriggeredAbility.cost field is added.
 *
 * ":rb_rune_order:" is one Order Power, not one Energy and not a sacrificed,
 * exhausted or recycled Rune. "it" is the exact Unit incarnation captured by
 * the triggering might-changed event, never Fiora merely because she owns the
 * ability. The `event:it` selector is an ObjectSelector, so it cannot prompt
 * the player or select another friendly Unit.
 *
 * CR 709 makes becoming Mighty a true transition from current Might below 5
 * to 5 or greater. It is false for 3 -> 4, 5 -> 6 and 5 -> 4. The filter keeps
 * that transition predicate and the friendly-unit scope. Mighty is checked
 * when the event occurs; the printed text adds no "if it is still Mighty"
 * Resolve condition, so this program does not invent one. There is no once cap,
 * so a later separate 4 -> 5 transition can trigger again.
 *
 * status = judge-required after the 2026-10-19 production probe. The correct
 * IR and Finalize cost translator are present, but the default Chain currently
 * has no complete producer/consumer edge for this interaction: registering the
 * transition filter fails closed in programs/filters.ts, real layer changes do
 * not publish a scanned might-changed event in the default Chain, the generic
 * pipeline does not assign a frozen event `it` to the trigger snapshot, and
 * effect.ready's primitive schema does not yet accept the event selector. The
 * legacy ResolveContext also cannot represent Universal Power, although CR
 * 135.2.e.5.a / 163.2.b permits it to pay any Domain cost. Those are shared
 * engine/pipeline responsibilities and must not be approximated by Fiora-
 * specific settlement code or a player-selected target.
 *
 * Evidence URL: the card text is from the official Spiritforged catalog (the
 * two approved printings above); the CR download and hash are recorded in
 * docs/rule-source-manifest.json. CR 135.2.e.5.a / 163.2.b govern Universal
 * Power; CR 383.3.a / 383.3.b.1 govern the leading may and payment timing;
 * CR 709-711 govern the event-time Mighty transition.
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "might-changed",
      filter: {
        event: "might-changed",
        object: {
          type: "unit",
          controller: "self",
          becomesMighty: true
        }
      }
    },
    // The trigger itself is mandatory; the leading choice.optional owns may.
    optional: false,
    body: [
      {
        id: "fiora-worthy.opt-in",
        op: "choice.optional",
        args: {
          prompt: {
            kind: "constant",
            value: "Pay 1 Order Power to ready the unit that became Mighty?"
          },
          body: {
            kind: "constant",
            value: [
              {
                id: "fiora-worthy.pay-order",
                op: "cost.pay",
                args: {
                  payments: {
                    kind: "constant",
                    value: {
                      power: ["Order"]
                    }
                  }
                }
              },
              {
                id: "fiora-worthy.ready-event-it",
                op: "effect.ready",
                args: {
                  objects: {
                    kind: "constant",
                    value: { event: "it" }
                  },
                  linkKey: { kind: "constant", value: "readied" }
                }
              }
            ]
          }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-261f97a75639fd51dc63b8c4b2a577b52d5bd6893227a1a3a13da5375880fe6f",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "Fiora's official text and IR are source-backed, but the default production path is incomplete (probed 2026-10-19): " +
    "programs/filters.ts rejects object.becomesMighty, the default Chain does not publish a scanned might-changed event after a real layer change, " +
    "EventPipeline does not install the frozen event `it` on trigger snapshots, effect.ready does not accept `{event:'it'}`, " +
    "and the legacy ResolveContext cannot represent Universal Power (CR 135.2.e.5.a / 163.2.b). " +
    "Keep this card blocked until the shared trigger/event/payment owner connects those paths; no player target, Fiora source fallback, or custom resolution is permitted.",
  abilities,
  sourceText:
    "When a unit you control becomes [Mighty], you may pay :rb_rune_order: to ready it. (A unit is Mighty while it has 5+ :rb_might:.)"
} satisfies CardProgram;

export default program;
