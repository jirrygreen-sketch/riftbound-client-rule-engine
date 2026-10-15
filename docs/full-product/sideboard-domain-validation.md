# Sideboard Domain Identity validation

Scope: `apps/game-server` Constructed deck validator (`constructed-policy.ts`)
and its focused tests. This note records the rule basis, the exact behaviour
change, and what remains explicitly unavailable.

## Rule basis

- CR v1.4 **103.2.c** — Main Deck contents are “Subject to Domain Identity”.
- CR v1.4 **103.1.b.2-4** — Domain Identity is dictated by the Champion Legend
  domains; a multi-Domain card is permitted only when the identity contains
  *all* of its Domains.
- Tournament Rules 2026-07-16 **601.1.c.2** — “A sideboard can consist only of
  valid Main Deck cards.” A sideboard card must therefore also satisfy the Main
  Deck Domain Identity constraint. (601.1.c.1 keeps the sideboard at 10 or
  fewer cards; 601.1.c.3 keeps the named-copy limits combined across Main Deck
  and sideboard.)

The effective window is the 2026-07-16 Tournament Rules text in use for the
current Constructed format. The later 2026-10-16 / Radiance material is **not**
mixed into this decision.

## Behaviour change

`DOMAIN_IDENTITY_ZONES` in `apps/game-server/src/constructed-policy.ts` now
includes `"sideboard"` alongside `mainDeck`, `champion`, `runes` and
`battlefields`. Every submitted sideboard card therefore runs through the
existing Domain containment check:

- A sideboard card whose declared Domains are not all inside the Champion
  Legend's Domain Identity is rejected with the existing
  `card_not_in_domain_identity` issue (zone `sideboard`).
- A sideboard card with no catalog identity metadata is reported with the
  existing `identity_metadata_unavailable` issue — the same fail-closed
  behaviour as the other zones, never a silent pass.
- Declared-Domain cards are still matched by the resolved Champion Legend
  identity; extra region/creature tags are never used as a family.

No new issue codes, error types, tenant/permission rules, regions, Colorless
semantics or BO3/swap rules were added. The change reuses the existing
`ConstructedCardIdentityMetadata` lookup and the existing error codes.

## Explicitly unchanged

- Signature total across zones (including sideboard) still caps at 3
  (`SIGNATURE_COUNT_ZONES`).
- Cross Main Deck + sideboard canonical copy limits and the 10-card sideboard
  ceiling are unchanged.
- `POLICY_LIMITATIONS` public text, order, source array and dates are unchanged,
  so the version-bound policy metadata is untouched here.
- Colorless keeps its conservative “no Domain Identity semantics yet”
  treatment; card identity metadata stays `unknown` /
  `identity_metadata_unavailable` when the catalog does not supply it.
- Cards added by game effects (CR 103.1.b.5) are not emulated.

## Remaining gaps (do not overstate)

- The public policy still reports `tournamentComplete: false`.
- Regional product availability and release dates remain policy metadata, not
  independently verified; they are never inferred from the user's time zone or
  from TR dates.
- Colorless Domain Identity, region/product availability and effect-added cards
  remain unresolved and must stay `judge-required` / `blocked`.
- Because of the above, this validator must **not** be described as a complete
  Constructed rules implementation.

## Verification

- `apps/game-server/tests/constructed-sideboard-domain.test.ts` — 8 focused
  cases through `validateConstructedDeck` / `validateCatalogDeck`.
- `apps/game-server/tests/constructed-identity.test.ts` and
  `constructed-policy.test.ts` — existing regressions.
- Full `@riftbound/game-server` test run and `typecheck`.
