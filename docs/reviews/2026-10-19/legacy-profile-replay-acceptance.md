# RIFT-862: Legacy Profile Replay Acceptance

- Audit date: 2026-10-19 UTC
- Audit branch: `task/RIFT-862-legacy-replay-audit`
- Audit HEAD: `5a01d3b92e6e8e2b3935f1f8ef66cb65d9d0a1c7`
- Frozen implementation: `e2cbcdf45ae6f98764951f20a6b67b9dfc4bb95a`
Verdict: **PARTIAL**

## Decision

- **PASS:** the frozen `e2cbcdf` implementation strictly replays the available original schema 8 / `optional-unit-physical-chain-v4` journal. All 28 operations, entropy consumption, private state, both seat projections and the public projection match. The source journal and options remain byte-identical.
- **BLOCKED:** the current HEAD cannot consume that same legacy archive. Its `replayDuelCommandArchiveP4` rejects it with `P4 journal: legacy replay requires the legacy-replay-e2cbcdf implementation`. Frozen-module replay is therefore historical evidence, not proof of true default server consumption.
- **BLOCKED per profile:** original schema 1, 2, 3, 4, 5, 6, 7 and 9 journals, their exact matching options/contexts, and the cited verification artifacts are absent from both the `e2cbcdf` Git tree and the permitted shared inputs. Module tests pass, but they are not substituted for original-log replay.
- The missing `legacy-replay-e2cbcdf` tag does not block locating the commit. `git cat-file -t e2cbcdf` returned `commit`, and `git rev-parse e2cbcdf^{commit}` resolved to `e2cbcdf45ae6f98764951f20a6b67b9dfc4bb95a`. The commit is an ancestor of the audited branch; its parent is `8d3929da02d70f07ea3b880e50a2b31512d2dfa4`.

No code, test, config, dependency, lockfile, profile, schema, card text, original log or original tag was changed.

## Frozen implementation and original input

I created a detached worktree at `/tmp/RIFT-862-legacy-replay-audit/e2cbcdf` from the resolved commit. The tracked tree remained clean. Offline frozen install succeeded (`Scope: all 10 workspace projects`, no downloads). Protocol, card DSL and engine-core builds exited 0.

The source hashes match the independently recorded 643-file source manifest in `/root/swarm-rift/shared/prior/gear-normal-deck-positive-closure/inputs/parent-source.json`:

| Frozen source | SHA-256 |
| --- | --- |
| `apps/game-server/src/duel/command-journal-p4.ts` | `4f8fbb1f5824bd7c90d1462186b140a790a212052e5f51d360b834d1971c1216` |
| `apps/game-server/src/duel/authoritative-runtime-p4.ts` | `c5e02a751c0c890701959c2c6c69b453c1e8aa41a07489290be7dbe45eebf41a` |
| `apps/game-server/src/card-catalog.ts` | `18649e6876a578a38382fa6a3e915d6201b06f7a276b735d9a3a7f3049e377b0` |
| `apps/game-server/src/duel/printed-unit-chain-services-p8.ts` | `653f21abc065e5f5a921d0e9c44e02ce2b588b9112ad3f09e363573445d5ebdd` |
| `packages/engine-core/src/duel/cardplay-unit-chain-v4.ts` | `6ecb9b15d264243bb9fba09d4cf4937ed1b0e7074015110a5e18b2dcd8c08a34` |

The original schema 8 input is shared by two byte-identical copies:

- `/root/swarm-rift/shared/prior/gear-normal-deck-positive-closure/inputs/native-main5/journal.json`
- `/root/swarm-rift/shared/prior/point-public-owner-p10-candidate/inputs/native-main5/journal.json`

| Input | Bytes | SHA-256 |
| --- | ---: | --- |
| `journal.json` | 1,370,935 | `6179f73bb251d5c02e5e395d32f64b6eddd24cb034aea3d1572da68de9096aae` |
| `options.json` | 4,242 | `487ae795df01c99b937b859eb4c12c8ce828f191fa8b7a091ec608e8bcd0369d` |

The journal identifies itself as `private-duel-command-journal-p4`, schema 8, profile `optional-unit-physical-chain-v4`, semantic version `riftbound-p4-optional-unit-physical-chain-v4`, policy date `2026-10-15`, context digest `de68cee6780757d14d9ec5a99835a3e930a51308d5f3dbf5a85d782979fbfcce`, and archive digest `e3aadaf5e7fe85ea95c46da69df86444dff4bcf8965da0bb1adcb6f1bc564acc`. It contains 213 creation entropy records and 28 recorded operations, including mulligans, physical Unit choice/payment, movement, Focus passes, damage allocation, and a final blocked choice.

The catalog digest embedded in every observation is `sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10`, matching `/root/swarm-rift/shared/card-data/deck-catalog.json` (1,381 cards, 1,080 groups). I fixed the replay process clock to the journal's own audit day, `2026-10-15`, because the frozen loader derives Constructed policy and Radiance availability from the current date. Without that historical clock, the gate correctly rejected the context. At the recorded day, the P8 context recomputed exactly to `de68cee6...`.

## Schema 8 original-log replay

Command:

```bash
cd /tmp/RIFT-862-legacy-replay-audit/e2cbcdf
apps/game-server/node_modules/.bin/tsx /tmp/RIFT-862-legacy-replay-audit/strict-replay-native-main5.mts
```

Result: exit 0, 20.353 seconds for the strict replay itself.

- Operations replayed: **28 / 28**.
- Final recorded and actual private digest: `e84e51246e1866274c69129390dff2b5c1241dd1567454e26ec87bc40e41981b`.
- Final state version: **87 / 87**; event sequence: **87 / 87**; turn: **5 / 5**; phase: **main / main**.
- Final player-1 projection, player-2 projection and public projection all equal the recorded views.
- Final operation is structurally equal to the recorded operation after canonical key normalization.
- Journal SHA-256 and byte count are unchanged before and after replay. Options SHA-256 is also unchanged.
- Evidence: `/tmp/RIFT-862-legacy-replay-audit/strict-replay-native-main5.log`.

The historical code validates each operation after dispatch by comparing its actor, packet, consumed entropy, ack, three views and private digest with the original operation. It also verifies creation entropy/state and the complete archive/context digests before replay. It does not mutate the supplied JSON.

## Integrity and tamper results

Command:

```bash
cd /tmp/RIFT-862-legacy-replay-audit/e2cbcdf
apps/game-server/node_modules/.bin/tsx /tmp/RIFT-862-legacy-replay-audit/tamper-native-main5.mts
```

Result: exit 0; every mutation was rejected:

| Mutation | Result |
| --- | --- |
| actor changed, original digest retained | rejected: `archive digest/schema mismatch` |
| command body changed, original digest retained | rejected: `archive digest/schema mismatch` |
| private digest changed, original digest retained | rejected: `archive digest/schema mismatch` |
| entropy changed, original digest retained | rejected: `archive digest/schema mismatch` |
| schema/profile changed, original digest retained | rejected: `archive digest/schema mismatch` |
| semantic version changed, original digest retained | rejected: `archive digest/schema mismatch` |
| schema 8 journal presented with schema 9 profile gate | rejected: `schema 3/4/5/6/7/8/9 profile mismatch` |
| command body changed and attacker recomputed archive digest | rejected: `unused entropy` |

Evidence: `/tmp/RIFT-862-legacy-replay-audit/tamper-native-main5.log`.

## Current HEAD production-consumption check

Command:

```bash
cd /root/swarm-rift/wt/RIFT-862-legacy-replay-audit
apps/game-server/node_modules/.bin/tsx /tmp/RIFT-862-legacy-replay-audit/current-head-legacy-consumption.mts
```

Result: exit 0 for the negative assertion; the same original schema 8 journal was rejected with:

```text
P4 journal: legacy replay requires the legacy-replay-e2cbcdf implementation
```

Evidence: `/tmp/RIFT-862-legacy-replay-audit/current-head-legacy-consumption.log`.

This is the decisive delivery boundary. `e2cbcdf` demonstrates that the historical implementation could replay the original archive. It does **not** demonstrate that the current default server consumes it. Restoring production consumption remains outside this report-only task and belongs to the owning implementation workstream and parent integration.

## Per-profile matrix

| Schema / profile | Original journal + exact options available? | Frozen module evidence | Acceptance |
| --- | --- | --- | --- |
| 1 / `legacy-unit-v1` | No. The docs cite room `900bc504`, 58,970,270 bytes and partial SHA `25d4ec...`; the file is absent. | `replay-profile-p4.test.ts` and `command-journal-p4.test.ts` cover explicit legacy gate, context recovery, replay and tamper rejection with synthetic old-schema serialization. | **BLOCKED** for original-log replay; module tests PASS. |
| 2 / `legacy-unit-v1` | No. The docs cite room `4083c787`, 48 deliveries / 34 commands / state 258 and SHA `5cf4ed7a48bc11919059d8d9155a0b65c03902aa985a91819c6ad545b6c920d2`; the file is absent. | Same schema 1/2 replay-profile test; schema 2 is generated from a real fixture owner and strictly replayed. | **BLOCKED** for original-log replay; module tests PASS. |
| 3 / `spell-v1` | No original schema 3 journal or exact options. | `replay-profile-p4.test.ts` and `public-chain-card-p4.test.ts` record, fork and strictly replay schema 3 under its explicit profile. | **BLOCKED** for original-log replay; module tests PASS. |
| 4 / `public-chain-v1` | No. Docs cite room `17cecbea`, 19 commands and a 7,220,302-byte archive with digest `c1331f0a59ab63e75e8dd1edf44c5770492388dda524c89438479aba458a3759`; file absent. Room `06a8a0d2` is also absent. | Replay-profile and public-chain tests pin schema 4 and reject wrong-profile gates. | **BLOCKED** for original-log replay; module tests PASS. |
| 5 / `regional-public-chain-v1` | No original schema 5 regional journal or trusted region context. | `constructed-regional-room.test.ts` creates a schema 5 archive, restores both seat projections and rejects a changed region/source. | **BLOCKED** for original-log replay; module tests PASS. |
| 6 / `optional-unit-payment-v3` | No. Docs cite two golden schema 6 pay/decline logs and hash artifacts, but the original files are absent. | `optional-unit-replay-profile-p4.test.ts` and `optional-unit-choice-clock-p4.test.ts` pin schema 6, replay both views and reject profile/schema forgery. | **BLOCKED** for original-log replay; module tests PASS. |
| 7 / `optional-unit-choice-clock-v4` | No. Docs cite room `2ba8404c`, 16 commands / version 46 / 3,388,491 bytes / SHA `04ba926d4a5eada935d532579ccfef75cba84d98b644e635a030aecb3a98a404`; file absent. | Choice-clock tests distinguish schema 6 from schema 7, strictly replay pending/final states and reject wrong-profile gates. | **BLOCKED** for original-log replay; module tests PASS. |
| 8 / `optional-unit-physical-chain-v4` | **Yes.** Original 1,370,935-byte journal and exact options were found in shared read-only inputs and verified byte-identical across two copies. | Full frozen source replay passed; all tamper cases rejected. | **PASS at `e2cbcdf`; BLOCKED at current HEAD production consumption.** |
| 9 / `optional-unit-resolved-history-v5` | No original schema 9 journal or the cited P9 parent artifacts. The 27-command GUI seed is a reduced command seed, not the original journal. | `optional-unit-resolved-history-p9.test.ts` re-executes the reduced seed, pays to state 92, strictly replays schema 9 and rejects schema 8. | **BLOCKED** for original-log replay; module tests PASS. |

All eight original files named in `docs/full-product/delivery-goal.md` were checked at their repository-relative paths. The following were individually absent: `native48-ui-chat-current-replay/verification.json`, `native-layout-current/strict-replay/verification.json`, `optional-public-wire-parent-recheck/original-schema6-log-hashes.json`, `post-combat-profile9-parent/REAL-TRAJECTORY.json`, `post-combat-profile9-parent/PARENT-FORMAL-REGRESSION.json`, `p4-reaction-compatibility-proof/verification.json`, `native-optional-clock-current/native-current-verification.json`, and `recruit-token-play-parent-review/native-schema7-current-core-replay.json`.

## Module regression used as supporting evidence only

Command:

```bash
cd /tmp/RIFT-862-legacy-replay-audit/e2cbcdf
heavy pnpm --filter @riftbound/game-server exec vitest run --config vitest.config.ts \
  tests/duel/replay-profile-p4.test.ts \
  tests/duel/command-journal-p4.test.ts \
  tests/duel/optional-unit-choice-clock-p4.test.ts \
  tests/duel/optional-unit-replay-profile-p4.test.ts \
  tests/duel/public-chain-card-p4.test.ts \
  tests/duel/optional-unit-physical-chain-p8.test.ts \
  tests/duel/optional-unit-resolved-history-p9.test.ts \
  tests/constructed-regional-room.test.ts
```

Result: **8 test files passed; 35 tests passed; 0 failed; 0 skipped**; duration 330.82 seconds. Evidence: `/tmp/RIFT-862-legacy-replay-audit/frozen-profile-focused-tests.log`.

These tests prove current frozen-module behavior for schemas 1–9. They do not supply the missing original logs, hidden projections, hashes or exact historical contexts and therefore do not close the BLOCKED rows.

## Source and contract boundaries

- Historical rule/version evidence: the replay audit preserves the archive's recorded CR 1.4 context and `policyCheckedAt=2026-10-15`. It does not upgrade old semantics to CR 1.5. The current official sources are CR v1.5 at `https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf`, updated 2026-10-09, and the Radiance rulings at `https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/`, effective 2026-10-16, as cached in `shared/rules/official-order/source-snapshots.json`. They govern new semantics; they do not rewrite the historical replay context.
- The schema 8 trajectory includes card interactions involving `ogn-001-298`, `ogn-010-298`, `ogn-013-298`, and other recorded cards. This audit proves replay identity, not that their current CR 1.5 effect semantics are complete.
- Unknown or unsupported effects remain `judge-required` / blocked. No timing or priority behavior was inferred from code order, YGO rules, or the new current default.
- A JSON digest is an integrity check, not a MAC. The historical gate additionally requires independently supplied archive and context digests, a trusted current profile, exact catalog/roster/deck-rule context, entropy exhaustion and per-operation private observations.
- No retired service was started. No shared integration database was used. Only task ports 35940–35959 were reserved; no listener was needed.

## Exact evidence paths

All are under `/tmp/RIFT-862-legacy-replay-audit/`:

- `install-e2cbcdf.log`
- `frozen-data-hashes.log`
- `context-audit.log` (current-date negative context)
- `context-audit-at-original-day.log` (exact context match)
- `strict-replay-native-main5.log`
- `deep-diff-final.log`
- `tamper-native-main5.log`
- `current-head-legacy-consumption.log`
- `frozen-profile-focused-tests.log`

## Remaining dependencies

1. Restore the exact original schema 1, 2, 3, 4, 5, 6, 7 and 9 journal bytes, matching trusted options/context, expected step events/hidden projections and hashes. Re-run the frozen historical replayer without regeneration.
2. Resolve current production consumption of legacy archives with the owning implementation workstream and parent integration. This report proves the frozen historical replayer; it does not merge it into current HEAD.
3. Preserve each archive's historical profile/schema/rule context and do not upgrade in place.

Contract change requests: none.
