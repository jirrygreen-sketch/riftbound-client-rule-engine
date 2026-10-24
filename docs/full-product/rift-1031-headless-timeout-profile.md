# RIFT-1031 headless timeout profile

## Scope and baseline

This workstream inspected the real `runHeadlessGame` path in
`packages/integration-tests/src/headless/duel.ts` against the RIFT-990
evidence. The worktree started at `1f6da057`, already containing RIFT-927;
`git merge integration` reported `Already up to date`.

The evidence is CPU-profile data and raw wall-clock timings. No transaction,
event, resource, zone, lifecycle, Pending/Finalize/Resolve, or outcome value
was rewritten to make the gate pass.

## Reproduction

The initial profile used seed `RIFT-990-m1-seed-060`, Fiora on seat A and Rumble
on seat B. It completed with the same game result as RIFT-990:

| Run | Wall time | Turns | Commands | Events | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| RIFT-990 original | 428.649 s | 7 | 55 | not retained in summary | replay mismatch |
| Current HEAD, before fix | 516.535 s | 7 | 55 | 800 | guard / no-progress |
| After the fix | 235.690 s | 7 | 55 | 800 | guard / no-progress |

The original RIFT-990 command run used four concurrent workers. The current
measurements were isolated one-game runs, so their wall-clock values are a
direct before/after signal rather than a recreation of the four-worker total.

The timeout seed `RIFT-990-m1-seed-025` was also rerun through the same real
headless entry after the fix. It returned normally in 188.268 s with 7 turns,
49 commands, 752 events and `guard / no-progress`. RIFT-990 observed that seed
hit its 900 s wall-clock limit without a completed journal. This demonstrates
the previously non-returning seed can now return; it does not prove every one
of the other 18 timeout seeds is fixed.

## Profile findings

The before profile contained 227,872 samples in 518,756.7 ms of profiled CPU
time. Its dominant inclusive paths and self samples were:

- `layerObjects` / `evaluateAll` / `evaluateGroup`: about 78% of profiled time;
- `liveSource`: 384.7 s inclusive and 23.1 s self; and
- `evaluateGroup`: 107.4 s self (20.7%), clone/snapshot work 51.8 s self, and
  garbage collection another 86.2 s self (16.6%).

The recurring stack was:

```text
static filter in layerMatches
  -> liveSource
    -> ChainEngine.pipeline.host.objects()
      -> ChainEngine.layerObjects()
        -> LayerEngine.evaluateAll()
          -> evaluateGroup()
```

The call is a slow, repeated re-entry rather than an unchanged-state ACK
spin. The headless driver reached the same final `guard / no-progress` state
after 55 finite commands; the profile recorded continued layer calculation
inside that finite work. RIFT-990's no-progress classifier ends after a
successful command leaves the logical digest unchanged. That is a separate
gameplay stop condition from the computational timeout.

After the fix, the same seed produced 84,644 samples in 238,805.7 ms. The
top-level result was unchanged. `liveSource` self time fell to 0.26 s; the
remaining work is broader layer matching and object filtering, outside this
task's `layers/` and `programs/` scope. A further optimization there should be
handled by its own owner with dependency-order and cache-drift tests.

Profile artifacts are under
`/tmp/RIFT-1031-headless-game-timeout-profile/`; the full `.cpuprofile` files
are intentionally not committed.

The replay mismatch observed by RIFT-990 on seed 060 is not explained by this
timing fix. The current before-fix and after-fix timing runs both reached the
same 7-turn, 55-command, 800-event no-progress boundary. Those timing probes
did not compare the journal as a replay result. The seed 046/058/060
determinism work remains with the replay owner.

## Root cause and fix

`liveSource` in
`packages/engine-core/src/programs/static-adapters/model.ts:43` is the live
source lookup for static filters, conditions and relative anchors. It called
`pipeline.host.objects()` even when the same layer engine was already in the
middle of evaluating the authoritative Board. `ChainEngine` then started
another complete layered host pass. With the full M1 precon programs, each
static filtering check could fan out into repeated whole-board passes.

When a pass is in progress, the lookup now reads the exact layered snapshot
from that in-flight `LayerEngine`. The same source incarnation is used, and
the source remains available while the pass evaluates it. Outside an
evaluation the existing authoritative host lookup is unchanged, so a later
read still observes a newly committed Board state.

This follows CR v1.5 478.1-478.4 (continuous layers and rechecking), 478.1.a
(pause for object dependency and evaluate the referenced object), and
479-482 (layer order, dependencies and timestamps). The lookup optimization
does not change the layer sequence, dependency determination, timestamps,
conditional outcomes, or final board characteristics.

## Production-path regression

`packages/engine-core/test/engine-gaps/m1-headless-turn-budget.test.mjs` uses
the real `createProgramBinding`, `createMatch`, `ChainEngine`, Play lifecycle,
static binder, `MatchCommandAdapter`, and the same two M1 precon decks as the
headless runner.

- `RIFT-1031: nested live static reads reuse the in-flight board layer pass`
  binds the shipped Breakneck Mech static through `createEngineStaticBinder`
  and asserts that the production `liveSource` lookup did not fan out into
  repeated host reads. The instrumented host is read fewer than 500 times,
  versus 4,498 nested reads in the same probe with the fix removed.
- `RIFT-1031: a full M1 precon advances real turns through production commands
  within budget` exercises setup and three directions of turn transfer through
  real Chain/Priority handling and a hard 60 s upper bound. Its pass and time
  bounds protect the reproduced cost regression while the production command
  adapter rejects an unsupported `end-turn` envelope; the turn boundary is
  called through the authenticated `TurnFlow` owned by that adapter.

The profile is the evidence that the old path was repeatedly slow. The unit
probe is the fast regression for the nested lookup; it does not claim to
profile every M1 card or replace the full headless natural-win gate.

## Remaining limits

- The completed M1 precons still stop in `no-progress`; fixing gameplay
  stalls is outside this performance-only workstream.
- Two timeout seeds were directly measured after the fix. The other 17
  RIFT-990 timeout seeds and the complete 100-game matrix remain parent-owned.
- A five-minute full-convoy turn budget is not claimed. Per-turn time remains
  high because non-owner layer matching, predicates, cloning and GC are still
  substantial.

## Verification and one owner request

The ordinary engine-core suite completed with 5,222 tests: 5,002 passed, zero
failed, 220 todo. `pnpm --filter @riftbound/engine-core typecheck` also passed.

`RIFT_LAYER_MEMO_CHECK=1` completed the same 5,222-test suite with 5,001
passed, one failed, 220 todo. The sole failure was the pre-existing
`m1-full-precon-layer-budget` threshold:

```text
layer passes stay below the reproduced regression (15487)
```

The same RIFT-999 flow without the memo-check diagnostic observed 391 layer
passes and 971 host reads. The debug mode deliberately performs an additional
fresh pass on every cached view before comparing it; that check is included by
the test's `evaluateAll` counter under `RIFT_LAYER_MEMO_CHECK=1`. No
"layer memo drifted" error occurred.

Owner request: update
`packages/engine-core/test/engine-gaps/m1-full-precon-layer-budget.test.mjs`
so the performance budget does not count the memo-check-only comparison pass,
or expose a separate diagnostic counter from
`packages/engine-core/src/chain/engine.ts` for those comparison passes. Keep
the original production count and drift assertion intact. Those paths are
outside RIFT-1031's unique write scope, so they were not edited here.
