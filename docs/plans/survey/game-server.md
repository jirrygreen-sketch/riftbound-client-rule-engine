# Game Server 收敛调查

调查日期：2026-10-15。范围是 `apps/game-server/src/**`、对应的
`apps/game-server/tests/**`，以及只读参考 `/root/swarm-rift/shared/redesign.md`。
本文把代码中已经存在的事实与基于重设计目标的建议分开；“建议”不代表当前
protocol、engine-core 或 journal contract 已经变更。

## 结论先行

当前服务端有三层并行实现：

1. 公网 `GameRoom` 的旧 Duel V1 路径：`duel/runtime.ts`，库工厂默认走它。
2. 公网 `GameRoom` 的 P4 路径：`duel/authoritative-runtime-p4.ts`，覆盖
   V3 actions、native operation journal、Spell、optional Unit、physical chain
   和 engagement；主入口 `index.ts` 默认选择 P4，并在未设置环境变量时把
   runtime profile 解析为 `optional-unit-choice-clock-v4`。
3. 没有接入 `server.ts` 房间生命周期的 full-product runtime/orchestrator
   实验路径。

因此，建议以 `authoritative-runtime-p4.ts` 的能力集合为当前唯一 runtime 的
迁移基线，把 V2/V3 facade、旧 V1 session/journal、P3 durable adapter 和
full-product 房间编排实验逐批迁出；`private-journal-cas-store.ts` 作为存储
原语保留。当前源码仍按 profile 和 journal schema 分叉，不能把这份建议当作
已完成的收敛实现。

## 证据和计数口径

源码总量是 49 个 TypeScript 文件、21,529 行；文件级计数来自：

```text
wc -l $(rg --files apps/game-server/src | sort)
```

本次调查的原始静态索引保存在 `/tmp/RIFT-8-survey-game-server/`：

- `line-counts.txt`：每个源文件的 `wc -l` 结果。
- `imports.txt`：import/export 行索引。
- `local-imports.txt`：只保留 `apps/game-server/src` 内部相对依赖的简化图。
- `duel-index.txt`：Duel 文件的导出与 import 索引。
- `callers-focused.txt`、`runtime-refs.txt`：服务 factory、runtime、journal 的调用搜索结果。

行号均按当前 worktree 的 `nl -ba` 读取；后续修改源码后需要重新核对。

## 源文件清单

下表的“关系”同时记录直接 import 关系和主要被调用关系；完整的相对 import
边见 `/tmp/RIFT-8-survey-game-server/local-imports.txt`。

### 目录、卡牌和房间基础层

| 文件 | 行数 | 职责 | 主要关系与代码出处 |
|---|---:|---|---|
| `apps/game-server/src/card-catalog.ts` | 753 | 加载、校验、规范化卡牌目录，提供图片 manifest、路径和目录级 deck 校验。 | 被 `server.ts`、`room.ts`、`file-room-store.ts`、Duel services 使用；类型和 loader 在 `:20-110`，目录/deck/image API 在 `:490-679`。 |
| `apps/game-server/src/deck-validation.ts` | 679 | 定义 deck/card/zone 结构并执行通用数量、区域和基础合法性校验。 | 被 `card-catalog.ts`、`constructed-policy.ts`、`setup-seats.ts` 使用；import 在 `:1-15`，公开校验 API 分布在 `:80-679`。 |
| `apps/game-server/src/constructed-policy.ts` | 1125 | 构筑赛制、印刷品身份、禁限用和 deck policy；在 catalog deck 校验之上增加产品规则。 | 依赖 `deck-validation.ts`，被 `card-catalog.ts` 和 regional context 使用；依赖在 `:1-8`，规则工厂在 `:409-679`。 |
| `apps/game-server/src/constructed-regional-availability.ts` | 254 | 纯数据的地区发行日/可用性计算；缺失日期返回 unknown。 | 只被 `constructed-regional-context.ts` 使用；模块边界说明在 `:1-25`，评估函数在 `:164-254`。 |
| `apps/game-server/src/constructed-regional-context.ts` | 158 | 绑定并验证地区上下文，按地区过滤 catalog，并执行 regional deck 校验。 | 依赖 availability、constructed policy、catalog、protocol；公开绑定/验证/过滤在 `:102-158`。 |
| `apps/game-server/src/constructed-regional-policy.ts` | 251 | 对外提供 regional 构筑 policy 视图和校验组合。 | 依赖 `constructed-policy.ts`、availability、deck validation；import 在 `:1-8`。它不直接创建 Duel runtime。 |
| `apps/game-server/src/foundation-game.ts` | 195 | Foundation ruleset 的 engine-core state 创建和 command 提交适配。 | `room.ts` 在 `:54` import，房间启动和 command 路径调用；公开 factory 在 `:1-195`。 |
| `apps/game-server/src/room-chat.ts` | 146 | 私有聊天 ledger、游标、消息校验和增量读取。 | `room.ts` 在 `:44-48` import；`room.ts` 的 archive、send/read/chat 广播使用它。 |
| `apps/game-server/src/room-store.ts` | 63 | `RoomStore` contract 和默认 `InMemoryRoomStore`。 | `server.ts` 在 `:35-36` import；接口和内存实现是 `:9-53`。 |
| `apps/game-server/src/file-room-store.ts` | 321 | 可选文件 room store；按 roomId hash 目录定位 archive，负责 load/save/list/restore 和写失败封存。 | 依赖 `room.ts`、catalog、`full-product/persistent-room-store.ts`，见 `:19-22`；核心 CRUD 在 `:29-125`，扫描恢复在 `:138-210`，hash 路径在 `:220-237`。 |

### Duel runtime、journal 和服务

| 文件 | 行数 | 职责 | 主要关系与代码出处 |
|---|---:|---|---|
| `apps/game-server/src/duel/authoritative-runtime-p4.ts` | 1574 | 当前功能最完整的 P4 authoritative owner；组装 setup、CardProgramAuthority、source services、operation journal、Spell、optional Unit、physical chain、engagement 和 V3 projection。 | 依赖清单集中在 `:96-117`；profile/semantic 常量在 `:125-157`；factory 与开关在 `:373-420`；production services 在 `:577-684`；命令 dispatch 在 `:1190-1545`。 |
| `apps/game-server/src/duel/card-program-authority.ts` | 524 | 把已加载 catalog 绑定为受信任 card-dsl program registry；区分 source identity 和 execution permission。 | P4、phase bridge、各 production service 依赖；registry factory 在 `:437-524`。Gear、Beginning、Point 等扩展只授予 source authority 的事实在 `:465-524`。 |
| `apps/game-server/src/duel/catalog-card-type-v2.ts` | 118 | 为 catalog card type 建立带 dataVersion/catalogDigest 的 trusted resolver。 | P4 在 `authoritative-runtime-p4.ts:100,391-395` 使用；公开 resolver 见 `:1-118`。 |
| `apps/game-server/src/duel/setup-seats.ts` | 412 | 校验 trusted roster/deck，分配真实物理 UID，建立 Duel setup metadata。 | `runtime.ts`、`runtime-v2.ts`、P4 都依赖；factory 在 `:309-412`。 |
| `apps/game-server/src/duel/runtime.ts` | 186 | 旧 Duel V1 内存 facade：创建 `DuelCommandSession`、V1 projection、旧 command executor。 | `room.ts:56-59,1230-1245` 直接使用；factory/executor 在 `:37-186`。 |
| `apps/game-server/src/duel/runtime-v2.ts` | 331 | V2 engine capability adapter，封装 V2 session、resource projection、turn/payment continuation 和 command execution。 | `runtime-v3.ts`、`command-journal-v2.ts` 使用；V2 API 在 `:80-331`。 |
| `apps/game-server/src/duel/runtime-v3.ts` | 167 | V3 wire/projection facade，复用 V2 session 和 executor，不拥有独立完整 engine。 | `authoritative-runtime-p4.ts:108` 和 P3 durable adapter 使用；显式复用关系在文件注释 `:1-7`，实现 API 在 `:84-167`。 |
| `apps/game-server/src/duel/session-archive.ts` | 435 | 旧 V1 Duel session archive 编解码、trusted restore 和旧 command/session receipt 校验。 | `room.ts:6-8,403-414` 使用；archive API 在 `:415-435`。 |
| `apps/game-server/src/duel/session-archive-v2.ts` | 1024 | V2 committed archive，包含 match/session/cursor/receipt/task 等更完整状态校验。 | 主要由 V2/archive tests 直接使用；公开 export/restore 在 `:1014-1024`。没有被当前 P4 room 直接 import。 |
| `apps/game-server/src/duel/command-journal-v2.ts` | 430 | P3/V2 私有 command journal recorder/replayer，记录随机 entropy、command outcome、clock 和 session hash。 | 依赖 `runtime-v2.ts`/`runtime-v3.ts`，见 `:1-27`；sealed journal 和 replay gate 在 `:305-430`。 |
| `apps/game-server/src/duel/command-journal-p4.ts` | 362 | P4 recorded owner、archive digest、profile/schema gate 和 replay。 | 依赖 `authoritative-runtime-p4.ts`，见 `:1-27`；公共 archive 形状在 `:36-57`，schema/profile 选择在 `:242-280`，恢复 gate 在 `:286-362`。 |
| `apps/game-server/src/duel/persistent-command-runtime-v3.ts` | 397 | P3 durable adapter；以 `command-journal-v2` 为 authority，使用 private CAS store 做受保护写入。 | 依赖 journal-v2、runtime-v3、CAS，见 `:20-37`；数据 profile P3 在 `:39-60`。未接入 `GameRoom`。 |
| `apps/game-server/src/duel/persistent-command-runtime-p4.ts` | 110 | P4 durable adapter；恢复 P4 archive、依据 schema 反推 historical profile，并通过 CAS compare-and-swap 发布。 | 依赖 P4 journal/owner/CAS，见 `:1-16`；schema→profile 选择在 `:35-44`，CAS owner 在 `:47-86`，factory 在 `:88-110`。 |
| `apps/game-server/src/duel/private-journal-cas-store.ts` | 921 | private journal 的 CAS store contract、文件实现、head/revision/nonce、写失败和恢复边界。 | 两个 persistent command runtime 依赖；contract/factory 在 `:22-76,843-920`。它是存储原语，不是第三条 runtime。 |
| `apps/game-server/src/duel/operation-journal-v2.ts` | 1057 | native operation/path、source/cost census、effect ledger、zone/token transition、current/observed head 和 proposal fork。 | P4、hold-recruit、optional、spell、point、printed-chain 依赖；接口在 `:178-221`，实现贯穿 `:242-1057`。 |
| `apps/game-server/src/duel/phase-source-bridge-v2.ts` | 356 | 将受信任 catalog/program authority 绑定到 engine-core V2 source-closure registry；无法证明时保持 unknown/pending。 | `production-source-services-v2.ts` 和 printed-chain 使用；边界原则在 `:1-9`，factory 在 `:170-356`。 |
| `apps/game-server/src/duel/production-source-services-v2.ts` | 456 | P4 production source seam：phase registry、source inspection、Unit entry facts、Unit/Spell cost binding、derived Might。 | 依赖 card authority、phase bridge、operation journal，见 `:1-30`；接口在 `:102-113`，factory 在 `:166-456`。P4 在 `authoritative-runtime-p4.ts:580-606` 创建。 |
| `apps/game-server/src/duel/engagement-services-v2.ts` | 88 | source-qualified cleanup/combat/lethal/FEPR/burnout/draw proof；不完整的 source closure 返回 pending。 | 依赖 production source services；factory 在 `:10-88`，P4 在 `authoritative-runtime-p4.ts:609-629` 使用。 |
| `apps/game-server/src/duel/p4-spell-services.ts` | 705 | P4 Spell 服务，包含 Draw/Kill 以及显式 opt-in 的 Point damage Spell；负责 cost census、source proof 和 spell session。 | 依赖 catalog、card authority、operation journal，见 `:1-30`；普通 factory 在 `:111-143`，Point factory 在 `:146-705`。P4 在 `authoritative-runtime-p4.ts:801-825` 按需创建。 |
| `apps/game-server/src/duel/point-spell-production-services-v1.ts` | 6 | Point Spell service 的公共 re-export。 | 只 re-export `p4-spell-services.ts`，见 `:1-6`；没有独立 runtime wiring。 |
| `apps/game-server/src/duel/point-effect-production-services-v1.ts` | 368 | 为 engine-core Point damage authority 提供 current-head/source/Might/census callbacks；不直接改 state。 | 依赖 card authority 和 production source，见 `:20-23`；factory 在 `:125-180`。当前 P4 owner 没有 import。 |
| `apps/game-server/src/duel/hold-recruit-executor-v1.ts` | 478 | 一个经过审查的 Hold→Recruit token birth executor；entry/replacement/cost/trigger proof 不完整时保持 pending。 | 依赖 card authority、operation journal、production source，见 `:28-35`；factory 在 `:177-478`。当前 P4 owner 和 `room.ts` 都没有 import，只有测试直接调用。 |
| `apps/game-server/src/duel/optional-unit-services-p4.ts` | 536 | optional Unit 的 source/program/cost/costBinding/entry/unit service 组合。 | 依赖 catalog、card authority、operation journal，见 `:1-30`；公开组合在 `:349-536`，P4 在 `:630-640` 注入。 |
| `apps/game-server/src/duel/optional-unit-entry-boundary-v1.ts` | 433 | 只证明 pure Accelerate Unit entry；不选择 pay/decline、不移动卡、不改变 ready 状态。 | 依赖 optional services、operation journal、P6 native source，见 `:1-30`；boundary callback 在 `:334-433`。 |
| `apps/game-server/src/duel/optional-unit-native-source-p6.ts` | 285 | 检查 current head、catalog stamp、native cost census、choice receipt、entry boundary；未知时返回 unknown。 | 文件头明确写 “No profile wires this in” (`:1`)，但 P4 的 payment adapter 间接实例化它，`optional-unit-payment-entry-v3.ts:152-160`。 |
| `apps/game-server/src/duel/optional-unit-payment-entry-v3.ts` | 270 | 将 P6 native source inspection、choice receipt 与 payment continuation/journal pin 绑定成 entry service。 | 依赖 entry boundary/native source/operation journal，见 `:20-25`；factory 与 native wiring 在 `:152-165`；P4 answer 分支在 `authoritative-runtime-p4.ts:1133-1145`。 |
| `apps/game-server/src/duel/optional-unit-choice-projection-p6.ts` | 75 | 把 optional Unit prompt 映射为 viewer-bound P6 pending-choice DTO。 | P4 import 在 `authoritative-runtime-p4.ts:115`；实现为 `:1-75`。 |
| `apps/game-server/src/duel/printed-unit-chain-services-p8.ts` | 732 | physical printed Unit Chain V4 服务；维护 physical source chain、choice、cost history、journal/session binding。 | 依赖 catalog、authority、operation journal、phase bridge，见 `:1-35`；factory 在 `:364-729`，P4 只在 physical/resolved-history profile 的 `:678-684` lazy create。 |

### 房间、HTTP/WebSocket 和 full-product 实验层

| 文件 | 行数 | 职责 | 主要关系与代码出处 |
|---|---:|---|---|
| `apps/game-server/src/room.ts` | 1464 | authoritative room state：seat/deck/ready、session、room event log、command/request idempotency、Duel profile/session/journal、projection、chat 和 archive restore。 | 直接 import V1 runtime、P4 journal/owner、foundation、chat，见 `:1-69`；archive schema/私有字段在 `:90-128`，room fields 在 `:139-160`，profile dispatch 在 `:521-539,1192-1246`。 |
| `apps/game-server/src/server.ts` | 1047 | HTTP API、WebSocket lifecycle、catalog/image API、room mutation queue、room transactions、resume handshake。 | 依赖 room/store/catalog/protocol，见 `:1-53`；profile/store defaults 在 `:84-142`，room creation 在 `:577-601`，transaction buffer 在 `:942-1002`。 |
| `apps/game-server/src/index.ts` | 43 | 公网进程入口，解析 PORT/HOST/storage/profile 环境变量并启动/停止 `GameServer`。 | `:5-26` 解析 `RIFTBOUND_DUEL_PROFILE` 和 runtime profile；默认 room profile 是 P4，未设置 runtime profile 时 ternary 选择 optional-unit-choice-clock-v4。 |
| `apps/game-server/src/full-product/errors.ts` | 21 | full-product orchestration error codes/class。 | `full-product/index.ts:1-4` 和 orchestrator/adapter 使用。 |
| `apps/game-server/src/full-product/types.ts` | 151 | full-product room/session/connection/view/command/receipt/replay 类型。 | orchestrator、adapter、index 使用；类型出口在 `:6-151`。 |
| `apps/game-server/src/full-product/runtime.ts` | 172 | full-product runtime contract、projection/event/prompt 类型和 `FullProductRulesRuntime` 接口。 | `runtime-adapter.ts` 实现，`projection.ts` 使用；接口在 `:21-172`。 |
| `apps/game-server/src/full-product/runtime-adapter.ts` | 733 | engine-core full-product game 的 runtime adapter，维护 event actor、legal action、command result 和 replay state。 | 依赖 `createFullProductGame` 等 engine-core API，见 `:1-39`；核心实现类从 `:71` 开始。没有被 `server.ts` 或 `room.ts` import。 |
| `apps/game-server/src/full-product/projection.ts` | 205 | full-product projection 的隐藏 zone/object 清洗。 | 依赖 `runtime.ts`，见 `:1-9`；sanitize 在 `:11-205`。 |
| `apps/game-server/src/full-product/orchestrator.ts` | 646 | 独立 full-product room lifecycle：join/reconnect/deck/ready/command/idempotency/match result。 | 依赖 errors/projection/runtime/types，见 `:1-27`；class 在 `:62-646`。仅由 full-product tests/index 使用。 |
| `apps/game-server/src/full-product/index.ts` | 44 | full-product public barrel export。 | 只汇总该目录模块，见 `:1-44`；公网 `server.ts` 不 import 它。 |
| `apps/game-server/src/full-product/persistent-room-store.ts` | 222 | 基于 `FileEventStore` 的 append-only room archive log、load/save、archive history 和 fsync receipt。 | `file-room-store.ts:19-22` 复用它，核心 `load/save` 在 `:118-152`；尽管目录名带 full-product，它已经是当前 FileRoomStore 的持久化后端。 |

## Runtime、profile 和 journal schema

### Runtime 入口清单

| Runtime | 当前入口 | 默认/实际调用路径 | 差异 |
|---|---|---|---|
| V1 memory facade | `duel/runtime.ts` | `createGameServer()` 默认 `duelRoomProfile = "v1"`，见 `server.ts:84-92`；Duel room 在 `room.ts:536-539` 创建。 | 旧 `DuelCommandSession`、V1 wire command、V1 projection；不含 P4 native journal、Spell/optional/physical chain production services。 |
| V2 memory adapter | `duel/runtime-v2.ts` | 被 V3 facade 和 `command-journal-v2.ts` 使用；不直接由 `GameRoom` 选择。 | 对 engine-core V2 session、resource legality、turn/payment/end continuation 做适配。 |
| V3 wire facade | `duel/runtime-v3.ts` | P4 用 `projectDuelRuntimeV3`，P3 durable runtime 用 V3 session；它内部调用 V2，见文件 `:1-7,84-160`。 | 主要是 projection/wire/API 兼容层，不是独立完整 authoritative owner。 |
| P4 authoritative owner | `duel/authoritative-runtime-p4.ts` + `command-journal-p4.ts` | `GameRoom` 的 `duelProfile === "p4"` 分支创建 `createDuelRecordedRuntimeP4`，见 `room.ts:521-539`；公网 dispatch 在 `room.ts:1203-1222`。 | 当前最完整 production path，含 command ledger、P4 archive、operation journal、source closure、Spell、optional、physical chain、engagement。 |
| P3 durable adapter | `persistent-command-runtime-v3.ts` | 只由该模块测试/调用者显式创建；`server.ts`/`GameRoom` 无 import。 | `command-journal-v2` + P3 projection profile + CAS；未进入公网 room lifecycle。 |
| P4 durable adapter | `persistent-command-runtime-p4.ts` | 只由 persistent P4 caller 显式创建；它恢复 P4 archive 后 CAS publish，见 `:88-110`。 | P4 archive/profile/schema gate + CAS；当前 `GameRoom` 使用自己的 `FileRoomStore` 事务，而不是直接调用此 adapter。 |
| full-product runtime | `full-product/runtime.ts` + `runtime-adapter.ts` + `orchestrator.ts` | 只由 `full-product/index.ts` 和 `apps/game-server/tests/full-product/**` 暴露/创建；`server.ts` 与 `room.ts` 没有相对 import。 | 另一套 engine/runtime/room contract；必须迁移进唯一路径或退役，不能长期与 P4 并列。 |

当前直接生产路径可概括为：

```text
index.ts -> createGameServer -> GameRoom
  ├─ v1 (library default) -> duel/runtime.ts
  └─ p4 (CLI default) -> command-journal-p4.ts -> authoritative-runtime-p4.ts
       -> runtime-v3 projection + operation-journal-v2
       -> production-source / engagement / spell / optional / physical-chain services
```

### Runtime profile 常量与默认值

`authoritative-runtime-p4.ts:131-157` 定义了全部 P4 profile 常量和 semantic
version；`room.ts:71-72` 对公网房间只开放四个 optional profile 类型，P4
factory 自身仍接受八个 profile。

| 常量值 | schema | 当前入口/默认 | 语义差异 |
|---|---:|---|---|
| `legacy-unit-v1` | 1/2 | 仅 direct P4 factory/replay gate 可选；公网 `GameRoom` 的 v1 是另一条 V1 runtime。 | 保留旧 Unit/turn semantics，不暴露 Spell actions；schema 1/2 archive 缺少 profile/semanticVersion，恢复要求独立 legacy gate，见 `command-journal-p4.ts:299-333`。 |
| `spell-v1` | 3 | direct P4 factory 可选；公网 room 没有此 `duelRuntimeProfile` 选项。 | 打开 Spell，不含 public chain；archive 要求 profile + `riftbound-p4-spell-v1`。 |
| `public-chain-v1` | 4 | P4 factory 默认值，见 `authoritative-runtime-p4.ts:373-383`；普通 P4 room 未带其他 profile 时走这里。 | 打开 public chain 和 Spell；archive schema 4。 |
| `regional-public-chain-v1` | 5 | `GameRoom.p4Options()` 在有 `constructedRegion` 时强制选择，见 `room.ts:194-202`。 | public chain + trusted regional context；archive schema 5，且 `constructedRegion` 必须存在。 |
| `optional-unit-payment-v3` | 6 | `server.ts` 允许 trusted host 选择；P4 factory 的 `optionalUnitEnabled` 打开 optional Unit，但不打开 choice clock。 | optional Unit payment continuation；archive schema 6。 |
| `optional-unit-choice-clock-v4` | 7 | `index.ts` 默认：`RIFTBOUND_DUEL_PROFILE` 默认 P4，`RIFTBOUND_DUEL_RUNTIME_PROFILE` 未设置时由 `:19-24` 选择该值。 | schema 7 把 optional choice opening 纳入 canonical state/clock。 |
| `optional-unit-physical-chain-v4` | 8 | CLI/server 显式 trusted host profile；P4 `physicalUnitEnabled` 打开 physical chain。 | schema 8；physical chain services 在需要时 lazy create。 |
| `optional-unit-resolved-history-v5` | 9 | CLI/server 显式 trusted host profile；P4 同时打开 physical chain 和 resolved pre-exit history。 | schema 9；要求 explicit semantic version，见 `command-journal-p4.ts:242-259,324-329`。 |

还存在三组容易混淆的“profile”名：

- 房间 profile 只有 `"v1" | "p4"`，见 `room.ts:71-72`；它决定 room dispatch
  分支，不等于 P4 runtime profile。
- `DUEL_REPLAY_PROFILE_P4_LEGACY/SPELL/PUBLIC_CHAIN` 是 journal replay alias，
  见 `command-journal-p4.ts:29-34`，不是新的 runtime。
- `PERSISTENT_DUEL_PROJECTION_PROFILE_V3 = "P3"` 是 P3 durable payload 标识，
  见 `persistent-command-runtime-v3.ts:39-45`，不是 P4 的 schema 3。

### Journal schema 1–9

P4 archive 的共同结构是 `kind`、`schemaVersion`、可选 `profile`、可选
`semanticVersion`、`contextDigest`、`creation.entropy/observation` 和
`operations`，见 `command-journal-p4.ts:36-50`。schema 选择在
`:242-273`，恢复校验在 `:305-361`。

| schema | 入口 | 默认值/差异 | 恢复约束 |
|---:|---|---|---|
| 1 | P4 legacy archive 的旧形状；它与 `command-journal-v2` 的 `private-duel-command-journal-v2` schema 1 同号但不是同一种 `kind`。P4 gate 仍接受 P4 kind 的 schema 1。 | legacy archive；没有 P4 profile/semanticVersion。 | 只能由独立 legacy replay selection 进入；`policyCheckedAt` 有旧特殊路径，见 `command-journal-p4.ts:331-336`。 |
| 2 | P4 recorded owner 在 legacy profile 分支创建。 | P4 legacy archive；仍无 profile/semanticVersion。 | 与 schema 1 一样必须是 legacy gate。 |
| 3 | P4 recorder 的 `spell-v1` 分支。 | Spell profile + `riftbound-p4-spell-v1`。 | profile、semanticVersion、context digest 全部匹配。 |
| 4 | P4 recorder 的 `public-chain-v1` 分支。 | P4 factory 默认；public chain + Spell。 | 只能由 public-chain profile gate 恢复。 |
| 5 | P4 recorder 的 regional 分支。 | `regional-public-chain-v1` + regional context。 | archive profile 和 room `constructedRegion` 必须同时匹配；`room.ts:244-254`。 |
| 6 | optional payment profile。 | `optional-unit-payment-v3`；choice opening 仍是旧语义。 | profile 和 semantic version 精确匹配。 |
| 7 | optional choice clock profile。 | `optional-unit-choice-clock-v4`；choice opening 是 state update。 | profile 和 semantic version 精确匹配。 |
| 8 | physical chain profile。 | `optional-unit-physical-chain-v4`；P8 service/session。 | profile、semantic version、physical runtime option 精确匹配。 |
| 9 | resolved history profile。 | `optional-unit-resolved-history-v5`；P8 + resolved pre-exit history。 | profile、semantic version、runtime option 精确匹配。 |

注意：P4 `archive()` 对当前 `legacy` 只写 schema 2；schema 1 是被兼容读取的
旧形状。`persistent-command-runtime-p4.ts:35-44` 明确按 1/2→legacy、3→spell、
4→public、5→regional、6→optional payment、7→choice clock、8→physical、
9→resolved history 选择 replay profile。

## Production services 机制清单

| 机制/模块 | 做什么 | engine-core 依赖 | 是否进入默认路径 |
|---|---|---|---|
| Phase/source closure | 将 CardProgramAuthority、catalog stamp、match 和 Core resolver 绑定为 source registry；缺失证据是 unknown/pending。 | `createDuelPhaseClosureAuthorityV2`、closure request/inspection、phase registry；bridge 的原则在 `phase-source-bridge-v2.ts:1-9`。 | **是**，P4 首次需要 Unit/source service 时由 `authoritative-runtime-p4.ts:580-606` 创建。 |
| Production source / cost / Might | 提供 Unit entry facts、Unit/Spell cost binding、phase inspection 和 derived Might checkpoint。 | `DuelUnitEntryRequestV2`、`DuelUnitCostBindingV2`、`DuelSpellCostBindingV2`、phase registry；接口在 `production-source-services-v2.ts:102-113`。 | **是**，P4 `ensureServices()` 使用。 |
| Engagement | required cleanup、combat、lethal approval、FEPR、burnout、draw proof。 | `inspectDuelPhaseSourcesV2`、`gainDuelPoints`、`DuelEngagementServicesV2`；实现 `engagement-services-v2.ts:10-88`。 | **是**，P4 `:609-629` 创建；未闭合时返回 pending。 |
| Spell | Draw/Kill Spell 的 source/cost/session；Point damage Spell 为显式 opt-in factory。 | P4 Spell/Cost/Source types、operation journal、CardProgramRegistry；factory `p4-spell-services.ts:111-166`。 | **普通 Draw/Kill 是按命令按需进入 P4**；Point factory 不是 P4 owner 默认 import。 |
| Point effect | 给 engine-core Point damage authority 提供 current-head、source、Might、catalog census callback。 | `DuelPointDamageEffectAuthorityOptionsV1`、`DuelPointDamageProposalV1`；实现 `point-effect-production-services-v1.ts:125-180`。 | **否**；P4 owner 没有 import，测试和 point authority factory 直接使用。 |
| Point Spell | 只是 Point Spell service 的公共 re-export。 | 复用 P4 Spell services。 | **否**；`point-spell-production-services-v1.ts:1-6` 没有额外 wiring。 |
| Gear | `card-program-authority.ts` 可绑定 reviewed Gear source identity。 | Card DSL registry/census。 | **否**；源码明确没有 Gear/CardPlay/Equip activation execution，见 `card-program-authority.ts:478-490`。 |
| Hold→Recruit | 在精确 program、native token history、entry/replacement/cost/trigger proof 完整时调用 Core token birth；否则 pending。 | `createDuelRecruitUnitV2`、token source/history、phase registry、operation journal。 | **否**；`hold-recruit-executor-v1.ts` 只有测试直接 import，P4/room 没有 import。 |
| Optional Unit source | 检查 optional choice receipt、current head、native cost census、entry proof，再产生 entry facts。 | `DuelOptionalPlayReceiptV1`、`DuelUnitEntryRequestV2`、operation journal/cost census。 | **间接是**：P4 optional payment answer 在 `authoritative-runtime-p4.ts:1133-1145` 创建 `optional-unit-payment-entry-v3`，该 adapter 在 `optional-unit-payment-entry-v3.ts:152-160` 创建 P6 native source。P6 文件头的 “No profile wires this in” 只说明没有独立直接 profile 入口。 |
| Optional Unit payment/choice | 将 pay/decline receipt、payment continuation、journal pin 和 unit entry 接起来；choice projection 绑定 viewer。 | `beginDuelOptionalUnitPaymentV3`、optional choice authority、entry service、journal. | **只在 schema 6/7 optional profile 进入**；P4 开关在 `authoritative-runtime-p4.ts:379-383,630-640`。 |
| Printed Unit Chain | physical chain、choice、cost history、current journal/session 和 optional pre-exit history。 | `beginDuelPrintedUnitPhysicalChainV4`、`DuelPrintedUnitChainSessionV4`、phase bridge/journal。 | **只在 schema 8/9 profile 进入**；P4 physical/resolved branch 在 `authoritative-runtime-p4.ts:678-684,1247-1266`。 |
| Native operation journal | 记录 source work、cost census、effect ledger、commit、zone transition、token birth/retirement、current/observed head，支持 fork。 | `DuelPhaseSourceClosureContextV2`、physical zones、native closure facts。 | **是，P4 基础设施**；P4 在 `authoritative-runtime-p4.ts:433-496` 创建并在 `:614-619` 绑定 checkpoint。 |
| Card program authority | 将 catalog program identity/census 提供给各服务；不自动把未知能力变成 executable effect。 | Card DSL program registry/semantic census。 | **是**，P4 根据 optional/physical profile 在 `authoritative-runtime-p4.ts:396-398` 选择 legacy 或 Fury roster authority。 |

## 房间、会话、重连、幂等、隐私和持久化

| 机制 | 当前实现位置 | 是否按 profile 分叉 |
|---|---|---|
| Room lifecycle | `GameRoom` 保存 seats、players、state、Duel session/P4 owner、room version/event log/chat ledger，见 `room.ts:134-160`。`server.ts` 负责 room map、HTTP/WS 生命周期和串行 `runRoomMutation`，见 `server.ts:93-106`。 | room lifecycle 本身共用；Duel start/submit/archive 按 `v1`/`p4` 分叉。 |
| Session/authentication | `room.ts:1308-1333` 校验 roomId、seat、resume token 和 current connection；`server.ts:898-940` 处理 hello/resume、cursor、welcome、room、projection 和增量事件。 | 共用认证逻辑；P4/V1 的 private session 内容不同。 |
| Disconnect/reconnect | `room.ts` 的 connection map 与 disconnect/reconnect 维护 live binding；resume 使用 token 和 `connectionId`，新连接会使旧连接收到 `session-replaced`。 | 连接层共用；恢复后的 projection 根据 `duelP4` 或 `duelSession` 分叉。 |
| Command idempotency | `ProcessedCommand` 在 `room.ts:90-96`；command 去重/冲突在 `room.ts:1020-1103`。P4 owner 另有 actor+commandId ledger，P4 receipt 在 `room.ts:1203-1222` 生成。 | 共用 room command ledger，Duel runtime 内部 ledger 分为 V1/P4。 |
| Request idempotency | `ProcessedRoomRequest` 在 `room.ts:98-104`；读/写在 `room.ts:1287-1305`，按 playerId+requestId 绑定 payload hash、room version、room event seq。 | 不按 profile 分叉。 |
| Private projection | Foundation 使用 `projectGame(state, playerId)`；V1 Duel 使用 `projectDuelRuntime(session, playerId)`；P4 使用 `duelP4.runtime.project(playerId)`，见 `room.ts:622-644`。 | 投影入口按 runtime 分叉；隐私目标共用。P4 event sync 不回放 private history，只重新发当前 projection，见 `room.ts:725-736`。 |
| Archive shape | `RoomArchive` 包含 room schema 1、seats/state/version/event log、processed ledgers/chat；Duel V1 放 `duelSession`，P4 放 `duelProfile + duelJournal`，见 `room.ts:106-128,205-227`。 | 明确按 profile 分叉。 |
| Restore | `room.ts:230-365` 校验 room archive、regional context、optional runtime profile、journal schema/profile、seat/deck/event invariants；`room.ts:415-425` 为 P4 按 schema 选择历史 replay profile。 | 明确按 profile/schema 分叉；这是收敛的主要删除点。 |
| Durable transaction | `server.ts:942-1002` 先保存 archive 和 socket bindings，缓存 transport，操作成功后 `store.save()`；失败恢复 archive、players、session bindings。 | transaction 外壳共用；存储 backend 可内存或文件。 |
| Default persistence | `server.ts:136-142`：无 `storageDirectory` 用 `InMemoryRoomStore`；配置 `storageDirectory` 才用 `FileRoomStore`。 | 不按 Duel profile 分叉，但 archive 内容按 profile 分叉。 |
| FileRoomStore | `file-room-store.ts:24-38` 说明文件后端；`get/save/list` 在 `:59-176`，按 `sha256(roomId)` 目录在 `:220-237`，失败后标记 unavailable 在 `:101-109`。 | backend 不分叉；restoreRoom 对 Duel/Foundations 加载 catalog，见 `:204-210`。 |
| Append-only archive | `full-product/persistent-room-store.ts:118-152` 使用 `FileEventStore` 读最后 archive event、append 一个 `room-archive` event，append 返回后视为 fsync receipt。 | 存储格式共用；目录名是历史 full-product 命名，实际被当前 FileRoomStore 复用。 |
| P4 private CAS | `private-journal-cas-store.ts` + `persistent-command-runtime-p4.ts` 提供另一路受保护 P4 journal CAS。 | 与 `GameRoom` 的 FileRoomStore 事务并列存在；P4 room 默认没有直接接入这个 adapter。 |

## 唯一 runtime 建议和删除/合并清单

### 选择

保留 `authoritative-runtime-p4.ts` 的能力集合，迁移为一个不带历史 profile
分叉的当前 runtime。理由是它已经覆盖当前服务端最多的 production seams：

- P4 factory 已把 V3 actions、setup、CardProgramAuthority、operation journal、
  source/cost/Might、engagement、Spell、optional Unit、physical chain 和
  private projection 组装在一起，见 `authoritative-runtime-p4.ts:373-420,577-684`。
- `GameRoom` 的 P4 分支已经使用 recorded owner、profile-aware journal、
  public receipt 和 projection，见 `room.ts:521-539,1203-1222`。
- full-product runtime 虽有更完整的独立 room tests，但没有进入公网 `server.ts`
  或 `room.ts` 的 import 图；它不能作为当前 server 的事实默认路径。

“保留 P4”是迁移基线名称，不表示继续保留八个 P4 profile。目标是把能力合并
到一个当前 engine/ruleset/journal contract，并把未知能力继续保持
`judge-required`/`blocked`/pending。

### 合并顺序和退役清单

| 批次 | 动作 | 结果 |
|---|---|---|
| A | 以 P4 owner 的 setup、projection、command ledger、operation journal 为骨架，把 `runtime-v2.ts` 的 V2 session/turn primitives 和 `runtime-v3.ts` 的 projection/wire adapter 移入唯一 runtime。 | 旧 facade 不再是独立入口；P4 仍能复用已验证的 engine-core V2 primitives。 |
| B | 把 `command-journal-v2.ts`、`command-journal-p4.ts` 的 recorder/replayer、digest、entropy、receipt、context 和 operation 记录合为一个 journal writer/replayer。 | 删除 schema/profile 选择分支；旧 schema 不由新 runtime 逐字节重放。历史回放若仍需支持，冻结在旧 tag 的 replayer。 |
| C | 把 `persistent-command-runtime-v3.ts` 和 `persistent-command-runtime-p4.ts` 合为一个 durable runtime adapter，底层保留 `private-journal-cas-store.ts`。 | 只有一个 CAS publication path；P3/P4 adapter 类型和 profile 常量退役。 |
| D | 将 `room.ts` 的 `duelProfile === "v1"`/`"p4"` dispatch、V1/P4 archive restore、schema→profile 反推合并到一个 current room/session path。 | `room.ts` 保留 session/auth/reconnect/idempotency/projection/transaction，但不再按 runtime profile 选择执行器。 |
| E | 将 point damage、Spell、optional Unit、printed Unit Chain 和 Hold→Recruit 的可执行部分收敛到 EffectIR + generic primitive interpreter；服务模块只保留必要的 source/proof adapter。 | 删除每张机制一套 production callback executor；未知 source/effect 继续 pending。 |
| F | 将 `full-product/runtime.ts`、`runtime-adapter.ts`、`orchestrator.ts`、`projection.ts`、`types.ts`、`errors.ts`、`index.ts` 的 room/runtime 实验迁移出 server，或在确认没有需要的 v1.5 能力后退役。 | 不再保留第二个 server room/runtime contract。`full-product/persistent-room-store.ts` 先保留为 FileRoomStore backend，之后可改名/迁移。 |
| G | 删除旧 facade/archive/runtime 文件及 profile constants，最后删除测试中的旧 profile fixtures；保留历史 tag replayer。 | 当前源码只有一个 runtime、一个 journal schema、一个默认规则版本。 |

具体候选文件：

- **最终退役**：`duel/runtime.ts`、`duel/session-archive.ts`、
  `duel/session-archive-v2.ts`、`duel/command-journal-v2.ts`、
  `duel/persistent-command-runtime-v3.ts`。
- **合并后删除旧 wrapper**：`duel/runtime-v2.ts`、`duel/runtime-v3.ts`；其
  仍需要的 projection/session primitive 先搬进唯一 runtime 或 engine-core。
- **P4 文件重命名/瘦身**：`authoritative-runtime-p4.ts` 和
  `command-journal-p4.ts` 可暂时作为迁移落点，去除 `P4` 后缀、profile 常量、
  schema 1–9 gate 和历史 semantic version 分支。
- **服务收敛**：`point-effect-production-services-v1.ts`、
  `point-spell-production-services-v1.ts`、`hold-recruit-executor-v1.ts`、
  `optional-unit-*-p6.ts`、`optional-unit-payment-entry-v3.ts`、
  `printed-unit-chain-services-p8.ts`、`p4-spell-services.ts` 的机制逻辑迁移到
  generic EffectIR primitive；迁移完成后退役对应 profile-specific wrapper。
- **保留/合并为 cross-cutting seam**：`operation-journal-v2.ts`、
  `phase-source-bridge-v2.ts`、`production-source-services-v2.ts`、
  `engagement-services-v2.ts`、`card-program-authority.ts`；移除版本后缀，
  但不移除 unknown/pending 和证据校验。
- **保留**：`private-journal-cas-store.ts`、`room-store.ts`、
  `file-room-store.ts` 的基础存储能力；将 archive payload 改为统一 journal/room
  contract 后再处理历史命名。

### 单 journal 建议字段

下面是按重设计目标提出的目标字段，不是现有 contract 的改写；共享 contract
变更必须由父任务提出。

```text
kind
journalSchemaVersion       # 唯一当前 schema
engineVersion              # engine-core 当前版本/构建标识
rulesetVersion             # 目标规则 v1.5 的规则版本
matchId / roomId
catalogVersion / catalogDigest
rosterDigest / trustedDeckDigest
creation:
  entropy / deterministicSeed
  uidSeedOrUidTranscript
  createdAt / creator
head:
  stateVersion / eventSeq / roomVersion
  parentJournalDigest / journalDigest
  stateDigest / privateStateDigest
commands[]:
  actor
  requestId / commandId
  expectedStateVersion / expectedRoomVersion
  payload
  result / publicReceipt
  appliedStateVersion / eventSeq
  duplicate / rejection
  entropyConsumed
  projectionDigestByViewer
operations[]:
  operationId / taskId / phase
  sourceClosureEvidence
  costCensus / paymentPlan / paymentReceipt
  effectIRDigest / primitiveReceipts
  tokenBirths / tokenRetirements / zoneTransitions
  unresolvedOrPendingReason
integrity:
  parentDigest / currentDigest
  CAS revision / nonce
  protectedHeadReference
```

必须保留的语义是：command 顺序、actor/request/command 幂等键、expected/current
version、公开 receipt、状态和私有 digest、随机/UID entropy、source/cost/payment
证据、pending continuation，以及 parent/current digest。`engineVersion` 和
`rulesetVersion` 用来把 engine 代码版本与规则版本分开，避免再用 profile 名
承担两种含义。

## 分批顺序

### 可以并行的批

1. **Journal contract 设计**：定义唯一 schema 的字段、digest、entropy、CAS
   head 和 `engineVersion/rulesetVersion`，同时盘点旧 schema 的只读导入边界。
2. **EffectIR primitive 迁移设计**：分别整理 Point、Spell、optional Unit、
   physical chain、Hold→Recruit 的 source/proof 需求；每个机制保持未知时
   pending，互不改 room dispatch。
3. **P4 内部抽取**：把 V2/V3 projection/session primitive 抽进目标 runtime；
   同时整理 phase-source、operation-journal、engagement 的版本无关接口。
4. **测试重标记**：将旧 profile/schema tests 分成 current behavior、历史
   fixture/replayer 和应删除的旧分叉测试。

这些批的写入面可以分别由 contract、engine-core、server runtime 和 tests
负责人承担；跨批只共享接口草案。

### 必须串行的批

1. **先完成共享 contract 和 current engine version**，再实现 server journal；
   否则 server 会继续制造第二套 schema。
2. **先完成单 journal writer/replayer**，再迁 durable adapter；持久化必须能
   验证新的 parent/current digest 和 entropy。
3. **先完成唯一 runtime 的 direct tests**，再把 `room.ts` 的 start/submit/
   projection/restore 切换掉；这是避免房间同时存在两种 authoritative owner 的
   关键顺序。
4. **再迁 `server.ts` transaction、FileRoomStore 和 reconnect restore**；room
   archive payload 变更后才有稳定的 durable/recovery contract。
5. **最后删除 profile/schema 分支和 full-product runtime**，并更新测试；删除
   之前不能证明旧调用者已经清空。
6. **最后做包级和全工作区回归**；持久化恢复和 websocket 测试必须覆盖统一
   journal、重连、幂等和隐私 projection。

## 受影响测试文件

以下是按直接 import、runtime/profile、journal、持久化、房间和机制服务整理的
当前测试清单。重命名/合并后这些测试需要迁移或明确成为历史 tag replayer
测试；不应通过删断言来适配收敛。

### Runtime、journal、持久化

- `apps/game-server/tests/duel/runtime.test.ts`
- `apps/game-server/tests/duel/runtime-v2.test.ts`
- `apps/game-server/tests/duel/runtime-v2-payment-inspection.test.ts`
- `apps/game-server/tests/duel/runtime-v3.test.ts`
- `apps/game-server/tests/duel/resource-legality-projection-v2.test.ts`
- `apps/game-server/tests/duel/catalog-card-type-v2.test.ts`
- `apps/game-server/tests/duel/session-archive.test.ts`
- `apps/game-server/tests/duel/session-archive-v2.test.ts`
- `apps/game-server/tests/duel/command-journal-v2.test.ts`
- `apps/game-server/tests/duel/command-journal-p4.test.ts`
- `apps/game-server/tests/duel/replay-profile-p4.test.ts`
- `apps/game-server/tests/duel/optional-unit-replay-profile-p4.test.ts`
- `apps/game-server/tests/duel/authoritative-runtime-p4.test.ts`
- `apps/game-server/tests/duel/authoritative-journal-read-p4.test.ts`
- `apps/game-server/tests/duel/authoritative-journal-atomicity-p4.test.ts`
- `apps/game-server/tests/duel/persistent-command-runtime-v3.test.ts`
- `apps/game-server/tests/duel/persistent-command-runtime-p4.test.ts`
- `apps/game-server/tests/duel/private-journal-cas-store.test.ts`
- `apps/game-server/tests/duel/operation-journal-v2.test.ts`

### P4 room、WebSocket 和恢复

- `apps/game-server/tests/duel/public-room.test.ts`
- `apps/game-server/tests/duel/public-room-p4.test.ts`
- `apps/game-server/tests/duel/public-websocket.test.ts`
- `apps/game-server/tests/duel/public-websocket-p4.test.ts`
- `apps/game-server/tests/duel/reconnect-wire-p4.test.ts`
- `apps/game-server/tests/duel/optional-unit-room-p4.test.ts`
- `apps/game-server/tests/duel/optional-unit-physical-chain-recovery-p8.test.ts`
- `apps/game-server/tests/duel/optional-unit-resolved-history-p9.test.ts`
- `apps/game-server/tests/constructed-regional-room.test.ts`
- `apps/game-server/tests/game-server.test.ts`
- `apps/game-server/tests/lobby-ready.test.ts`
- `apps/game-server/tests/owner-deck-confirmation.test.ts`
- `apps/game-server/tests/room-request-dedupe.test.ts`
- `apps/game-server/tests/server-lifecycle.test.ts`
- `apps/game-server/tests/room-chat.test.ts`
- `apps/game-server/tests/room-chat-websocket.test.ts`

### FileRoomStore / archive persistence

- `apps/game-server/tests/file-room-store.test.ts`
- `apps/game-server/tests/persistent-server.test.ts`
- `apps/game-server/tests/persistent-room-archive-history.test.ts`
- `apps/game-server/tests/duel/persistent-room.test.ts`
- `apps/game-server/tests/full-product/persistent-room-store.test.ts`

### Production services and mechanism coverage

- `apps/game-server/tests/duel/card-program-authority.test.ts`
- `apps/game-server/tests/duel/accelerate-card-program-authority-v1.test.ts`
- `apps/game-server/tests/duel/point-card-program-authority-v1.test.ts`
- `apps/game-server/tests/duel/equip-beginning-card-authority-v1.test.ts`
- `apps/game-server/tests/duel/phase-source-bridge-v2.test.ts`
- `apps/game-server/tests/duel/production-source-services-v2.test.ts`
- `apps/game-server/tests/duel/authoritative-engagement-p4.test.ts`
- `apps/game-server/tests/duel/p4-spell-services.test.ts`
- `apps/game-server/tests/duel/p4-kill-spell-services-v1.test.ts`
- `apps/game-server/tests/duel/p4-spell-cost-census.test.ts`
- `apps/game-server/tests/duel/authoritative-spell-p4.test.ts`
- `apps/game-server/tests/duel/public-spell-p4.test.ts`
- `apps/game-server/tests/duel/recorded-spell-p4.test.ts`
- `apps/game-server/tests/duel/spell-command-journal-p4.test.ts`
- `apps/game-server/tests/duel/pending-spell-resource-ack-p4.test.ts`
- `apps/game-server/tests/duel/point-effect-production-services-v1.test.ts`
- `apps/game-server/tests/duel/point-spell-production-services-v1.test.ts`
- `apps/game-server/tests/duel/hold-recruit-executor-v1.test.ts`
- `apps/game-server/tests/duel/optional-unit-entry-boundary-v1.test.ts`
- `apps/game-server/tests/duel/optional-entry-current-source-applicability-v1.test.ts`
- `apps/game-server/tests/duel/optional-unit-native-source-p6.test.ts`
- `apps/game-server/tests/duel/optional-native-journal-nominal-binding.test.ts`
- `apps/game-server/tests/duel/optional-unit-payment-entry-v3.test.ts`
- `apps/game-server/tests/duel/optional-unit-choice-projection-p6.test.ts`
- `apps/game-server/tests/duel/optional-unit-choice-clock-p4.test.ts`
- `apps/game-server/tests/duel/optional-unit-cost-source-applicability-v1.test.ts`
- `apps/game-server/tests/duel/optional-unit-services-p4.test.ts`
- `apps/game-server/tests/duel/optional-unit-runtime-p4.test.ts`
- `apps/game-server/tests/duel/optional-unit-physical-chain-p8.test.ts`
- `apps/game-server/tests/duel/printed-unit-chain-services-p8.test.ts`
- `apps/game-server/tests/duel/printed-unit-chain-resolved-history.test.ts`
- `apps/game-server/tests/duel/public-chain-card-p4.test.ts`
- `apps/game-server/tests/duel/public-reaction-actions-p4.test.ts`
- `apps/game-server/tests/duel/unit-point-census-adapter.test.ts`
- `apps/game-server/tests/duel/fury77-real-rosters-source-cost-entry.test.ts`
- `apps/game-server/tests/duel/fury77-source-cost-entry-composition.test.ts`

### Full-product experiment

- `apps/game-server/tests/full-product/full-product-room-adapter.test.ts`
- `apps/game-server/tests/full-product/match-orchestration.test.ts`
- `apps/game-server/tests/full-product/match-result.test.ts`
- `apps/game-server/tests/full-product/orchestrator.test.ts`
- `apps/game-server/tests/full-product/persistent-room-store.test.ts`

这些 full-product tests 证明实验路径自身的行为；它们不能证明当前公网
`GameServer` 已经使用该路径。

## 复核命令

本调查可用以下只读命令复核：

```text
git status --short --branch
rg --files apps/game-server/src | sort
wc -l $(rg --files apps/game-server/src | sort)
rg -n 'RIFTBOUND_DUEL_PROFILE|RIFTBOUND_DUEL_RUNTIME_PROFILE|duelRoomProfile|createDuelRecordedRuntimeP4|createDuelRuntimeSession' apps/game-server/src
rg -n 'createDuelHoldRecruitExecutorV1|createOptionalUnitNativeSourceP6|createDuelPointEffectProductionServicesV1|createP4SpellServices|createDuelPrintedUnitChainServicesP8' apps/game-server/src apps/game-server/tests
rg -n 'schemaVersion|DUEL_RUNTIME_PROFILE_P4_' apps/game-server/src/duel/command-journal-p4.ts apps/game-server/src/duel/authoritative-runtime-p4.ts
rg -n 'processedCommands|processedRoomRequests|duelJournal|duelSession|resumeToken|runRoomTransaction|InMemoryRoomStore|FileRoomStore' apps/game-server/src/room.ts apps/game-server/src/server.ts apps/game-server/src/file-room-store.ts
```

本任务没有修改源码、测试、protocol、engine-core、lockfile 或生成卡牌数据；
只新增本文件。契约变更请求：需要父任务在共享 contract 中定义统一 journal
字段，至少包括 `engineVersion`、`rulesetVersion` 和上述完整性/命令/操作字段，
再开始 runtime 收敛实现。
