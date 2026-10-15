# Implementation Status

Last reviewed: 2026-10-15

## 2026-10-15 当前快照

本节是当前状态口径；其后的 `2026-10-13 refresh (10th) / (9th)` 区块与 `Verification Status` 计数均为**带日期的历史记录**，不得当作当前事实。

- **整体目标仍 active / 未 complete。** 未 commit / push / deploy；工作区为 detached HEAD `8d3929da` + dirty，原 checkout 未动。
- **已可跑的有限路径（非完整官方规则）**：CLI 默认新房间为 `p4` + runtime `optional-unit-choice-clock-v4`（journal schema 7）；SDK 默认兼容 profile4；显式 `public-chain-v1`（schema 4）与 `v1` 独立保留。来源：`apps/game-server/src/index.ts`。启动配置已对真实 spawn / TCP / decks / setup 验证（`outputs/coordination/resume-20261013/artifacts/cli-optional-profile-startup-proof/`）。
- **真实原生（Native）双端已实际运行**：房间 `2ba8404c` 完成真实 setup / 双方 mulligan / 第 3 回合 Main，B 选择不支付额外费用、仍支付本体 2 能量后横置入场、A 付 3 能量 + 1 炽烈符能就绪入场，真 Rune / Pay、2 条双向 chat、两端保存回放，严格当前 Core fresh-replay 与私有观察双方 board / resources 与原始日志字节一致。布局（Base / Ribbon / hand / battlefield / resources）已在 1280×800 与 1024×720 实际验收。证据：`outputs/coordination/resume-20261013/artifacts/native-optional-clock-current/`、`outputs/coordination/resume-20261013/artifacts/base-ribbon-resource-visibility/`；但**本轮 pendingChain UI 文案尚未重新打包进 Native**。
- **上一轮全工作区本地回归（新链内核加入后正在重跑）**：`pnpm typecheck` / `pnpm build` / `pnpm test` / `git diff --check` 均 exit0，9 包 **2632 passed / 0 skip**；Core783 / server562 / client763 / DSL207 / protocol91 / replay77 / card-data92 / judge18 / integration39，22 个源码哈希匹配。证据：`outputs/coordination/resume-20261013/artifacts/recruit-token-play-ui-workspace/verification.json`。这是当前本地源码回归，不等同于远程 CI 或新原生包验收；新链内核随后已入Core且过70项聚焦，当前完整回归仍在重跑，公开profile8未启用。
- **规则覆盖边界**：持久化效果覆盖保持 `executable 0 / judge-required 1348 / no-ability 33`（1381 printings / 1080 canonical）；source 侧“默认全 IR 识别 65 / 显式 77”是不同维度，部分真实 Draw4 / 费用 / Move / Combat 机制已在有限 P4 owner 接通，但**不能**据此说 77 项全部可执行，也**不能**从 persisted 0 推出没有任何能力会执行。unknown source / entry / trigger / queue 一律 pending / judge-required。
- **未完成**：完整官方效果与 current FinalPoint 闭包、Windows NSIS 与 Windows 实际运行、clean Git、完整 CardPlay / public Hold / 能力执行、原 23 项整体；新链内核返修已入Core并过70项聚焦；P4公开接线与当前全量仍待验。

> 以下 `2026-10-13` 刷新区块为**历史**。

> **2026-10-13 refresh (10th).** Incremental facts since the 9th note; the overall
> goal remains **active / not complete**. The **131 token-lifecycle and 141 V2
> turn-executor cores are now terminal** (no longer being written). Wave 160
> verified the frozen 130→131-141 baseline: protocol + engine-core
> `strict --noEmit` and full compile all exit 0, engine-core **346/346** and
> protocol **57/57**, with 84/84 frozen hashes matched — but this is a
> **test-framework baseline, not production source**: there is still **no
> production source registry and no public Main/fullmatch**, and the 7
> phase-source-authority cases are imported/re-registered by the turn test, so
> the totals are **executions, not unique scenarios**. The first failure was
> merely a file-level missing `card-data` fixture (copied unchanged, no
> test/assert edits). Wave 158's independent token review ran 35 original TAP +
> **27 framework probes**, all executed PASS, but cases **#17–22 are
> "unsafe-acceptance" passes, not correctness**: P1 (a restore that rewrites
> `readied` can mint resources; Recruit born-trait invariant) and P2 (token
> history structure is not independently authenticated) are findings **assigned
> to wave 165** — token restore and overall release remain **unsigned**. Wave 164
> completes the wave-159 preserved edits under a **scoped internal-command**
> acceptance: Gold **15/15** (= 8 distinct), continuation **13/13** (= 6
> distinct), combined regression **83/83**, with the pre-159 negative control
> 11 pass / 2 fail on exactly the completed-continuation reuse — this **closes
> wave 137's `continuationId`-reuse P1 at this slice** (the other P1 — external
> durable CAS / ACK-after-persist — is still pending). The Gold creating-source
> oracle is an internal kernel **test fixture**; real sourceIR and public Main
> are not connected. Wave 163 promoted the replay-core **formal dist**
> (`file-event-store.js` → `802fc017…`, byte-identical to wave 151/155) and the
> formal replay suite passes **77/77**, but **8795 still runs 144 old cached
> imports** — not the new formal runtime. Wave 162 is read-only zone/keyword
> evidence (**not IR**; the `duel-official-programs` binding stays **52 resolved
> / 1329 unknown of 1381, automatic execution 0**). Wave 166's read-only
> resource-gap evidence confirms the public room still stops at
> `setup → mulligan → awaiting-turn-start`: there is **no public "start
> turn/enter Main" command** and turn-start needs a trusted provider (currently
> always pending), so **real Main payment and arbitrary `+/-` counters are not
> wired** (wave 167 is only a local source-button/payment-summary visibility
> fix, still not a real-Main acceptance). **In-flight, not accepted** (source
> written in each task's exclusive scope): 161 V2 phase/source review (pid
> 67966), 165 token invariants (pid 72216), 167 resource-panel visibility (pid
> 72631), 168 payment/cursor reentrancy (pid 72805), 169 DSL phase/event scope
> (pid 73230), 170 phase-source closure (pid 73767).

> **2026-10-13 refresh (9th).** Incremental facts since the 2026-10-12 note, still
> kept honest about what is *not* accepted. Frontend `desktop-client` is now
> **313 tests / 26 files** with a fresh production build (`index-ByPJLsZc.js`,
> mechanical typecheck/tests/build only — not UI/reconnect proof), and a 1-line
> App.tsx deck-count label clarification (`卡组总计 N 张 · 当前区域：X`). `card-dsl`
> is now **91 tests** with a formal build; the Basic Rune official IR
> (CR-v1.4:164.2 two Reaction activations) binds exactly 30 printings →
> `duel-official-programs` registry **52 resolved / 1329 unknown (1381)**. This is
> **binding/IR only — automatic execution is still 0**. The game-server suite
> measured **226 pass / 3 fail (PARTIAL)** at wave 144; the audited wave-150/151
> fix files were overlaid onto the frozen wave-144 baseline and the wave-155
> independent merge reports **229/229 + strict typecheck 0 + module smoke 0** —
> a **frozen-merge snapshot, not the live worktree**, and no standing service was
> started. Independent review wave 137 (V2 session × official Gold IR) is
> **release BLOCKED**: the frozen slice's 14 framework probes pass but probe 12
> reproduces a **P1 continuationId reuse** defect — so the mechanism must **not**
> be described as correct. Wave 140 verifies the frozen 130+129 slice (50/50,
> real independent genesis/ordered-history attacks rejected, legitimate restore
> can still commit). The 131 token-lifecycle and 141 V2 turn-executor kernels are
> **still being written by their workers (not published to Main)**; the 146
> continuation-dedup fix waits for 141 to release `canonical-session-v2.ts`. The
> full goal remains **active / not complete**.

> **Current round (2026-10-12 full-product round, base `8d3929d`).** The
> authoritative, up-to-date status now lives in
> [`docs/full-product/progress.md`](full-product/progress.md) and the acceptance
> checklist in [`docs/full-product/delivery-goal.md`](full-product/delivery-goal.md).
> They carry the module completion table, current evidence, the prototype status,
> the action/target loop design, and the reproducible verification commands.
>
> The test totals below (`301`, `139`, etc.) are **historical / pre-full-product
> baseline numbers** and were **not** re-run in the current round; they must not
> be presented as current results. Current-round facts (2026-10-12):
> `pnpm install --frozen-lockfile --offline`, `pnpm build`, `pnpm typecheck`
> exited 0. The round promoted the **internal Duel kernels**
> (`board/setup/resources/scoring/printed-costs/movement/match-state`) into
> `packages/engine-core/src/duel/` behind the `./duel` export: per-package
> `test` + `typecheck` are now green — engine-core **182/182** at the Draw/Burn Out
> promotion snapshot (was 123, then 146/161/168/170 as kernels landed; the Draw
> kernel added 12 and the former `59/64` red state is obsolete; **182 is that
> task-time whole-package snapshot, not a final proof of the currently-unifying
> core**), game-server **168/168** (constructed identity: Domain Identity / named
> champion tag / Signature ≤ 3), card-dsl **45/45** (`./duel` fixed-text Ganking /
> enter-ready source-bound binding), desktop-client **210** (19 files: room/deck
> confirmation witness fix + SharedBattlefields tabletop layout + connection
> address restoration). The resource kernel passed an independent
> 1,161-case DFS oracle with zero mismatches. The F-1 legacy/restored prompt leak
> fix is now **promoted into src and closed** (15 regressions pass); the high
> action-authority bypass fix is likewise **in the working-tree src but
> uncommitted**. The former `room-deck-receipt-core` (wave-27) task was
> **cancelled by the coordinator** (source retained; the `GameClientAPI` core is
> already partial), so the older 163/165 desktop snapshots are not current. On
> macOS the Tauri shell was compiled historically (`cargo check`/`cargo build`
> exit 0, Mach-O arm64) but against an **older `dist`**; a fresh preflight
> re-confirmed no cargo/rustc/rustup on this host and a Windows-only NSIS
> bundler. Since this refresh the **web frontend has been freshly built**
> (`pnpm --filter @riftbound/desktop-client build` exit 0, `dist/assets/index-Bx6ry0KG.js`)
> and a **real Foundation-room room/deck GUI** was exercised by the coordinator
> (`outputs/coordination/full-product-20261012/gui-room-proof/`: 13 room/deck
> checks + 5 service-address checks). Still: **no fresh Tauri GUI, no Windows
> NSIS, no desktop installer, and no completed full match** — the room/deck GUI
> is Foundation-room only, not an official Duel. The
> official catalog/images are no longer absent: `official-card-sync` wrote the
> `.gitignore`-ignored `packages/card-data/data/` into this checkout, currently
> verified as 1,381 printings / 1,080 canonical identities / executable `0` /
> judge-required `1,348` / no-ability `33`, and 1,381 images with zero missing;
> `deck-catalog.json` carries digest `sha256:53b974c8…a504d10` after the Karma
> exact-source regeneration (actual catalog: 143 Legends / 60 Signatures, all
> uniquely resolved). Draw/Burn Out (43) is now **promoted into src**
> (`packages/engine-core/src/duel/draw-burnout.ts` via `./duel`, 12 cases; only
> import lines changed). Resource command session idempotency (48) and unit
> lifecycle (49) remain **artifact source checkpoints only — not promoted**; the
> official turn executor (53) was **cancelled** (no runner/worker source, only
> copies) and a new 59 split adds `begin-turn only` + CombatDamage, both
> **in development / not accepted**. Review 56 (`duel-core-integration-independent-review`)
> published `integration-contract.md` + `evidence.json` with FR1–FR4 wiring gates
> (429.3 required-cost without ordinary Priority / nullable Champion / single
> stateVersion+eventSeq / Draw retry identity); its independent `review.md` is
> now available and the verdict is **integration NOT PASS (FR1–FR5)** — the
> review task's `succeeded` status means the review was produced, not that
> integration passed — and wave 60 formal unification is **not yet accepted,
> still fixing**. The coordinator still holds **three in-flight cores
> (turnStart / CombatDamage / canonicalIntegration) plus review 56 wrap-up —
> pending acceptance, not complete**. All current-round full-product edits
> and final workspace verification remain **实施中 / 待主控验收**; the
> coordinating task fills in the final numbers after integration. The three-page
> prototypes and the public-foundation dual-browser fixture are **local evidence
> only**, not official full-match or two-Tauri results; the Foundation-room
> room/deck real GUI (13 + 5 checks) is likewise **partial evidence only**. The
> overall goal is **not** complete.

（以下至 `Verification Status` 的历史说明，写作时点为 2026-10-12 / 2026-10-13。）
Data and catalog statements below describe the persisted snapshot last verified
on 2026-10-12. The `Verification Status` totals section is **historical**
(commit `7280dd8`, pre-full-product). Current status is in the `2026-10-15 当前快照`
section above; this page does not re-assert server smoke, frozen-install, audit,
or CI verification for the current workspace.

## Current Shape

The repository is a server-and-desktop pnpm workspace:

```text
apps/
  game-server/       HTTP catalog/image/deck APIs and WebSocket rooms
  desktop-client/    React + Vite client with a Tauri 2 desktop shell
packages/
  protocol/          shared command, event, and projection contracts
  engine-core/       deterministic synthetic-demo and foundation game state
  card-data/         versioned card data, sync scripts, and image manifest
  card-dsl/          synthetic-demo DSL and EffectIR validation
  replay-core/       replay envelope and event-log validation
  judge-tools/       judge policy, review, and decision metadata
  integration-tests/ cross-package WebSocket and protocol tests
```

Implemented surfaces include:

- A game server with `/health`, `/api/cards`, `/api/card-images/:id`, and
  `/api/decks/validate`, plus in-memory WebSocket rooms.
- A desktop client that loads the server catalog, groups cards by canonical
  identity, selects printings, and edits a six-zone deck: main deck, runes,
  legend, champion, battlefields, and sideboard. DeckBuilder honors
  `available: false`, preserves API `printingIssues`, and includes a full-art
  preview.
- Server-side Constructed validation using canonical card identity: current
  official ban targets, grouped copy limits, zone structure, and (since
  2026-10-12) Legend/Domain Identity, Chosen Champion tag, and cross-zone
  Signature ≤ 3. Independently verified regional availability restrictions and
  the domain handling of Colorless battlefields / sideboard remain unresolved.
- Tauri NSIS bundling configuration with PNG and ICO icons and the Tauri CLI as
  a package dependency.

These implemented surfaces do not add up to a complete playable game. The
WebSocket rooms are in-memory. The synthetic-demo mode uses the narrow demo
engine, while the foundation mode maps submitted official printings through the
server adapter into `createConfiguredGame`. That foundation surface is a
deliberately narrow CR v1.4 1v1 Duel vertical slice, not a complete official
rules implementation. It starts with four submitted Main Deck cards in submitted
order and does not model official shuffling, mulligans, first-player selection,
battlefield selection, rune channeling, sideboarding, or official ability
execution. （该 foundation 说明为其写作时点；截至 2026-10-15，独立的有限 P4
路径已通过真实 setup / 双方 mulligan / 第 3 回合 Main 与双向原生运行，见
`2026-10-15 当前快照`——但完整官方 CardPlay / public Hold / 能力执行仍未完成。）

Official card ability text is not parsed. Cards with unmodeled official text,
inherent rune abilities, token-like definitions, or a mapped multi-type
definition become judge-required effects and block automatic resolution rather
than being approximated. Unsupported card types are rejected rather than being
guessed as another engine type. Player confirmation cannot resolve
judge-required effects; an authoritative ruling is required.

## Data, Catalog, And Effects

| Area | Current status |
| --- | --- |
| Official raw card data | Complete for this snapshot: English and Chinese official galleries each contain 1,381 records with matching IDs. |
| Persisted card snapshot | `sync:cards` exited 0 and wrote `packages/card-data/dist/cards.json` and `packages/card-data/data/catalog.json`. Coverage is OGN 352, OGS 24, RAD 192, SFD 288, UNL 288, VEN 237, totaling 1,381. |
| Deck catalog identities | `build-deck-catalog` processed 1,381 printings into 1,080 official English full-name identities, including 46 cross-set identities; variants are 169 alternate and 1,212 standard. |
| Community correction source | Used as a correction/comparison source. The missing `unl-022-219` regular printing was filled from the official gallery. |
| Localized display names | 1,355 printings have a localized Chinese name and 26 fall back to the official English name. |
| Card image cache | Complete for this snapshot. `data/images` contains 1,381 files, including `ogn-028-298.png` (840,102 bytes). `images-manifest.json` is `ok=true`, `partial=false`, with 1,381 entries and zero missing or failed entries. `sync:images --dry-run` reports `total=1381 resumed=1381 missing=0 failed=0 pending=0 partial=false`. |
| Catalog and deck builder | Implemented against the persisted catalog, including canonical grouping, printing selection, six zones, official bans, grouped copy limits, and zone structure. Domain Identity, named-champion tag, and Legend/Signature ≤ 3 are now enforced (game-server **168/168**, named-champion fail-closed); independently verified regional availability is still not implemented. |
| Playable card effects | Not complete. `engine-core` covers explicitly modeled synthetic-demo and foundation semantics, while `card-dsl` validates synthetic-demo DSL and EffectIR; neither is a complete 1,381-card rules engine. Unmodeled official text and object semantics are judge-required. Current verified effect coverage (2026-10-12): `executable = 0`, `judgeRequired = 1,348`, `noAbility = 33` over 1,381 printings / 1,080 canonical identities (`packages/card-data/data/effect-coverage.json`). `card-dsl`'s `duel-official-programs` now binds **52 resolved / 1329 unknown** (Basic Rune IR included) — **binding/IR only, automatic execution still 0**. |

This distinction is important: 1,381 reconciled data records establish card
identity, text, image references, and the bounded Constructed policy. They do
not make all card abilities executable. Full effect coverage still needs a real
state model, DSL compilation, trigger/replacement/prevention semantics, and
rule fixtures.

The persisted deck-catalog digest is:
`sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10`
(after the Karma exact-source regeneration, which changed only `ogn-235-298.tags`
`Vi→Karma`; 1,381 cards / 1,080 groups / all image URLs unchanged).
The catalog generation fix classifies all 45 official public codes ending in
ASCII `*` as alternate printings and left every `primaryPrintingId` unchanged.

## Verification Status

> The totals in this section are the **historical pre-full-product baseline
> (commit `7280dd8`)**, recorded before the full-product foundation
> (`b488d73`). They were not produced by the current round; see
> [`docs/full-product/progress.md`](full-product/progress.md) for current-round
> status.

Historical test verification (pre-full-product baseline `7280dd8`; **not** the
current round):

- `protocol`: 8 passed.
- `engine-core`: 27 passed.
- `game-server`: 78 passed.
- `desktop-client`: 58 passed.
- `card-data`: 51 passed.
- `card-dsl`: 17 passed.
- `judge-tools`: 18 passed.
- `replay-core`: 10 passed.
- `integration-tests`: 34 passed.

A full `pnpm test` run exited 0 with these package results: 301 tests passed.
`pnpm typecheck`, `pnpm build`, and `git diff --check` also exited 0.
After the final reconnect visibility fix, the desktop-client tests passed
58/58 again and its build, including TypeScript checking, exited 0.

One isolated
`game-server` package run had a timing-sensitive reconnect failure, but that
failure did not reproduce in the full recursive run; it is not a verified
stable result.

Persisted data checks last completed on 2026-10-11:

- `node scripts/sync-current-cards.mjs --dry-run` exited 0. It loaded 1,380
  community records, 1,381 English official records, and 1,381 Chinese official
  records, generated a 1,381-card bundle, and reported one official-gallery
  fill for `unl-022-219`.
- `pnpm --filter @riftbound/card-data build:catalog` exited 0 and built 1,381
  cards and 1,080 identity groups.
- `pnpm --filter @riftbound/card-data sync:images --dry-run` exited 0 and
  reported 1,381 resumed, zero missing, zero failed, zero pending, and
  `partial=false`; no files were written.
- Deck-catalog generation processed 1,381 printings into 1,080 official English
  full-name identities, including 46 cross-set identities.

Server smoke, frozen-install, and audit checks also passed in that earlier
workspace state on 2026-10-11. Those three checks have not been re-asserted for
the current workspace.

Current-round (2026-10-12) data re-collection is recorded in
`outputs/coordination/full-product-20261012/task-artifacts/official-card-sync/summary.json`
(`sync:cards` / `build:coverage` / `sync:images` / `audit:catalog` all exit 0;
1,381 cards; deck catalog 1,080 identity groups; images
1,381 downloaded, 0 missing, 0 failed; `audit:catalog` 4 tests passed). Reading
the persisted files directly confirms effect coverage executable `0` /
judge-required `1,348` / no-ability `33`.

DeckBuilder no longer adds printings marked `available: false`, preserves API
`printingIssues`, and includes a full-art preview. The former
`primaryPrintingId` fixture defect is fixed.

Not yet verified:

- Windows NSIS installer creation or installation. The Tauri shell was
  **compiled on macOS historically** (`cargo check` / `cargo build` exit 0,
  Mach-O arm64, root file/hash verified; `task-artifacts/desktop-native-check/`),
  but that binary was linked against an **older `dist`** and was **never
  executed** (no GUI). A fresh preflight (`task-artifacts/desktop-delivery-preflight/`)
  re-confirmed that this host has **no cargo/rustc/rustup on PATH** and that
  `bundle.targets=["nsis"]` is a **Windows-only** bundler; there is **no Windows
  NSIS artifact**, GitHub Windows CI verification is pending, and **no desktop
  installer exists**. The **web frontend has since been freshly built**
  (`pnpm --filter @riftbound/desktop-client build` exit 0, `dist/assets/index-Bx6ry0KG.js`),
  but that is a web build, not a Tauri/desktop package.
- Complete Constructed validation beyond the bounded policy. Domain Identity /
  named-champion tag (fail-closed) / Legend / Signature ≤ 3 are now enforced in
  the game-server source (**server 168/168**); the actual catalog resolves
  **143/143 Legends and 60/60 Signatures** to a unique family, and the former
  `ogn-235-298` Karma/Vi contradiction is fixed (now `Karma`). Still unresolved:
  the Colorless-battlefield domain, the sideboard CR 103 scope, independently
  verified regional availability, and the current (2026-10-12) Tournament Rules
  text. The actual catalog has **no Karma Legend**, so a fully-Karma legal deck
  cannot be built from real data (an in-memory probe is not a real deck).
  `policy.tournamentComplete` remains **false** and sideboard `0..10` is
  unchanged. Complete official rules (setup, turn, move/location,
  control/contested, showdown, combat, conquer/hold, scoring, win conditions),
  full-card effect execution (currently `executable = 0`), persistent-room
  restart recovery, and production installer/update behavior are not
  implemented; the internal `src/duel/*` kernels (board/setup/resources/scoring/
  printed-costs/movement/match-state/draw-burnout) are not wired to the public
  path. Draw/Burn Out (43) is now promoted into src but remains an internal
  kernel; resource command session (48) and unit lifecycle (49) artifacts are
  **source checkpoints only**; the official turn executor (53) was **cancelled**
  and its successor 59 (`begin-turn only` + CombatDamage) is **in development**;
  review 56 FR1–FR4 remain **unmet wiring gates** and wave 60 is **not yet
  accepted**. Since the 10th refresh the 131/141 V2 cores are **terminal** and
  wave 160 froze a **346/57** core-baseline pass, but the public path is still
  **not wired** (no public start-turn/enter-Main command, no production
  provider), and 165/167/168/169/170 remain **in-flight**.
- Real two-Tauri/dual-process full match. No completed full match exists. The
  public foundation surface has only been exercised by a dual-browser fixture
  (play card / switch turn / refresh recovery / continue / concede,
  `outputs/verification/action-smoke-20261012/`), by the isolated
  SharedBattlefields snapshot (13 scoped tests), and — since this refresh — by a
  **real Foundation-room room/deck GUI run** (13 room/deck checks + 5
  service-address checks, `outputs/coordination/full-product-20261012/gui-room-proof/`),
  none of which is an official Duel or a full match. The room/deck GUI is
  **Foundation-room only**; the owner-deck submission confirmation is still lost
  on a full page reload (owner-only server proof not implemented).
- The F-1 legacy/restored prompt-target fix is now **promoted into src and
  closed** (15 regressions pass), and the high action-authority bypass fix is in
  the working-tree src — but both are **uncommitted and not independently
  accepted**, and the restored-state authority repair (a state that fully loses
  its legal targets) is still **not done**. `canonical-duel-state-resource-flow-v1`
  (wave-35) and `duel-turn-start-sequence-v1` (wave-59, `begin-turn only`) are
  **staged/checkpoint only** (not in src), and `duel-official-turn-executor-v1`
  (wave-53) was **cancelled**. The old broad authority review (wave-17) was
  cancelled with no conclusion and must not be presented as a pass.

## Commands

Run from the repository root.

```text
pnpm build

pnpm cards:sync
pnpm --filter @riftbound/card-data sync:cards --dry-run
pnpm --filter @riftbound/card-data sync:cards --timeout-ms 60000

pnpm --filter @riftbound/card-data sync:images --dry-run
pnpm --filter @riftbound/card-data sync:images --timeout-ms 60000

pnpm dev:server
pnpm start:server

pnpm desktop:dev
pnpm desktop:build
pnpm --filter @riftbound/desktop-client build
```

Use package-filtered commands when passing options. Do not insert an extra `--`
before script options: the card sync parser tolerates one bare `--`, but the
image sync parser does not.
