# RIFT-49：game-server 测试文件归类（为删除 profile / schema 分支做准备）

日期：2026-10-15；任务分支 `task/RIFT-49-game-server-test-classification`；分析基线 worktree HEAD `1794381`（integration 合入点）。本文件只新增文档，未修改任何源码、测试、契约或生成卡牌数据。

## 归类口径

依据 `docs/plans/survey/game-server.md` 的「唯一 runtime 建议」与契约 `docs/plans/2026-10-15-p0-contract.md` 第 1 节：不再兼容旧 profile/schema 回放；旧日志用 tag `legacy-replay-e2cbcdf` 的代码重放。每个测试文件归入四类之一：

- **current**：验证收敛后要保留的行为。迁到唯一 runtime 后应继续通过；fixture 可按新构造路径调整，断言意图不变。
- **historical**：只验证旧 profile/schema（journal schema 1–9、runtime profile P1–P9、V1/V2/V3 facade 的 archive/replay）的逐字节回放或兼容门禁。收敛后删除，由 `legacy-replay-e2cbcdf` tag 承担。
- **split**：同一文件里 current 与 historical 两类用例都有。正文列出各自用例名。
- **delete**：验证即将退役的实验路径（full-product runtime/orchestrator）且对当前 server 无价值。

判定依据是文件的**直接 import 面**（它测试哪条 runtime 实现）、测试名与断言，以及该实现是否被公网 `server.ts` / `room.ts` 接入（见 `game-server.md` 的 runtime 入口清单）。

## 核对口径与总数

- 测试文件总数：**95**（`find apps/game-server/tests -name '*.test.ts'`，`src/` 下无内联测试）。另 7 个 `tests/duel/fixtures/` 文件是被共享的 fixture（`fury77-real-decks.ts`、`native-main5-command-seed.json`、`p4-runtime-catalog.ts`、`p4-spell-service-fixture.ts`、`recorded-spell-p4-fixture.ts`、`setup-adapter-catalog.ts`、`spell-first-setup-deck.ts`），不是测试文件，不计入归类。
- 用例数按 vitest 实测展开后的 assertion 计（`it.each` 按参数个数展开）：在本 worktree 跑 `pnpm --filter @riftbound/game-server exec vitest run --config vitest.config.ts --reporter=json`，结果 **95 个 suite / 608 用例 / 608 通过 / 0 失败**，与基线 95 文件 / 608 用例一致。原始 JSON 在 `/tmp/RIFT-49-game-server-test-classification/vitest-baseline.json`。
- 下表「用例数」列即上述实测每文件用例数。

## 逐文件归类

### tests/ 根目录（19 个文件）

| 路径 | 用例数 | 覆盖的行为 | 依赖 runtime / profile / schema | 归类 | 理由 |
|---|---:|---|---|---|---|
| tests/card-api.test.ts | 16 | HTTP 卡牌目录与图片 API（路径、分页、类型校验） | catalog + HTTP 层；无 Duel profile | current | 目录/图片 API 是保留的 `server.ts` 行为，与 runtime 分叉无关。 |
| tests/constructed-identity.test.ts | 29 | 构筑身份（champion/legend tag、canonical identity）规则 | `constructed-policy.ts` | current | 构筑规则属保留域，收敛后仍需。 |
| tests/constructed-policy.test.ts | 16 | 构筑赛制 policy（禁限、份数上限） | `constructed-policy.ts` | current | 同上。 |
| tests/constructed-region-context.test.ts | 3 | 地区上下文绑定与校验 | `constructed-regional-context.ts` | current | 地区上下文属保留域。 |
| tests/constructed-regional-availability.test.ts | 13 | 地区发行日/可用性纯数据计算 | `constructed-regional-availability.ts` | current | 纯数据计算，收敛后保留。 |
| tests/constructed-regional-http.test.ts | 12 | regional catalog 的 HTTP 过滤与校验 | HTTP + regional context | current | 公网 HTTP 行为保留。 |
| tests/constructed-regional-policy.test.ts | 11 | regional 构筑 policy 视图组合 | `constructed-regional-policy.ts` | current | policy 视图保留。 |
| tests/constructed-regional-room.test.ts | 8 | regional 上下文下的房间 deck 校验与开局 | `room.ts`（断言 `archive.duelProfile === "p4"`） | split | 主体是 regional 房间行为（current）；其中 `expect(archive.duelProfile).toBe("p4")` 的断言绑定旧 P4 archive 形状，收敛后 archive 字段会改，需改写该断言而非删除（归入 split 供迁移时改写）。 |
| tests/constructed-sideboard-domain.test.ts | 8 | sideboard 域规则 | `constructed-policy.ts` | current | 构筑域规则保留。 |
| tests/deck-validation.test.ts | 17 | 通用 deck 数量/区域/份数合法性 | `deck-validation.ts` | current | deck 校验保留。 |
| tests/file-room-store.test.ts | 15 | FileRoomStore CRUD、hash 目录、损坏恢复、不可用标记 | `file-room-store.ts`（存储后端，archive payload 视为 opaque） | current | 存储后端是保留能力；archive payload 收敛为统一 journal 后，本文件的 opaque 字节级用例不受影响。 |
| tests/foundation-privacy-copy-limit.test.ts | 5 | Foundation ruleset 隐私投影 | foundation + `room.ts` | current | Foundation 路径与 Duel profile 分叉无关，保留。 |
| tests/foundation-ready-state.test.ts | 7 | Foundation 房间 ready 状态 | foundation + `room.ts` | current | 同上。 |
| tests/foundation-room.test.ts | 6 | Foundation 房间生命周期 | foundation + `room.ts` | current | 同上。 |
| tests/foundation-websocket-regression.test.ts | 2 | Foundation WebSocket 回归 | foundation + `server.ts` | current | 同上。 |
| tests/game-server.test.ts | 4 | createGameServer 公共行为：hello 前拒绝、创建/加入/隐私、重放幂等、prompt 归属 | `server.ts` 默认路径 | current | 公网 server 行为保留。 |
| tests/lobby-ready.test.ts | 5 | 大厅 ready 流程 | `room.ts` | current | 房间生命周期共用逻辑，保留。 |
| tests/owner-deck-confirmation.test.ts | 9 | owner deck 确认（`it.each` 覆盖 FOUNDATION_RULESET_ID 与 DUEL_RULESET_ID 两个 ruleset） | `room.ts` deck 提交流程（ruleset 参数化，非 runtime profile） | current | 这里的「两个 ruleset」是 Foundation 与 Duel 的规则集标识，不是旧 profile/schema 分叉；deck 确认行为保留。 |
| tests/persistent-room-archive-history.test.ts | 7 | 房间 archive 历史分页/游标/损坏恢复（`full-product/persistent-room-store.ts` 被 FileRoomStore 复用为后端） | FileEventStore 后端 | current | 虽目录名带 full-product，但该模块已是 FileRoomStore 的持久化后端（game-server.md 明确），属保留存储能力。 |
| tests/persistent-server.test.ts | 6 | 持久化 server：重启恢复 Foundation 会话、durable save 失败回滚、断线保持 live socket、重放提交回执 | `server.ts` + FileRoomStore（Foundation 路径） | current | 持久化/重启恢复是保留能力；用 Foundation 路径，未依赖 Duel profile。 |
| tests/room-chat-websocket.test.ts | 3 | 房间聊天 WebSocket | `room-chat.ts` + `server.ts` | current | 聊天与 profile 无关，保留。 |
| tests/room-chat.test.ts | 6 | 房间聊天 ledger | `room-chat.ts` | current | 同上。 |
| tests/room-request-dedupe.test.ts | 14 | 房间请求幂等（requestId 去重/冲突） | `room.ts` ProcessedRoomRequest | current | 幂等是保留的横切机制。 |
| tests/server-lifecycle.test.ts | 5 | server 启停生命周期 | `server.ts` | current | 生命周期保留。 |

### tests/duel/（71 个文件）

| 路径 | 用例数 | 覆盖的行为 | 依赖 runtime / profile / schema | 归类 | 理由 |
|---|---:|---|---|---|---|
| duel/accelerate-card-program-authority-v1.test.ts | 5 | Accelerate 卡的 program authority source 绑定 | `card-program-authority.ts`（保留 seam） | current | CardProgramAuthority 是保留的 cross-cutting seam（game-server.md），Accelerate 的 source authority 行为保留。 |
| duel/authoritative-engagement-p4.test.ts | 3 | P4 engagement 服务（combat/lethal/FEPR/burnout proof） | `authoritative-runtime-p4.ts` + `engagement-services-v2.ts` | current | engagement 是 P4 保留能力，迁入唯一 runtime。 |
| duel/authoritative-journal-atomicity-p4.test.ts | 4 | P4 journal 写原子性（durable 写失败不 ACK） | P4 owner + `persistent-command-runtime-p4.ts` + CAS | current | 写原子性是保留的持久化语义；用例同时经 `persistent-command-runtime-p4.ts`，但该 CAS publication 语义保留（合并为单 durable adapter 后语义不变）。 |
| duel/authoritative-journal-read-p4.test.ts | 4 | P4 journal 读取/恢复边界 | P4 + `persistent-command-runtime-p4.ts` + CAS | current | 读取边界语义保留。 |
| duel/authoritative-runtime-p4.test.ts | 4 | P4 authoritative owner 主体（setup、command dispatch、projection） | `authoritative-runtime-p4.ts` | current | P4 owner 是迁移基线本身。 |
| duel/authoritative-spell-p4.test.ts | 1 | P4 Spell 在 authoritative 路径的行为 | P4 + `p4-spell-services.ts` | current | Spell 是 P4 保留能力（迁 EffectIR 后行为意图保留）。 |
| duel/card-program-authority.test.ts | 43 | catalog→card-dsl program registry、source identity vs execution permission（含 `it.each(MALFORMED_ARRAYS)` 展开） | `card-program-authority.ts` | current | CardProgramAuthority 是保留 seam。 |
| duel/catalog-card-type-v2.test.ts | 4 | catalog card type trusted resolver（带 dataVersion/catalogDigest） | `catalog-card-type-v2.ts`（被 P4 使用） | current | trusted resolver 是 P4 在用的保留基础设施。 |
| duel/command-journal-p4.test.ts | 8 | P4 journal 的 record/replay/gate | `command-journal-p4.ts`，fixture 固定 `DUEL_RUNTIME_PROFILE_P4_LEGACY`（旧 legacy profile 与 schema 1/2） | historical | 全部 8 个用例都在旧 legacy profile（schema 1/2）下回放：`replays genuine legacy null resumes in both schemas…`、`restores v2 across UTC audit-day changes…`、`recovers only the missing v1 audit date…`、`does not normalize …in either schema`、`omits repeated genuine null resumes…`、`replays actual setup and Main…fresh live entropy`、`forks a real isolated owner…`、`refuses a copied gate…`。回放/digest/分叉的通用正确性已由 `replay-profile-p4.test.ts`、`optional-unit-replay-profile-p4.test.ts` 与 `persistent-command-runtime-p4.test.ts` 在其它 profile 下覆盖；本文件的旧 profile/schema 专属回放由 legacy tag 承担。 |
| duel/command-journal-v2.test.ts | 5 | V2 command journal recorder/replayer、entropy、回放门禁 | `command-journal-v2.ts` + `runtime-v2.ts` | historical | 该模块是 P3/V2 私有 journal，属「最终退役」清单（game-server.md）；其逐字节回放/篡改拒绝由 legacy tag 承担。 |
| duel/equip-beginning-card-authority-v1.test.ts | 8 | Gear/Beginning 卡的 source authority 授予 | `card-program-authority.ts` | current | source authority 行为保留。 |
| duel/fury77-real-rosters-source-cost-entry.test.ts | 9 | 真实 Fury77 牌组 source/cost/entry 记账（`it.each` 展开多目标） | operation journal + source services（保留 seam） | current | 真实牌组的行为记账保留。 |
| duel/fury77-source-cost-entry-composition.test.ts | 5 | Fury77 source/cost/entry 组合（`it.each` 展开） | 同上 | current | 同上。 |
| duel/gear-normal-production-chain.test.ts | 3 | Gear 正常打出链、未审查 source opcode 保持 pending | production source services | current | Gear 行为与 pending 红线保留。 |
| duel/hold-recruit-executor-v1.test.ts | 3 | Hold→Recruit token birth executor（证据不全保持 pending） | `hold-recruit-executor-v1.ts` | current | 该 executor 的「证据不全保持 pending」语义是保留红线；实现迁 EffectIR 后行为意图保留。 |
| duel/operation-journal-v2.test.ts | 10 | native operation journal：source work、cost census、zone/token transition、fork | `operation-journal-v2.ts` | current | operation journal 是 P4 保留基础设施。 |
| duel/optional-entry-current-source-applicability-v1.test.ts | 4 | optional entry 的 current-source 适用性 | optional 服务 + source seam | current | optional Unit 机制行为保留。 |
| duel/optional-native-journal-nominal-binding.test.ts | 2 | optional native journal 名义绑定 | operation journal + optional 服务 | current | 同上。 |
| duel/optional-unit-choice-clock-p4.test.ts | 3 | optional Unit 的 canonical clock 与 replay 保持（`it.each` pay/decline 展开） | P4 optional profile + journal | split | 用例 `keeps historical schema 6 choice opening on the old clock` 显式验证历史 schema 6 在旧时钟下回放 → historical；`it.each(["pay","decline"])("advances one canonical clock and preserves %s through replay")` 两个展开用例验证 clock 语义在 replay 中保留 → current（改用唯一 schema 后断言意图保留）。current 2 / historical 1。 |
| duel/optional-unit-choice-projection-p6.test.ts | 9 | optional Unit prompt 映射为 viewer-bound pending-choice DTO | `optional-unit-choice-projection-p6.ts`（P4 import） | current | pending-choice 投影是 P4 保留能力。 |
| duel/optional-unit-cost-source-applicability-v1.test.ts | 3 | optional Unit cost source 适用性 | optional 服务 | current | 机制行为保留。 |
| duel/optional-unit-entry-boundary-v1.test.ts | 2 | optional Unit entry boundary（只证明 entry，不改 state） | `optional-unit-entry-boundary-v1.ts` | current | entry boundary 语义保留。 |
| duel/optional-unit-native-source-p6.test.ts | 8 | optional Unit native source 检查（current head/catalog stamp/cost census/choice receipt，未知返回 unknown） | `optional-unit-native-source-p6.ts` | current | native source 检查语义保留。 |
| duel/optional-unit-payment-entry-v3.test.ts | 4 | optional Unit payment continuation 与 entry 绑定（`it.each` pay/decline 展开） | `optional-unit-payment-entry-v3.ts` | current | payment/entry 行为保留。 |
| duel/optional-unit-physical-chain-p8.test.ts | 2 | physical printed Unit Chain 原生支付与实体入场（`it.each` pay/decline 展开） | `printed-unit-chain-services-p8.ts`（physical chain profile） | current | physical chain 是 P4 保留能力；该文件测行为本身而非旧回放。 |
| duel/optional-unit-physical-chain-recovery-p8.test.ts | 1 | physical chain 恢复：还原 Chain 选择与 required payment 后完成一次真实入场 | P4 + physical chain + room restore | current | 恢复语义保留；改用统一 journal 后断言意图不变。 |
| duel/optional-unit-replay-profile-p4.test.ts | 4 | optional Unit 的显式 archive profile 回放 | `command-journal-p4.ts`，固定 optional profile + `DUEL_REPLAY_PROFILE_P4_PUBLIC_CHAIN` | historical | 全部 4 个用例（`runs four real turns…preserves both views through replay`、`pins schema 6…`、`requires the independent optional profile and its exact semantic version`、`retains the historical public Chain default and rejects new-profile gate downgrade`）都是旧 profile/schema 回放与降级拒绝 → 由 legacy tag 承担。 |
| duel/optional-unit-resolved-history-p9.test.ts | 2 | resolved-history P9 下的 native Main5 decline 回归 | 固定 `DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN`(P8) 与 `…_RESOLVED_HISTORY`(P9)，断言 `schemaVersion` 8/9 | historical | 用例 `keeps the legacy P8 owner blocked at 87…`（断言 `archive.schemaVersion` 8）与 `re-executes the same 27 inputs plus decline at 88…`（断言 `journal.schemaVersion` 9）都绑定旧 profile/schema 回放。 |
| duel/optional-unit-room-p4.test.ts | 2 | optional Unit 在房间层经 fresh room restore 保留 choice/payment（`it.each` 两个 profile 展开） | `room.ts` P4 分支 + 两个 optional profile，断言 `archive.duelJournal?.schemaVersion` 6/7 | split | `it.each` 在 `DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT`(schema 6) 与 `DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK`(schema 7) 两个 profile 上展开：schema 6 展开是历史 profile 回放（historical），schema 7（optional-unit-choice-clock-v4，公网默认）展开是房间 restore 保留 choice/payment 的当前行为（current）；两展开同断言行，迁移时删 schema 6 参数并改写断言。current 1 / historical 1。 |
| duel/optional-unit-runtime-p4.test.ts | 4 | optional Unit 在 P4 runtime 的 pay/decline（`it.each` 4 组展开） | `command-journal-p4.ts`，两个 optional profile × pay/decline | split | `it.each` 展开含 `DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT`（历史 profile）× pay/decline 两例（historical）与 `DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK`（公网默认）× pay/decline 两例（current）；断言差分 `stateVersion +1/0` 依 profile 而定。current 2 / historical 2。 |
| duel/optional-unit-services-p4.test.ts | 4 | optional Unit source/program/cost/costBinding/entry/unit 服务组合 | `optional-unit-services-p4.ts` | current | optional 服务组合保留。 |
| duel/p4-kill-spell-services-v1.test.ts | 5 | Kill Spell 服务 | `p4-spell-services.ts` | current | Spell 服务行为保留。 |
| duel/p4-spell-cost-census.test.ts | 4 | Spell cost census | `p4-spell-services.ts` | current | 同上。 |
| duel/p4-spell-services.test.ts | 6 | P4 Spell 服务主体 | `p4-spell-services.ts` | current | 同上。 |
| duel/pending-spell-resource-ack-p4.test.ts | 6 | pending Spell 的 resource ACK 语义 | P4 Spell + resource ACK | split | 用例 `keeps the historical Spell profile ACK and journals distinct from the new profile` 显式区分历史 Spell profile 的 ACK/journal → historical；其余 5 个（unpaid Chain priority 关闭、合法 Rune 激活/回收 ACK、重试不重复授予、非法 UID/错误 actor/过期 window 拒绝）是 pending payment/ACK 的当前语义 → current。current 5 / historical 1。 |
| duel/persistent-command-runtime-p4.test.ts | 7 | P4 durable adapter：受保护写、CAS 竞争、失败恢复 | `persistent-command-runtime-p4.ts` + CAS | current | durable publication 语义保留（合并为单 durable adapter 后语义不变）。 |
| duel/persistent-command-runtime-v3.test.ts | 7 | P3 durable adapter（journal-v2 authority + CAS） | `persistent-command-runtime-v3.ts` | historical | 该 adapter 属「最终退役」清单（P3 profile，未接入 GameRoom）；其回放/准入门禁由 legacy tag 承担。 |
| duel/persistent-room.test.ts | 2 | Duel 房间持久化恢复（UID/手牌/回合/场上）与篡改拒绝 | `room.ts` 持久化，断言 `archive.duelSession`（V1 session 字段） | split | `restores UID, hand, turn order, board and sticky failures without replaying RNG` 与 `rejects mismatched room-derived ID…` 的恢复/篡改拒绝意图是 current，但断言绑定旧 `duelSession`（V1 archive 字段，如 `edited(archive => { archive.duelSession… })`）→ 收敛后 archive 改用统一 journal，需改写 fixture/断言字段而非删除。 |
| duel/phase-source-bridge-v2.test.ts | 4 | phase-source bridge：绑定 catalog/program authority 到 engine source-closure registry，无法证明保持 unknown/pending | `phase-source-bridge-v2.ts` | current | phase-source bridge 是保留 seam。 |
| duel/point-card-program-authority-v1.test.ts | 6 | Point 卡的 program authority | `card-program-authority.ts` | current | source authority 保留。 |
| duel/point-effect-production-services-v1.test.ts | 4 | Point damage authority 的 current-head/source/Might/census callbacks（不直接改 state） | `point-effect-production-services-v1.ts` | current | Point effect 行为保留（迁 EffectIR 后意图不变）。 |
| duel/point-spell-production-services-v1.test.ts | 2 | Point Spell service 公共 re-export | `point-spell-production-services-v1.ts` → `p4-spell-services.ts` | current | Point Spell 行为保留。 |
| duel/printed-unit-chain-resolved-history.test.ts | 5 | printed Unit Chain 的 resolved native cost history | `printed-unit-chain-services-p8.ts` | split | `accepts exactly witnessed history, declines Accelerate, pays 2E and enters Base` 等 3 个用例测当前 resolved-history 行为 → current；`it.each([undefined, false])("keeps historical P8 replay blocked when option is %s")` 两展开显式验证历史 P8 回放被阻止 → historical。current 3 / historical 2。 |
| duel/printed-unit-chain-services-p8.test.ts | 7 | physical printed Unit Chain V4 服务主体 | `printed-unit-chain-services-p8.ts` | current | physical chain 服务保留。 |
| duel/private-journal-cas-store.test.ts | 13 | private journal CAS store：head/revision/nonce、写失败、恢复边界 | `private-journal-cas-store.ts` | current | CAS 存储原语保留。 |
| duel/production-source-services-v2.test.ts | 3 | P4 production source seam：phase registry/source inspection/Unit entry facts/cost binding/derived Might | `production-source-services-v2.ts` | current | production source seam 保留。 |
| duel/public-chain-card-p4.test.ts | 4 | 公网 P4 房间的 Chain 卡行为 | P4 room | current | P4 公网行为保留。 |
| duel/public-reaction-actions-p4.test.ts | 2 | 公网 P4 reaction actions | P4 room | current | 同上。 |
| duel/public-room-p4.test.ts | 4 | 公网 P4 房间所有权：投影只带 viewer 手牌、restored duplicate、fresh native branch 恢复、拒绝 legacy packet | `room.ts` P4 分支，断言 `archive.duelProfile === "p4"` 且 `duelSession` 为 undefined | split | 主体（投影隐私、duplicate 幂等、恢复、拒绝被替换 socket/legacy packet）是 current；其中绑定 `duelProfile === "p4"` archive 形状与 `duelJournal` 字段的断言（如 `const forged = { ...archive, duelProfile: undefined, duelJournal: undefined, duelSession: null }`）在统一 journal 后需改写。 |
| duel/public-room.test.ts | 5 | 公网房间主体：deck 校验、ready 后开局、投影只带 owner 手牌、mulligan、stale/duplicate 拒绝 | `room.ts`（库工厂默认 V1 路径） | current | 房间行为意图保留；迁移时把 fixture 从 V1 会话构造改为唯一 runtime 构造，断言意图（隐私投影、开局门禁、幂等）不变。 |
| duel/public-spell-p4.test.ts | 1 | 公网 P4 Spell 行为 | P4 room | current | P4 Spell 行为保留。 |
| duel/public-websocket-p4.test.ts | 4 | P4 WebSocket 生命周期 | P4 + `server.ts` | current | 同上。 |
| duel/public-websocket.test.ts | 6 | 公网 WebSocket：连接、增量事件、durable save 失败注入 | `server.ts` 默认路径（V1 facade） | current | WebSocket 生命周期/事务语义保留；fixture 改用唯一 runtime。 |
| duel/reconnect-wire-p4.test.ts | 3 | P4 断线重连的 wire 行为 | P4 + `server.ts` | current | 重连是保留的横切机制。 |
| duel/recorded-spell-p4.test.ts | 1 | 重构 Spell 的每个 native owner checkpoint（payment/Chain/Draw/retirement） | P4 recorded owner | current | Spell recorded 行为保留。 |
| duel/replay-profile-p4.test.ts | 4 | P4 replay profile gate | `command-journal-p4.ts` 的 `createDuelReplayGateP4` / `replayDuelCommandArchiveP4` + 各 replay profile | historical | 全部 4 个用例（`restores schema 1 and 2 only under an explicit legacy gate…`、`records the explicit historical Spell profile as schema 3…`、`records the new public Chain default as schema 4 and requires its own replay profile`、`keeps Spell actions out of legacy projections and rejects forged profile/context admission`）都是 schema/profile 回放门禁。 |
| duel/resource-legality-projection-v2.test.ts | 1 | V2 resource legality 投影稳定、不安装 mutation probe | `runtime-v2.ts` projection | current | 投影稳定性/无副作用是保留意图；迁移到唯一 runtime 的投影层。 |
| duel/runtime-v2-payment-inspection.test.ts | 2 | V2 payment inspection：重复 inspect 不消耗一次性 proof、hint 语义 | `runtime-v2.ts` payment | current | payment inspection 语义保留，迁移后断言意图不变。 |
| duel/runtime-v2.test.ts | 9 | V2 session/turn primitives | `runtime-v2.ts` | split | V2 turn/payment/end continuation 等 primitive 语义会并入唯一 runtime（current）；但 facade 形状（`DuelRuntimeSessionV2`、V2 executor 入口）退役，绑定该形状的断言需改写（historical 面）。 |
| duel/runtime-v3.test.ts | 12 | V3 wire/projection facade | `runtime-v3.ts`（断言 `schemaVersion 3 / riftbound-duel-v3`） | split | V3 projection/wire 的 viewer 绑定、安全 ACK、隐私投影是 current 意图；但 V3 facade 作为独立入口退役，`publishes schemaVersion 3 / riftbound-duel-v3…` 等绑定 V3 schema/线形的断言需改写（historical 面）。 |
| duel/runtime.test.ts | 9 | 旧 V1 内存 facade（`duel/runtime.ts`） | `duel/runtime.ts`（退役清单） | historical | V1 facade 整体退役；其会话/投影/执行器形状不由新 runtime 承担。 |
| duel/session-archive-v2.test.ts | 8 | V2 committed archive round-trip/校验 | `session-archive-v2.ts`（退役清单） | historical | V2 archive 形状（schema downgrade/V1 mixing 拒绝、V2-only carrier 等）退役，由 legacy tag 承担。 |
| duel/session-archive.test.ts | 12 | 旧 V1 Duel session archive 编解码/恢复校验 | `duel/session-archive.ts`（退役清单） | historical | V1 session archive 退役。 |
| duel/setup-seats.test.ts | 12 | trusted roster/deck 校验、物理 UID 分配、setup metadata | `setup-seats.ts`（被 V1/V2/P4 共用） | current | setup-seats 是保留的共用模块。 |
| duel/spell-command-journal-p4.test.ts | 1 | Spell command journal：重试 pending receipt 不产生新 identity、拒绝跨 actor payload 冲突 | P4 journal | current | journal 幂等/冲突拒绝语义保留。 |
| duel/unit-point-census-adapter.test.ts | 6 | Unit Point census adapter（SYNTHETIC fixture 标记的 3 例 + 真实路径 3 例） | census adapter + source seam | current | census 行为保留；SYNTHETIC 用例是显式标记的合成 fixture，非伪造结算。 |

### tests/full-product/（5 个文件）

| 路径 | 用例数 | 覆盖的行为 | 依赖 runtime / profile / schema | 归类 | 理由 |
|---|---:|---|---|---|---|
| full-product/full-product-room-adapter.test.ts | 1 | full-product runtime adapter 的 concession 广播/会话恢复 | `full-product/runtime-adapter.ts`（engine-core `createFullProductGame`） | delete | 验证未接入 `server.ts`/`room.ts` 的实验 runtime；game-server.md 明确 full-product 实验须迁移或退役。 |
| full-product/match-orchestration.test.ts | 4 | full-product 房间编排（join/ready/command/幂等） | `full-product/orchestrator.ts` | delete | 实验 room 编排路径，非公网 server。 |
| full-product/match-result.test.ts | 2 | full-product 比赛结果（确定性胜者、setup prompt 权威） | full-product runtime | delete | 同上。 |
| full-product/orchestrator.test.ts | 5 | full-product orchestrator 生命周期 | `full-product/orchestrator.ts` | delete | 同上。 |
| full-product/persistent-room-store.test.ts | 9 | FileEventStore append-only archive log | `full-product/persistent-room-store.ts`（已被 FileRoomStore 复用为后端） | current | 该模块虽是 full-product 命名，但已是当前 FileRoomStore 的持久化后端（game-server.md 明确）；存储能力保留，归档契约统一后改名/迁移即可。 |

## 汇总

| 归类 | 文件数 | 用例数 |
|---|---:|---:|
| current | 79 | 515 |
| historical | 7 | 48 |
| split | 9 | 45 |
| delete | 4 | 14 |
| 合计 | 95 | 622 |

注：上表 split 行的用例数是 9 个 split 文件的全部用例之和（未在 current/historical 间二次拆分），因此四行用例数相加（515 + 48 + 45 + 14 = 622）比 vitest 实测总数 608 多 14——这 14 正是 split 文件内部 current 与 historical 在按文件计数时被重复计入两类的部分。文件数 95 与实测 suite 数一致。

### 收敛后预计保留的用例数

- 直接保留：current 文件 **515** 用例。
- split 文件中保留的部分：按正文逐名统计 split 文件的 current 用例约 **31** 用例。
- historical（48）与 delete（14）合计 **62** 用例由 `legacy-replay-e2cbcdf` tag 承担或直接删除。
- **预计保留合计 ≈ 546 用例**（515 + 31）；实际以 split 文件改写时按用例名精确拆分为准。

## 复核命令

```text
find apps/game-server/tests -name '*.test.ts' | sort | wc -l          # 95
pnpm --filter @riftbound/game-server exec vitest run --config vitest.config.ts --reporter=json   # 608 用例
grep -rl 'duel/command-journal-v2\.js' apps/game-server/tests --include='*.ts'   # historical import 面
grep -rln 'full-product' apps/game-server/tests --include='*.ts' | grep -v tests/full-product
```

## 契约变更请求

无。本任务只读归类；统一 journal 字段（`engineVersion`/`rulesetVersion`/完整性/命令/操作字段）的契约变更由父任务按 `game-server.md` 的建议另行提出。
