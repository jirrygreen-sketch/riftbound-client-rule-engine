# Riftbound Rules Coverage

Status date: 2026-10-15（快照刷新）。**最新当前口径见下方第 0 节；第 1 节及以后均为带日期的历史审计记录，须按其日期解读，不得当作当前状态。**

This document is evidence-bound. It classifies current repository behavior, not intent. Where official text, IR, runtime behavior, or tests do not close a semantic loop, the item is `judge-required` or explicitly not implemented.

## 0. 当前快照（2026-10-15）

本节只写当前可查证据支持的事实。第 1–12 节（2026-10-12 / 2026-10-13 的模块与测试快照）保留为历史，其中的 quarantine 与测试计数不是当前状态，也不得被整段“翻绿”。

**规则版本边界**

- 现仍有效 Core Rules 为 `v1.4`（最后更新 `2026-07-16`）；v1.5 / Radiance（`2026-10-09` 发布、**`2026-10-16` 生效**）在生效日前不得混入。
- 持久化效果覆盖保持 `executable 0 / judge-required 1348 / no-ability 33`（`packages/card-data/data/effect-coverage.json`，1381 printings / 1080 canonical）。**这不代表“没有任何能力会执行”**：source 侧“默认全 IR 识别 65 / 显式 77”是不同维度，部分真实 Draw4 / 费用 / Move / Combat 机制已在有限 P4 owner 接通；也**不能**据此说 77 项全部可执行。
- unknown source / entry / trigger / queue 一律保持 pending 或 judge-required；不得手改 resources / damage / controller / score。

**当前可跑的有限路径（P4，非完整官方规则）**

- CLI 默认新房间为 profile `p4` + runtime `optional-unit-choice-clock-v4`（journal schema 7）；SDK 默认兼容 profile4；显式 `public-chain-v1`（schema 4）与 `v1` 独立保留。来源：`apps/game-server/src/index.ts`、`apps/game-server/src/duel/authoritative-runtime-p4.ts`；启动配置已对真实 spawn / TCP / decks / setup 验证（`outputs/coordination/resume-20261013/artifacts/cli-optional-profile-startup-proof/`）。
- 真实双原生（Native）房间 `2ba8404c`：真实 setup、双方 mulligan、第 3 回合 Main；B 选择不支付额外费用、仍支付本体 2 能量后横置入场，A 付 3 能量 + 1 炽烈符能就绪入场；真 Rune / Pay、2 条双向 chat、两端保存回放；严格当前 Core fresh-replay 与私有观察双方 board / resources 与原始日志字节一致。证据：`outputs/coordination/resume-20261013/artifacts/native-optional-clock-current/native-current-verification.json`、`outputs/coordination/resume-20261013/artifacts/recruit-token-play-parent-review/native-schema7-current-core-replay.json`。
- 布局（Base / Ribbon / hand / battlefield / resources）已在 1280×800 与 1024×720 实际验收；但本轮 pendingChain UI 文案**尚未重新打包进 Native**。证据：`outputs/coordination/resume-20261013/artifacts/base-ribbon-resource-visibility/final-native-verification.json`。

**上一轮全工作区本地回归（新链内核加入后正在重跑）**：`pnpm typecheck` / `pnpm build` / `pnpm test` / `git diff --check` 均 exit0，9 包2632passed / 0skip，Core783 / server562 / client763，22个源码哈希匹配。证据：`outputs/coordination/resume-20261013/artifacts/recruit-token-play-ui-workspace/verification.json`。这不是远程 CI 或新原生包验收。

**当前核心缺口（按官方 354–359 顺序）**

- 真实 probe A 确认：printed Unit 在 choice / payment 时仍处于 Hand、State Open、无 publicChain；按 CR 354 先移动至 Chain / 关闭 State、355 选择、356 定费、357 付款必须补齐；337.2 是 Finalize 之后立即 resolve，不能用“普通 Unit 无需 Step 1”豁免。
- Unit V4 与 Spell chain-first 的返修已入主控 Core 并通过70项聚焦回归；真实卡池/完整队列来源适配与 P4 公开接线仍在进行。当前公开默认 Spell 路径仍是旧 Hand-first，新行为只在显式 opt-in 内核。拟用的 schema8 `optional-unit-physical-chain-v4` **尚未启用**，schema1–7 字节不改。
- Recruit TokenPlay 333/334（nominal 预约 / 重入 / tombstone / prepaycancel / 未定费恢复）已入 Core 并经 783 验证；canonical tokenChain / publicHold / afterpaid rollback 与正式 whole-source adapters **仍未完成**。

**仍开放的门槛**

- 完整官方效果、current FinalPoint 闭包、Windows NSIS 与 Windows 实际运行、clean Git 均未完成；原 23 项整体仍 active。
- 私有 probe B 的“人工 Main”是机制 fixture，不是正式回合。HEAD `8d3929da` 为 detached + dirty，原 checkout 未动、未 commit / push / deploy；tar 快照或 unsigned mac `.app` **不能**当作干净 Git / Windows 安装包证明。
- 旧 full-product life / health / attack 模板的 quarantine 依然适用其自身模块；正式有限 P4 是另一条路径——不能把该 quarantine 错套所有现 Duel 源码，也不能反过来解除旧模板隔离。
- 新链内核已合入70项聚焦回归，当前全量重跑中；不能把下列2632历史快照当作新内核完整验收，也未完成公开接线。

## 1. Rule Version Boundary

As of 2026-10-12:

| Boundary | Status | Source |
| --- | --- | --- |
| Active Core Rules | `v1.4`, last updated `2026-07-16` | Official Rules Hub and Core Rules v1.4 |
| Published future Core Rules target | `v1.5 / Radiance`, last updated `2026-10-09`, effective `2026-10-16` | Official Rules Hub and Radiance patch notes |
| Published future Tournament Rules target | dated `2026-10-09`, effective `2026-10-16` | Official Tournament Rules changelog |
| Radiance product release | `2026-10-23` | Official Rules Hub / patch notes |

Official entry points:

- <https://playriftbound.com/en-us/rules-hub/>
- <https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/>
- <https://playriftbound.com/en-us/news/announcements/october-2026-tournament-rules-changelog/>
- <https://playriftbound.com/en-us/news/rules-and-releases/vendetta-rules-faq-and-clarifications>
- Future Core Rules v1.5 PDF: <https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf>
- Future Tournament Rules PDF: <https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/861752822d217edf37d9febaeaf77a7d924c1bb6.pdf>

Repository hashes for reviewed artifacts:

| Artifact | SHA-256 |
| --- | --- |
| Core Rules v1.4 | `9c5fb8b8638f2cd19ceda237929fa2c37aac23c797cc7410294993470ba5a30b` |
| Core Rules v1.5 / Radiance | `94d41fee86f88b61c4157c0389c0595d990b98e5b42555c99d9f649ee64d1fec` |
| Tournament Rules | `ce07da4fb632526afbbce7f058287a57e7444fa6bde17b0938ff52ce3fab3d07` |

Rules that differ between v1.4 and v1.5, notably the changed `ignored` / `Ignored` / `Negated` terminology and related replacement semantics, must remain v1.4-only until v1.5 is effective. Timestamps ending at `T00:00:00.000Z` in project serialization are implementation assumptions, not an official midnight-effective-time claim.

## 2. Executive Finding

> （历史记录，原始日期 2026-10-12 / 2026-10-13）本书写的 quarantine 结论仍适用其自身模块（full-product life/health/attack 模板与 foundation 别名）；但“无 GUI、无公开房间”等表述是其写作时状态，**不是 2026-10-15 当前状态**，见第 0 节。

The current full-product engine in `packages/engine-core/src/full-product/runtime.ts` is an experimental life/health/attack template and is not an official Riftbound runtime. It must not be exposed, selected, or advertised as official Riftbound gameplay.

The server adapter says this explicitly: `apps/game-server/src/full-product/runtime-adapter.ts:65` calls it an "Experimental life-based combat adapter, NOT the official Riftbound runtime." The adapter projects `score: player.life` at `runtime-adapter.ts:248` and labels natural endings `life-zero` at `runtime-adapter.ts:179`; those are compatibility projections, not evidence that score, Control, Conquer, or Hold are implemented.

Nonconformance in `packages/engine-core/src/full-product/runtime.ts`:

- Card definitions use `attack` and `health` at lines 41-46.
- Players use `life` at lines 75-78.
- The runtime accepts `declare-attack` at lines 94 and 162, permits a target unit or literal target `"player"`, and resolves declared attacks at lines 490 and 660.
- Loss is based on `life <= 0` at line 878.
- It effectively supports only `unit` and `spell` at lines 219-224, while `battlefield`, `rune`, `champion`, and `legend` appear as type labels rather than full official game-object implementations.
- `defaultMaximumBoardSize` is 6 at line 219. A generic board-size counter is not a Base/Battlefield Count model.
- There is no official Score, Base, Battlefield Location, Control, Contested, Conquer, Hold, Focus, Showdown, Combat Damage assignment, Deathknell, or cleanup victory state machine.

The protocol also aliases `FULL_PRODUCT_RULESET_ID` to the foundation identifier, and one translated event still emits `rulesetId: "riftbound-foundation"` at `runtime-adapter.ts:624`. These aliases are wiring plumbing, not official-rules coverage.

**已实现边界（2026-10-12 增补、2026-10-13 事实增量）。** 上述 quarantine 结论对 `packages/engine-core/src/full-product/runtime.ts`（life/health/attack 模板）与 foundation 别名仍然成立。但需要更正一处“完全不存在”的过度表述：`packages/engine-core/src/duel/` 现已正式包含一组**内部 duel 纯内核**——`battlefields.ts`（board/Location/Contested/Control 数据结构）、`setup.ts`、`resources.ts`、`scoring.ts`、`printed-costs.ts`、`movement.ts`、`match-state.ts`、`draw-burnout.ts`，并经 `src/duel/index.ts` 单一出口暴露（barrel 84 导出）。截至 **2026-10-13** 另增 `turn-start.ts`（7）、`turn-flow.ts`（8）、`ending.ts`（历史 88 落地 12 → 99 修复后当前 15）三个**内部 trusted 执行器 seam**（Start-through-Main / Ending-Expiration）；该段对正式 dist 的核心套件为 **actual 434/434 pass**（**2026-10-13 快照，非当前值**；当前包计数见第 0 节）。因此旧文中“所有 location/control/8 分/setup 完全不存在”不再准确：它们以**内部内核**形式存在。Standard Move（CR 144/810）17 例已由 `duel-standard-move-promotion` 正式落地 `src/duel/movement.ts`；83/88 执行器缺 provider 时**一律 pending，绝不 no-op skip**；97 曾记录的跨回合链路 **FAIL**（见第 9 节）已由 99 修复、103 定点独立复核 **4 PASS**（限定 fixture-certified-no-effect 4 回合）。**该段写作时结论为“没有 GUI 或公开房间接线、仍非公开可玩对局”；截至 2026-10-15 已有有限 P4 公开路径与真实双原生桌面运行（见第 0 节），但完整官方 CardPlay / public Hold / 所有能力执行仍未闭合，故“未达完整官方规则”的结论不变。**

**第八次刷新增补（2026-10-13 事实增量）。** 存储层新增**只读** `PersistentRoomArchiveStore.readArchives(roomId, afterArchiveSeq=0, limit=1000)`（108），按 `FileEventStore` 日志 seq 顺序返回已校验、detached 的 `{archiveSeq, archive}[]` + `hasMore`/`nextCursor`；它是 **opaque 私有历史流**，**不认证 owner/CardIR**、**不判断迁移合法性**、**不是游戏规则 event replay**、不对外 HTTP/ws 暴露，**未**改变本报告任何 quarantine 结论或 `judge-required` 立场。109 只读核对证明真实 live room `05715086` 归档**具备迁移输入**（genesis=log seq 6 / tail=seq 70），但**未做任何自动迁移或 state 变更**。该只读 API 与 31 个针对测试**已由 Root 正式验收**（真实源码 + 定向 typecheck 0）；**而全 server 套件/typecheck 当前 snapshot 仍不能报 PASS**（`apps/game-server` tsc exit 2，错误全部在 `room.ts`，来自未完成的 102 新 protocol types；108 本文件 0 错误），**待 102 稳定后验收**。

## 3. Official Core Rules v1.4 Baseline

The following short rule references are sufficient to define the required convergence target. They do not reproduce full official text.

| Official area | Core Rules v1.4 reference | Required state/action |
| --- | --- | --- |
| Base | `107.1` | One player Base; it is a Location; controlled Permanents and Runes reside there |
| Battlefield Zone | `107.2` | Houses multiple Battlefields; each Battlefield is individually a Location |
| Board Unit location | `141.1`, `146.1` | A Board Unit is at a Battlefield or its Base; its Location is the currently occupied Base or Battlefield |
| Contested | `190.3` | Applied when an opposing Unit becomes present; persists until Control is established/re-established subject to cleanup |
| Battlefield Control | `190.4` | Established at the end of Combat/Showdown when Units remain; maintained/lost under specified conditions |
| Cleanup victory | `194.2`, `194.3` | Cleanup checks Victory Score; default Victory Score is 8; winner must be unique |
| Beginning scoring step | `315.2.b` | Turn player Holds all controlled Battlefields |
| Showdowns | `316.8` | Combat and Non-Combat Showdowns; structured opportunity for Action/Reaction |
| Focus | `464.2.d` | Attacker gains Focus at Combat/Showdown opening |
| Combat Damage | `465.2` | Uses current Might; assignment and dealing are distinct and damage is dealt simultaneously after assignment |
| Control after Combat | `466.5` | Remaining Units establish Control; establishment can result in Conquer |
| Scoring | `468`, `469.1`, `469.2` | Scoring is Conquer or Hold of Battlefields |
| Final Point | `471.1` | Additional restriction applies to Conquer, not every point source |
| Score triggers | `471.2` | Score, Conquer, and Hold Battlefield abilities trigger when Scored |
| Cleanup win check | `472` | Reach Victory Score and have more points than every opponent in cleanup |
| 1v1 Duel | `485.3`, `485.4` | Victory Score 8; Battlefield Count 2; each player provides 3 Battlefields and only 1 is used, chosen during setup |
| Deathknell | `808.1.d` | Triggers on Killed and sent to Trash; replacements remove pending trigger; source details are snapshotted before movement |

No v1.5/Radiance semantic may replace a v1.4 behavior before `2026-10-16`.

## 4. Coverage Matrix

### 4.1 Implemented

These are implemented only at the stated repository boundary. They are not a complete official ruleset.

| Capability | Evidence | Boundary |
| --- | --- | --- |
| Canonical identity grouping for deck copy counting | `apps/game-server/src/card-catalog.ts`; `constructed-policy.ts:239-268` | Same official English `fullName` maps to one canonical identity |
| Constructed zone sizes and copy pools | `constructed-policy.ts:428-453` | Main Deck + Chosen Champion = 40; Legend = 1; Champion = 1; Runes = 12; Battlefields = 3; Sideboard = 0-10 |
| Default canonical copy limits | `constructed-policy.ts:126-133`, `432-442` | Main/Champion/Sideboard and Legend pool default 3; Runes 12; Battlefields 1 |
| Canonical copy counting across zones | `apps/game-server/src/deck-validation.ts:560-615` | Bans, restricted/limited policies, and canonical counts are enforced |
| Prompt blocking and judge-required refusal | Old foundation evidence in `packages/engine-core/src/index.ts`; server foundation adapter | A judge-required card blocks automatic approximation instead of guessing |
| Server-side versioning and idempotency plumbing | Full-product room/orchestrator tests | Does not make the underlying engine official |
| Duel board kernel (Location/Contested/Control 内部结构) | `packages/engine-core/src/duel/battlefields.ts`; `test/duel-battlefields.test.mjs` | 内部 board 纯内核；每座 3 张 printing 互异、per-seat identity 校验；无官方 Combat/Showdown 编排 |
| Duel setup kernel | `packages/engine-core/src/duel/setup.ts`; `test/duel-setup.test.mjs` | 洗牌/调度/mulligan/选 Battlefield 的纯内核 + DTO；未接线 stage→playing 原子切换 |
| Duel resources kernel (+DFS oracle) | `packages/engine-core/src/duel/resources.ts`; `test/duel-resources.test.mjs`; `test/duel-resource-allocation.test.mjs` | 符文费用支付纯原语；独立 DFS 可行性 oracle 1161 案例 0 mismatch；无房间支付命令 |
| Duel scoring kernel | `packages/engine-core/src/duel/scoring.ts`; `test/duel-scoring.test.mjs` | Conquer/Hold、once-per-Battlefield-per-turn、Final Point、cleanup 唯一领先者，`victoryScore` 默认 8；不跑 phase/turn、不结束对局 |
| Duel printed base-cost binding | `packages/engine-core/src/duel/printed-costs.ts`; `test/duel-printed-costs.test.mjs` | 只绑定 printed base cost（真实 catalog numeric 1119 / not-played 262）；不含费用修正/能力费用 |
| Duel Standard Move kernel | `packages/engine-core/src/duel/movement.ts`; `test/duel-standard-move.test.mjs` | CR 144.1-144.4 单组 Move + 810 Ganking（Battlefield→Battlefield）；Standard Move 是 420.3 自主动作（Discretionary，区别于 420.2 的 Limited Move Effect），由 312 的 Priority（Neutral Open Main Phase 归 Turn Player）门禁，timing 需 actor 同时为 turnPlayerId 与 priorityPlayerId；未接公开 Move/trigger/cleanup 命令面，merely-staged Showdown 放行为既定契约（开放问题保留） |
| Prompt 选项安全投影（旧隐藏目标泄露修复） | `packages/engine-core/src/index.ts`（`currentPromptOptions`/`safeOptions` 约 428-435、1416）；`test/legacy-prompt-target-policy.test.mjs` | 15 条新增回归；非法/私有/stale/当前非法 option 与 response 共享同一安全集；0 合法选项时 prompt 投影 `null` 而 `waitingForPlayer` 保留 |
| Duel turn-start kernel（Awaken/Beginning，内部） | `packages/engine-core/src/duel/turn-start.ts`; `test/duel-turn-start.test.mjs` | CR 315.1–315.4 / 316.1–316.4 / 430–431 的内部 trusted seam：Awaken、readiness、beginning、Hold/Channel/Draw；缺 provider → pending（**绝不 no-op skip**）；**未接公开 server/turn 命令** |
| Duel turn-flow kernel（Start-through-Main，内部） | `packages/engine-core/src/duel/turn-flow.ts`; `test/duel-turn-flow.test.mjs` | `awaiting-turn-start → awaken → beginning → Hold → Channel → Draw → Main`；trusted/resumable flow cursor（仅 step/task ID），首 Channel 按 player 身份持久化，Main 清双方池后才给 Priority；**未接公开 turn 命令；97 跨回合链路 FAIL 已由 99 修复、103 复核 4 PASS（第 9/10 节，限 fixture 4 回合）** |
| Duel ending kernel（Ending/Expiration，内部） | `packages/engine-core/src/duel/ending.ts`; `test/duel-ending.test.mjs` | CR 323.1/323.2 / 467–472 / 485.7：special cleanup 次序（pre-kill snapshot→Kill→Heal→同时「本回合」expiration→清双方 Rune Pools→FEPR）；缺 provider → pending；**未接公开 server/wire** |
| V2 public projector（公开投影） | `packages/engine-core/src/duel/projection-v2.ts`（`projectCanonicalDuelMatchV2`，duel barrel 已导出）；`test/duel-projection-v2.test.mjs` | 逐字段公开投影（setup/playing/pendingPayment）；**不读** provenance/physicalCardsByUID/legendStates/gears/session ledger；**不认证 viewer、未接 server/client/archive**；独立审查 P0/P1 无、P2×3（未拒非 V2 authority，可为 V1 快照贴 V2 标；board Gear 无公开载体；Legend 控制/readiness 无公开载体） |
| Server V2 runtime facade | `apps/game-server/src/duel/runtime-v2.ts`; `tests/duel/runtime-v2.test.ts` | session 工厂/投影/命令/turn 转发的完整 facade；**zero-wired**：`room.ts`/`server.ts`/`file-room-store.ts`/`room-store.ts` 对 V2 符号零命中；生产 provider（trustedCardType/sources/sourceAttestor）刻意不发布；durable V2 restore 不可实现（须 fail-closed） |
| V2 catalog 卡型角色修复 | `v2-catalog-card-type-role-fix`（`verification.md`） | Unit+精确 `Champion` tag → Champion（chosen 与 main-deck physical origin 一致）；Spell → Other；Gear/Rune/Battlefield 保留精确类型；token/invalid/unknown/duplicate fail closed；resolver 只证 **printed type**，不证 Champion family 有效性或整卡组合法性 |

以上 Duel 内核是**源码级正式落地**（`src/duel/index.ts` 单一出口，注释明确无 `DuelGame` 工厂），strict `typecheck --noEmit` exit 0；截至 **2026-10-13** 对正式 dist 的核心套件 `node --test --test-reporter=tap test/*.test.mjs test/full-product/*.test.mjs` 为 **actual 434/434 pass / 0 fail**（第九次刷新口径，`v2-catalog-card-type-role-fix/engine-full.tap`；此前 248/245/182 为旧快照，248 仅计 duel kernel 子集；board 16 + setup 15 + resources 13 + DFS 1 + scoring 14 + printed-costs 8 + Standard Move 17 + constructor 7 + draw-burnout 12 + turn-start 7 + turn-flow 8 + ending 15 + 其余既有 + V2 系列）。这是**组件/包快照**，不等于公开服务/真实玩法接通；97 曾记录的 83/88 跨回合链路 **FAIL** 已由 99 修复、103 独立复核 4 PASS（见第 9/10 节，限 fixture-certified-no-effect 4 回合）。

`apps/game-server/src/card-catalog.ts`（`loadCardCatalogRuntime` 约 600-617 行）显示实际 catalog 运行时使用 constructed-policy 规则。`PARTIAL_DECK_RULES` in `deck-validation.ts:141-146` 仍带一个未接线的 Sideboard `10-10` 值及 "sideboard is 10 cards" 注释；这是审计缺陷，应协调或从活跃路径移除（现行 constructed-policy 的 sideboard 仍为 0-10，未改）。

### 4.2 Partially Implemented

Old foundation evidence is reusable as a seed, not as an official rules implementation:

| Foundation concept | Evidence |
| --- | --- |
| Player score | `packages/engine-core/src/state.ts:148`; initialization at `packages/engine-core/src/index.ts:637`; `gain-points` around `index.ts:1240`; score victory checks around `index.ts:1450-1505` |
| Base / Battlefield zones | `packages/engine-core/src/state.ts:10-27` and `154-156`; initialization/loading/projection around `index.ts:637-699` and `517-527` |
| Battlefield capacity | `packages/engine-core/src/state.ts:100-104`; default at `index.ts:238-240`; no runtime enforcement found |
| Priority and prompt | `packages/engine-core/src/state.ts:205-215`; initial priority at `index.ts:247-279`; pass rotation at `index.ts:869-885`; playable gating around `index.ts:1580-1592` |
| Judge-required blocking | `packages/engine-core/src/state.ts:56-61`; task creation around `index.ts:1029-1042`; prompt around `1344-1349`; refusal around `1204-1213` |
| Synthetic trigger | `packages/engine-core/src/index.ts:1115-1129` and `1342-1354`; this is not official Battlefield Conquer |
| Server foundation boundary | `apps/game-server/src/foundation-game.ts:19-41`; official-text/multi-type/rune/token-like cards are blocked as judge-required around lines 135-164 |

| Capability | Current behavior | Official gap |
| --- | --- | --- |
| Score | Old foundation has player `score`, `startingPoints`, `targetPoints`, and score victory; full-product adapter projects `score` from `life` | 内部 `src/duel/scoring.ts` 已实现 Conquer/Hold、once-per-Battlefield-per-turn、Final Point、cleanup 唯一领先者（纯内核，`victoryScore` 默认 8）；full-product 生命值运行时仍以 `life` 投影，未接该内核 |
| Base / Battlefield zones | Old foundation models `base` and `battlefield` zones and initializes/projects them | 内部 `src/duel/battlefields.ts` 已有 Location/per-Battlefield Control/Contested/Board Unit location 结构（纯内核）；未接入任何运行时/工厂 |
| Battlefield capacity | Old foundation has `battlefieldCapacity` with default 5 | No runtime capacity enforcement; capacity 5 is also not the official 1v1 Duel Battlefield Count 2 |
| Turn/priority machinery | Old foundation has active/priority rotation and prompt blocking; full product has a template turn loop | 内部 setup kernel 已含 shuffle/mulligan/首玩家/选 Battlefield（纯内核）；channel、首回合 draw/后手额外 Rune、HOT FEPR、Focus、Chain、Showdown、Combat、cleanup 固定点均未实现 |
| Automatic trigger concept | Old foundation has a synthetic optional `trigger-conquer` demo task and prompt | Not official Battlefield Conquer; no general triggered-ability, pending-chain, replacement, or Deathknell lifecycle |
| Full-product room orchestration | Two seats, deck validation, ready gating, start, reconnect/replay, idempotency, and result are tested | Orchestrator and adapter are not wired into the public WebSocket room lifecycle |
| EffectIR execution | Experimental runtime accepts eight opcodes | Not connected to official card pool; opcodes are not sufficient official semantics |

The old foundation can seed score, zone, prompt, and blocking patterns, but its synthetic trigger must not be renamed or reused as official Conquer.

### 4.3 Judge-Required

An item is `judge-required` when official behavior is known to exist but the implementation cannot automatically and verifiably execute it. It is not a fallback approximation.

The current classification includes:

- All official card ability text outside explicitly verified compiler and runtime coverage.
- Any official card whose text references location, Battlefield, Control, scoring, Combat, Showdown, Deathknell, replacement, hidden information, or target legality semantics not represented by the runtime.
- Any v1.4/v1.5 semantic difference that cannot be resolved from the effective official version.
- Any official judge or FAQ interpretation not present in the reviewed sources.
- Any ambiguity in whether an empty ability text printing truly has no ability; `no-ability` is a text classification, not proof of an official rules absence. Basic Runes still have inherent abilities under Core Rules `164.2`.

A card may leave `judge-required` only when all of the following close the loop: official text source, canonical identity, effect IR, deterministic runtime mechanism, version boundary, and focused tests. Experimental opcode support alone never changes the classification.

### 4.4 Explicitly Not Implemented in Any Connected Runtime

状态列区分“内部纯内核已落地”与“运行时/产品接通已落地”；内核落地不等于对局可玩（见第 2 节与 4.1）。

| Official capability | Status |
| --- | --- |
| Official Base/Battlefield Location model | 内部内核已实现（`src/duel/battlefields.ts`）；**未**接入任何运行时/工厂，full-product 生命值运行时仍无 |
| Contested and Battlefield Control | 内部内核已实现（board 的 controlled/contested 结构）；无官方 Combat/Showdown 建立/清理编排 |
| Conquer and Hold scoring | 内部 `src/duel/scoring.ts` 已实现 Conquer/Hold/once-per-turn/Final Point/cleanup 领先者；无 phase/turn 执行器 |
| 8-point 1v1 Duel Victory Score configuration | 内部 scoring kernel `victoryScore` 默认 8（194.3）；无对局配置/启动接线 |
| Battlefield Count 2 and per-player 3-choose-1 setup | 内部 setup kernel 已实现 2 battlefield + 每座位 3 选 1；未接 stage→playing 原子切换 |
| Official setup: shuffle, mulligan, first player, Battlefield selection, channel, draw | shuffle/mulligan/首玩家/选 Battlefield 已在 setup kernel；**首回合 Channel/Draw 已在 turn-start/turn-flow 内部 seam（缺 provider → pending）**；后手额外 Rune、公开 channel 命令未接 |
| HOT FEPR and full priority transfer | 仅 **Ending/Expiration 内部 seam 含 partial FEPR/cleanup**（`ending.ts`，纯内核，未接公开）；完整 priority transfer 未实现 |
| Focus | Not implemented |
| Combat and Non-Combat Showdowns | Not implemented（movement kernel 只拒绝 active Showdown/Combat，不建立/结束 Showdown） |
| Official Combat Damage assignment and simultaneous dealing | Not implemented（CombatDamage 拆分件进行中、未验收） |
| Standard Move（144）/ Ganking（810）单组移动 | 内部 `src/duel/movement.ts` 已实现（含 per-seat readiness 校验、原子性、无占用上限）；未接公开 Move 命令/触发/cleanup |
| Cleanup fixed point and unique-leader victory | 唯一领先者查询在 scoring kernel 内；**Ending seam 有 partial cleanup/FEPR（内部）**；完整 cleanup 固定点执行未实现 |
| Deathknell trigger, replacement check, death snapshot, pending-chain removal | Not implemented |
| Official Battlefield/rune/champion/legend object behavior | Not implemented as a full state machine |
| **Canonical permanent registry：Legend/Gear/ownership/attachments authority** | **仍缺**（90 取证）：Legend/Champion 仅 `{uid,cardId}`；**Gear / attachedGear 完全无对象**；readiness 只认 unit/rune/gold；需 `{objectId,cardId,cardType,owner,controller,location,readied,trait/attachment}` |
| **Trusted production readiness / 可执行 effect IR / CostResolver 与 source attestation** | 未接：`AbilitySource` 的 digest 仅 transport 元数据、**未加密再验**；engine-core 零 import card-dsl；缺 source IR 时含 ledger 的档案 **fail closed / 不可恢复** |
| **Official turn 公开命令面 & 完整 gameEvents replay** | 未实现：server 只到 `awaiting-turn-start`，无真实 CardPlay/Move/Combat/EndTurn 公开命令面与可重放全事件流；**97 跨回合链路 FAIL 已由 99 修复、103 复核 4 PASS（第 9/10 节，限 fixture 4 回合）** |
| **Private 83/88 turn/ending cursor 的 archive 注册/恢复** | 未实现：server src 未引用 `turnFlow`/`endingProgress`（生产恢复无法重建该 cursor）。**第八次刷新**：108 新增只读 `PersistentRoomArchiveStore.readArchives`（有序、可续页、detached 的 **opaque 私有历史流**，**不认证 owner/CardIR**、**非 MAC**、**非 event replay**）仅作**输入**；109 证 live `05715086`**具备 migration input**（genesis=seq 6）但**未迁移**；迁移合法性/重放接线**未做** |
| Domain Identity restrictions | **已按 CR 103.1.b.2-4 / 103.2.c / 103.3.a.1 / 103.4.b 在 `constructed-policy.ts` 正式实现**；sideboard 是否适用 CR 103 未明文，仍为未核验限制 |
| Champion/Legend/Signature restrictions | **已按 CR 103.2.a.2 / 103.2.d 正式实现**（含 named champion family 解析、Signature 合计 ≤3、Signature 不得进 Champion 区）；自相矛盾/0 或多候选 family 一律 `identity_metadata_unavailable`（fail-closed） |
| Independently verified regional product availability | Explicit policy limitation（`constructed-policy.ts` 的 `regional-product-availability`，未独立核验） |
| Colorless 域 / effect-added-cards / 复杂 replacement 语义 | 未核验，仍 unknown（`colorless-domain`、`effect-added-cards` 限制保留） |
| **V2 phase source closure 接线** | **仍未接**（`phase-closure-turn-seam-audit`）：`phase-source-closure-v2.ts` 是契约完备、**权威为零的孤儿**——`turn-executor-v2.ts:254` 只调 `authority`（`inspectDuelPhaseSourcesV2`），从不调 closure；closure 未被任何 barrel 导出；`phase-closure-evidence-v2.ts` 已落盘但 **未从 `duel/index.ts` 导出**；把 closure 放进现有 `cover()` 时机会对 `draw`/`channel`/`lethal-kill` **永久 pending（死锁）**；阻塞 B1–B10，缺生产 DSL→engine 适配器 |
| **公开 room 的 V2 runtime/投影** | **仍未接**（`room-v2-cutover-impact`）：公开 room 仍构造 V1 `DuelCommandSession`；`runtime-v2.ts` 已可用但 **zero-wired**；V2 session 是内存 capability（"unadmitted V2 session; JSON is not restore"），`session-archive.ts` 仍为 V1 schema1，durable V2 restore 当前**不可实现**，遇 V2 archive 须 **fail-closed** |

## 5. Card Data and EffectIR Coverage

Current coverage data in `packages/card-data/data/effect-coverage.json`:

| Metric | Count |
| --- | --- |
| Printings | 1,381 |
| Canonical identities | 1,080 |
| Executable effects | 0 |
| Judge-required effects | 1,348 |
| Empty-text / no-ability-classified effects | 33 |

该文件现存字段为 `schemaVersion 1 / printingCount 1381 / canonicalIdentityCount 1080 / executableCount 0 / judgeRequiredCount 1348 / noAbilityCount 33`。`src/duel/printed-costs.ts` 的 printed base cost registry（真实 catalog numeric 1119 / not-played 262）与 Ganking 等 ability 绑定只是**局部**费用/移动绑定，**不得**计成卡牌能力可执行；cardAbility 覆盖仍是 **0 executable / 1348 judge / 33 noAbility**。`noAbility` 33 由 Rune 24（真实 Basic Rune 空文本，规则固有能力属 CR 164.2）+ Unit 9（空文本但仍需对象模型）构成，属文本分类，非“无官方规则”。

The experimental full-product IR accepts these eight opcodes in `packages/card-dsl/src/full-product/types.ts` and executes them in `packages/card-dsl/src/full-product/runtime.ts`:

`cost.energy`, `draw.cards`, `gain.energy`, `gain.score`, `move.zone`, `prompt.target`, `chain.create`, `judge.required`.

This is schema/runtime support only. It is not wired to the official card pool and does not implement official Combat, Showdown, scoring, location, trigger, replacement, or DeathIR semantics. Therefore executable official-card coverage remains zero.

Room persistence work does not alter this coverage result. It only affects foundation/synthetic room durability and must not be counted as official rules implementation.

Earlier documentation mentioning four synthetic-demo opcodes describes a different, smaller experimental surface. The current full-product IR has eight opcodes; neither count is official card-pool coverage.

The maintained local `(rulings)` collection is non-official and is not treated as authoritative. The official Vendetta FAQ entry is a source, but each case must be separately verified and cited before it can alter runtime behavior; otherwise it remains `judge-required`.

## 6. Canonical Printing and Deck Rules

Canonical identity is derived from official English `fullName` in `constructed-policy.ts`. Alternate art, reprints, promos, and cross-set same-name printings share a canonical ID and merge for copy counting. This is the implementation's interpretation supported by Core Rules `132.3` / `132.4` and Tournament Rules `601.2.a`; the implementation does not independently claim an official "alternate art" clause.

Current default copy pool:

- Main Deck, Champion, and Sideboard: default 3 copies per canonical identity.
- Legend: default 3 copies per canonical identity.
- Rune Deck: default 12 copies per canonical identity.
- Battlefields: default 1 copy per canonical identity.

Current structure:

- Main Deck + Chosen Champion: exactly 40.
- Legend: exactly 1.
- Champion: exactly 1.
- Rune Deck: exactly 12.
- Battlefields: exactly 3.
- Sideboard: 0-10 in the active constructed policy.

The validator enforces canonical copy counts across configured zone groups at `deck-validation.ts:560-615` and requires distinct canonical identities in Battlefields at lines 630-638. Domain Identity 与 Champion/Legend/Signature 限制已按 CR 103 在 `constructed-policy.ts` **正式实现**（不再是“未实现”）；仅 regional product availability、sideboard 域归属、Colorless 域与 effect-added-cards 仍为未核验限制。

### 6.1 真实 catalog 身份核验（2026-10-12）

- 真实 `packages/card-data/data/deck-catalog.json`（`dataVersion=2026-10-12-official-gallery`，1381 printings）：Legend **143/143**、Signature **60/60** 均可唯一定 family，未决 **0**；named champion tag 名集 **104**，`Yordle`/`Dog`/`Shurima` 等地区/生物 tag 不参与匹配；0 或多候选一律 `identity_metadata_unavailable`（fail-closed），不猜 family。
- `ogn-235-298 Karma, Channeler` 的原生 tags 自相矛盾（`Vi` vs `Karma`）已通过 versioned reviewed tag correction + 正式 regenerate 修复：全库唯一字段级变化为该卡 `tags ["Vi","Ionia","Champion"] → ["Karma","Ionia","Champion"]`，内部 digest `sha256:53b974c8…4d10`（`dataVersion` 未变，1381/1381 imageUrl 未变）；raw snapshot `dist/cards.json` 未被修改。
- 重要限制：真实 catalog 中**不存在 Karma Legend**（143 Legend 无 Karma tag），Karma canonical 仅 3 张 Unit printing，因此**不能**声称真实的 Karma 主题卡组可完整合法构筑。因果验证用 in-memory 合成 Legend 探针完成，并已明确标注非真实 catalog 数据。
- 截至 2026-10-12 仍生效的 pre-2026-10-16 Tournament Rules 全文尚未核验；2026-10-09 发布、2026-10-16 生效的新 TR 是未来目标，不作为当前规则。sideboard 保持 0..10、`tournamentComplete=false`，**不得**用旧 Jan-8 版本替换，也不声称 tournament 完整。region product availability、Colorless 域、effect-added-cards、复杂 replacement 语义仍为 unknown/未核验。

## 7. Convergence Plan

（说明：第 2-4 项中的一部分状态与内核已作为**内部纯内核**落地，见 4.1；但尚未有工厂/编排把它们接成可玩对局，故本清单的收敛目标未变。Startup/Channel/Draw、Combat/Showdown、Deathknell、能力执行与公开房间接线仍全部待做。）

1. **Quarantine the template.** Keep the life/health/attack runtime experimental. Do not bind it to the public room lifecycle, package it as official Riftbound, or map `life` to `score`.
2. **Model official state.** Add score, Base, multiple Battlefields, Location, per-Battlefield Control, Contested status, current Might, turn-score tracking, and official object types as first-class state.
3. **Implement 1v1 Duel configuration.** Victory Score 8, Battlefield Count 2, and each player providing 3 Battlefields with one selected during setup.
4. **Implement setup.** Shuffle, mulligan, first-player selection, Battlefield selection, rune channeling, and initial draw must be deterministic and replayable.
5. **Implement turn machinery.** HOT FEPR, priority transfer, Focus, Chain, replacement checks, Cleanup fixed point, Showdown, and Combat must follow Core Rules v1.4.
6. **Implement scoring.** Hold in the Beginning Phase, Conquer on Control establishment, once per Battlefield per turn, Final Point restrictions, Score/Conquer/Hold triggers, and cleanup unique-leader victory.
7. **Implement Deathknell correctly.** Snapshot location and relevant details before movement, check replacement effects, add pending trigger before Trash movement, and remove pending trigger when the Kill/movement is replaced.
8. **Keep unknown card effects blocked.** Unsupported official text remains `judge-required`; no plausible approximation, inferred ruling, or unverified v1.5 semantics.
9. **Reuse foundation ideas only where valid.** Score/zone/prompt/blocking patterns can seed implementation; synthetic `trigger-conquer` cannot be treated as official Conquer.
10. **Gate release on official action tests.** Official state transitions need deterministic tests for setup, scoring, Combat/Showdown, Final Point, triggers, Deathknell, reconnect/replay, and private information.

## 8. Review Gates

Before the runtime can be called official Riftbound:

- Core Rules v1.4 references are bound to implementation and tests.
- Every rule in section 4.4 is moved only after implementation and focused tests.
- `judge-required` remains the only path for unverified official card effects.
- Card data coverage only counts a printing executable when the full semantic loop is closed.
- No full-product projection uses `life` as official `score`.
- 内部 Duel 内核（4.1，engine-core 核心套件 **434**，对正式 dist，第九次刷新口径；含 turn-start/turn-flow/ending seam 与 V2 系列）落地**不**等于官方运行时接通；在没有 `DuelGame` 工厂、公开 turn/phase 编排、能力执行与公开房间接线之前，不得据此声称可玩对局完成。**`434/64/335`（engine-core/protocol/desktop）与 server `251`（29 files，主控实测；支撑 artifact 由主控补落）均为组件/包快照，不是 full-workspace / 远程 CI / native 证明。**
- **83/88 跨回合（97 FAIL → 99 修复 → 103 复核）**：`duel-turn-flow-ending-independent-review`（97）曾记录跨回合链路 **FAIL**（`runDuelEndOfTurn` 恒 `task-conflict`，第二回合 End 被拒）；`duel-ending-cross-turn-cursor-fix`（99）修复后，`duel-cross-turn-targeted-independent-review`（103）定点复核 **4 PASS**，`raw.jsonl` 机读 `passed:4, failed:0`。**PASS 严格限定为已修复的 fixture-certified-no-effect 普通 Duel 4 回合链路**，非生产 IR/provider/source attestation 完整，不背书 extra/queued turn、card IR、完整 FEPR、生产恢复或 GUI；在公开 turn 命令面接线前不得把 83/88 写成回合流程完成。
- **canonical 永久物 authority / trusted provider / source attestation 未接**（4.4）：Gear/attachedGear 无对象，`AbilitySource` digest 未再验；缺 provider 一律 pending，含未认证 source 的档案 fail closed。
- Staged-only 产物（`outputs/.../task-artifacts/*/staged`）在正式合入 `src/duel` 并跑通真实日志前，不计入测试基线、不标记为通过；只把测试文件/源码放进 CI 目录本身也不构成“已实现”。
- **私有归档读取与创建溯源（第八次刷新）**：108 `readArchives` 是只读 **opaque 私有历史流**，不等于认证（可被整体重写 + 重算校验和绕过；是 corruption/shape 检查，**非 MAC**），**不认证 owner/CardIR**、**不判断迁移合法性**、**不是官方游戏 event replay**；**全 server 套件/typecheck 因 102 `room.ts` 未完成 exit 2，故全 server 套件不得报 PASS（108 只读 API 本身已验收）**。109 只读核对**仅证明** live `05715086` 归档**具备迁移输入**（genesis=log seq 6、tail=seq 70、strict decoder ok、catalog/roster/seat-deck 一致），**未做任何迁移或 state 变更**，**不得**据此宣告 V2/迁移完成。**private journal 权限**：真实 `archive.log` 曾为 `mode=644`（含私有令牌），105 fixture 0600 **非通用保证**；Root 已对自己实际 regular 文件 fd-verified `chmod 600`（不读令牌），但**源码级默认/既有权限修复（110）尚未验收**（110 已非 prepared：`runs/private-file-permissions-wave110/status.json` 记自 `2026-10-12T20:47:21.918Z` 起 running、pid `99355`、assistant-model `gpt-6-sol`）。106 `duel-permanent-authority-module` 的 14/14 isolated-results **仅为未接线 internal candidate，不计入核心 248**。
- v1.5/Radiance changes are introduced only after their effective date and under a separate versioned test suite.

## 9. 2026-10-13 事实增量（组件/包快照）

本节只记录经 artifact 复核的事实增量，不改变第 2 节的 quarantine 结论或 `judge-required` 立场。

| 事实 | 证据 | 性质/边界 |
| --- | --- | --- |
| 83 Start-through-Main（`turn-flow` 8 + `turn-start` 7）、88 Ending（`ending` 历史 12 → 当前 15）进 src；103 对正式 dist 核心套件 **actual 248/248**（取代旧 245）、build+typecheck 0 | `…/task-artifacts/duel-cross-turn-formal-verification/{core-full-tests.tap,core-full-tests.summary.txt,report.md}`；第六次 245 见 `…/duel-turn-core-formal-build-verification/{core-full-tests.tap,report.md}` | 内部 trusted executor seam；**组件/包快照** |
| （历史）**97 曾记录 83/88 跨回合链路 FAIL**：`runDuelEndOfTurn` 恒 `task-conflict`，第二回合 End 被拒 | `…/task-artifacts/duel-turn-flow-ending-independent-review/{review.md,raw-probe.jsonl}` | 当时代码 FAIL；**已由 99 修复、103 复核 4 PASS（第 10 节）**，不再作当前状态 |
| game-server room archive 导入修复 + legacy 0-seat 兼容：full server **213/25 + typecheck 0** | `…/task-artifacts/duel-room-archive-integration-fix/{report.md,raw/full.log}` | 仅 `room.ts` 3 处；Duel 分支校验未放宽 |
| protocol `build` + game-server `tsc` **exit 0**（`apps/game-server/dist` 20 js） | `…/task-artifacts/duel-server-production-build/report.md` | 仅写 dist；未 commit |
| protocol 全包 `pnpm --filter @riftbound/protocol test` **47/47**（含 build）+ strict `tsc --noEmit` exit 0；纯包 fixture，无 engine-core 依赖 | `…/task-artifacts/duel-protocol-evidence-doc-count-fix/{report.md,rawlogs/}` | **纯包快照**；不代表 full-workspace CI（旧 21 为早期 snapshot） |
| Duel 本地卡图优先（显示层）→ desktop 正式 build 0；dist `index-FccGea0j.js`/`index-Dn_nryXp.css` | `…/task-artifacts/duel-local-card-images-build/{REPORT.md,build.log}` | 仅显示顺序；不改 authority |
| 修正过时 SSR 期望后 full frontend **294/25 + typecheck 0** | `…/task-artifacts/duel-local-image-route-test-fix/{report.md,full-frontend.log}` | 96 初跑 293/294 的 1 fail 为过时断言，非源码 regression |
| 真实 App（非 harness）Duel room `05715086`：两客户端对 compiled `:8794`，setup→双 mulligan→await，重启后可见状态一致；三档视口布局/10 本地图 | `…/gui-room-proof/{actual-duel-05715086-verification.json,actual-duel-layout-3-viewports.json}` | **非 Main / 非资源支付 / 非完整对局** |
| 93 private-room 边界审查 **PASS（8/2 files）** | `…/task-artifacts/duel-private-room-boundary-review/review.md` | **仅** setup→双 mulligan→await；不为 full turn/CardPlay/IR/native 背书 |
| 90 canonical 永久物 authority 缺口：Legend/Champion 仅 `{uid,cardId}`；**Gear/attachedGear 无对象**；readiness 只认 unit/rune/gold | `…/task-artifacts/duel-permanent-provider-evidence/{report.md,provider-input-map.json}` | 只读取证；**最关键缺口** |

官方 catalog 说明：真实 `packages/card-data/data/deck-catalog.json` 为 1381 printings / 1080 canonical，`dataVersion=2026-10-12-official-gallery`，内部 digest `sha256:53b974c8…4d10`（文件级 sha256 会因重生成/重序列化变化，内部 digest 稳定）。`effect-coverage.json` 仍为 executable 0 / judge-required 1348 / no-ability 33；`fullyBound=3 / partial=10 / unknown=1368`（card-dsl `./duel` 固定文本绑定 Census，**不是**全部能力已实现）。本地图片按 current observed 记录。

## 10. 2026-10-13 跨回合修复复核与并行任务增量（第七次刷新）

本节只记录经 artifact 复核的事实增量，不改变第 2 节的 quarantine 结论或 `judge-required` 立场。

| 事实 | 证据 | 性质/边界 |
| --- | --- | --- |
| 99 `duel-ending-cross-turn-cursor-fix`：`ending.ts` 严格 `parsedCursor` + 私有 `priorEndingTurns` sidecar；仅在上一回合真实 terminal + 当前真实 Main 就绪时创建新 Ending cursor；旧 task ID 只 `duplicate`、不重放 provider/RNG/资源 | `…/task-artifacts/duel-ending-cross-turn-cursor-fix/{report.md,focused-tap.log,after-probe.mjs,after-probe.jsonl}` | 已入 src（未 commit）；`ending.ts` sha `bb8293aa…`；修复 97 的历史 FAIL |
| 103 正式核心套件（正式 dist）`node --test --test-reporter=tap …` → **actual 248/248 / 0 fail**，build exit 0、strict typecheck 0；source pre==post、build 幂等、dist 仅 `.tsbuildinfo`+`duel/ending.{js,d.ts}` 变化 | `…/task-artifacts/duel-cross-turn-formal-verification/{core-full-tests.tap,core-full-tests.summary.txt,dist-hash.diff,source-hash-pre.txt,source-hash-post.txt,exit-codes.txt}` | 取代旧 245；**组件/包快照** |
| 103 定点独立复核 **4 PASS**：真实 `createDuelMatch`→双方 mulligan→Main1→**End1→Start2→End2→Start3→End3→Start4** 全 `awaiting-turn-start`；次玩家 Start2 首 Channel=3 后 2，累计 Base rune 3→5；三 Ending 双池清空、双 clock 成对；旧未完成/未知 ID `wrong-task`、已消费 ID（turn1/2/3）latest `duplicate`；16 项篡改原子拒绝；缺 provider 仍 pending | `…/task-artifacts/duel-cross-turn-targeted-independent-review/{report.md,raw.jsonl,probe.mjs}` | `raw.jsonl` = `passed:4, failed:0`；PASS 限定 fixture-certified-no-effect 普通 Duel 4 回合；**非**生产 IR/provider |
| 98 V2 设计 + Root 决定（`physicalCardsByUID`/`legendStates`/`gears`/`retiredPhysicalUIDs` 最小共享契约；CR124 全域/journal 创建证明/BF readiness override） | `…/task-artifacts/duel-permanent-canonical-contract/{contract.md,change-map.json,minimum-acceptance.json}`；`…/contracts/permanent-v2-root-decisions.md` | **design not implemented** |
| 106 新 authority 模块 `duel-permanent-authority-module`（`src/duel/permanent-state.ts`）**开发中** | wave106 派发；目标文件/artifact 尚未落盘 | **不是 V2 已切换** |
| 105 只读 journal 取证：底层 `FileEventStore.readEvents` 可读 genesis（含原始 UID/deck），但 `PersistentRoomArchiveStore` 只暴露 tail；未在真实 live v1 归档验证 | `…/task-artifacts/duel-creation-provenance-storage-evidence/{report.md,rawprobe.json,API-INPUT.md}` | **只读证据，未签收**；不能声称可自动迁移 live v1 |
| 101 F1 边界取证 + 104 修复：全失效目标 → public `prompt=null` 而 authority 仍 pending（残留可达） | `…/task-artifacts/legacy-prompt-authority-repair-evidence/report.md`（+raw-*.json） | **104 未签收** |
| 102 owner-deck-confirmation（新私人 owner 消息）：`packages/protocol/src/{owner-deck-confirmation.ts,index.ts}`、`apps/game-server/src/room.ts`、`apps/desktop-client/src/{net/GameClient.ts,decks/owner-deck-confirmation.ts}` 源改动进行中 | wave102 派发；artifact 尚未落盘 | **未完成**；故 **47 protocol / 213 server / 294 front 为过去已验收组件快照，不是当前 Source** |

边界（务必保留）：真实 public room 仍停在 **setup→双方 mulligan→`awaiting-turn-start`**；**Main 银行资源交互、CardPlay、移动/战斗、完整 replay / native / Windows 均未接**。103 的 4 PASS **不**等于生产 effect IR/provider 完整或 source attestation 已接。`434/64/335`（engine-core/protocol/desktop）均为**组件/包快照**，server 251（29 files，主控实测；支撑 artifact 由主控补落）；均不是 full-workspace / 远程 CI / native 证明。

## 11. 2026-10-13 存档历史读取与创建溯源 / 权限事实增量（第八次刷新）

本节只记录经 artifact 复核的事实增量，不改变第 2 节的 quarantine 结论或 `judge-required` 立场。

| 事实 | 证据 | 性质/边界 |
| --- | --- | --- |
| 108 新增只读 `PersistentRoomArchiveStore.readArchives(roomId, afterArchiveSeq=0, limit=1000)`：按 `FileEventStore` 日志 seq 顺序返回已校验、detached 的 `{archiveSeq,archive}[]` + `hasMore`/`nextCursor`；fail-closed 参数/cursor/事件 shape 校验；roomId 同实例绑定；不追加 / 不 mutation / 不 re-export / 无 HTTP-ws 引用 | `…/task-artifacts/private-room-archive-history-reader/{report.md,raw.json,rawprobe.json,probe.ts}` | **opaque 私有历史流**；**已落 src（未 commit）**；只读 API + 31 针对测试**已验收**，全 server 套件/typecheck 待 102 稳定后验收；source SHA `0fa682cc…` |
| 108 定向：新测试 7 cases + 旧 24 = **3 files / 31 tests 全通过**；定向 strict `tsc` exit 0 | `…/private-room-archive-history-reader/{focused-vitest.log,history-vitest-verbose.log}` | 组件/包快照 |
| 108 **全 server typecheck `apps/game-server` exit=2**，错误**全部在 `src/room.ts`**（File102 新 protocol types：`OWNER_DECK_CONFIRMATION_SCHEMA`/`OWNER_DECK_ZONES`/`OwnerDeckConfirmationMessage`/`OwnerDeckEcho` 未导出），108 本文件 0 错误 | `…/private-room-archive-history-reader/server-typecheck.log`；`raw.json.serverSourceTypecheck={exitCode:2,errorFiles:["apps/game-server/src/room.ts"],targetFileErrorLines:0}` | **全 server 套件不能报 PASS**（108 只读 API 本身已验收）；按契约未修改 `room.ts` |
| 109 live room `05715086` `archive.log` **只读**核对 **PASS**：`bytes=1107677`、**`mode=644`**、70 条完整记录、逐条 checksum 一致、seq 1..70 连续、全 roomBound；genesis=log seq 6（setup/v0/mulligan）、tail=seq 70（playing/v2）；strict decoder genesis+tail 均 `ok`；catalog digest/dataVersion==当前 runtime；roster==存档 seats；提交卡组拷贝数一致；每玩家 53 UID、genesis↔tail 集合 digest 相等、跨玩家互异 | `…/task-artifacts/live-duel-creation-provenance-verification/{report.md,rawprobe.sanitized.json,probe.ts}` | **仅证明 live v1 具备迁移输入**；**未做任何迁移/state 变更**；未读旧 `gui-room-state`；未验证 RNG 可复算/多进程并发 |
| private journal 权限风险：真实 regular `archive.log` 曾为 **`mode=644`**（含私有恢复令牌），105 fixture 0600 **非通用保证**；Root 对自己实际 regular 文件 fd-verified `chmod 600`（`0o644→0o600`、`sameInode`、`contentsRead=false`、不读取令牌） | `…/gui-room-proof/actual-archive-permissions.json` | 已就地修正该实际文件；**源码级默认/既有权限修复（110 `private-file-store-permissions`）尚未验收**（110 已非 prepared：`runs/private-file-permissions-wave110/status.json` 记 `2026-10-12T20:47:21.918Z` 起 running、pid `99355`、assistant-model `gpt-6-sol`，producer 未签收），不得声称通用已修复 |
| 106 `duel-permanent-authority-module`（`packages/engine-core/src/duel/permanent-state.ts`）自身 isolated-results **14/14 通过** | `…/task-artifacts/duel-permanent-authority-module/{isolated-results.log,isolated-tap.log}` | 进程未退出 / Root 未源码验收；**仅 permanent-state internal candidate**，未接构造器/canonical/V2 archive/wire/Main；**14 不计入核心 248**；非 V2 已切换 |
| 并行 writers：102 `owner-deck-confirmation-restore`、104 `legacy-prompt-authority-repair` 仍在开发；105 只读取证未签收 | `…/work-queue.json` `readyDispatched` | **47 protocol / 213 server / 294 front 为过去组件快照，不是当前 Source**（第九次刷新后 protocol 64 / desktop 335；server 251（29 files，主控实测））；有 writers 的源码不得冒认 whole pass |

边界（务必保留）：108 `readArchives` **仅当只读 API 本身**（已随 31 针对测试验收）**不认证 owner/CardIR**、**不判断迁移合法性**、**非 MAC**、**非游戏 event replay**，整文件重写 + 重算校验和仍可绕过；109 **仅证明“具备迁移输入”**、**未迁移**。旧稳定快照 **Core 248 / proto 47 / server 213 / frontend 294** 与过去跨 turn 99/103 的 **4 PASS** 接受事实**保持不变**（第九次刷新后当前计数见第 12 节）。**整体目标仍不 complete。**

## 12. 2026-10-13 V2 投影 / runtime facade / 卡型角色与 phase closure 事实增量（第九次刷新）

本节只记录经 artifact 复核的事实增量，不改变第 2 节的 quarantine 结论或 `judge-required` 立场。**Core v1.4 现仍有效、v1.5/Radiance 于 2026-10-16 生效**的版本边界与 `executable 0 / judge-required 1348 / no-ability 33` 均**保持不变**。

| 事实 | 证据 | 性质/边界 |
| --- | --- | --- |
| **source-program scope hardened（已落）**：`queryDuelSourceProgramPhaseScope` 改为四参数入口，只接受由 `createDuelOfficialProgramRegistry` 创建、模块私有 `WeakMap` 持有的 registry authority；bare program / binding / clone-spread facade / 自洽伪造 fingerprint / caller reference **一律 fail closed**，不再独立铸造 `sourceProgramComplete` / negative proof | `…/task-artifacts/source-program-scope-hardening/report.md` | 源码级落地（未 commit）；provider/Core/server **未接**；**本任务未声称 52 resolved 可执行** |
| source-local 结果不再复用 Core evidence 结构：使用 `directBoundaryStatus` / `sourceApplicabilityStatus` / `eventRecognized` / `globalClosureStatus:"unverified"`，**刻意不导出** Core 字段 `status`/`eventSupported`/`replacementsCovered`/`continuousCovered`/`triggersCovered`；phase 词表运行时 `Object.freeze` + 私有显式 switch；所有 source/semantics 数组加 ordinary-array/精确 own keys/dense/no-accessor/no-exotic-prototype 校验；`recursive-conquer-event-journal` 作为**所有 source scope 的全局 fixed-point 义务** | `…/source-program-scope-hardening/report.md`；`packages/card-dsl/test/duel/source-phase-program-scope.test.mjs` | 23 个 TAP 子测试；card-dsl 隔离 dist **130/130 pass**、typecheck 0 |
| **52 resolved 非可执行**：phase source registry census **52 resolved / 1329 unknown（1381）**；这些 resolved 仅表示 source scope 结论，**不是**卡牌能力可执行；旧 `queryDuelPhaseEventScope` 仍只支持 `awaken`/`begin`/`hold`，**9 个 boundary 仍 unknown** | `docs-current-facts-audit/findings.json`（A3 边界）；`…/source-program-phase-scope-independent-review/report.md` | `effect-coverage.json` 仍 **executable 0 / judge-required 1348 / no-ability 33**；**独立审查发现 3 项可复现 P1**（自证 fingerprint 可伪造、语义数组 future-field 绕过 strict 校验、导出的 phase 列表可变）+ 2 项 P2，**已由主控 hardening 修复后 card-dsl 130 通过、计数已复验** |
| **phase closure 仍未接**（孤儿模块）：`phase-source-closure-v2.ts` 契约完备但**权威为零**——executor 只调 `authority`（`inspectDuelPhaseSourcesV2`，`turn-executor-v2.ts:254`），**从不调 closure**；closure 未被任何 barrel 导出；`phase-closure-evidence-v2.ts` 已落盘但**未从 `duel/index.ts` 导出**（本轮 grep 复核：barrel 只导出 `phase-source-authority-v2`）；把 closure 放进现有 `cover()` 时机会对 `draw`/`channel`/`lethal-kill` **永久 pending（死锁）**；阻塞 B1–B10，**缺生产 DSL→evidence 组装器/适配器** | `…/task-artifacts/phase-closure-turn-seam-audit/{report.md,core-bridge-contract.md}`；`…/phase-closure-evidence-assembler/type-compatibility.ts` | 静态只读取证；`phase-closure-evidence-assembler` 仅一个 type-compatibility 编译探针，**非生产实现** |
| **V2 public projector（已落）**：`packages/engine-core/src/duel/projection-v2.ts` 导出 `projectCanonicalDuelMatchV2(match, viewer)`，已由 `duel/index.ts` barrel 导出；逐字段公开投影（setup/playing/pendingPayment），**不读** provenance/physicalCardsByUID/legendStates/gears/session ledger | `…/task-artifacts/engine-v2-public-projector/report.md`；`test/duel-projection-v2.test.mjs` | engine-core 当时 **430/430**（后增至 434）；**不认证 viewer**（server 须从认证连接派生 viewer）；**未接 server/client/archive** |
| V2 projector 独立审查：**P0/P1 无已确认项，P2×3、P3×2**。P2：投影器不在运行时拒绝**非 V2 authority**（可为 V1 快照贴 V2 标）；board **Gear** 公共状态整体缺失；**Legend** 当前控制/readiness 无公开载体 | `…/task-artifacts/engine-v2-projector-independent-review/review.md` | 只读源码审查；建议入口 fail-closed 版本检查；**私有 Gear/Legend 不得整体 spread 修补** |
| **server V2 runtime facade（已落）**：`apps/game-server/src/duel/runtime-v2.ts` 提供 session 工厂/投影/命令/turn 转发全部能力，自包含测试 `tests/duel/runtime-v2.test.ts` 9/9 | `…/task-artifacts/room-v2-cutover-impact/room-v2-cutover-impact.md`；`…/server-v2-runtime-facade/vitest.own.config.ts` | facade 刻意**不发布任何生产 provider**（trustedCardType/sources/sourceAttestor） |
| **公开 room 仍 V1**：`room.ts`/`server.ts`/`file-room-store.ts`/`room-store.ts` 对 `V2`/`runtime-v2`/`duelSessionV2`/`DUEL_PROJECTION_SCHEMA_V2` **全部零命中**（本轮 grep 复核）；公开 room 仍构造 V1 `DuelCommandSession`。protocol 已双向支持 V2（换投影值即可，消息类型名不变） | `…/room-v2-cutover-impact/room-v2-cutover-impact.md`；本轮 grep | V2 session 是内存 capability（"unadmitted V2 session; JSON is not restore"）；`session-archive.ts` 仍 **V1 schema1**；**durable V2 restore 当前不可实现，遇 V2 archive 须 fail-closed**；生产 `room.ts` 只发 V1 duel，无 V2 对外 send path |
| **卡型角色修复（已落）**：Unit+精确 `Champion` tag → Champion（chosen 与 main-deck physical origin 一致）；Unit 无 tag → Unit；Legend 带 Champion tag 仍 Legend；Spell → Other；Gear/Rune/Battlefield 保留精确类型；token-tagged/invented/unknown/duplicate **fail closed** | `…/task-artifacts/v2-catalog-card-type-role-fix/verification.md`（`engine-full.tap`/`engine-focused.tap`/`server-focused.log`） | engine-core **434/434**（focused 4/4）；server focused **25/25（3 files）**；engine-core & game-server typecheck pass；**resolver 只证 printed type，不证 Champion family 有效性或整卡组合法性**（`validateCatalogDeck` 不可绕过） |
| 真实 catalog opt-in 扫描（v2-catalog 口径）：1381 printings → Unit **376**、Champion **344**、Other/Spell **268**、Gear **131**、Rune **30**、Legend **143**、Battlefield **75**、invalid token-tagged/typed **14**；`dataVersion=2026-10-12-official-gallery`、digest `sha256:53b974c8…4d10` | `…/v2-catalog-card-type-role-fix/verification.md` | `deck-catalog.json` 仍 1381 printings / 1080 canonical；此扫描**不改** `effect-coverage.json`（executable 仍 0） |

### 12.1 当前包计数与边界（组件/包快照，非 full-workspace / 远程 CI / native）

> （2026-10-13 历史快照）“当前计数”指该次刷新时点，**非 2026-10-15 当前值**；当前包计数见第 0 节。

| 包 | 当前计数 | 证据 | 边界 |
| --- | --- | --- | --- |
| `@riftbound/engine-core` | **434/434** | `…/v2-catalog-card-type-role-fix/engine-full.tap` | 默认门 `node --test test/*.test.mjs test/full-product/*.test.mjs`（build 后）；**取代** 430/425/248/245 旧快照 |
| `@riftbound/protocol` | **64/64** | `…/protocol-v2-compatibility-fix/report.md` | 纯包 fixture，无 engine 依赖；DTO/guard **只验 shape**，不认证 viewer、不判 action 合法性、server 未接 V2 |
| `@riftbound/card-dsl` | **130/130**（主控已复验） | `…/source-program-scope-hardening/report.md` | 隔离 dist；独立审查原 3 项 P1 + 2 项 P2 已由主控 hardening 修复后 130 通过；provider/Core/server 未接；52 resolved / 1329 unknown 仅为 binding |
| `@riftbound/desktop-client` | **335/335（28 files）** | `…/protocol-v2-compatibility-fix/report.md` | 组件/包快照；desktop V1/V2 投影路由未端到端验证 |
| `@riftbound/game-server` | **251/251（29 files）**（**主控实测**） | 主控实测；支撑 artifact 由主控补落（本轮最接近的局部证据为 focused 25/25） | 全 server 套件上一次**非 PASS**（`room.ts` 曾 tsc exit 2，源自未完成的 102 新 protocol types）；V2 facade zero-wired。**支撑 artifact 由主控补落后作为完整落盘证据** |

边界（务必保留）：以上全为**组件/包快照**，不是 full-workspace / 远程 CI / native 证明。第九次刷新**新增**：`source-program scope hardened` 已落（但 52 resolved **非可执行**；独立审查 3 项 P1 已经主控 hardening 修复、130 通过）；`phase closure 仍未接`（孤儿模块 + 未导出 + 时机死锁）；V2 projector / server runtime facade / 卡型角色修复**已落源码**，但**公开 room 仍走 V1**、`runtime-v2` **zero-wired**、**durable V2 restore 不可实现**。`effect-coverage.json` 仍 **executable 0 / judge-required 1348 / no-ability 33**；Core v1.4（2026-07-16 最后更新）现仍有效，v1.5/Radiance（2026-10-09 发布、**2026-10-16 生效**）在生效日前不得混入；unknown/`judge-required` 立场**不变**。**整体目标仍不 complete。**
