# Card Data Integrity Audit

Audit date: 2026-10-11 (Asia/Hong Kong)

Data version: `2026-10-11-official-gallery`

Scope: current card-data synchronization outputs and their source snapshot.
The original audit was read-mostly. The one issue it identified was subsequently
fixed, covered by a real-shape regression test, and the generated deck catalog
was rebuilt and verified.

## Executive Summary

All required data layers contain the same 1,381 card printings:

| Layer | Count |
| --- | ---: |
| Merged snapshot | 1,381 |
| English official gallery | 1,381 |
| Chinese official gallery | 1,381 |
| `data/catalog.json` | 1,381 |
| `data/deck-catalog.json` | 1,381 |
| Image manifest | 1,381 |
| Image files on disk | 1,381 |

The English and Chinese ID sets are identical in both directions. Chinese
`name` values are present for all 1,381 printings and no replacement or control
characters were found. The image catalog, manifest, and disk files are
consistent, with no missing image, failed download, extra file, path escape,
or byte/hash mismatch.

The rebuilt deck catalog contains 1,212 standard printings and 169 alternate
printings. Its display names comprise 1,355 localized Chinese values and 26
English fallbacks.

One production issue was found and fixed: the 45 public codes ending in ASCII
`*` are now classified as `alternate`. Every affected identity kept its existing
`primaryPrintingId`.

## Files Audited

Primary data files:

- `packages/card-data/dist/cards.json`
- `packages/card-data/data/catalog.json`
- `packages/card-data/data/deck-catalog.json`
- `packages/card-data/data/images-manifest.json`
- `packages/card-data/data/images/`

Relevant generation logic:

- `packages/card-data/scripts/sync-current-cards.mjs`
- `packages/card-data/scripts/build-deck-catalog.mjs`
- `packages/card-data/scripts/sync-images.mjs`

## Coverage

Set counts are consistent across the merged snapshot and official galleries:

| Set | Cards |
| --- | ---: |
| `ogn` | 352 |
| `ogs` | 24 |
| `rad` | 192 |
| `sfd` | 288 |
| `unl` | 288 |
| `ven` | 237 |

Community records: 1,380. The official gallery fills one community gap:
`unl-022-219`. There are no community-only printings in the merged result.

ID sets:

| Comparison | Missing count |
| --- | ---: |
| Snapshot minus `catalog.json` | 0 |
| `catalog.json` minus snapshot | 0 |
| English official minus Chinese official | 0 |
| Chinese official minus English official | 0 |
| Snapshot minus deck catalog | 0 |
| Deck catalog minus snapshot | 0 |

`catalog.json` has the same 1,381 IDs in the same order as the merged snapshot.
Each entry has the expected `id`, `cardCode`, and `imageUrl`.

The card bundle digest in `catalog.json` is:
`sha256:c100aa4964d75ffd06d293c5fd4a973b7bede609c489205a42e32833a43a476f`.

The deck catalog is exactly reproducible from the current snapshot. Its digest
is:
`sha256:c06644d45b8a5ee2fe868a0cbb5edcf7eb3c807e4b482cf982f2a8811df51331`.

## Identity And Variants

Canonical identity results:

| Metric | Count |
| --- | ---: |
| Canonical identities/groups | 1,080 |
| Single-printing groups | 873 |
| Multi-printing groups | 207 |
| Cross-set groups | 46 |

Group size distribution:

| Printings per group | Groups |
| --- | ---: |
| 1 | 873 |
| 2 | 136 |
| 3 | 57 |
| 4 | 5 |
| 5 | 9 |

All canonical IDs and group/printing mappings verify against the current
snapshot.

Variant labels currently present:

| Variant | Cards |
| --- | ---: |
| `standard` | 1,212 |
| `alternate` | 169 |

All official public codes are nonempty, and all 1,381 printings select a
standard primary under the current `standard`-before-`alternate` ranking.

## Fixed Issue: Trailing `*` Misclassified As Standard

The current data contains 45 public codes whose printed number ends with `*`
instead of the literal text `star`, for example `SFD-227*/221` and
`UNL-231*/219`. All 45 are classified as `alternate`:

```text
ogn-299-star-298, ogn-300-star-298, ogn-301-star-298, ogn-302-star-298,
ogn-303-star-298, ogn-304-star-298, ogn-305-star-298, ogn-306-star-298,
ogn-307-star-298, ogn-308-star-298, ogn-309-star-298, ogn-310-star-298,
sfd-223-star-221, sfd-224-star-221, sfd-225-star-221, sfd-227-star-221,
sfd-228-star-221, sfd-230-star-221, sfd-232-star-221, sfd-233-star-221,
sfd-235-star-221, sfd-236-star-221, sfd-237-star-221, sfd-239-star-221,
unl-226-star-219, unl-227-star-219, unl-228-star-219, unl-229-star-219,
unl-230-star-219, unl-231-star-219, unl-232-star-219, unl-233-star-219,
unl-234-star-219, unl-235-star-219, unl-236-star-219, unl-237-star-219,
ven-189-star-166, ven-190-star-166, ven-191-star-166, ven-192-star-166,
ven-193-star-166, ven-194-star-166, ven-195-star-166, ven-196-star-166,
ven-197-star-166
```

These 45 printings occur in 45 identity groups. This correction changed the
reported variant totals from 1,257 standard / 124 alternate to 1,212 standard /
169 alternate. No `primaryPrintingId` changed, because every affected group has
at least one other standard printing.

### Root Cause

`packages/card-data/scripts/build-deck-catalog.mjs`,
`explicitPublicCodeVariant()` recognizes these suffixes:

- literal `a`
- literal `star`
- a Unicode star character expected after decoding

It did not recognize the ASCII `*` character used by all 45 current official
public codes. The original test
`recognizes explicit official publicCode alternate indicators` in
`packages/card-data/test/build-deck-catalog.test.mjs` only covered literal
`star`, so it passed even though the current official API emits `*`.

### Fix Verification

`explicitPublicCodeVariant()` now treats a trailing ASCII `*` the same as
literal `star` and the Unicode star indicator. The regression suite includes
the real shape `SFD-227*/221`, checks that `sfd-227-star-221` is `alternate`
and `sfd-227-221` is `standard`, and keeps the standard printing as the
group's `primaryPrintingId`.

`packages/card-data/data/deck-catalog.json` was rebuilt. The rebuilt catalog
still contains 1,381 printings and 1,080 identity groups, all 45 `*-star-*`
printings are `alternate`, and the primary-printing comparison against the
previous catalog found zero changes. No image manifest or image file change was
required.

## Localization

The current catalog has 1,355 nonempty Chinese `localizedName` values and 26
English-name fallbacks where the localized source has no Chinese name.

Fifteen English cards have a subtitle but no Chinese `localizedSubtitle`. The
Chinese source records provide a combined `name` such as `Ahri, Inquisitive`
and no separate subtitle, so the generator intentionally omits
`localizedSubtitle`:

```text
ogn-066a-298, ogn-252-298, sfd-143-221, sfd-223-star-221,
sfd-224-star-221, sfd-225-star-221, sfd-227-star-221, sfd-228-star-221,
sfd-230-star-221, sfd-232-star-221, sfd-233-star-221, sfd-235-star-221,
sfd-236-star-221, sfd-237-star-221, sfd-239-star-221
```

This is an upstream Chinese localization shape, not a merge failure. It does
not create a missing Chinese card name.

## Images And Manifest

Manifest status:

| Check | Result |
| --- | --- |
| `partial` | `false` |
| `ok` | `true` |
| Catalog cards | 1,381 |
| Selected cards | 1,381 |
| Missing | 0 |
| Failed | 0 |
| Disk files | 1,381 |
| Extra disk files | 0 |

All image IDs match the deck catalog and image catalog. Every disk file is
listed by the manifest, every manifest file exists, and every byte count and
SHA-256 matches.

Content types:

| Content type | Images |
| --- | ---: |
| `image/png` | 1,380 |
| `image/webp` | 1 |

The single WebP file is `sfd-227-221.webp`; it is valid and is not an anomaly.

`catalog.json` and the image manifest use the same unmodified official image
URLs. The deck catalog uses the same URLs with `?accountingTag=RB`, which is
the expected presentation-layer accounting tag, not a path error.

## Empty Fields And Duplicates

No duplicate IDs were found in any checked layer:

| Layer | Duplicate IDs |
| --- | ---: |
| Snapshot | 0 |
| `catalog.json` | 0 |
| `deck-catalog.json` | 0 |
| Image manifest IDs | 0 |
| Manifest image file names | 0 |

No empty required text scalar was found except the intentionally empty
`ability` values discussed below. No null image URL was found.

### Empty Ability

Thirty-three cards have an empty `ability`:

| Card type | Count |
| --- | ---: |
| Rune | 24 |
| Unit | 9 |

The nine units are token or simple generated units:

```text
ogn-049-298 Playful Phantom, ogn-088-298 Mega-Mech,
ogn-142-298 Mountain Drake, ogn-175-298 Shipyard Skulker,
ogn-219-298 Vanguard Sergeant, ogn-271-298 Recruit (DE),
ogn-272-298 Recruit (NX), ogn-273-298 Recruit (ZN), ven-t04 Recruit
```

The upstream official text is empty for these cards. The current generator
and tests explicitly preserve empty ability text.

### Empty Domains

Seven cards have an empty `domains` array:

```text
rad-006-167, rad-009-167, rad-026-167, rad-041-167,
rad-047-167, rad-049-167, rad-121-167
```

The official source records contain a `Domain` object with an empty `values`
array. This is therefore an upstream field shape, not a generated-data
omission.

### Empty Tags

Four hundred seventeen cards have an empty `tags` array: 219 Spells, 77 Gear,
75 Battlefields, and 46 Units. The official source provides no tags for these
records, so this is a legal field shape rather than a synchronization defect.

### Null Costs

Null cost values are type-dependent and expected:

| Field | Null count | Largest affected types |
| --- | ---: | --- |
| `energy` | 262 | Legends, Battlefields, Runes |
| `power` | 818 | Units, Legends, Runes, Gear, Battlefields |
| `might` | 613 | Legends, Spells, Battlefields, Gear |

These values should continue to be interpreted by card type; a blanket
non-null rule would be incorrect.

## Test Result

Command:

```powershell
pnpm --filter @riftbound/card-data test
```

Result: passed, 48 tests. The test run rebuilds ignored `dist/` files but did
not modify tracked production source.

No unresolved production-data issue was found by this audit. Keep the complete
official-rules boundary separate from data completion.

Follow-up validation on 2026-10-11 found one reproducible synchronization
guard gap: `mergeCards` previously allowed a later community record to silently
overwrite an earlier record with the same `cardCode`. Current source data is
not affected, because it contains no duplicate community card codes. The guard
is now explicit: invalid, empty, and duplicate community card codes fail the
sync before merge. The focused regression suite passes 49 card-data tests, and
the persisted data totals, variant counts, localization counts, and deck digest
remain unchanged.
