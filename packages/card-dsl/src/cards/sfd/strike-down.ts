/**
 * Strike Down (sfd-107-221) — Spell, 3 energy + 1 Body power, Fiora deck.
 *
 * Printed text:
 *   Choose an equipped friendly unit. It deals damage equal to its Might to an
 *   enemy unit. Then detach an Equipment from it.
 *
 * Official source: Core Rules v1.5 (last updated 2026-10-09, effective
 * 2026-10-16 for the current profile):
 *   https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
 *
 * Rules model:
 * - "Choose an equipped friendly unit" names a public Board object and is a
 *   target under CR 355.5, 355.7 and 355.8. CR 359.3.e.12's official Strike
 *   Down example also calls this object the spell's "targeted unit". Both the
 *   equipped friendly unit and the enemy unit are therefore TargetSpecs locked
 *   during Finalize; modelling the first choice as a non-target pick would lose
 *   the legal-target retest and linked-instruction semantics.
 * - "It deals damage equal to its Might" uses the friendly unit as the Deal's
 *   source and reads its current Might on Resolve (CR 418.6.b.3).
 * - "Then detach an Equipment from it" is linked to the damage instruction
 *   (CR 359.3.e.14). The Equipment is a Gear with the Equipment tag (CR 150.1,
 *   818.1.a), restricted to an object Attached to the locked friendly unit
 *   (CR 718.5; Detach itself does not inherently target, CR 436.3).
 *
 * Status: executable (2026-10-22 production replay against current integration).
 * The ObjectFilter `equipped` predicate reads the complete visible object set
 * and implements CR 818.3.b: a Unit is equipped iff an attached live Gear has
 * the Equipment tag. TargetPlan evaluates it during both Finalize and Resolve.
 * The linked Resolve pick lists the Equipment attached to the locked host and
 * detaches exactly the selected one.
 *
 * The program keeps both restrictions explicit. Dropping `equipped` would
 * widen the first target, and using `eachAttachedTo` would detach every
 * attachment instead of one chosen Equipment. No inferred replacement is used.
 *
 * Speed: no [Action]/[Reaction] keyword appears on the printing, so default
 * spell timing (CR 159.2) applies.
 */
const strikeDown = {
  canonicalCardId: "card.hash-f7e9f4f53ed55ffc9e6b1d38d72324ad29bb9ebf5f25c356bcd7f723aa08b177",
  rulesetVersion: "core-1.5",
  status: "executable",
  sourceText:
    "Choose an equipped friendly unit. It deals damage equal to its Might to an enemy unit. Then detach an Equipment from it.",
  abilities: [
    {
      kind: "play",
      body: [
        {
          // Finalize chooses both targets: "an equipped friendly unit" and
          // "an enemy unit" (355.5/355.7/355.8). The damage source and amount
          // refer back to the former, rather than choosing it again.
          id: "damage",
          op: "effect.damage",
          args: {
            amount: {
              kind: "object-attribute",
              object: { target: "equipped-friendly-unit" },
              attribute: "might"
            },
            source: {
              kind: "object-attribute",
              object: { target: "equipped-friendly-unit" },
              attribute: "ref"
            },
            target: { kind: "constant", value: "enemy-unit" }
          },
          targets: [
            {
              id: "equipped-friendly-unit",
              // `equipped` is evaluated against the complete object set during
              // Finalize and the Resolve retest (CR 818.3.b).
              filter: { type: "unit", zone: "board", controller: "you", equipped: true },
              min: 1,
              max: 1,
              selection: "one"
            },
            {
              id: "enemy-unit",
              filter: { type: "unit", zone: "board", controller: "opponent" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // The singular Equipment is chosen from the locked host's
          // attachments. It stays a pick because Detach does not inherently
          // choose or target (436.3). The production pick resolver presents the
          // attached Equipment and detaches exactly the selected one.
          id: "detach",
          op: "effect.detach",
          args: { pick: { kind: "literal", value: "detached-equipment" } },
          picks: [
            {
              id: "detached-equipment",
              options: ["dynamic:attached-equipment"],
              selection: "one",
              min: 1,
              max: 1,
              filter: {
                type: "gear",
                tags: "Equipment",
                zone: "board",
                attachedTo: { target: "equipped-friendly-unit" }
              }
            }
          ],
          linkedTo: "damage"
        }
      ]
    }
  ]
};

export default strikeDown;
