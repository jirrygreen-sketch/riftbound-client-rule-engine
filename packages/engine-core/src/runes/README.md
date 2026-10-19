# Basic Rune resource activations

`planBasicRuneResourceActivation` and `executeBasicRuneResourcePlan` implement
the two rule-granted Basic Rune abilities from Core Rules v1.5 (published
2026-10-09), rules 164.2.a-b:

- `rune-energy`: Reaction, Exhaust this Rune, Add 1 Energy.
- `rune-power`: Reaction, Recycle this Rune, Add 1 Power of that Rune's Domain.

Source: [Core Rules v1.5](https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf),
with the current official-source snapshots in
`shared/rules/official-order/source-snapshots.json` checked on 2026-10-19. The
Radiance patch effective 2026-10-16 and the Spiritforged rulings/errata contain
no applicable change to these Basic Rune abilities.

The planner accepts only a trusted catalog resolver keyed by the physical
`cardId`. It requires `energy: null`, `power: null`, the `Basic` tag, and a Rune
type; it never derives Domain from a Power cost, card name, or Legend. The
resolved `cardId`, `canonicalCardId`, and Domain are frozen into the plan.

The Chain Finalize owner builds and pays the non-standard `exhaust` or
`recycle` cost with the existing cost layer. The registered
`effect.resources` primitive performs the Add action. Execution does not write
resource balances directly. The `power` path recycles the Rune to its owner's
Rune Deck under rules 417.1.b and 417.3; both paths add to the controlling
player's Rune Pool under 166.1. Priority activations use the normal Reaction
window; payment activations must enter through
`ChainEngine.activateAddDuringPayment`, the implementation seam for 357.1.a and
430.3.
