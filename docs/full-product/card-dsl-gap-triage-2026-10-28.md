# RIFT-1111: Card DSL Gate Gap Triage

Date: 2026-10-28 UTC
Integration baseline: `b3a1cfb86771c877d8192b2e6a1e83196cd1d1fa`
Task branch: `task/RIFT-1111-card-dsl-gap-triage`
Scope: read-only analysis. The only repository file written by this task is
this report.

## Evidence and counting boundary

The task card requires the current integration result rather than the earlier
gate snapshot alone. I checked branch, HEAD, and worktree first. Both the task
branch and local `integration` were at `b3a1cfb8`, which is newer than both
`origin`-style local integration refs (`33b20b47`); the worktree was clean.
No merge or source edit was needed.

The actual command was (真实默认生产回归 gate):

```sh
heavy pnpm --filter @riftbound/card-dsl test
```

Full TAP log (完整失败列表证据): `/tmp/RIFT-1111-card-dsl-gap-triage/card-dsl-test.log`
SHA-256: `dc16d01bcffeb261f33a05dc7ee164097ab3a515aecfb47711379b903b0a7d31`
Duration: 204,396.99 ms.

The actual current result reproduces `gate-393cdbfc` exactly:

| Metric | Current rerun | Gate `393cdbfc` | Difference |
| --- | ---: | ---: | ---: |
| tests | 12,365 | 12,365 | 0 |
| pass | 9,813 | 9,813 | 0 |
| fail | 518 | 518 | 0 |
| skipped | 2 | 2 | 0 |
| todo | 2,032 | 2,032 | 0 |

The set of 565 TAP `not ok` titles is also identical between the gate and the
rerun. TAP has 518 ordinary failure records including the two nested children, plus
47 TODO subtests, so `518 + 47 = 565`. The 2,032 TODO total includes 1,983 passing TODO tests. The two skipped
tests are not failures. The one `not ok 409` parent record is a rollup for two
failed `Cruel Patron` child assertions, so no failures are lost by reading the
parent records as categories. Node reports those two nested failures in its
`fail` total without assigning them a new top-level pass/fail number. The raw
index therefore has 516 top-level ordinary failure records, and two nested
children account for the remaining two. The runner's reported 518 is the
failure total authority.

The failure total (失败总数) and failure counts per expansion/capability are cross-checked below. Failure-set dimensions:

| Dimension | Count |
| --- | ---: |
| Actual failing tests | 518 |
| Failing direct card-test modules | 228 |
| Failing template-test modules | 33 |
| Distinct implicated test files | 261 |
| TODO subtests (not in the 518) | 47 |
| Explicit TAP skips | 2 |

The task-card prefix split is confirmed for the 518 failures (失败数):

| Prefix | Failures |
| --- | ---: |
| `RIFT-*` template suites | 150 |
| `ven` | 96 |
| `unl` | 95 |
| `sfd` | 33 |
| `rad` | 32 |
| `ogn` | 20 |
| `ogs` | 10 |
| unprefixed descriptive tests | 80 |

The last row is 80. The detailed machine-readable index is
`/tmp/RIFT-1111-card-dsl-gap-triage/failures-for-report.json` (516 top-level
ordinary failure records and their source locations). Add its two nested
`Cruel Patron` child failures to reach 518. The 49 TODO-labelled `not ok` groups are
outside the ordinary-failure index. Use the TAP log as the count authority.

The `RIFT-*` 150 failures are concentrated in 27 failing template files. The
largest multiplicities are RIFT-670 (19), RIFT-646 (18), RIFT-642 (10),
RIFT-644 (10), RIFT-674 (9), RIFT-650/647/666 (8 each), RIFT-641 (7), and
RIFT-697 (6). A card can fail in more than one template suite, so these are
test instances rather than 150 independent engine defects.

## How to read the clusters

Each cluster records its failure count (失败数), implicated cards/decks (涉及卡牌与卡组), representative tests (代表测试), engine/card-DSL landing modules (所在模块), repair approach (修复方案), risk (风险), and rule basis (官方规则依据) where available.
The clusters below are a primary triage partition: every one of the 518 actual
failures is assigned once to the cluster that is first reached in the observed
production path. A test can depend on later clusters too; a secondary-impact
table records that overlap. Exact counts come from matching each failure's test
title, assertion text, and source assertion; the labels are a routing aid, not
a claim that 518 independent bugs exist.

M1's Rumble/Fiora decks are not a representative sample of the gate. The
two-precon manifest has 51 canonical identities and reports 39 passing/12
failing card golden files, 272 passing cases, and 52 TODO cases. Five canonical
identities appear by full canonical ID in failing template titles: Vex `Allay, Eager Admirer`; Vi `Crimson Pigeons`, `Lord Broadmane`,
`Loyal Poro`, and `Towering Pairofant`. Direct M1 card golden paths themselves
are not among the 27 failing template files. Re-running the 2-deck M1
acceptance is not evidence for the remaining card pool.

## Primary gap clusters (能力聚类)

### S1. Static binding, layer predicates, and grant re-expansion — 149

Observed shape: static declarations register but their amount, controller,
location, keyword, designation, or referent is never evaluated; grants remain
in a separate `KeywordGrantLayerEngine`; `sameLocationAs` sometimes reaches the
wrong representation; duplicate settlement IDs can throw. Representative
surfaces are `Sett, Kingpin`, `Steadfast Outrider`, `Wuju Bladesman`,
`Windswept Hillock`, `Karthus, Eternal`, `Taric, Protector`, `Ornn, Forge God`,
`Jeweled Colossus`, `Petty Officer`, and `Watchful Curator`.

Representative tests:

- `RIFT-670 keyword+static: Sett, Kingpin · buffed friendly units are measured but the dynamic Might stays at print`
- `RIFT-646 keyword+static: Steadfast Outrider · aura registers but the unresolved controller placeholder leaves Might at print`
- `Windswept Hillock: the merged keyword adapter grants both players' units here a movement route`
- `ogs-019-024 Wuju Bladesman, Starter golden: the merged characteristics consumer really gates a combatRole aura per recipient`
- `Unlimited 060 Vilemaw: the layers matcher ignores the mightLt predicate`

Engine-core landing points:

- `programs/statics.ts`: `layerFor`, `staticFilter`, `bindStatic`,
  `registerCost`, play-location registration, and predicate/modifier routes.
- `layers/filter.ts` and `layers/relative/filter.ts`: live source-relative
  controller, exclusion, location, relation, keyword/characteristic, and
  null-safe candidate matching.
- `layers/engine.ts` and `layers/ops/index.ts`: evaluate live/dynamic amounts and
  conditions instead of freezing or swallowing them.
- `programs/lifecycle.ts` and `programs/keyword-grants.ts`: default assembly and
  re-expansion of granted keywords.
- `layers/duration.ts` / `keyword-grants.ts`: collision-free per-incarnation and
  per-settlement registration IDs.

Card-DSL landing points: `src/ir/types.ts`, `src/ir/validation.ts`, and
`src/cards/**` only to confirm the authored IR; do not weaken validation or
edit card semantics as part of this engine task.

Suggested implementation: add one narrow production consumer per existing
static family and carry symbolic selectors through to a strict runtime query.
The binder must fail closed on an unknown predicate. Dynamic amount/condition
evaluation receives a bound host and live object set, and restart/idempotent
evaluation must not re-register the same settlement effect. Re-expand a granted
keyword only at the consumer boundary so an initial declaration is not silently
treated as already effective.

Protocol/journal change: no wire or replay schema change is required for the
core path. If optional diagnostics expose immutable layer provenance, use
additive runtime evidence rather than writing new fields into old journals.

Rules: CR 053.3 ("here" is the source's battlefield relation), 364.1-364.3
(passive conditions), 478.1-479.4 (layers and dependency), 702.2-702.3 (Buff),
807.1-807.2 (Assault), 809.1-809.3 (Deflect), 814.1 (Shield), and 815.1
(Tank). The official Core Rules are the 2026-10-09 v1.5 text; Radiance notes
effective 2026-10-16 apply where relevant. Local evidence:
`/root/swarm-rift/shared/rules/CR-v1.5.txt` and
`/root/swarm-rift/shared/official-effect-order-policy.json`.

Risk: highest semantic risk is treating an unresolved gate as true or applying
an aura to the wrong controller/location. Verify source-relative live reevaluation,
layer dependency, loss of source, and null cost fields. This cluster remains
`judge-required` for any card whose generated IR has no authoritative source
meaning.

### S2. Cost planning, extra costs, and receipts — 78

Observed shape: base cost reaches Finalize but a static/keyword additional cost,
alternate cost, discount, Empower/Flow/Repeat component, or disempower payment
does not; a plan total is not convertible to the final play plan; cost choices
and paid receipts are not bound to the frozen Finalize plan. Representative
cards are `Call to Glory`, `Onslaught`, `Legion Rearguard`, `Frostcoat Mother`,
`Perfect Execution`, `Iterative Design`, `Hextech Disc`, `Needlessly Large Yordle`,
and `Iron Revenant`.

Representative tests:

- `RIFT-683 measured gate · Call to Glory's optional spend-buff cost and ignore-base rewrite have no consumer`
- `ven-032-166 Frostcoat Mother: merged Empower expands, but the printed cost cannot cross the card-program boundary`
- `ogn-010-298 Legion Rearguard: the merged play binding produces no accelerate cost component`
- `rad-143-167 Iron Revenant boundary: the printed Banish cost has no payable plan today`
- `unl-173-219 Sacrifice: the merged production adapter still refuses the static cost.additional declaration`

Engine-core landing points: `programs/keywords.ts`, `programs/play.ts`,
`programs/activate.ts`, `programs/cost-adapters/index.ts`, `cost/plan-values.ts`,
`cost/cost-plan.ts`, `cost/plan-choices.ts`, `cost/payment.ts`,
`cost/discounts/collect.ts`, `chain/engine.ts`, and the relevant
`effects/keywords/{Empower,Flow,Repeat,Equip}.ts` expansion files.

Card-DSL landing points: `src/ir/types.ts` and validation for additive
`params.cost`/receipt shapes; card programs remain authored data owned by their
card task.

Suggested implementation: separate selection, plan construction, payment,
receipt, and linkage. Pass printed `null` through unchanged, require explicit
branch choices for either/or costs, represent Universal Power as
`allowedDomains` rather than a fabricated domain, preserve paid-even-if-zero,
and make failed payment roll back state. Make effect-instructed plays consume a
finalized plan, including Power and all nonstandard components.

Protocol/journal change: no required wire change. A durable receipt may need an
additive replay/runtime interface if the current proof is ephemeral; existing
profiles and old logs must remain `judge-required` unchanged rather than being
silently upgraded.

Rules: CR 163.2.b (Universal Power), 203.1-203.3 (cost/effect linkage and
rollback), 355.1.a/355.10.c.1 (choices), 356.1-356.7 (base, repeats,
increases, discounts, zero floors), 357.1-357.3 (payment), 415.4 (unpayable
costs), 805 (Accelerate), 818 (Equip), 820 (Repeat), 827 (Empower), and 829
(Flow).

Risk: an absent printed Energy/Power can be misread as zero; a discount can
apply after the wrong stage; a receipt can be treated as paid when only chosen;
or an effect play can bypass Power/nonstandard payment. Test absent, unpayable,
declined, replaced-cost, exact-zero, and rollback paths independently.

### S3. Chain body, replacement, token, nested target, and choice adapters — 73

Observed shape: the interpreter primitives exist, and `trigger.delayed` is in
the current generated registry, but production still fails on registration
parameters (for example `referent`) and on missing lifetime/consumer wiring.
`resolveChainBody` may fail to decode literal fields; nested targets/modes are
rejected at Finalize; replacement bodies cannot receive the replaced object;
token play lacks a generated chain identity; and some activation/Add shapes are
unverified.
Representative cards are `Nocturne, Horrifying`, `Zenith Blade`, `Kai'Sa,
Evolutionary`, `Heimerdinger, Academy Instructor`, `Riven, Broken Blade`,
`Forgotten Relic`, `Mirror Image`, `Angle Shot`, `Honeyfruit`, and
`Highlander, Yi`.

Representative tests:

- `nocturne-horrifying evidence: the production chain adapter still rejects cost.modify literals`
- `ven-135-166 Kennen: the production chain body adapter cannot execute the declared Stun instruction`
- `rad-132-167 Heimerdinger gap: the merged replacement planner still rejects effect.token`
- `ven-080-166: the chain still refuses the nested gear target at Finalize`
- `rad-043-167 Riven, Broken Blade: the choice.mode body is rejected by the merged chain Finalize`

Engine-core landing points: `chain/interpreter-adapter.ts` (`LITERAL_FIELDS`,
primitive argument preparation), `chain/engine.ts` (`assertFinalizationSurface`,
payment transaction and target/replacement lifecycle),
`effects/instructions/{effect.stun,effect.play,effect.token,effect.copy,trigger.delayed,replacement.*}.ts`,
`replacement/{bind,planner}.ts`, and `effects/linked-abilities/**` where applicable.

Card-DSL landing points: `src/ir/types.ts` and validation only for additive
runtime descriptors; do not replace unknown card text with a same-looking
opcode.

Suggested implementation: decode fields according to each registered schema;
lock nested target/mode choices in Finalize; give replacement bodies the exact
`zoneEntryId`/LKI; lower replacement declarations separately from executable
actions; and create the played token as its own Pending Chain item. Return
structured `AwaitChoice` only while a legal choice remains; reject stale or
out-of-band answers atomically.

Protocol/journal change: an additive chain/target choice descriptor may be
needed for replayable nested choices. Do not alter the closed GameAction union
inside this task; request that contract change if the existing action cannot
encode an authoritative transition.

Rules: CR 203.3, 354.1-354.3, 355.3-355.18, 359.3.e.14, 370.1-373.2,
388.4-392 (delayed/reflexive boundaries), 420.3, and 440.2. The effect-order
policy requires the actual Pending/Finalize/Resolve order and cannot be reduced
to a global FIFO/LIFO.

Risk: this cluster can look solved by a caller-supplied plan or no-op closure.
Reject such evidence. Test stale targets, illegal modes, replacement chains,
rollback, and the no-extra-card-play timing of Repeat/token play.

### S4. Trigger event vocabulary, emitter payload, and source identity — 35

Observed shape: the event vocabulary has expanded since older card notes, but
authoritative spellings still differ (`conquer` vs `conquered`, `hold` vs
`held`, `score` vs `scored`) and emitted events can lack the battlefield,
object, `toZone`, or holder needed by a source filter. Look/death/hold/combat
events are representative; `Poro Herder`, `Kai'Sa, Evolutionary`, `Nocturne,
Horrifying`, `Noxian Drummer`, `Trevor Snoozebottom`, `Voidreaver`, and `Ivern, Friend to All` expose different
producers versus consumers.

Representative tests:

- `Kai'Sa: the conquer subscription is rejected by the closed event-name vocabulary`
- `nocturne-horrifying: registration fails on the cards-looked-at event name, before any look payload is read`
- `ogn-222-298 Noxian Drummer: the object-moved emission carries no toZone for the battlefield filter`
- `unl-048-219 Trevor Snoozebottom gap: the hold payload carries no unit, so the presence-scoped subscription cannot fire`
- `RIFT-679: Unsupported filter field cause`

Engine-core landing points: `events/trigger-spec.ts` (`EVENT_PATTERN_TYPES`,
validation, aliases), `events/pipeline-match.ts` (canonical matching),
`events/action-adapter.ts` (`ACTION_TIMINGS`, payload attachment),
`events/producers/**`, and `programs/filters.ts` (`translateTriggerFilter`).
Card-DSL landing: `src/ir/types.ts` filter spelling/validation only when
additive and evidence-backed.

Suggested implementation: keep one canonical identity per emitter/timing alias;
add only event names already having a real producer and documented rule point;
emit immutable object/before/after, source/controller, batch, and battlefield
context; require the source incarnation for "I"/"here". Unknown extra fields
remain rejected unless an explicit typed reason decides their meaning.

Protocol/journal change: event/payload additions are shared-contract work.
Header/additive event evidence may require the parent's contract approval;
existing event aliases and logs must replay byte-for-byte.

Rules: CR 053.3, 383.1-383.4 (trigger conditions, hold/conquer/attack/defend),
412.4-412.5 (stun responsibility), 423.1 (discard/simultaneous identity),
449.1-449.2 (move), 466.2 (combat designations), and 473 (scoring).

Risk: broad vocabulary additions can admit cards whose payload cannot be
matched. Prove producer plus matcher plus trigger/chain item, not merely an
enum change. `secrets`/look ordering and historical LKI require privacy checks.

### S5. `here`, `other`, controller-relative and relation anchors — 32

Observed shape: `translateObjectFilter` rejects `sameLocationAs`, `here`,
`source`, `exclude`, or an `other` relation at registration; even accepted
filters can compare a structured `LocationRef` with a string spelling and fail.
Representative cards are `Nasus, Guardian of Knowledge`, `Zaun Warrens`,
`Riven, Shattered`, `Threshold of the Gray`, `Daisy`, `Vi, Peacekeeper`,
`Storm Raptor`, `Death from Below`, and `Hextech Formula`.

Representative tests:

- `nasus-guardian-of-knowledge: the 'here' anchor is rejected before any trigger registers`
- `unl-196-219 Daisy!: the attack trigger's sameLocationAs anchor is rejected by the program binder`
- `RIFT-680 Storm Raptor: the production trigger binder still rejects the 'here' anchor`
- `ven-041-166 Riven, Shattered gap: production trigger registration stops at the here target anchor`
- `ven-062-166 Hextech Formula probe: the production binding rejects exclude before any target is chosen`

Engine-core landing points: `programs/filters.ts`, `events/trigger-spec.ts`,
`events/pipeline-match.ts`, `layers/relative/{types,location,filter}.ts`, and
`programs/statics.ts` where static and trigger translations differ.

Suggested implementation: preserve symbolic relations until a live anchor
exists; resolve `self`/`source`/`here` by the source incarnation and its current
location; resolve controller/owner from the ability controller captured when
the ability entered the Chain; make exclusions reject the source/selected unit;
compare `LocationRef` values canonically and never turn a failed anchor into an
unrestricted filter.

Protocol/journal change: only additive symbolic filter data. Keep old unknown
anchor values fail-closed; no migration of serialized historical filters.

Rules: CR 053.3, 190.6.a-d (battlefield ability controller), 359.3.f.1-4
(referent timing, including LKI), 355.8-355.10 (target vs non-target), and
740.2.a (same-location/alone constraints when printed).

Risk: the same word "controller" can mean the source controller, acting
player, or target controller. Capture the documented player at the correct
event/ability time. This cluster needs production tests for both in-play and
left-play/LKI cases.

### S6. Movement and location adapters — 24

Observed shape: locked references are consumed as credentials yet the location
adapter returns no current objects; some destination choices include the
current location or follow the wrong controller; Recall is deliberately not
approximated as Move. Representative cards include `Akshan, Mischievous`,
`Blitzcrank, Impassive`, `Bard, Mercurial`, `Shuriken Flip`, `Soraka,
Wanderer`, `Tideturner`, `Maduli the Gatekeeper`, and `Highlander, Yi`.

Representative tests:

- `Blitzcrank golden subeffect: the production location adapter and Move primitive move the finalized enemy here`
- `sfd-109-221 Akshan, Mischievous golden: the merged move primitive relocates the locked enemy gear`
- `sfd-079-221 Bard, Mercurial golden: with a player-chosen destination the units really move`
- `ven-140-166 Shuriken Flip golden: the merged LocationExpr resolves a real destination and its candidates`
- `ogs-020-024 Highlander, Yi golden: Recall remains blocked rather than approximated as a Move`

Engine-core landing points: `target/location/**`, `effects/interpreter/locations.ts`,
`effects/instructions/{effect.move,effect.swap-location}.ts`,
`zones/movement.ts`, `turn/movement.ts`, `chain/interpreter-adapter.ts`, and
`zones/recall.ts` (the distinct Recall path).

Suggested implementation: bind selectors to exact current `ObjectRef`s at
Finalize; repeatedly revalidate at Resolve; derive legal destinations from the
current board and the effect controller; emit Move/LKI transfer for actual
relocation. Implement Recall as its own transition and leave unsupported
versions fail-closed.

Protocol/journal change: no contract change for ordinary Move. A distinct
Recall command/event is already represented or remains a contract request if a
card needs a transition the closed action union cannot express.

Rules: CR 144.1-144.4 (Move/Standard Move), 355.4 (legal location), 359.3.e.6-7
(unavailable destination/target), 449.2-449.2.c (move event and correction),
and 457-460 (Recall, which is not Move).

Risk: emitting `object-moved` for a failed movement, swapping aliases through
an interim board state, or treating Recall as a relocation can change trigger
history. Assert origin copy, simultaneous swap behavior, stale references, and
the route/current-location exclusions.

### S7. Zones, Hidden, play permissions, inspect/reveal — 23

Observed shape: Hidden/cost-hidden and play-location permissions do not reach a
production zone or placement consumer; look/inspect events have no object set;
battlefield and facedown occupancy/capacity are registered but not enforced.
Representative cards are `Bandle Tree`, `Here to Help`, `Sudden Storm`, `Called
Shot`, `Nocturne, Horrifying`, `Jeweled Colossus`, `Miss Fortune, Buccaneer`,
and `Runeblade Anvil`.

Representative tests:

- `ogn-278-298 Bandle Tree golden: the +1 Facedown Zone cap registers through continuous.restrict`
- `sfd-111-221 Here to Help evidence: [Hidden]'s cost.hidden static binds a production permission`
- `sfd-122-221 Called Shot golden: the real chain locks the deck top at Finalize and resolves the look`
- `Nocturne, Horrifying golden: the caller-supplied plan plays the looked-at card`
- `miss-fortune-buccaneer: playLocations only carries the named permission, never the open-battlefield value`

Engine-core landing points: `zones/{hidden,facedown,movement}.ts`,
`cost/kinds/hidden.ts`, `programs/play-permissions.ts`,
`programs/statics.ts` play-location mapping,
`chain/engine.ts:playDestinationIsLegal`, `layers/rules/query.ts`,
`effects/instructions/{effect.inspect,effect.reveal}.ts`, and event payload
producers for ordered look/reveal sets.

Suggested implementation: use a production Hide action and an explicit facedown
zone lifecycle; keep the looked-at set ordered and privacy-projected; bind
next-turn Reaction timing only after the Hidden card enters its legal zone;
enforce battlefield permissions at Finalize and revalidate at Resolve. Never
guess a looked-at card or convert an unsupported cost to zero.

Protocol/journal change: Zone/facedown state and action coverage may require a
shared additive contract. Do not silently add a socket/replay field; old
profiles remain exact and judge-required pending the owner's contract change.

Rules: CR 107.3.a-f (Facedown Zones and capacity), 124.1 (zone-change reset),
188.2 (Reveal), 355.2/420.3 (play destination and limited action), 422
(look/reveal handling), 425 (inspect/reveal operations as applicable), and
811.1 (Hidden). Cards with `energy:null`/`power:null` retain absence.

Risk: leaking hidden deck/hand content, accepting a look pick outside the shown
set, or enforcing a play-location predicate on the wrong controller. Exercise
public/private projection and failed look/reveal recovery. Unknown source
semantics stay `judge-required`.

### S8. History, LKI, and lifecycle — 17

Observed shape: a leave/death trigger is detached before the death scan; a
trigger condition counts current objects instead of finalized/played history;
or a replacement/ability needs the pre-death snapshot. Representative cards
include `Karthus, Eternal`, `Noxian Emissary`, `Treasure Trove`, `Noxus
Hopeful`, `Viktor, Leader`, `Loyal Poro`, `Fiora, Worthy`, and `Wuju
Bladesman`.

Representative tests:

- `ogn-236-298 Karthus, Eternal: no registry consumer reads trigger multiplicity or trigger.leave`
- `Treasure Trove boundary: the production lifecycle unregisters the leave trigger before the leave scan captures LKI`
- `noxus-hopeful: the production count ignores the finalized-history subject and any player filter`
- `ven-128-166 Noxian Emissary evidence: the production lifecycle detaches the death trigger before the kill scan`
- `RIFT-680 Lonely Poro gap evidence: ... the trigger fires even beside a friend`

Engine-core landing points: `programs/lifecycle.ts`, `events/action-adapter.ts`
(kill batch/death boundary), `events/producers/zone-change.ts`,
`events/pipeline.ts` and `events/trigger-rules/**`, `game/lifecycle.ts`,
`effects/interpreter/{history,expr}.ts`, and the source-incarnation binding in
`programs/triggers.ts`.

Suggested implementation: capture `before` snapshots and the triggering
incarnation before Trash/zone change; keep the ability registered for the
qualifying death; evaluate history from authoritative ordered events filtered
by player/source; collect simultaneous triggers with one batch id; pass LKI to
subsequent instructions. Make destructive state the last commit phase.

Protocol/journal change: additive event history/LKI evidence only; do not
rewrite historical replay. Any new finalize/death receipt belongs in versioned
runtime contracts owned by the parent.

Rules: CR 125/127 (incarnation and ownership), 383.2.c.1-c.3 (trigger LKI),
390-399 (delayed/linked/reflexive boundaries), 412 (responsibility),
429-431 (death), 441 (burn/history), and 470 (replacement of scoring).

Risk: preserving a destroyed object as if it were live, double-queuing a death,
or evaluating "this turn" from current board membership. Test simultaneous
deaths, replacement negation, no trigger after a replaced event, and a fresh
incarnation after zone re-entry.

### S9. Expression/query and condition engines — 11

Observed shape: a grammar-valid `player-turn-count`, `player-property`, or
filter subject is not dispatched by the production evaluator; `count.filter`
can collapse to 0 or count live objects instead of history; relation/threshold
predicates are absent. Representative surfaces are `Ol' Poro`, `Draven,
Showboat`, `Targonian Visionary`, `Swain, Visionary`, `Rhasa the Sunderer`,
`Crimson Pigeons`, and `Concentrate`.

Representative tests:

- `ven-029-166 Ol' Poro: the per-player turn ordinal has no engine-side evaluator yet`
- `ogn-028-298 Draven, Showboat golden: the static effect registers, but the amount stays at the printed Might`
- `RIFT-644 static|| template: Targonian Visionary — the Level 11 gate counts board objects and over-applies at 0 XP`
- `ven-065-166 Swain gap: the count condition ignores its subject and reads the live object set`
- `rhasa-the-sunderer golden: the amount expression evaluates to minus the trash size`

Engine-core landing points: `effects/interpreter/expr.ts`, `condition.ts`,
`history.ts`, `effects/interpreter/expr-ext/**`, `layers/engine.ts`,
`layers/filter.ts`, and `cost/discounts/values.ts`.

Suggested implementation: route each validated expression kind through one
typed evaluator with source/controller/turn/history context; use strict
number/null propagation; implement counted subject and filter semantics from
event history where printed; make unsupported expression kinds fail closed.

Protocol/journal change: none for pure evaluation. New durable history state
must use the existing journal event/history contracts, not a second truth.

Rules: CR 143.2 (Might and zero reduction), 194.1-194.4 (points), 356.4.c/g
(dynamic discounts), 364.3 (conditions), 383.2.a.1 (conditional triggers),
706-710 (Mighty), and 824 (Level/XP as applicable).

Risk: an unknown expression can fall through as truthy/nonzero. Make unknown a
typed unavailable value. Verify null printed values, nesting, arithmetic floor,
opponent scope, and player-turn boundaries.

### S10. Finalize choice/pick locks and leading trigger costs — 8

Observed shape: exactly-N picks are not locked, a may branch prompts before its
cost can be planned, and trigger-leading costs lack a trigger-level Finalize
carrier. Representative cards include `Bottled Constellation`, `Life from
Stone`, `Angle Shot`, `Zaun Punk`, `Fate Weaver`, `Kennen`, and `Lightning
Rush`.

Representative tests:

- `ven-067-166 Bottled Constellation boundary: the resolver does not enforce the exactly-3 pick bounds`
- `rad-029-167 Life from Stone boundary: the declared cost placeholder is rejected by the real planner`
- `sfd-160-221 Zaun Punk: the production play path still does not consume the declared static cost`
- `RIFT-683 measured gate · Call to Glory's optional spend-buff cost`
- `ven-135-166 Kennen golden: the production chain gate blocks the optional trigger before resolution`

Engine-core landing points: `chain/engine.ts` Finalize transaction,
`chain/finalize/{choices,choice-memory,target-tax}.ts`, `chain/picks/plan.ts`,
`programs/triggers.ts`, `programs/trigger-adapters/leading-choice.ts`,
`programs/trigger-adapters/finalize-cost.ts`, and `cost/plan-choices.ts`.

Suggested implementation: build and freeze the may/cost/target plan together;
enforce min/max/any-number before commitment; give each choice and repeated
execution a deterministic identity; make a declined optional cost remove the
trigger/action without payment or callback. A trigger's leading cost is paid
at Finalize, not silently at Resolve.

Protocol/journal change: choose descriptors may need an additive contract for
replayable nested choices; preserve old choice IDs and journals. Request an
explicit contract update rather than adding unstructured fields.

Rules: CR 355.1.a, 355.3, 355.10.c.1, 355.11-355.18, 356.2.b.1,
357.2, 383.3.a-b, 404.1.b, 415.4, and 820.1 (Repeat choices/counts).

Risk: prompting or paying at Resolve changes reaction windows; accepting fewer
than required picks creates illegal state. Test decline, unpayable, stale,
repeat, and rollback paths before accepting a card.

### S11. Other concrete adapters and mixed card composition — 12

This residual is intentionally small and retains explicitly mixed failures
that do not fit one earlier stage: unregistered `trigger.reflexive`,
unverified Add shapes for Reaction/Honeyfruit activations, copy/effect text,
and a few registration+body combinations that begin in more than one stage.
Representatives are `Forgotten Relic`, `Honeyfruit`, `Platewyrm Egg`,
`Riven, Broken Blade`, `Rousing Display`, and `Svellsongur`.

Representative tests:

- `ven-108-166 Forgotten Relic evidence: trigger.reflexive is not a registered opcode`
- `unl-049-219 Honeyfruit: the merged activation adapter describes the Reaction Add ability`
- `ven-075-166 Platewyrm Egg: the merged activation adapter exposes Reaction Add as ordinary activated`
- `rad-043-167 Riven, Broken Blade: the choice.mode body is rejected by the merged chain Finalize`
- `svellsongur: effect.copy mode 'effect' cannot write the attached unit's text today`

Engine-core landing points: `effects/instructions/registry.generated.ts` for
registration only; `programs/index.ts` direct Add shape validation;
`programs/add.ts`; `effects/instructions/trigger.reflexive.ts`; `effect.copy.ts`;
and `chain/engine.ts` for the relevant nested/choice composition.

Suggested implementation: add a real instruction module and generate the
registry entry through the intended script; classify Add shapes by their
authoritative amount/resource/lifecycle, not merely by finding an Add word;
copy only text allowed by the source snapshot and attachment lifetime. Keep
unknown shapes judge-required.

Protocol/journal change: Reflexive ability creation and effect-copy attachment
may require additive linked/runtime descriptors. Treat these as parent-owned
contract requests.

Rules: CR 164 (Add/Reaction resources), 388-389 (reflexive trigger), 394-398
(linked abilities), 430 (Add), 479 (copy/layers), and 475-478.1 for any copied
static value.

Risk: adding an opcode to the registry without a correct capability is a false
green. For `effect.copy`, copying the printed text and copying a live
continuous result are different operations. Require a real producer/consumer
test, preservation of the attachment bound, and source-version evidence.

### Cluster count reconciliation

The primary cluster counts sum to 518:

| Cluster | Primary failures | Secondary overlap |
| --- | ---: | --- |
| S1 static/layer/grant | 149 | cost, condition, lifecycle |
| S2 cost plan/receipt | 78 | static, chain, trigger cost |
| S3 chain/replacement/token | 73 | cost, target, event payload |
| S4 event vocabulary/payload | 35 | here/controller, trigger, LKI |
| S5 relative anchors | 32 | static layer, trigger payload |
| S6 movement/location | 24 | here, permissions, static movement |
| S7 Hidden/zones/inspect | 23 | permissions, event payload, privacy |
| S8 history/LKI/lifecycle | 17 | event/payload, replacement |
| S9 expression/query | 11 | static amount, condition |
| S10 Finalize choices/trigger costs | 8 | target, cost, trigger |
| S11 other adapters/mixed | 12 | depends on the specific card |
| **Total** | **518** | |

The earlier raw clause search can report larger overlapping counts; those are
not failure counts and must not be used as task sizes. For example, 150 contain
keyword/ability text and 146 contain static language, but both sets overlap the
same template failures.

## Official effect-order evidence (官方规则依据)

The governing official policy (URL and effective-date evidence) is
`/root/swarm-rift/shared/official-effect-order-policy.json`
(`official-effect-order-20261019`, created 2026-10-19T07:15:04.193212Z). Its
official sources are the current CR v1.5 PDF
(`https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf`),
the official rules hub, Radiance patch notes (生效日期: 2026-10-16), the
Spiritforged errata snapshot, and the Spiritforged rulings. The cached text
target is 2026-10-09 CR v1.5. I did not download or replace these sources.

Relevant rule IDs (with the official source URL/version/effective date above) are listed per cluster. The report deliberately
does not assign one global priority value. The following handling and ordering timeline must remain
distinct in any repair:

- **Player Priority/Focus and legal response windows:** CR 311-313, 338.1,
  345-348. A trigger/event fix must not grant a response window or remove one
  by using a convenient render order.
- **Cost selection and payment:** CR 355.1.a, 355.10.c.1, 356.1-356.7,
  357.1-357.3, 383.3.b, 415.4. Option, target/mode choice, plan freeze, payment,
  receipt, Finalize, and Resolve are separate assertions.
- **Replacement vs prohibition:** CR 054.1, 369-373. "Can't beats can" applies
  to the specific action/effect; it is not a universal source priority.
- **Layers and dependency:** CR 475-479.1. Apply layers in order, evaluate live,
  and resolve dependencies from the printed effects rather than object
  enumeration.
- **Simultaneous triggers:** CR 303.2.a is limited to actions beginning
  simultaneously; CR 383.3.d controls trigger ordering. It cannot be collapsed
  into a chain-wide FIFO/LIFO rule. Radiance's Chronobreak/Assembly Rig examples
  distinguish a single Play instruction's child item from simultaneous events.
- **Pending/Finalize/Resolve/LKI:** CR 329, 337-340, 354.1-354.3,
  359.3.e.14, 359.3.f.1-4, 370.1.c, and 383.2.c. A card/effect-instructed Play
  creates its own item; the parent Resolve may be suspended until that item is
  appropriately handled. LKI is captured before the qualifying leave/death.
- **Printed card-text exceptions:** CR 002, 051, 054.1 and 303.2.a apply only
  under their stated conditions. No cluster is ordered from card names or
  historical FAQ/community claims.

The `canonicalCardId` values in test titles/catalog rows are the card identity anchors;
representative IDs include `card.hash-9eef9a...` (Call to Glory),
`card.hash-9dec94...` (Kai'Sa, Rebel), `card.hash-af1469...` (Steadfast
Outrider), and `card.hash-8e8505...` (Sett, Kingpin). Full IDs remain discoverable
from the TAP titles and the local catalog; they are not truncated in executable
tests or replay evidence.

## Cards and decks in each cluster

Expansion counts describe the actual failing direct-card modules; template
rows may also exercise those identities. This is a routing inventory, not a
card-status change:

| Expansion | Actual failures | Direct failing modules | Representative cards |
| --- | ---: | ---: | --- |
| OGN | 20 | 13 | Karthus, Cruel Patron, Last Stand, Noxian Drummer, Kadregrin, Karma, Bandle Tree |
| OGS | 10 | 2 | Highlander, Yi; Wuju Bladesman |
| Radiance | 32 | 24 | Heimerdinger, Neeko, Orianna, Overloaded Traveler, Reckless Innovator |
| Spiritforged | 33 | 23 | Akshan, Soraka, Bard, Jax, Jayce, Zaun Punk, Svellsongur |
| Unleashed | 95 | 65 | Conscription, Death from Below, Maduli, Shadow, Tactical Retreat, Vi |
| Vengeance | 96 | 58 | Frostcoat Mother, Kennen, Swain, Bottled Constellation, Esteemed Hierophant |
| RIFT template pool | 150 | 27 failing templates | Current template IDs above; many cards repeat across RIFT-641/642/644/646/647/650/670 suites |
| Unprefixed/mixed | 80 | shared direct/template modules | Cross-set adapters such as Nocturne, Rally the Troops, Highlander, Bard, Honeyfruit |

The prefix named `ven` is the Vengeance expansion here; do not confuse it with
the Vex precon. Rumble/Fiora M1 coverage is only the two-precon manifest; the
four candidate precon decks belong to a broader regression and are not a
claim of 518-card failure ownership.

## Disposition: real defect vs intentional red test

All 518 are maintained red tests in the current release gate. I did not find a
test that should be deleted or weakened. There are, however, three distinct
maintenance states:

1. **Real production defect (fix capability):** the assertion reaches a
   production entry point and exposes a missing consumer, missing binding, or
   incorrect state transition. The largest examples are S1-S3 and S8/S9.
   These should stay red until the capability is implemented and must gain a
   reproduction test through `createProgramBinding`, `ChainEngine`/`TurnFlow`,
   and `attachLifecycle` as appropriate.
2. **Intentional retained red/golden/probe test:** the test title or assertion
   deliberately pins the current fail-closed refusal (for example "still
   refuses," "unregistered opcode," or "no layer mapping") so it will turn green
   only after the named capability lands. The 33 template files account for 163
   actual failures and contain substantial intentional repetition. These are
   useful acceptance obligations, not 163 independent fixes.
3. **Test-harness or stale-assertion issue (record only):** a few tests assert
   an older expected exception whose text or behavior has already moved. The
   strongest example is `Rally the Troops`, which asserts the registry is
   missing `trigger.delayed`, while the current integration has the instruction
   registered in `effects/instructions/registry.generated.ts`. Likewise the
   active event enum contains `cards-looked-at`, `object-moved`,
   `empowered-changed`, `might-changed`, `beginning-start`, and `main-start`,
   while older tests still assert those names are outside the vocabulary. Those
   failures are not evidence that a new engine feature is absent; they need a
   focused test refresh in the owning card/template task, without deleting the
   corresponding production tests.

The two `test.todo` skips are explicitly outside these 518 and should not be
treated as repaired acceptance: `Stormclaw Ursine` channel-rune exhaustion and
`Relentless Pursuit` same-location target revalidation. They belong in the
event/zone and target/filter workstreams respectively.

The 47 TODO subtests are not failures and should not be copied into a fix-count
table. They contain useful intended follow-ups, such as move-count history,
batch discard/recycle semantics, and target/location LKI, but the report uses
them only as corroboration when the same capability has an actual red test.
The 49 `not ok` lines labelled `# TODO` are a few more than the runner's 47 TODO
subtest total because two are grouped/parent markers; the runner summary, not a
line grep, determines the 2,032 total.

## Repair architecture and task order (修复方案与推荐顺序)

The ranking below uses actual gate failures touched, semantic risk, and the
existing `docs/plans/engine-gaps.json` task boundaries. It is a dependency
score, not a promise that every listed failure flips green. A capability with a
high count should be split across disjoint files once its shared contract is
stable. The parent remains the sole owner of cross-package contract changes,
lockfiles, integration, and final acceptance.

| Rank | Capability | Approx. failures touched | Risk | Suggested owner scope |
| ---: | --- | ---: | --- | --- |
| 1 | S1 static layer/filter and live predicates | 149 | XL | `programs/statics.ts`, `layers/{filter,relative,engine,ops}`, `programs/lifecycle.ts` + grants |
| 2 | S2 cost plan/additional/receipt | 78 | XL | `programs/{keywords,play,activate,cost-adapters}`, `cost/**`, keyword modules |
| 3 | S3 chain adapter/replacement/nested choices | 73 | XL | `chain/{interpreter-adapter,engine}`, replacement + instruction modules |
| 4 | S4 event vocabulary and payload | 35 | L | `events/{trigger-spec,pipeline-match,action-adapter}`, producers; parent contract review |
| 5 | S5 here/relative selectors | 32 | L | `programs/filters.ts`, `layers/relative/**`, trigger matcher |
| 6 | S6 movement/location/Recall | 24 | L | `target/location/**`, interpreter locations, `effect.move`, movement/recall |
| 7 | S7 Hidden/zone/play permissions/inspect | 23 | XL | hidden/facedown, play permissions, inspect/reveal, query |
| 8 | S8 LKI/lifecycle/history | 17 | L | lifecycle, action-adapter death boundary, history/expr |
| 9 | S9 expression/query | 11 | L | expression, condition, history, expr-ext, discount values |
| 10 | S10 Finalize choices/trigger costs | 8 | L | chain finalize, picks, trigger adapters, cost choices |
| 11 | S11 reflexive/Add/copy | 12 | L | instruction registry, add, reflexive, copy |

Start with S5 and S9 as low-coupling foundational repairs, then S1 only after
the live filter/condition semantics have tests. S2 and S3 can proceed in
parallel only if their file ownership is split by cost-versus-chain and the
parent owns the final integration. S4 must not be merged as an enum-only
change. S6 and S7 need separate adapter owners because their state transitions
are different. S8 needs the event-payload/direct death-boundary proof. S10 is a
Finalize integrator, and S11 is best split by instruction (reflexive, Add,
copy) so no agent edits the generated registry directly.

## Ten dispatchable task cards (任务拆分)

These are proposals for the coordinating parent. Each has a disjoint write
scope; the parent alone assigns ranges, updates shared contracts, runs the
integrated gate, and commits/pushes.

### RIFT-1111-A — Relative anchor translation after live source binding

Write scope: `packages/engine-core/src/programs/filters.ts`,
`packages/engine-core/src/events/trigger-spec.ts`,
`packages/engine-core/src/events/pipeline-match.ts`,
`packages/engine-core/src/layers/relative/**`, and a new
`packages/engine-core/test/engine-gaps/relative-anchors.test.mjs`.

Acceptance: exact `self/source/here/other/exclude/controller` behavior with a
live source incarnation and captured ability controller; no unrestricted
fallback; source-relative LKI tests; representative card tests for Nasus,
Riven, Storm Raptor, Hextech Formula, and Vi Peacekeeper pass through the
default assembly. Keep unknown spellings judge-required. CR 053.3,
190.6.a-d, 359.3.f.1-4, 355.8-355.10.

### RIFT-1111-B — Event producer/payload contract matrix

Write scope: `packages/engine-core/src/events/{trigger-spec,pipeline-match,action-adapter}.ts`,
`packages/engine-core/src/events/producers/**`,
`packages/engine-core/src/events/timing-points.ts`, and a new
`packages/engine-core/test/engine-gaps/event-payload-matrix.test.mjs`.

Acceptance: one canonical spelling per emitted event; source/controller,
battlefield, before/after, object set, `toZone`, responsibility, and batch
fields are asserted from actual actions; aliases remain backward compatible;
production scenarios for conquer/hold/object-moved/object-killed/look/stun.
Protocol additions are a parent contract request, not part of this scope. CR
053.3, 383.1-383.4, 412.4-412.5, 449.1-449.2, 466.2, 470-473.

### RIFT-1111-C — Static layer consumer and keyword-grant re-expansion

Write scope: `packages/engine-core/src/programs/statics.ts`,
`packages/engine-core/src/programs/{lifecycle,keyword-grants}.ts`,
`packages/engine-core/src/layers/{engine,filter,ops,duration}.ts`, and a new
`packages/engine-core/test/engine-gaps/static-literal-closure.test.mjs`.

Acceptance: dynamic controller/location/other filters, `continuous.might`,
keyword grants, `target.tax`, continuous combat, trigger multiplicity, and
dynamic counts use live snapshots; unique settlement IDs; source removal
unregisters; no static declaration silently becomes an unconditional effect.
Representative Sett, Steadfast Outrider, Wuju, Karthus, Windswept Hillock and
Vilemaw scenarios pass. CR 478.1-479.4 plus keyword rule IDs in S1.

### RIFT-1111-D — Cost component and receipt adapter

Write scope: `packages/engine-core/src/programs/{keywords,play,activate}.ts`,
`packages/engine-core/src/programs/cost-adapters/**`,
`packages/engine-core/src/cost/**`, the relevant
`packages/engine-core/src/effects/keywords/{Empower,Flow,Repeat,Equip}.ts`, and
a new `packages/engine-core/test/engine-gaps/cost-components.test.mjs`.

Acceptance: printed base, alternate, mandatory/optional additional, increases,
discounts, Universal Power, nonstandard costs, and paid receipts remain
distinct through Finalize; decline/unpayable/zero-floor/rollback; `null` cost
not changed to zero; real Empower/Flow/Repeat/Equip programs. Any additive
receipt interface is a parent contract request. CR 163.2.b, 203, 355-357,
415.4, 805, 818, 820, 827, 829.

### RIFT-1111-E — Chain body adapter and atomically nested choice

Write scope: `packages/engine-core/src/chain/interpreter-adapter.ts`,
`packages/engine-core/src/chain/finalize/**`,
`packages/engine-core/src/chain/picks/**`, and a new
`packages/engine-core/test/engine-gaps/body-adapter-matrix.test.mjs`.

Acceptance: decode fields for `effect.stun`, `effect.damage`, `effect.play`,
`effect.inspect`, `cost.modify`, divide/repeat and replacement; nested mode and
target choices lock at Finalize; stale choices are ignored per rule; no caller
supplied plan or callback; real `createProgramBinding` + `ChainEngine` +
`attachLifecycle` scenarios for Nocturne, Zenith Blade, Heimerdinger, Kennen,
and Riven. CR 355.3-355.18, 357, 359.3.e.14, 370-373, 420.3.

### RIFT-1111-F — Location/Move/Recall production bridge

Write scope: `packages/engine-core/src/target/location/**`,
`packages/engine-core/src/effects/interpreter/locations.ts`,
`packages/engine-core/src/effects/instructions/{effect.move,effect.swap-location}.ts`,
`packages/engine-core/src/zones/{movement,recall}.ts`,
`packages/engine-core/src/turn/movement.ts`, and a new
`packages/engine-core/test/engine-gaps/location-transitions.test.mjs`.

Acceptance: locked selector -> current ObjectRef -> legal destination -> actual
transition; exclude current location where printed; relative base uses ability
controller; source removal/incarnation; ordinary Move versus Recall remains
distinct; failed destination changes no state/event. CR 144, 355.4,
359.3.e.6-7, 449.2, 457-460.

### RIFT-1111-G — Hidden, facedown, play permissions, inspect/reveal

Write scope: `packages/engine-core/src/zones/hidden/**`,
`packages/engine-core/src/zones/facedown/**`,
`packages/engine-core/src/programs/play-permissions.ts`,
`packages/engine-core/src/programs/statics.ts` (play-location route only),
`packages/engine-core/src/effects/instructions/{effect.inspect,effect.reveal}.ts`,
and a new `packages/engine-core/test/engine-gaps/hidden-inspect.test.mjs`.

Acceptance: real Hide action and capacity; finalize-time placement and
permission checks; per-turn Reaction only from eligible facedown state;
ordered look/reveal picks; private projection; stale/out-of-range picks ignored;
no guessed destination or zero cost. New zone/action types are a parent
contract request. CR 107.3, 124.1, 188.2, 355.2, 420.3, 422, 425, 811.1.

### RIFT-1111-H — Death/leave LKI and authoritative history

Write scope: `packages/engine-core/src/programs/lifecycle.ts`,
`packages/engine-core/src/events/action-adapter.ts` death-boundary helpers,
`packages/engine-core/src/events/producers/zone-change.ts`,
`packages/engine-core/src/game/lifecycle.ts`,
`packages/engine-core/src/effects/interpreter/{history,expr,condition}.ts`, and
a new `packages/engine-core/test/engine-gaps/lki-history.test.mjs`.

Acceptance: all qualifying deaths are queued before Trash/zone removal;
replacement negates the queued ability atomically; source incarnation/LKI is
available to body; simultaneous kills share batch identity; this-turn history
filters by event/player and does not count live objects; fresh incarnation is
not mistaken for the old one. CR 125/127, 383.2.c, 390-399, 429-431, 441, 470.

### RIFT-1111-I — Expression dispatch and dynamic layer values

Write scope: `packages/engine-core/src/effects/interpreter/{expr,condition,history}.ts`,
`packages/engine-core/src/effects/interpreter/expr-ext/**`,
`packages/engine-core/src/layers/engine.ts`,
`packages/engine-core/src/layers/filter.ts`,
`packages/engine-core/src/cost/discounts/values.ts`, and a new
`packages/engine-core/test/engine-gaps/expr-dynamic.test.mjs`.

Acceptance: every validated expression kind dispatches or fails closed;
player points, turn ordinal, XP, count subject/filter, Might thresholds,
opponent/controller scoping, arithmetic and null-safe floors; layer amount
reevaluates on live mutation; representative Draven, Ol' Poro, Targonian
Visionary, Swain, Rhasa and Crimson Pigeons. CR 143.2, 194, 356.4, 364.3,
383.2.a.1, 706-710, 824.

### RIFT-1111-J — Finalize leading choices/picks/costs

Write scope: `packages/engine-core/src/chain/engine.ts`,
`packages/engine-core/src/chain/finalize/**`,
`packages/engine-core/src/chain/picks/**`,
`packages/engine-core/src/programs/{triggers,trigger-adapters}/**`,
`packages/engine-core/src/cost/plan-choices.ts`, and a new
`packages/engine-core/test/engine-gaps/finalize-choice-matrix.test.mjs`.

Acceptance: choose mode/target/leader/cost before payment; exact min/max and
any-number picks; decline optional cost without trigger/effect/receipt; pay
trigger-leading cost at Finalize; stale/unavailable choices roll back; repeat
choice IDs are independent and deterministic. New structured choice fields are
a parent contract request. CR 355.1.a, 355.3, 355.10.c.1, 355.11-355.18,
356.2.b.1, 357.2, 383.3.a-b, 415.4, 820.1.

### RIFT-1111-K (reserve) — Reflexive/Add/copy instruction owners

This is below the top ten because it is smaller and easily split. It should be
three child owners: (a) `trigger.reflexive` + `effects/reflexive/**`; (b)
`programs/add.ts` and direct Add shape tests; (c) `effect.copy.ts` and
attachment/text layer tests. Generate registries with the intended script;
never edit `registry.generated.ts` by hand. Acceptance requires real Pending
reflexive item, exact Add resources/Reaction window, and attachment-bounded
copy text. CR 164, 388-389, 394-398, 430, 475-479.

## Contract and persistence requests (协议、存档与契约变更)

No source/contract file was changed by this task. The following are requests
for the parent if the implementation owners select the corresponding route:

- Additive event/payload fields for source-incarnation, event battlefield,
  look/reveal object set, and move destination/cause if current typed contracts
  cannot represent them. Do not widen a closed event enum without a real
  producer and matcher.
- Additive durable Finalize choice/receipt/Reflexive descriptors if replay must
  reconstruct a nested effect-created Pending item. Existing profile 1-9 and
  historical journals must remain strictly replayable; no silent profile or
  schema upgrade.
- A distinct Hide/facedown or Recall action/zone contract only where the closed
  GameAction/ZoneId union cannot express the evidenced rule. In particular,
  do not normalize `energy:null`/`power:null` to zero and do not use a Move as a
  substitute for Recall.

## Risks and residual questions (风险与遗留问题)

- The statistical labels S1-S11 are a routing partition, not an official rules
  taxonomy. Template loops inflate counts; do not promise "149 tests will pass"
  from one capability.
- The current `TriggerSpec`/filter types carry more symbolic anchors than the
  serializable ObjectFilter validator admits. The owner must establish which
  anchors are evidence-backed, which are legacy spellings, and which must stay
  judge-required; merely accepting the union can over-apply auras.
- Some card-source notes mention a gap that the current code has partially
  closed. Treat every test title and old judgeReason as a hypothesis to
  re-measure. The TAP rerun is the authority for this report.
- Default headless and real UI integration can still be blocked even when a
  card-level focused test is green. The parent must run the full engine/server
  and integration gates after capability repairs.
- No production database, shared integration test service, or unmanaged process
  was touched. No system package, lockfile, generated card data, or card file
  was modified.

## Verification

Executed:

```sh
heavy pnpm --filter @riftbound/card-dsl test
# result: tests 12365, pass 9813, fail 518, skipped 2, todo 2032

heavy pnpm --filter @riftbound/desktop-client test
# result: 84 files passed, 982 tests passed, 0 failed

pnpm --filter @riftbound/desktop-client typecheck
# result: exit 0, no diagnostics
```

Desktop evidence:

- `/tmp/RIFT-1111-card-dsl-gap-triage/desktop-client-test.log`
  SHA-256 `db1f9c9710f4ed75933043d37a87ce21d2e94e420cabdd518600c177ab89c54c`
- `/tmp/RIFT-1111-card-dsl-gap-triage/desktop-client-typecheck.log`
  SHA-256 `8366207267355d3e3d5bf3bf6e8c94c5f93f6078c34f08973fa2b38cdda6cc92`

`LAND_CHECK` was intentionally not used for desktop-client; this task's own
desktop test and typecheck are the required evidence. No full-workspace gate was
run because the task's only repository change is documentation and the parent
owns integrated acceptance.

## Final status against acceptance items

1. **Actual card-dsl rerun and gate reconciliation:** complete. The current
   baseline exactly matches the 12,365/9,813/518/2/2,032 gate result, and the
   gate/local 565 `not ok` title sets are identical.
2. **Read tests and assign production-path capabilities:** complete for all
   518 failure instances via the S1-S11 table, source locations, representative
   clusters, and the exact excluded TODO/skip accounting.
3. **Per-cluster failures/cards/tests/files/implementation/contract/risk/rule
   evidence:** complete. Cards are listed as examples/expansion inventories;
   the complete failure-title index remains in the TAP log and source line
   references. Estimates are explicitly not exact flip counts.
4. **Ranked repair sequence and ten dispatchable cards:** complete; the reserve
   S11 card is listed after the top ten and all write scopes are disjoint.
5. **Real defect vs intentional red vs stale test:** complete with the
   three-way disposition above; no tests were edited, skipped, or weakened.

No remaining implementation was authorized by this read-only task. Card-file
closure remains with the existing card owners; the parent should use the
workstream cards only after contract and file-ownership separation.
