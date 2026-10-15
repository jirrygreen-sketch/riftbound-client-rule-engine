# Strict Runtime 接线契约（当前源码接线说明，非验收通过）

> 2026-10-14 current11：全工作区 build/typecheck/test 均 exit 0，1966 通过、0 失败、0 跳过（Core 703、server 380、desktop 420、integration 39）。已合入不可变对象视图缓存、Immediate actor/priority、Spell原claim收据失败续接、空resume不写日志/CAS且兼容旧日志，以及Spell包级导出；60项Chain/Spell、15项P4 journal/CAS聚焦分别通过。父exact proof通知在独立镜像实施，公开P4 Spell仍待。CR1.4不变，已恢复July TR与10/16 future TR，规则manifest22项通过。真实双GUI既有50命令/17回合/8分/226和重启重放证据保留。完整效果、Constructed、原生桌面/干净checkout未签收，原23项及goal active不变。详见 [接续记录](resume-20261014.md)。

> current6 内部 Spell 增量：指定目标在支付前绑定真实 UID/epoch，原选择纳入 command fingerprint；Main Chain 的 stateOpen/priority 变化通过 canonical frame 提交。外部效果凭据和父命令回执失败保留真实候选与已关闭 Chain 后继，ACK 版本取最终发布窗口的 Core 时钟。聚焦 20、Core 686、全工作区 1939 通过。该协调器尚未接公开 P4，也尚未支持共享 Reaction、目标失效/部分失效和 token 目标；新增能力仍需补齐来源闭包、私有状态与熵重放。

> 2026-10-14 主控增量优先：P4 已接真实 `GameRoom`/`server.ts`，新 Duel 房间由服务端 profile 选择；入口默认 P4，库 API 默认 V1，已有私有归档保留 profile。P4 recorded journal 从真实 factory 重放原始 actor/body/熵，比较双方及旁观投影和私有摘要；Room 只存 journal，不序列化 capability，保存失败从旧 journal 重构真实分支并保留 socket 绑定。公共 ACK 严格构造并绑定本次 requestId，整份归档保存后才发送。P4 CAS 另经真实多进程中途恢复与去重验证，SHA 只是校验摘要。最新源码与证据见 `resume-20261014.md`；下方未路由、V1-only 与早期 hash 为原采样快照，不得作为当前事实。

> 当前仍未接入 P4 的包括 Spell finalization/共享 Chain、响应、激活/Gear、Hold 卡牌效果及 token 清理。P4 私有摘要包含当前 Core/canonical/Unit receipts、payment/tasks/turn、pending Move/Turn/engagement 与全局 command ledger；不声明所有未来效果与 Chain UUID 的恢复覆盖。新增能力必须同步补齐熵/私有态/恢复故障契约。原生 Core origin 是进程内对象身份，重放恢复产生新 origin，不能把 JSON、SHA 或 native 提交路径当 MAC 或跨进程 capability。

本文只记录**当前 raw source 可证明**的接线事实，供主控（parent）后续集成使用。
它不重设计规则，不签发任何 ready 进度，也不代表任何验收项通过。文中 `symbol` 保持
源码原样，其余为中文。官方目录/镜像缺省不存在，本地目录计数**不作为最终计数**，
不得复用历史 52 项 source census 或 1836 之类旧计数当作当前结论。

## 1. 本文的证据口径与环境

- 工作目录 `/home/zeron/projects/riftbound-resume-20261013-01a13560` 当前**没有 `.git`**：
  `git status` / `git rev-parse` 均以 `fatal: not a git repository` 退出，因此无法核实分支、
  提交或脏工作树；本执行者未做任何 Git 写操作。
- Node `v22.22.2`；pnpm 由
  `/home/zeron/projects/riftbound-resume-20261013-01a13560-tooling/node_modules/.bin/pnpm`
  提供（`11.9.0`）；`PATH` 为该 bin + `/usr/local/bin:/usr/bin:/bin`。
- 本执行者独占写域仅为 `docs/full-product/strict-runtime-contracts.md` 与本 artifact 目录
  `outputs/coordination/resume-20261013/artifacts/strict-runtime-integration-document`。
  验证一律在独占 artifact mirror 内进行（见 `REPORT.md`），**不写 shared `dist`**。
- 采样时间窗：2026-10-13 约 18:20-18:27 UTC。其他 workstream 正在并发写入**非本表**的新文件
  （如 `apps/game-server/src/duel/operation-journal-v2.ts`、`packages/engine-core/src/duel/engagement-executor-v2.ts`）；
  本文所有事实**只绑定下表 SHA-256 的采样内容**。若这些文件随后变化，主控须以最新源码复核，勿直接沿用本文结论。

- 采样源文件 SHA-256（以当前磁盘内容为准）：

| 文件 | sha256 |
| --- | --- |
| `packages/engine-core/src/duel/core-v2.ts` | `23afadb784155117fc2b274fcfcac06ee087f806b94e6ab3685db5c267eba48f` |
| `packages/engine-core/src/duel/turn-executor-v2.ts` | `5e93df8e7702c8e4bf6f7b3f7797e4d379fa1463fd054a47e24ae11540abedbe` |
| `packages/engine-core/src/duel/cardplay-unit-v2.ts` | `538808a8dfc76f567ef65131978f88a8577e1a009811d90f7a44e323c96bc01a` |
| `packages/protocol/src/duel-actions-contract-v3.ts` | `baf33a05fc3cbef6adacc67296e598ba2ea25c2461fdadacab99534056449856` |
| `apps/game-server/src/duel/authoritative-runtime-p4.ts` | `1e6ab74e823a74a5e73da0255bf0056ae79defff3cd2c114dd1955f0db249897` |
| `apps/game-server/src/duel/production-source-services-v2.ts` | `1d4be94d67ed92ae45f749aa47f9bd624f4726d86ba3497c8e71d37d8908a510` |
| `apps/game-server/src/duel/persistent-command-runtime-v3.ts` | `63f50aa0d1c30a04eaefe76c8d60c3fb35842e7761f6f8955799c63ff1e0c316` |
| `apps/game-server/src/server.ts` | `29e2a038bfb763caf033400bec1d80fce540b56c44de4e5d3cf145e8a5b39c19` |
| `apps/game-server/src/room.ts` | `6d7f1c55277fc9e24590bd76b931cdf805543fcd6fed85dd984ad01e26c9d90e` |
| `apps/desktop-client/src/net/GameClient.ts` | `da9e5b53691969ed51676e11ffff63d9dddf5839535dcff601999580bec2428e` |
| `apps/desktop-client/src/full-product/components/DuelActionsPanelV3.tsx` | `af658d5b591a9dedc4dca164c548782f84577c7e014088adace8b5f0e1779735` |

## 2. 当前权威运行时（P4）在源码中的真实状态

### 2.1 服务器房间仍走 V1/V2/V3 facade，P4 未路由

- `apps/game-server/src/server.ts` 的 `case "duel-command"`（约 `:684`）只接受
  `isDuelCommandMessage(parsed)`（V1/V2/V3 旧五命令包），否则抛
  `RoomError("当前房间尚未启用该对局动作协议", "command-rejected")`（约 `:687`）。
  也就是说公共 socket 从未把 P4 包路由到任何运行时。
- `apps/game-server/src/room.ts` 只导入并调用 `./duel/runtime.js` 的
  `createDuelRuntimeSession` / `executeDuelRuntimeCommand` / `projectDuelRuntime`
  （约 `:44-48`、`:402`、`:497`、`:980`），发布 `DUEL_PROJECTION_SCHEMA_V2` 投影。
- `apps/game-server/src/duel/authoritative-runtime-p4.ts` 完整存在，但**没有任何生产文件引用它**：
  在该文件中搜索 `authoritative-runtime-p4` / `createDuelAuthoritativeRuntimeP4` 的引用只会命中
  它自身（以及 `docs/full-product/*` 的说明文字）。它**未接入 `room.ts` / `server.ts` / barrel**。
- 该模块自述 `durability: "in-memory"`（`:107`、`:455`）：owner 明确不声明 archive/restart 能力。

主控若要把 P4 投入运行，需要自己完成 barrel/合约/路由/`room.ts` 接线；这些均属 parent 写域，
本文只登记实际输入输出，不代为集成。

### 2.2 P4Actions 协议类型/版本与「完整 body 发送」

- `packages/protocol/src/duel-actions-contract-v3.ts` 定义：
  - `DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1 = 'riftbound-duel-v3-actions-1'`（`:28`）
  - `DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1 = 'duel-command-v3-actions-1'`（`:30`）
  - `DUEL_PROJECTION_SCHEMA_V2_ACTIONS_REJECTED = 'riftbound-duel-v2-actions-1'`（`:32`，仅留存历史名，
    从不作为别名接受）
  - `DuelWireCommandV3Actions1`（`:57`）：旧五命令 + 八个 P4 动作
    （`play-card` / `activate-ability` / `pass-priority` / `pass-focus` / `standard-move` /
    `answer-pending-choice` / `assign-combat-damage` / `end-turn`）。命令体只携带不透明
    选择 token/UID 与 `expectedVersion`，**不携带** Might/伤害/proof/评分等自证权威字段。
  - `DuelCommandMessageV3Actions1`（`:72`）带显式 `commandProfile` 标签；`DuelProjectionV3Actions1`（`:140`）。
- 该模块顶部注释明确：**它不扩大 `isDuelCommandMessage` / `isDuelProjectionAny`，也不在共享
  index union 注册新消息；barrel/路由接线由 parent 拥有，尚未完成**。`packages/protocol/src/index.ts`
  末尾以 `// Standalone P4 data contract. Public message routing remains on the existing profiles.`
  + `export * from "./duel-actions-contract-v3.js";`（约 `:1204-1205`）只做类型/守卫导出。
- 客户端发送路径 `apps/desktop-client/src/net/GameClient.ts`：
  - `submitDuelCommandPacket`（`:307`）先做 `isDuelCommandMessageV3Actions1`、`projectionSchema === DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1`、
    `expectedVersion === match.stateVersion` 三重校验，再走 `submitDuelOperation`。
  - `submitDuelOperation`（`:316`）用 server 投影里的 `actions` 做精确动作映射（`matchesP4Action`，`:354`），
    拒绝不在服务端可用选项中的提交；`UT`/UID/payment 不能自造。
  - `sendPendingCommand`（`:583`）：P4 命名空间下携带 `duelCommandProfile` 时，发送
    `{ type: "duel-command", commandProfile, requestId, commandId, expectedVersion, command }`
    的**完整 body**；重连重发保留冻结的 `expectedVersion/eventSeq`（Duel 命令不 rebase）。
  - `DuelActionsPanelV3.tsx`（`:555`）以 `DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1` 组装并通过
    guard 后才交出 packet；组件只按 server `enabled/reason` 门禁，不算伤害/cost/authority。

### 2.3 旧房间对 P4 的安全拒绝

- 旧房间拒绝发生在两处，且均为 fail-closed：
  1. 服务端 `server.ts:684` `case "duel-command"`：不是旧包即抛 `command-rejected`，P4 包在未选择
     P4 profile 的房间被拒收。
  2. `room.ts:submitDuel`（`:964`）再次 `isDuelCommandMessage(message)` 校验，非法即
     `RoomError("Invalid duel command", "protocol-error")`。
- 客户端侧 `GameClient.ts:318-346` 依 `duelProjection` 的 `projectionSchema` 选择
  `isDuelCommandV3Actions1` 或 `isDuelCommand`：若当前投影不是 P4 profile，就不会把 P4 命令当作合法命令。
  跨 P3/P4 的重连不会静默混用（`GameClient.ts:1128-1129` 对 profile 变化做处理）。
- 结论：**「旧房间拒收 P4」在当前源码成立**；但这是拒绝语义，不等于 P4 已能在任何房间被接受。

### 2.4 P4 owner 的实际内部依赖（接线必须注入的输入）

`createAuthoritativeDuelRuntimeP4`（`apps/game-server/src/duel/authoritative-runtime-p4.ts:248`）需要：

- `catalog: CardCatalogRuntime`（已加载目录运行时）。
- `roster`：可信双座（`DuelAuthoritativeRuntimeSeatP4`，含 `playerId/displayName/deck`），
  **绝不从 P4 命令包读取**。
- `matchId`、`randomIndex`、可选 `uidFactory`。
- `globalJournal?` 是私有测试/故障注入入口。缺省构造实际 `createDuelNativeOperationJournalV2`，
  从 pristine setup、原生提交祖先链和 genuine programs 观察当前 head；缺失或未知来源仍阻断推进。
- 内部构造：`createDuelCommandSessionV2(setup.seats, setup.metadata, randomIndex, typeResolver.forMatch(...))`
  → `createDuelUnitPlaySessionV2(...)`；side services 由 `createDuelProductionSourceServicesV2`
  组合，含 `programs` / `cost` / `costBinding` / `entry` / `turn` / `move`。
  基本 engagement 由 `engagement-services-v2.ts` 绑定当前 head、完整来源检查和派生 Might。

产出为 `DuelAuthoritativeRuntimeP4`：
- `project(viewer)` → `DuelProjectionV3Actions1`（先过 `isDuelProjectionV3Actions1`，`:353`）。
- `dispatch(actor, packet)` → `{ ack, projection }`；`ack` 为 `request-result | error | blocked`。
- `resumePending()` → 续跑实际 Turn/Move 或 engagement 的非玩家选择边界。
- 当前 `dispatch` 已支持有限 StandardMove、Focus 和基本 Combat。玩家选择绑定实际 actor、
  window/choiceId 和版本；未实现的效果、响应及选择仍保持 `blocked`。

### 2.5 当前草稿与 working 源的差异（重要，勿混用）

`outputs/.../authoritative-p4-runtime-owner/authoritative-runtime-p4.ts` 与当前
`apps/game-server/src/duel/authoritative-runtime-p4.ts` **不同**：草稿里曾用
`journalSnapshot()` 从 head 现造「空 ledger + 完整候选 census」来自签 global closure，并
把 `fepr` 返回 `none`。当前 working 源使用实际原生日志与 private proposal fork，
按每个实际 head 观察提交。只有已绑定的事实与来源闭合、owned queue/Chain/FEPR 均无未完成项，
有限路径才可继续；不能把此有限 owner 当作所有官方卡牌处理器已实现。
主控应以 working 源为准，不得复用草稿的空 ledger 自签方案。

## 3. canonicalUnit / 资源 / Turn / Move / Chain / Effect 调用链

### 3.1 Core 原生提交链与两枚 native 检视 API（核心事实）

`packages/engine-core/src/duel/core-v2.ts`：

- `const live = new WeakMap<object, DuelLiveAuthorityV2>()`（`:204`）：只有经 `admitted(...)`（`:213`）
  放入的对象才是 admitted；`assertAdmittedDuelMatchV2`（`:273`）先做成员检查再读属性。
- `admitted(...)` 用 `parent` 记录父状态与 `origin` 能力（`:213-224`）：**进程内对象身份链**。
- `inspectDuelNativeCommitPathV2(ancestor, descendant)`（`:236`）：仅遍历真实 Core 提交，
  逐步校验 `stateVersion`/`eventSeq` 各 +1、`transitions` 前缀一致、token history 单调，
  返回每步 `DuelNativeCommitV2`（`:227`，含 `before/after/transitions/tokenBirths/tokenRetirements`）。
  **等 metadata/JSON、独立 restore 出来的新 root 都不接入旧链**（`restore` 产生新 origin）。
- `inspectDuelNativeTokenHistoryV2(state)`（`:267`）：读取被独立 admit 的 token 历史。

**边界**：这两枚 API 只证明**本进程内**由 Core 提交形成的对象身份链，**不证明**来源语义、
调用者权限、快照认证或**跨进程/重启的历史连续性**。`restoreDuelPlayingStateV2`（`:790`）必产新 root。
因此它**不是 durable 证明**，跨重启续链需要另行独立的 ledger/cursor journal。

### 3.2 可信变更与动作入口（core-v2）

- `commitDuelPlayingMutationV2(state, mutate)`（`:972`）：通用可信变更包装；真 no-op 返回同一对象。
- `commitDuelCombatDealMutationV2(state, completion, mutate)`（`:983`）：仅战斗桥接可记录真实
  Deal（含零伤害），要求当前 active battlefield 且 `pendingPayment === null`。
- 资源/载体：
  - `channelDuelRunesV2`（`:1143`）、`createDuelGoldTokenV2`（`:1041`，须经
    `attestDuelTokenSourceV2`（`:1027`）的真实 attestor 或已签发一次性 `DuelTokenCreationAuthorityV2`）、
    `createDuelRecruitUnitV2`（`:1090`）、`killRetireDuelUnitTokenV2`（`:1121`）。
  - 物理/装备：`attachDuelGearV2`（`:1166`）、`moveDuelUnitV2`（`:1173`）、
    `registerDuelGearFromTrustedSourceV2`（`:1197`）、`removeDuelGearToOwnerTrashV2`（`:1217`）、
    `enumerateDuelObjectsV2`（`:1163`）。

### 3.3 组合会话层（cardplay-unit-v2）

`packages/engine-core/src/duel/cardplay-unit-v2.ts`：
- `DuelUnitPlayServicesV2`（`:97`）：必含 `programs`（`DuelOfficialProgramRegistry`）、`cost`
  （`DuelCostResolverAuthorityV2`）、`costBinding`、`entry`；可选 `turn`（`DuelTurnServicesV2`）、
  `move`（`DuelUnitMoveServicesV2`）。**缺 `turn` 则回合命令保持 blocked**；缺 `move` 则 Move 恒 blocked。
- `createDuelUnitPlaySessionV2`（`:353`）、`applyDuelUnitResourceCommandV2`（`:371`）、
  `playDuelNoAbilityUnitToBaseV2`（`:432`）、`startDuelUnitTurnV2`（`:636`）、`endDuelUnitTurnV2`（`:640`）、
  `resumeDuelUnitTurnV2`（`:644`）、`applyDuelUnitStandardMoveV2`（`:760`）、
  `resumeDuelUnitStandardMoveV2`（`:842`）。
- Move 结算 `settleMove`（`:699`）要求 `services.move.triggers(...)` 返回
  `{ status: 'settled', disposition: 'no-triggers', taskId, movedVersion, events }` 且与该次
  continuation 完全一致；否则保持 `pending`，**不会**以空 trigger 冒充结算。
- 回归测试 `packages/engine-core/test/duel-cardplay-unit-v2.test.mjs` 覆盖该组合面。
- 无能力 Unit 的单次原子出牌保留实际 `Hand → shared Chain → Base` 两段物理转移，
  epoch 增加两次、canonical clock 增加一次。`chainCards` 是真实共享物理存储，不能仅用 effect item 替代。

### 3.4 Turn 执行与 observeCheckpoint（真实 head + 拒绝 pending 续玩语义）

`packages/engine-core/src/duel/turn-executor-v2.ts`：
- `DuelTurnServicesV2`（`:44`）含 `sources`（`DuelPhaseRegistryV2`）、可选 `observeCheckpoint`（`:51`）、
  `lethalEvaluators` / `approveLethal` / `fepr` / `firstBurnout` / `burnoutIntervention` / `randomIndex` /
  `resolveHandlers`。缺失的 resolver 一律使该边界保持 `pending`。
- `observeCheckpoint` 语义（`:262-268`）：在每个边界拿到 `DuelTurnCheckpointV2`（含 `match/turn/taskId/step/event`）
  的**真实 admitted head**；返回非 `true`（或抛错）时调用 `wait(...)`：
  **保留当前已提交 head 并把 `pendingTaskID` 置为当前 task，不能回滚已提交步骤**。`observeCheckpoint`
  缺席时视为 `true`（`:264`）。测试 `duel-turn-checkpoints-v2.test.mjs` 验证：观察者拒绝后 head 保持、
  cursor 保持精确 continuation；终局交接被拒仍 pending 且可续、不会多加一个 turn；观察者抛错则 fail-closed，
  克隆 cursor 不能触发观察者。
- `cursorBonds`（`:104`）是私有 in-process cursor 绑定：任意克隆/JSON sidecar 无权威，
  archive restore 需独立 ledger + cursor journal 证明。
- 入口：`runDuelStartOfTurnV2`（`:493`）、`resumeDuelStartOfTurnV2`（`:514`）、
  `runDuelEndOfTurnV2`、`resumeDuelEndOfTurnV2`。resume 只接受**精确 outstanding task**
  （`pendingTaskID === taskId` 且 resolution 形状匹配），**不存在裸 no-effect 续跑**（`:514-522`）。

### 3.5 Chain / Effect 面

- `packages/engine-core/src/duel/chain-v2.ts` 定义内部 Chain 内核（`DuelChainV2`、`DuelChainContinuationV2`、
  `DuelChainPhaseV2` 等），经 `packages/engine-core/src/duel/index.ts:36` 导出。
- Effect 执行器：`draw-effect-executor-v2.ts`、`kill-damage-effect-executor-v2.ts`、
  `combat-damage-executor-v2.ts`、`conquer-v2.ts`、`standard-move-executor-v2.ts`。
- 来源闭包账本契约在 `phase-source-closure-v2.ts`：`DuelPhaseSourceClosureJournalInputV2`（`:236`）
  固定要求 `tokenReferences / preExitSources / drawSubjects / transitions / activeEffects / chain /
  effectQueue / feprOutstanding`，并逐项校验 clock、taskId、ledger kind。**空的候选集或无来源闭包
  不能作为完成证明**；未知文本/未持证 no-effect 保持 `pending`/`blocked`。

## 4. production-source-services：exact-head + 真实 globalJournal 要求

`apps/game-server/src/duel/production-source-services-v2.ts`：

- `createDuelProductionSourceServicesV2`（`:139`）构造时强校验：`matchId` 非空、`currentHead` 为函数、
  `globalJournal.read`/`tokenBirth` 均为函数、且目录 `dataVersion/digest` 与 `programs.catalogStamp`
  完全一致；再要求首个 `currentHead()` 为 admitted 匹配头（`:157-166`）。
- `head()`（`:161`）：每次读取都重新校验 stage/dataVersion/digest 并 `assertAdmittedDuelMatchV2`，
  失败返回 `null`。
- `snapshot(h, c)`（`:171`）：要求 `globalJournal.read(c)` 返回 `scope:"exact"`、
  `status:"resolved"` 的完整快照；将其 `candidateKeys` 与 Core census + `preExitSources` + runtime effect
  账本**逐一比对**（含去重与排序）；`coverage` 每项需非空 proofId 且 journalRevision 一致；
  **若解析期间 head 变化即返回 `null`**。
- `inspect(c)`：无有效 head 或快照时返回 `pending("stale-or-foreign-head")` 或
  `pending("missing-exact-global-journal")`（`:206`）；只有 `createDuelPhaseSourceClosureJournalV2(global.input)`
  在精确头下通过才返回 ready。
- `entry` / `costBinding` / `derivedMight` 均各自 fail-closed（derivedMight 依赖 `continuous-effect-registry`
  覆盖）；`tokenBirth(uid)` 需受保护出生记录 + executor 决策。

**与第 3.1 节的关系**：production-source-services 要求的是**外部 protected globalJournal**
（当前源码中**没有**提供持久化实现；`authoritative-runtime-p4.ts` 仅把它当注入依赖）。而 Core
`inspectDuelNativeCommitPathV2` 只提供**进程内 native 提交链**。因此：

> 新 Core native commit ancestry **只是 in-process 证据，非 durable 证明**。把二者串起来时，
> 主控仍需自行实现「受保护的单写 globalJournal + cursor/token journal + CAS/fencing」，
> 并在 save-before-ACK 与崩溃重启后再验证续链，才能谈论 durability。

## 5. 持久化/命令日志现状（P3 边界，未被 P4 使用）

- `apps/game-server/src/duel/command-journal-v2.ts` + `private-journal-cas-store.ts` +
  `persistent-command-runtime-v3.ts`：记录**既有五类命令**，单写 CAS、save-before-ACK、
  duplicate 重新确认、目录 `fsync` 失败后要求重开（见 `private-cas-durability-recovery-fix`）。
- `persistent-command-runtime-v3.ts` 的 `PERSISTENT_DUEL_PROJECTION_PROFILE_V3 = "P3"`，
  只支持 P3；它**不记录** turn/Move/Combat/来源 ledger/cursor，也不接 P4 owner。
- 因此 P4 的 durability 目前完全空缺：owner 自身声明 `"in-memory"`。

## 6. 主控集成必须接的实际输入/输出与源码路径

| 环节 | 必须提供 | 实际源码路径 |
| --- | --- | --- |
| 目录 | `CardCatalogRuntime`（已加载、含 `publicCatalog.cards/dataVersion/digest`） | `apps/game-server/src/card-catalog.ts` |
| 座次/牌组 | 可信双座 + 已校验牌组 | `apps/game-server/src/duel/setup-seats.ts`、`apps/game-server/src/deck-validation.ts` |
| P4 owner | `createDuelAuthoritativeRuntimeP4({ catalog, roster, matchId, randomIndex, uidFactory?, globalJournal? })` → `{ project, dispatch, resumePending, durability }` | `apps/game-server/src/duel/authoritative-runtime-p4.ts` |
| 来源闭包 | `globalJournal = { read(context), tokenBirth(uid) }`，返回 `DuelProtectedGlobalSourceSnapshotV2` | `apps/game-server/src/duel/production-source-services-v2.ts` |
| 来源桥接 | `createDuelPhaseSourceServerBridgeV2` 等 | `apps/game-server/src/duel/phase-source-bridge-v2.ts` |
| 程序权限 | `createCardProgramAuthority` / `getCardProgramRegistryForRuntime` | `apps/game-server/src/duel/card-program-authority.ts` |
| 类型解析 | `createCatalogCardTypeResolverV2(...).forMatch(metadata)` | `apps/game-server/src/duel/catalog-card-type-v2.ts` |
| 房间路由 | 在 `room.ts`/`server.ts` 增加 P4 房间的选择与 `dispatch` 调用、发布 `DuelProjectionV3Actions1` | `apps/game-server/src/room.ts`、`apps/game-server/src/server.ts` |
| 协议 barrel | 若要公开路由 P4，需 parent 决定 `ServerToClientMessage`/`ClientToServerMessage` 联合与路由 | `packages/protocol/src/index.ts`、`packages/protocol/src/duel-transport-contract.ts`、`packages/protocol/src/duel-actions-contract-v3.ts` |
| 客户端 | 消费 P4 投影、`submitDuelCommandPacket` 完整 body | `apps/desktop-client/src/net/GameClient.ts`、`apps/desktop-client/src/full-product/components/DuelActionsPanelV3.tsx` |

集成是 parent 职责（shared contracts/barrel/依赖/lockfile）。本执行者不越域改这些文件。

## 7. 验证命令与日志路径规则

- 一律使用指定 pnpm：`/home/zeron/projects/riftbound-resume-20261013-01a13560-tooling/node_modules/.bin/pnpm`。
- 只在独占 artifact mirror 内编译/测试，**不写 shared `dist`**；`TMPDIR`/cache/logs 指向 artifact。
- 运行环境**不得读取或输出任何 credential / secret / resumeToken / 大段工具日志**。
- 本执行者本轮实测（隔离 mirror `.../strict-runtime-integration-document/mirror`，日志见同目录 `logs/`）：

| 命令 | exit | 结果 | 日志 |
| --- | ---: | --- | --- |
| `tsc -p packages/protocol/tsconfig.json`（mirror） | 0 | 编译通过 | `mirror/logs/tsc-protocol.log` |
| `tsc -p packages/card-dsl/tsconfig.json`（mirror） | 0 | 编译通过 | `mirror/logs/tsc-card-dsl.log` |
| `tsc -p packages/engine-core/tsconfig.json`（mirror） | 0 | 编译通过 | `mirror/logs/tsc-engine-core.log` |
| `node --test .../duel-native-commit-path-v2.test.mjs` | 0 | 3 pass / 0 fail / 0 skip | `mirror/logs/test-native-commit-path.log` |
| `node --test .../duel-turn-checkpoints-v2.test.mjs` | 0 | 4 pass / 0 fail / 0 skip | `mirror/logs/test-turn-checkpoints.log` |
| `node --test packages/engine-core/test/*.test.mjs`（mirror） | 0 | **608** pass / 0 fail / 0 skip（**仅 engine-core mirror**） | `mirror/logs/test-engine-core-all.log` |

**注意**：上表 `608` 只是本镜像 engine-core 的当前实际计数，**不是**全工作区计数，也**不替代**
历史 1836 等旧数字；主控在正式验收时须自行重跑全量。

## 8. 尚未签收的验收边界（不得据此标完成）

- **公开 Main / 完整对局恢复**：P4 未路由，公共房间仍 V1。内部 owner 已跑通有限 Move/Focus/Combat/计分，
  实际官方目录牌组完成 40 条命令、17 回合、8 分；这不是公开双 GUI 或持久化恢复证明，未知效果保持 judge-required。
- **重启持久化**：P4 owner `durability:"in-memory"`；P3 命令日志不含 turn/Move/Combat/来源 ledger/cursor；
  跨进程 native 链不保留（第 3.1 节）。`RIFTBOUND_STORAGE_DIRECTORY` 的 durability 声明须有独立重启/恢复验证。
- **双 GUI / 双客户端整局**：本文不含任何双进程/双 GUI 整局证据。
- **Tauri / Windows**：桌面壳与 Windows 打包不在本轮证据内（`bundle.targets=["nsis"]` 为 Windows-only 的历史观察）。
- **计数口径**：官方目录/镜像缺省不存在；本地计数不等于最终计数；effect coverage 生成态 executable 为 0；
  绑定不等于执行。不得复述旧 census/1836 作为当前结论。

以上均为**当前 raw source 可证明的接线事实**，供 parent 后续以最终事实自行调整；本文本身**不是**验收通过。
