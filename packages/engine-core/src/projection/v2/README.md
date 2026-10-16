# Projection v2

`projectFor(state, viewer)` is the engine-only privacy boundary for the new
state model. It accepts `PlayerId`, `null`/`"spectator"`, or `"replay"` and
returns a pure `ProjectionV2` value. The function does not import protocol v2
and does not mutate the authority.

The projection keeps zone counts public while filtering card characteristics:

- a hand exposes identities only to its owner;
- Main Deck and Rune Deck expose counts only, including to their owners;
- Trash, Banishment, Champion/Legend zones, Base, Battlefield, Rune Zone and
  Chain expose identities and public state;
- a facedown object exposes occupancy, owner/controller metadata and a
  viewer-scoped opaque id, while its card characteristics are available only to
  its controller or an active `reveal`/`look`/`show-off` grant;
- pending `ChoiceRequest`s are emitted only to their chooser;
- Chain items are public, including a card that has just left a hidden zone.

`zoneEntryId` remains on projected references. Whenever an object is hidden,
the projected `id` is replaced by `hidden:<opaque-token>`; the token is scoped
to the viewer, zone and entry and never contains the authoritative id. A move
to another zone must allocate a new authoritative `zoneEntryId`, so stale
references cannot be correlated through the projection.

The `visibility` input carries temporary information grants. A reveal is sent
to its declared audience, a look is private to its `player`, and Show Off may
limit the exposed characteristics with `properties`. The authority should
remove or mark a grant inactive at its rule-defined expiry; the projector keeps
the `duration`/`until` metadata intact for replay and includes only active
grants visible to the requested viewer.

Suggested protocol-v2 mapping (owned by the protocol task):

| Engine field | Protocol field suggestion |
| --- | --- |
| `ProjectedObject.ref` | `objectRef { id, zoneEntryId }` |
| `ProjectedObject.visibility` | `face: "up" | "down"` plus optional characteristics |
| `ProjectedZone.count` | `zone.count` |
| `ProjectedZone.cards` | `zone.knownObjects` |
| `ProjectedChainItem` | `chain.items[]` with `status`, `source`, `targets` |
| `ProjectedChoiceRequest` | `prompt` addressed to `chooser` only |
| `ProjectionV2.visibility` | transient `informationGrants` / replay metadata |

The protocol serializer must preserve omission of hidden characteristics. It
must not serialize the authority object, physical-card provenance, or a hidden
object's authoritative id.
