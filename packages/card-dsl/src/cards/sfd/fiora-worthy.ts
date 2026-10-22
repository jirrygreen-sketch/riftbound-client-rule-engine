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
 * status = judge-required after the 2026-10-22 production recheck. A real
 * Hand -> Chain -> Board lifecycle proves the exact one-Order debit, the
 * decline and unpayable branches, and readiness of the frozen triggering unit.
 * After RIFT-929, the ProgramBinding + ChainEngine path prepares a domainless
 * Universal Power lot for this named Order requirement. The engine's locked
 * `FinalizedCostPlan` keeps that lot separate as `universalPower` instead of
 * pretending it is Order (CR 135.2.e.5.a / 163.2.b).
 *
 * The remaining whole-card gate is the authoritative runtime representation
 * and commit, not the card IR. `PlayerSnapshot.power` is still declared as
 * `readonly Domain[]` (engine-core/src/effects/contract.ts:91), excluding the
 * already-declared `UniversalPowerSource`; the test host reports the generated
 * `pay` plan as done without consuming that lot
 * (engine-core/src/effects/testing/test-kernel.ts:572-590), so the payment
 * owner rejects the post-commit receipt and rolls Finalize back. The server
 * host also fails closed whenever a finalized plan contains `universalPower`
 * (apps/game-server/src/engine-runtime/host.ts:771). Until those owners carry
 * and consume the domainless lot end to end, the published program must not be
 * admitted or have this blocker approximated as a named Domain.
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
    "The ProgramBinding + ChainEngine path proves the typed Mighty transition, frozen event:it, Finalize payment with named Order, decline, unpayable rollback, and event:it ready effect. " +
    "RIFT-929 now plans a domainless `any` lot as `universalPower` for the named Order requirement (engine-core/src/cost/payment.ts:184-190), but the authoritative runtime cannot commit it: engine-core/src/effects/contract.ts:91 types PlayerSnapshot.power as `readonly Domain[]` without UniversalPowerSource, engine-core/src/effects/testing/test-kernel.ts:572-590 returns done while leaving `any` unconsumed, and apps/game-server/src/engine-runtime/host.ts:771 rejects `universalPower`. " +
    "CR 135.2.e.5.a / 163.2.b require Universal Power to pay this Order requirement, so the production host currently fails closed; no named-domain substitution, player target, Fiora source fallback, synthetic payment, or card-specific resolution is used.",
  abilities,
  sourceText:
    "When a unit you control becomes [Mighty], you may pay :rb_rune_order: to ready it. (A unit is Mighty while it has 5+ :rb_might:.)"
} satisfies CardProgram;

export default program;
