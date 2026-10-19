# RIFT-858: Official Effect Timing and Order Audit

Audit date: 2026-10-19 UTC
Worktree: /root/swarm-rift/wt/RIFT-858-official-effect-order-audit
Branch: task/RIFT-858-official-effect-order-audit
HEAD read before work: f036b0e5026aba1668ae88be2d74a05abeb55670

This report records official evidence, current implementation entry points, and real test outcomes. It does not declare the engine or M1 playable. A passing general-rule assertion does not prove a card program, a production path, or the two-precon vertical slice.

## 1. Scope and source applicability

The target rules are **Core Rules v1.5**, last updated 2026-10-09 and effective 2026-10-16. The official [Radiance Patch Notes](https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/) were published 2026-10-09 and state that a later Core Rules document takes precedence over any differing point in that rulings article. The [Rules Hub](https://playriftbound.com/en-us/rules-hub/) identifies the current rules documents. The current Core Rules PDF and all cited official pages returned HTTP 200 during this audit.

Source relationship is proposition-specific:

- **CR002** makes fundamental card-specific text authoritative when it contradicts a general rule.
- **CR051** requires card terminology to be interpreted according to the rules.
- **CR054.1** lets a prohibition supersede permission only for the same action or effect. It is not a universal source ranking.
- Official rulings are dated evidence. A later CR point supersedes a conflicting point; unrelated rulings remain usable.
- Community FAQ, videos, and inferred card mappings are discovery aids only. Missing evidence remains judge-required or blocked.
- Historical profiles 1-9 and replay logs retain their original versioned semantics. Nothing in this audit upgrades them.

The M1 scope is the two SFD precons in [m1-decks.json](/root/swarm-rift/wt/RIFT-858-official-effect-order-audit/docs/plans/m1-decks.json): 25 canonical identities in rumble-sfd and 26 in fiora-sfd, 51 distinct identities. Every identity resolves in the local 2026-10-12-official-gallery deck catalog. The manifest's identityCount fields exclude the two Basic Rune identities per deck; this is why they report 23 and 24. RIFT-857's versioned acceptance manifest is not merged into this worktree, so printing-level mapping below is reconstructed read-only from the original card list, the catalog, and the current DSL source.

## 2. Priority, Focus, and chain order

CR312 grants Priority to at most one player. CR313 makes Focus the Showdown Open permission, and gaining Focus also gains Priority. CR346 normally passes Focus to the next player when a Showdown chain closes; CR346.1 excludes trigger-opened and Add-opened chains.

The chain procedure is:

1. Add the card or ability as **Pending** (CR329).
2. Apply outstanding Tasks, then FEPR: Finalize, Execute, Pass, Resolve (CR334).
3. Finalize the **oldest** Pending item (CR337.1). Finalize does not pass Priority.
4. A Unit, Gear, or resource-Adding ability resolves immediately after Finalize (CR337.2).
5. After all Pending items are Finalized, the Priority holder may add a legally timed Reaction or pass (CR338-339).
6. After all players pass, the **newest** Finalized item resolves (CR340.1).

The official Chronobreak answer in the Radiance article is an application of CR303.2.a, not a universal FIFO or LIFO rule:

- If one player owns all banished Units, that player chooses their order.
- If multiple owners are involved, each owner chooses the order of its own Units, while owner groups are placed in Turn Order from the current Turn Player.
- Pending items Finalize oldest-to-newest; Units resolve immediately after Finalize.
- Their play effects then Finalize in trigger order.
- Reactions occur against the newest finalized item.

Chronobreak itself is outside M1 and is explanatory only. Its real execution remains blocked on variable any-amount Power, pre-Banish location, and per-owner effect.play-back. The official answer does not establish a general priority number for cards.

Current entries:

- [ChainEngine](/root/swarm-rift/wt/RIFT-858-official-effect-order-audit/packages/engine-core/src/chain/engine.ts:63) owns rule-layer Priority, Focus, Pending/Finalize/Resolve, and pass behavior.
- [finalize](/root/swarm-rift/wt/RIFT-858-official-effect-order-audit/packages/engine-core/src/chain/engine.ts:310), [advance](/root/swarm-rift/wt/RIFT-858-official-effect-order-audit/packages/engine-core/src/chain/engine.ts:407), and [resolve](/root/swarm-rift/wt/RIFT-858-official-effect-order-audit/packages/engine-core/src/chain/engine.ts:430) are the default rule-layer lifecycle.
- [DuelChainV2](/root/swarm-rift/wt/RIFT-858-official-effect-order-audit/packages/engine-core/src/duel/chain-v2.ts:506) is the production-chain state machine used by server Spell and Gear paths.
- The current room facade is [CurrentDuelRuntime](/root/swarm-rift/wt/RIFT-858-official-effect-order-audit/apps/game-server/src/duel/runtime/current.ts:1); the authoritative P4 owner is [createAuthoritativeDuelRuntimeP4](/root/swarm-rift/wt/RIFT-858-official-effect-order-audit/apps/game-server/src/duel/authoritative-runtime-p4.ts:373).

## 3. Costs, targets, choices, and response windows

CR355.1.a places optional additional-cost choices in the relevant-choice step while playing. CR356 orders base changes, additional costs, increases, discounts, and total-cost changes. CR357 pays the combined resource cost and nonstandard components, and CR358 rolls back a failed Finalize. CR358.5 is an atomic play failure, not a partially paid card waiting on the Chain.

For a normal play:

1. The card moves to the Chain as Pending.
2. Targets, modes, destination, and optional additional costs are selected.
3. The exact total is computed and locked.
4. Resources and nonstandard components are paid atomically. A Reaction Add may interrupt this payment step under CR357.1.a.
5. Finalize checks legality. Failure undoes the play; success allows response windows.
6. Resolution occurs only after the chain passes.

A target locks at Finalize and is retested at Resolve. An illegal or unavailable target causes related instructions to be Ignored; other impossible instructions are Negated. An ignored earlier linked instruction suppresses dependent later links. A Negated earlier action suppresses a later instruction only when that later instruction directly references the action. CR359.3.e.14.c still permits later execution after partial prevention, but the current damage result surface does not expose that partial case.

M1 cost and choice examples:

| Card | Official interaction | Current state |
| --- | --- | --- |
| Production Surge | Conditional -2 Energy at Finalize; play a 3-Might Mech token to base; draw 1. | Program declared; token-play and production cost bridge still have TODO assertions. |
| Jaull-Fish | Accelerate is an optional additional 1 Energy plus Body Power payment; its Mighty-unit discount is evaluated in the cost layer. | Accelerate expansion executes; Mighty discount and production static-to-Finalize bridge remain blocked. |
| Rumble, Hotheaded | Recycle another friendly Unit as a non-target cost, then play a Mech from Trash with a Might-valued discount. | Discount arithmetic and isolated play execute; conquer binding, non-target cost selection, and complete CostPlan-to-play conversion remain blocked. |
| Wages of Pain | Hidden/Action; deal 3 to a battlefield Unit, then play a Gold gear token exhausted. | Damage and stale-target Ignore execute; Gold, exhausted entry, and Hidden remain blocked. |
| Frigid Touch | Repeat is an optional additional cost; extra executions occur during Resolve. | Cost declaration exists; paid Repeat count to interpreter execution and Might-repeat path remain incomplete. |

The current cost entries are [buildCostPlan](/root/swarm-rift/wt/RIFT-858-official-effect-order-audit/packages/engine-core/src/cost/cost-plan.ts:73), [prepareCostPayment](/root/swarm-rift/wt/RIFT-858-official-effect-order-audit/packages/engine-core/src/cost/payment.ts:114), and [payCostPlan](/root/swarm-rift/wt/RIFT-858-official-effect-order-audit/packages/engine-core/src/cost/payment.ts:209). [finalizeTargetPlan](/root/swarm-rift/wt/RIFT-858-official-effect-order-audit/packages/engine-core/src/target/target-plan.ts:545) and [resolveTargetPlan](/root/swarm-rift/wt/RIFT-858-official-effect-order-audit/packages/engine-core/src/target/target-plan.ts:581) lock and retest choices. The production pending-payment test confirms that pass, response, and foreign payment remain closed while payment is pending.

## 4. Fiora, Worthy: parent-requested follow-up

CR709 defines becomes Mighty as the moment current Might changes from **below 5** to **5 or greater**. CR710 evaluates Units on the board by current Might. CR711 uses printed Might only in non-board zones. A static might-at-least-5 predicate cannot replace this transition: 5 to 6 and 5 to 4 do not become Mighty.

For [Fiora, Worthy](/root/swarm-rift/wt/RIFT-858-official-effect-order-audit/packages/card-dsl/src/cards/sfd/fiora-worthy.ts:29), the required sequence is:

1. Layer evaluation changes a friendly board Unit from below 5 to 5 or greater.
2. Emit might-changed with the pre/post values and capture that exact Unit incarnation as event.it.
3. The Fiora controller decides at Finalize whether to perform the leading you may.
4. If accepted, exactly one Order Power is locked and paid atomically.
5. The trigger Finalizes, then opponents may respond under normal Chain timing.
6. On Resolve, ready the captured event.it; do not prompt for a target and do not emit became-target.
7. If the captured object has left the board, ignore the ready instruction instead of looking up another object with the same id.

Current evidence conflicts with the card program's executable label:

- The parent probe at HEAD f036b0e5 reports ProgramBindingError judge-required: Unsupported filter field becomesMighty.
- [filters.ts](/root/swarm-rift/wt/RIFT-858-official-effect-order-audit/packages/engine-core/src/programs/filters.ts:68) does not translate becomesMighty.
- The card program has optional: true but no encoded leading Order Power cost.
- Its effect.ready body uses the source object, not the frozen event object.
- The current ChainEngine context lacks the default eventObject("it") bridge.
- The existing card test is shape plus a standalone effect.ready assertion; its end-to-end binding/payment case is test.todo.

The relevant core owners are:

- **RIFT-810:** match the typed might-changed transition and keep the immutable event/event.it identity. Do not accept an arbitrary becomesMighty object-filter key.
- **RIFT-835:** consume the frozen trigger event as eventObject("it"), move the leading may and Order Power into Finalize, and keep payment atomic. A branch of RIFT-835 contains that bridge and a real event-it regression, but it is not an ancestor of current HEAD.
- **RIFT-857:** do not accept the card based on DSL status or structure. Require a real production test that pays and declines, readies the event object, verifies no target prompt, and fails closed after departure.

No Fiora, Worthy entry appears in the cached SFD errata article. No official ruling found replaces CR709-711 for this interaction. The needed implementation uses existing interfaces; this audit makes no contract change request.

## 5. Replacement effects

Replacement effects apply before the qualifying event (CR367-370). CR372 assigns ordering among multiple replacements to the controller of the affected object, or to the affected player, or to the Turn Player for an uncontrolled battlefield. CR373 treats simultaneous events separately and orders different-controller replacement execution in Turn Order. A replacement applies once to the original event and its replacement events.

[EventPipeline.apply](/root/swarm-rift/wt/RIFT-858-official-effect-order-audit/packages/engine-core/src/events/pipeline.ts:373) selects the affected controller and loops through replacements. A fully replaced death does not emit object-killed. A replaced cost action remains paid where CR357.2.a applies.

Focused replacement tests passed 17/17. These are general-rule and binding assertions, not proof that every M1 card's replacement behavior is executable.

## 6. Continuous effects and dependencies

CR479 orders Copy, Trait, Ability, and Arithmetic effects. CR478.1 requires object dependency evaluation before the dependent object. CR480-481 allow dependency to override same-layer order; CR482 uses timestamps only when no dependency exists.

Implemented and tested:

- Fiora, Peerless doubling reads the current Might at resolution and registers a combat-duration arithmetic effect.
- Arithmetic increases are applied before decreases.
- Trait changes enable later abilities.
- Buff removal recomputes ability and arithmetic layers.
- Dependency chains and mutual dependency groups reach their tested endpoints.

Still TODO:

- Apply same-layer effects one at a time so dependency ordering can differ from timestamp ordering.
- Use timestamp fallback only after proving no dependency.
- Remove and restore Inactive text with a new timestamp.
- Carry those semantics into production M1 Mighty discounts and keyword grants.

The main implementation is [LayerEngine](/root/swarm-rift/wt/RIFT-858-official-effect-order-audit/packages/engine-core/src/layers/engine.ts:327). Its same-layer dependency comparison is at [depends](/root/swarm-rift/wt/RIFT-858-official-effect-order-audit/packages/engine-core/src/layers/engine.ts:653) and group evaluation at [evaluateGroup](/root/swarm-rift/wt/RIFT-858-official-effect-order-audit/packages/engine-core/src/layers/engine.ts:682). RIFT-798 is the source-history owner for the unresolved per-effect ordering.

## 7. Simultaneous triggers

CR383.3.d gives each controller the order of its own simultaneously triggered abilities. CR383.3.d.1 places those controller groups on the Chain in Turn Order from the current Turn Player. CR303.2.a does not assign a card priority and does not make every final resolution FIFO.

[EventPipeline.scan](/root/swarm-rift/wt/RIFT-858-official-effect-order-audit/packages/engine-core/src/events/pipeline.ts:245) collects a trigger wave, asks each controller for its own order, and emits controller groups in Turn Order. Focused tests confirm both same-controller order and multi-player Turn Order. The Radiance Chronobreak answer remains a mixed application of these rules.

## 8. Lost targets, ignored/negated/linked, LKI, and departure

The locked-target path is working for the tested cases: all-stale targets are Ignored, partial stale targets do not redirect, lookback works only through an authoritative snapshot, and ignored versus negated upstream links are distinguished. CR124 creates a new object identity after a zone change, so a stale reference cannot be revived by its id.

Remaining gaps:

- Partial prevention is not carried into a later linked instruction.
- Deathknell trigger snapshots retain pre-Trash characteristics, but the Pending item is not observable before the Trash move, as the current test.todo states.
- Show Off snapshot locking is not production-complete.
- Strike Down's non-target picks and equipped predicate remain unbound.
- Current HEAD lacks the RIFT-835 default eventObject("it") integration.

[EventPipeline.scan](/root/swarm-rift/wt/RIFT-858-official-effect-order-audit/packages/engine-core/src/events/pipeline.ts:250) captures pre-leave source data. [eventItBinding](/root/swarm-rift/wt/RIFT-858-official-effect-order-audit/packages/engine-core/src/programs/trigger-adapters/event-it.ts:17) freezes a role snapshot. The current production blocker is passing that exact snapshot through Finalize and Resolve.

## 9. M1 errata and current card status

### Yone, Blademaster

The official [Spiritforged Errata](https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/) replaces open battlefield with uncontrolled battlefield for Yone. The cached article was published 2026-01-14 and states no separate effective date. The current DSL source uses uncontrolled, while the local printed-gallery catalog keeps open battlefield for the SFD printings. The M1 manifest still flags Yone as a non-reminder printing difference. Keep this mapping pending until RIFT-857 pins the SFD printing and proves the corrected canonical behavior. Do not regenerate or rewrite the gallery snapshot.

### Other current high-risk card states

- **Rumble, Hotheaded:** three current focused assertions fail. The default static filter still exposes symbolic controller/tags values, the real conquer trigger assertion does not raise where expected, and the full trigger body returns partial instead of executed.
- **Strike Down:** the production filter rejects equipped; the two filter-driven non-target picks have no production Finalize lifecycle.
- **Wages of Pain:** two focused assertions fail. The frozen Gold token receipt gained blocked fields, and the Hidden binder no longer raises the expected missing-layer error. Gold, exhausted entry, and Hidden remain blocked.
- **Riposte:** one focused assertion fails. The ability-controller test returns partial instead of executed.
- **Production Surge:** the token play and conditional cost bridge remain TODO despite the program's executable label.
- **Jaull-Fish:** Accelerate expansion executes, but the Mighty discount and static-to-Finalize binding remain TODO.
- **Fiora, Peerless:** doubling and isolated trigger bodies execute, but attack/defense role producers and production trigger-condition evaluation remain TODO.
- **Veiled Temple:** ready/detach branches execute in isolation; the here conquer binding remains blocked.

The persisted effect-coverage.json still reports the older 2026-10-12 run of 1,381 printings with zero executable identities. It is a dated generated snapshot. Current DSL source and focused tests supersede it only as implementation evidence; this audit does not regenerate card data.

## 10. Production path findings

The current room uses CurrentDuelRuntime and the P4 authoritative owner. Focused production tests passed for a genuine Draw Spell, a public two-card Reaction Chain, pending Spell payment locking, and normal Gear play through Base entry. The P4 owner has separate Spell, Gear, and optional-Unit mechanisms rather than one fully integrated M1 card-program runtime.

The parent RIFT-857 evidence reports 100 distinct Rumble-versus-Fiora seeds with **0 natural winners, 100 blocked**, and zero combat, Conquer, or Score events. This report does not rerun the full-game flood. It also does not treat the 17-test focused headless suite as the natural-victory gate.

A production test conflict remains: optional-unit-room-p4.test.ts fails because the current room archive no longer emits duelRuntimeProfile. The current runtime tests intentionally assert that deprecated profile fields are absent. RIFT-350 owns reconciliation of the current room archive and its regression suite; this audit did not modify either side.

## 11. Commands and actual results

The following commands were run in this worktree. Results are copied from their actual process output; focused failures are not omitted.

| Command | Exit | Result |
| --- | ---: | --- |
| git status --short --branch | 0 | Clean at audit start; branch and HEAD recorded. |
| pnpm --filter @riftbound/engine-core build | 0 | Registry generation and TypeScript build passed. |
| node --test 303.2.a-simultaneous-triggers-turn-order.test.mjs | 0 | 1/1 passed. |
| node --test 383.3.d-simultaneous-triggers-same-player-orders.test.mjs | 0 | 1/1 passed. |
| node --test 337.1-multiple-pending-finalized-oldest-first.test.mjs | 0 | 1/1 passed. |
| node --test 340.1-lifo-resolution-order.test.mjs | 0 | 1/1 passed. |
| node --test 346-340.2.a-focus-passes-after-showdown-chain.test.mjs | 0 | 1/1 passed. |
| node --test 346.1-focus-not-passed-after-trigger-opened-chain.test.mjs | 0 | 1/1 passed. |
| node --test 805.1.b-accelerate-optional-pay.test.mjs | 0 | 3/3 passed. |
| node --test 357.2-nonstandard-costs-any-order.test.mjs | 0 | 1/1 passed. |
| node --test 358.2-basic-energy-insufficient.test.mjs | 0 | 1/1 passed. |
| node --test replacement-scenarios.test.mjs interaction.test.mjs | 0 | 17/17 passed. |
| node --test pipeline-scenarios.test.mjs | 0 | 43/43 passed. |
| node --test target-plan-relations-production.test.mjs | 0 | 8/8 passed. |
| node --test duel-chain-v2.test.mjs | 0 | 28/28 passed. |
| node --test Mighty.test.mjs might-change.test.mjs | 0 | 14/14 passed. |
| node --test 383.4.c.2.a-conquer-unit-present.test.mjs | 0 | 1/1 passed. |
| node --test 808.2-deathknell-instances-and-order.test.mjs | 0 | 2 passed, 1 TODO. |
| node --test fiora-worthy.test.mjs | 0 | 4 passed, 1 TODO. |
| node --test production-surge.test.mjs | 0 | 6 passed, 2 TODO. |
| node --test jaull-fish.test.mjs | 0 | 6 passed, 1 TODO. |
| node --test yone-blademaster.test.mjs | 0 | 4 passed, 1 TODO. |
| node --test Rumble, Strike Down, Wages of Pain, and Riposte focused files | 1 | 31 passed, 7 failed, 2 TODO. |
| game-server Vitest authoritative-spell-p4.test.ts | 0 | 1/1 passed. |
| game-server Vitest public-chain-card-p4.test.ts | 0 | 4/4 passed. |
| game-server Vitest pending-spell-resource-ack-p4.test.ts | 0 | 5 passed, 1 skipped. |
| game-server Vitest gear-normal-production-chain.test.ts | 0 | 3/3 passed. |
| game-server Vitest optional-unit-room-p4.test.ts | 1 | 1 failed, 1 skipped. |
| curl official source URLs | 0 | HTTP 200 for all five cited documents/pages. |

Raw failure output is in /tmp/RIFT-858-official-effect-order-audit/failing-card-tests.log.

## 12. Ownership handoff

| Owner | Evidence-bound request |
| --- | --- |
| RIFT-810 | Implement the typed might-changed below-5-to-at-least-5 match and preserve immutable event/event.it identity. Keep trigger collection and per-controller ordering tied to CR383.3.d. |
| RIFT-825 | Keep combat-created attack/defense role transactions authoritative; Fiora, Peerless still lacks role producers. |
| RIFT-831 | Preserve pre-exit/LKI snapshots, fail closed after departure, and make Deathknell Pending ordering observable where CR383.2.c.3 requires it. |
| RIFT-833 | Complete delayed/reflexive registration and window validation; no synthetic callback may stand in for a Pending item. |
| RIFT-835 | Consume event.it through Finalize and Resolve, bind Fiora, Worthy's leading may and Order Power, and keep target/cost/payment/legality atomic. |
| RIFT-856 | Preserve interpreter capability boundaries and ensure event-role and contract-action capabilities reach the real resolve context. |
| RIFT-857 | Reject DSL status alone as acceptance. Require the production Fiora, Worthy scenario, pin the SFD Yone errata mapping, and preserve all failed card assertions. |
| RIFT-350 | Reconcile the current room archive with its regression suite; the old optional-unit profile expectation conflicts with the current runtime. |

## 13. Completion boundary

**Completed:** official source and version audit; 51-card M1 canonical mapping; rule and ruling citations; timelines and response windows; actual code/test mapping; JSON field and URL validation; identification of production and card-specific blockers.

**Partial:** general rule-layer evidence is strong for ordering, costs, targets, replacement, layers, trigger order, and stale references. Several M1 card programs have only isolated or structural evidence, and some current assertions fail.

**Not done:** no core, card, catalog, contract, profile, replay, dependency, or lockfile change; no full-game flood; no card-data regeneration; no push or release. The engine and two-precon M1 path remain incomplete. There is no contract change request from this audit.
