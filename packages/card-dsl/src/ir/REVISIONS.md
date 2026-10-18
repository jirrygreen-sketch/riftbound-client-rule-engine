# Additive EffectIR revisions

The frozen P0 contract in `docs/plans/2026-10-15-p0-contract.md` remains owned by
the coordinator. This package-local record describes the additive IR delta for
integration; structural acceptance does not establish runtime executability.

| Date | Task | Addition |
| --- | --- | --- |
| 2026-10-17 | RIFT-711 | Add `PlayerSelector`, `player-property` (points/score, energy, XP and hand/deck/rune-deck/trash sizes), `turn-number`, `player-turn-count`, and `object-designation` to `Expr`. Existing variants and defaults remain unchanged. Turns count committed `turn-start` history, globally or per player; no turn-order arithmetic. Runtime dispatch and layer integration are pending coordinator changes; affected cards remain `judge-required`. |
| 2026-10-18 | RIFT-782 | Add event pronoun `it`, relation filters/conditions, explicit cost parameters and serializable payment receipts, Universal Power provenance, optional Facedown/Hide/Recall/batch action contracts, and keyword parameter maps. All additions are optional or new union members; existing IR, default schema/profile, and null printed characteristics remain unchanged. |
