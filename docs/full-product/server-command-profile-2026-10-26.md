# 服务端单条命令 CPU 剖析（2026-10-26）

## 结论

本轮用真实服务端子进程、真实 WebSocket、两个 M1 客户端和文件房间存储，对完整自然对局做了 1 ms 采样的 Node CPU profile。正式样本 `run-2026-10-26T08-12-51-752Z` 以 `player-1` 获胜结束，共 78 条命令、76.92 s；回执 p50 `738 ms`、p95 `2,711 ms`、p99 `3,150 ms`，平均 `932.06 ms`。因此 RIFT-1082 中单房间 p50 约 450–660 ms、p95 约 1.9–2.2 s 的量级在本机当前负载下可重复观察到，且本样本已明显高于 p95 `300 ms` 目标。

热点不是单一 JSON 写入。按命令窗口归因，有效 CPU `35.91 s` 中：

| 阶段 | 总 CPU | 有效 CPU 占比 | 平均每命令 | 主要代码 |
|---|---:|---:|---:|---|
| 深拷贝 `structuredClone` | 18,594.28 ms | 52.95% | 238.39 ms | `host.checkpoint/restore/objects`、journal、pipeline/event copies |
| 层计算 | 11,156.19 ms | 31.77% | 143.03 ms | `LayerEngine`、keyword grants、effects predicates |
| projection digest / canonical JSON | 1,972.89 ms | 5.62% | 25.29 ms | `runtime.appendJournal`、`journal.canonicalJson` |
| GC | 1,783.20 ms | 4.97%（有效 CPU 另列） | 22.86 ms | V8 |
| 投影生成 | 566.70 ms | 1.61% | 7.27 ms | `projectRuntime` 及事件/玩家映射 |
| 引擎执行（不含层） | 1,041.15 ms | 2.97% | 13.35 ms | `MatchRuntime` / `TurnFlow` / chain |
| 文件存储路径（CPU self time） | 176.93 ms | 0.50% | 2.27 ms | archive 序列化和存储调用栈 |
| protocol 校验 | 6.65 ms | 0.02% | 0.09 ms | `isV2CommandMessage` / command guard |
| WebSocket 发送 | 44.51 ms | 0.12% | 0.57 ms | `ws` 写入路径 |

`journal` 这一行只统计 `RuntimeJournalWriter` 本体的 self time；投影 3 个视角、canonical JSON 和 SHA 分别归在 `projection` 与 `digest` 行，避免重复计算。

表内百分比以 `structuredClone + layers + digest + projection + engine + GC` 为分母，避免把约 51.5% 的 `(idle)` 和异步等待误算成 CPU。该样本有效 CPU 占命令窗口 48.49%，服务端在等待客户端和共享机调度时确实有空闲，但这六类互斥热点平均每命令仍约 450.18 ms（逐命令 active CPU 均值因分类边界为 457.75 ms），足以解释 2.7 s p95。

两个热点会随对局长度恶化：前 45 条命令平均 `structuredClone 172.32 ms / 命令`、层计算 `173.25 ms / 命令`；后 33 条变为 `327.87 ms / 命令`、`101.75 ms / 命令`。同期投影 WS 字节从约 `266 KB / 命令` 增至 `619 KB / 命令`，存档增长从 `37,387 B / 命令` 增至 `95,125 B / 命令`。这说明后半局的历史事件和累计快照同时放大复制、摘要、发送与整档持久化。层计算在前半局的绝对热点更多，不能只优化 `stable-layers` memo；深拷贝和累计历史必须先拆开治理。逐命令时间线还显示，后段的普通 `rune-energy` 也持续承担约 `324–370 ms` 的复制成本，而单纯 `pass` 不改变这一基线，说明主要成本来自用新快照替换累计大状态，而不是命令类型本身。

## 方法与可复现证据

脚本为 `apps/game-server/scripts/profile-server.ts`，由 `tsx` 启动父进程。父进程在 `35740` 端口启动一个独立服务端子进程，子进程参数显式包含 `--cpu-prof --cpu-prof-interval=1000`；父进程只驱动两个真实 WebSocket 客户端。脚本只接受 `SWARM_PORT_BASE` 的 `35740–35759` 范围，并要求非空 `--room-id` 固定服务端 V2 seed。子进程加载构建后的 `dist`（缺失时明确要求先运行 `heavy pnpm --recursive --if-present run build`），所以 profile 栈能落到 `packages/*/dist` 和 `apps/game-server/dist` 业务函数，而不是停在 tsx loader。

每轮产物写入 `/root/swarm-rift/shared/RIFT-1083-server-command-cpu-profile/run-<timestamp>/`：

- `server.cpuprofile`：服务端整局 CPU profile。
- `summary.json`：Top 20、包/阶段、逐命令、逐类型、合规计数与存储数据。
- `profile-config.json`：本轮端口、固定 seed、命令/对局/启动超时，供独立重分析使用。
- `server-instrumentation.json`：`LayerEngine.evaluate/evaluateAll`、`ChainEngine.withStableLayers`、`TurnFlow`/host checkpoint-restore、`RuntimeJournalWriter.append` 的调用和墙钟耗时。
- `game-summary.json`：每命令回执延迟、投影包/字节、状态版本和存档增长。
- `storage/`：真实房间 archive。
- `server.stdout.log`、`server.stderr.log`：子进程输出。

正式样本固定 `--room-id=69dc614b`。该值是共享 RIFT-1082 文件存储 N=1 成功局的房间身份；V2 房间以 room id 作为引擎 seed（`apps/game-server/src/room.ts:331`），固定它使 M1 路线、开手和后续决策可重复。两轮完整样本均自然以 `player-1` 获胜，未用 fixture、手改 authoritative state 或伪造回执。

运行命令：

```bash
SWARM_TASK=RIFT-1083-server-command-cpu-profile \
SWARM_PORT_BASE=35740 \
heavy pnpm --filter @riftbound/game-server exec tsx scripts/profile-server.ts \
  --room-id=69dc614b --max-commands=1000 \
  --command-timeout-ms=120000 --game-timeout-ms=900000 \
  --startup-timeout-ms=180000
```

若一次运行已完成但需要重算汇总，脚本提供同一聚合器的只读重分析入口：

```bash
SWARM_TASK=RIFT-1083-server-command-cpu-profile SWARM_PORT_BASE=35740 \
pnpm --filter @riftbound/game-server exec tsx scripts/profile-server.ts \
  --analyze-existing=/root/swarm-rift/shared/RIFT-1083-server-command-cpu-profile/run-2026-10-26T08-12-51-752Z \
  --room-id=69dc614b
```

正式产物：

| 文件 | SHA-256 |
|---|---|
| `server.cpuprofile`（7,280,393 B） | `9edf54a0d44a16a1c2bcba07e420888edf9b59d703efb1d778f0e85b9c56d12e` |
| `summary.json` | `f9445d3d1bb64b17c0ec7dd3cec0304990a986062fe7bc1e7fad3fe208266e7c` |
| `profile-config.json` | `b32b32e10b7b6a240f3ad20663a1b70cd2da23b02bd6097cbd7e156ba9e88123`（schema v1） |

## 命令时延

延迟定义为发送命令到收到对应首个 `command-receipt` 的父进程墙钟时间；两者都从实际 WebSocket 路径经过。

| 命令 | 次数 | 平均 ms | p50 ms | p95 ms | 最大 ms | 平均存档增长 B |
|---|---:|---:|---:|---:|---:|---:|
| mulligan | 2 | 1,458.00 | 1,142 | 1,774 | 1,774 | 5,470.50 |
| rune-energy | 38 | 777.42 | 619 | 2,354 | 2,422 | 66,626.37 |
| play | 7 | 1,453.43 | 1,261 | 3,134 | 3,134 | 59,507.57 |
| end-turn | 10 | 1,124.80 | 913 | 2,711 | 2,711 | 67,538.30 |
| move | 3 | 1,399.67 | 815 | 3,150 | 3,150 | 53,965.00 |
| pass | 17 | 787.65 | 497 | 2,804 | 2,804 | 58,262.94 |
| choose | 1 | 1,232.00 | 1,232 | 1,232 | 1,232 | 34,504.00 |
| **全部** | **78** | **932.06** | **738** | **2,711** | **3,150** | **61,814.72** |

按类型平均 active CPU（不含 idle/other，另含该命令的 GC 以保持与阶段表一致）：

| 命令 | active CPU ms | structuredClone ms | layers ms | digest ms | projection ms | engine ms |
|---|---:|---:|---:|---:|---:|---:|
| mulligan | 1,421.21 | 478.92 | 725.90 | 10.06 | 7.43 | 127.39 |
| rune-energy | 353.28 | 224.45 | 59.38 | 26.69 | 6.93 | 10.60 |
| play | 596.77 | 219.36 | 291.06 | 23.66 | 9.08 | 11.49 |
| end-turn | 701.31 | 341.76 | 264.14 | 27.18 | 7.65 | 17.03 |
| move | 371.59 | 216.63 | 93.64 | 23.84 | 7.09 | 8.86 |
| pass | 347.47 | 194.27 | 91.69 | 24.40 | 6.97 | 5.17 |
| choose | 1,225.38 | 181.62 | 927.28 | 14.96 | 8.55 | 18.44 |

`choose` 的高层开销来自“回滚后再次执行原出牌”，不是单纯应答解析。它比普通 `pass` 多出约 877.91 ms active CPU，其中层计算多约 835.59 ms，复制少约 12.65 ms；另有未完全拆分的 pending/rollback 路径。这是单次样本，数值只用于定位调用链，不作为卡牌类型性能基准。

`summary.json` 同时以 `analysis.aggregateByType` 输出上表所用的 active CPU、phase 均值和样本数，便于后续优化任务直接与同一 seed 对比，无需手工复算。

## Top 20 self-time 热点

百分比以有效 CPU `35,726.90 ms` 为分母；`inclusive` 百分比以全部命令墙钟窗口 `73,675.00 ms` 为分母。inclusive 可跨分类重叠，只用于展示“经由该函数的调用树耗时”，不能与 self 或包自耗时相加。

| # | 函数 | 包 / 文件行 | self ms | inclusive ms | self % | inclusive % | 调用路径与含义 |
|---:|---|---|---:|---:|---:|---:|---|
| 1 | `structuredClone` | node internal worker/js_transferable:112 | 18,321.43 | 18,582.63 | 51.28 | 25.23 | 复制 checkpoint、host objects、事件、journal；真实优化入口不是 V8 内置本身 |
| 2 | `evaluateGroup` | engine-core/layers `engine.ts:936` | 2,013.93 | 9,734.60 | 5.64 | 13.22 | `LayerEngine.evaluate/evaluateAll` → 分组求值 → layer/dependency pass |
| 3 | `cloneSnapshot` | engine-core/layers `engine.ts:102` | 1,493.69 | 2,713.37 | 4.18 | 3.68 | `evaluateGroup` / `finishGroup` / `publicSnapshot` 的每个对象快照 |
| 4 | `canonicalJson` | game-server/runtime `journal.ts:97` | 1,192.85 | 6,922.22 | 3.34 | 9.40 | `projectionDigest` / privateStateDigest → recursive key sort + stringify |
| 5 | `snapshotFields` | engine-core/layers `engine.ts:141` | 1,056.10 | 1,218.57 | 2.96 | 1.65 | `cloneSnapshot` 对 raw/frozen fields 的重复冻结与数组复制 |
| 6 | `(anonymous)` alias | engine-core/programs `keyword-grants.ts:293` | 762.00 | 762.00 | 2.13 | 1.03 | keyword grant context 每次替换 `source`/query 对象时复制 object |
| 7 | `numericPredicates` | engine-core/effects `predicates.ts:295` | 671.43 | 671.43 | 1.88 | 0.91 | layer filter candidate scan，比较 might/printed cost |
| 8 | `(anonymous)` | game-server/runtime `journal.ts:100` (dist:14) | 552.60 | 3,587.68 | 1.55 | 4.87 | `canonicalJson` 数组/对象的递归 mapping/join |
| 9 | `buffMightEffects` | engine-core/layers `engine.ts:767` | 477.98 | 791.22 | 1.34 | 1.07 | 每次 arithmetic 层的 buff 候选重建 |
| 10 | `evaluateDependency` | engine-core/layers `engine.ts:1050` | 435.49 | 10,457.43 | 1.22 | 14.20 | object dependency/cycle cache lookup and group restart |
| 11 | `attachmentSignature` | engine-core/layers `engine.ts:1114` | 369.59 | 377.04 | 1.03 | 0.51 | evaluation 前对全部对象的 identity/type/tag/might/attachment JSON 签名 |
| 12 | `(anonymous)` | engine-core/layers `engine.ts:736` (dist) | 313.24 | 313.24 | 0.88 | 0.43 | copy effect 的递归 snapshot/cache path（源码 `engine.ts` copy helpers） |
| 13 | `matchesObjectPredicates` | engine-core/effects `predicates.ts:341` | 311.91 | 1,047.21 | 0.87 | 1.42 | layer filter / `queryObjects` candidate matching |
| 14 | `structuredClone` | V8 builtin (no URL) | 252.70 | 252.70 | 0.71 | 0.34 | 与 #1 同语义的内建采样片；报告不伪造其调用者 |
| 15 | `now` | V8 builtin | 244.17 | 244.17 | 0.68 | 0.33 | profiler/运行时 clock samples；不是业务热点 |
| 16 | `LayerDependencyRestart` | engine-core/layers `engine.ts:415` | 201.54 | 201.54 | 0.56 | 0.27 | dependency graph 形成后重启层 pass |
| 17 | `assertHiddenState` | engine-core/zones `hidden/state.ts:144` | 191.76 | 206.81 | 0.54 | 0.28 | hidden-zone state checks 被复制/投影路径多次触发 |
| 18 | `deepFreeze` | game-server/runtime `host.ts:112` | 174.91 | 451.58 | 0.49 | 0.61 | `host.objects()` 对累计 object snapshot 再冻结 |
| 19 | `mapEventValue` | game-server/room `room.ts:614` | 165.53 | 365.19 | 0.46 | 0.50 | 每个 Room broadcast 的 private→public player-id remap |
| 20 | `update` | node crypto hash | 161.21 | 161.21 | 0.45 | 0.22 | SHA-256 canonical payload hashing |

包级 self time 与上述调用路径一致：engine-core layers 8,245.34 ms、game-server runtime 2,063.38 ms、effects 1,202.21 ms、programs 1,200.55 ms、game-server projection 485.38 ms、chain 150.53 ms；card-dsl 20.87 ms、replay-core 124.97 ms、protocol 6.65 ms、ws 4.27 ms。不能把 Node 内置的 `structuredClone` 归到 engine-core：它最主要的业务调用入口是 `apps/game-server/src/engine-runtime/host.ts:220/231/255` 的 host checkpoint、restore 和 object view。

## 每命令重复计算核实

### 投影

对一个成功完成的 `MatchRuntime` 普通命令，`submit` → `atomicCommand` → `executeAndCommit` 生成 **1** 个 actor 结果投影（`runtime.ts:846`）；`appendJournal` 再为 A、B、spectator 生成 **3** 个（`runtime.ts:1113-1115`）；返回 Room 后 `broadcastProjections` 对两个已连接玩家各生成 **1** 个（`room.ts:1203-1206`，构造位于 `room.ts:1192`）。合计 **6 次投影构造 / 普通完成命令**，之后才是 WebSocket 序列化与发送。

pending 出牌会先走一次 1 actor + 3 journal + 2 broadcast 的暂停发布；之后的 `choose` 重放原命令并再次经历 1 actor + 3 journal + 2 broadcast。两者合计约 **12 次投影构造 / 一次需要选择的出牌流程**，另有 journal 和 Room 发布开销。

`appendJournal` 的 3 个投影随后做 3 个 viewer digest、一个 public state digest（由 spectator 投影计算）和一个 private A+B digest（`runtime.ts:1124-1125`），即 **5 次 projection canonical JSON + SHA 操作 / journal record**。`RuntimeJournalWriter.append` 另对 entry、result 与整份 journal 做完整性摘要，因此这些摘要会继续复用同一 canonical encoder，不能把“5 次”误解为整个 journal 只有 5 次 SHA。body 中的每命令平均 WS 投影字节约 `415,337 B`，每个客户端平均约一个 projection packet；这与 6 次构造中有 2 次最终被房间发送相符。

### 层

instrumentation 记录 `3,070` 次 `LayerEngine.evaluateAll`、`2,742,123` 次 `evaluate` 和 `2,448` 次 `withStableLayers`。以 78 条命令计，平均 **39.36 次 evaluateAll、35,155.42 次 evaluate、31.38 次 stable-layer 窗口 / 命令**。这是调用计数，不能把每次 `evaluateAll` 都视为一个完整无缓存的独立层 pass；`LayerEngine` 自身缓存、依赖 group 与 RIFT-999 stable view 都会命中。确定的热点是仍有大量 `evaluate/evaluateAll` 进入 `evaluateGroup`，并且 `withStableLayers` 自身墙钟总计 `10,436.97 ms`，与该窗口内的层/对象读取重叠。`LayerEngine.evaluate` 自身总计 `13,048.22 ms`，包含嵌套和 memo 命中，不能把它与 profile 的互斥 self-time 相加。

### pending choice 回滚重放

真实 journal 证据在存档 `engineRuntimeJournal.entries`：

- seq 18 是 `play` 命令 `profile-RIFT-955-v2-07-19-mvozbqbh`，`pendingReason.choiceId = target:dangerous-duo.unit`、`appliedStateVersion = 17`、`eventSeq = 321`。
- seq 19 是 `choose` 命令 `profile-RIFT-955-v2-07-20-mvozbran`，`result.resumedCommandId` 正好指回上面的 play，`appliedStateVersion = 18`、`eventSeq = 345`。

代码路径确认：`atomicCommand` 在 `PendingChoiceError` 时恢复 host/rules checkpoint（`runtime.ts:872-887`）；`choose` 设置冻结答案后调用 `this.execute(original.playerId, original.command)`（`runtime.ts:680-686`），从原命令开头重新执行。随后 actor 投影、3 个 journal 投影、5 个 digest、seen 记录以及 Room 的 2 个 broadcast 会再次执行。也就是说，**pending 导致整条原命令重复执行一次**；不是只从选择点继续的半条命令。这一行为保持了 Pending/Finalize/Resolve 与回滚一致性，优化时必须保留，不能靠跳过重算破坏语义。

### 文件存储

正式样本 storage 只有一个 `archive.log`，整档 `4,956,762 B`，含 **85 条完整 room-archive records**。逐 record 平均 `58,314.85 B`、中位 `58,278 B`、最大 `119,562 B`。从命令测量看：

- 全部 78 条命令的平均文件增长 `61,814.72 B`；除两条 setup mulligan 外，76 条 `EngineRuntime` 命令平均 `63,297.46 B`。
- 前 45 条平均 `37,387 B / 命令`，后 33 条 `95,125 B / 命令`，后半局增长约 2.54 倍。
- 最后一条 `end-turn` 单次写入增长 `119,481 B`。
- `/proc/<pid>/io:write_bytes` 在 GPFS 上为该样本报 `0`，因此不把该计数器作为写入体积证据；`stat` 前后文件大小是权威数值。存储 CPU self-time 只有 176.93 ms，说明当前缓存下 CPU profile 主要看到序列化/复制，不一定覆盖 fsync/页面缓存和共享存储抖动。

整档每次留存一份不断增长的完整 room archive，原因是 `server.runRoomTransaction` 在 `server.ts:1119` 取 `room.exportArchive()`，`file-room-store.save` 再执行 `JSON.parse(JSON.stringify(archive))`（`file-room-store.ts:139-147`），`PersistentRoomArchiveStore` 将完整 archive 作为 event 追加。当前所有 85 条记录合计约 4.96 MB，是累计快照的重复保存，而不是 85 条互不重叠的增量。

## 调用路径与源码定位

1. 命令回执：`server.ts:630` 校验 V2 command message → `runRoomTransaction` → `room.submitEngineV2`（`room.ts:1813`）→ `runtime.submit`（`runtime.ts:574`）→ `atomicCommand` → `executeAndCommit`。
2. host 深拷贝：`EngineRuntimeHost.checkpoint/restore/objects`（`host.ts:220/231/255`）对全部 objects、players、grants、lastKnown、hidden state 复制并递归冻结；chain/turn transaction 还会经过 `TurnFlow.checkpoint/restore`。
3. 层：`MatchRuntime` 创建 `ChainEngine`/`TurnFlow`，程序 lifecycle 绑定 `KeywordGrantLayerEngine`（`programs/statics.ts:269-316`）；每轮 `withStableLayers` → `layerObjects`（`chain/engine.ts:783-817`）→ `LayerEngine.evaluateAll/evaluate/evaluateGroup`（`layers/engine.ts:1144/1069/936`）。dependency restart 与 copy 都走 `evaluateDependency`/`cloneSnapshot`。
4. 投影与事件：`projectRuntime`（`engine-runtime/projection.ts:339`）每次建立 player/zone/object/action/events；`eventProjection` 调 `match.events()`，而 `EventPipeline.events` 在 `events/pipeline.ts:257` 对整个历史 log 做 `structuredClone`。这解释了后局每命令复制和 WS 字节同步增长。
5. digest：`appendJournal` 将 A/B/spectator 投影交给 `projectionDigest`；`journal.canonicalJson` 递归排序 key，再交给 SHA-256（`journal.ts:97-106`）；journal writer 又对 entry/base/整份 journal 计算完整性摘要（`journal.ts:140-160`）。
6. Room 发布：成功回执 `transport(receipt)` 后 `broadcastProjections`（`room.ts:1849`），每个 client 的 `projectFor` 经 `publicEngineProjection` 做 player-id remap；`publicEngineProjection` 的递归 `mapEventValue`（`room.ts:614-617`）再次遍历完整事件历史。`runRoomTransaction` 则对每个 outbox message 做 `structuredClone`（`server.ts:1129`）。
7. 存档：命令响应全部完成后，`runRoomTransaction` 比较 room revision，保存一次 `room.exportArchive()`；`exportArchive` 本身 `structuredClone`（`room.ts:721`），`FileRoomStore.save` 再 JSON 往返，持久层追加一份完整 archive event。

## 优化工单拆分

以下每张工单的写入区域互不重叠；所有工单必须保持旧 profile 1–9、旧回放日志、protocol v2 与 CR v1.5 的原有语义，并且不能通过删事件、跳过 pending 重放或弱化 ACK 守卫获取性能。

### RIFT-1083-A：engine-core 层求值与 snapshot 分配

**目标**：减少 `evaluateGroup`、`cloneSnapshot`、`snapshotFields`、dependency restart 的重复对象/数组构造；把稳定视图复用扩展到真正变化边界，同时不改变 CR v1.5 478.1.a–478.4 的依赖、循环和 effect-once 语义。

**写域**：`packages/engine-core/src/layers/engine.ts`、`packages/engine-core/src/chain/engine.ts`、`packages/engine-core/src/effects/filters/predicates.ts`、`packages/engine-core/src/effects/interpreter/selectors.ts` 及对应 `packages/engine-core/test/` 文件。

**预期收益**：当前层阶段 `11.16 s`，另有 7.54 s 的 layer/evaluate 内 time；先以降低每命令层 CPU 30% 为阶段目标，对应每命令约 43 ms。不要承诺直接把总 p95 降到 300 ms。

**改动风险**：最高。层缓存或 dependency 归并错误会产生隐藏的语义漂移；必须保持 layer order、object-level dependency、simultaneous cycle、effect applies once、RIFT-999 invalidation。

**涉及文件**：上述 engine-core 层/effects/chain 源文件及对应 tests；`programs/stable-layers.ts` 只在 owner 确认需要时纳入同一写域。

**验收命令**：

```bash
pnpm --filter @riftbound/engine-core typecheck
heavy pnpm --filter @riftbound/engine-core test
heavy pnpm --filter @riftbound/game-server test
RIFT_LAYER_MEMO_CHECK=1 heavy pnpm --filter @riftbound/game-server exec tsx scripts/profile-server.ts \
  --room-id=69dc614b --max-commands=1000 --game-timeout-ms=900000
```

### RIFT-1083-B：engine-runtime host 深拷贝/checkpoint

**目标**：为 `EngineRuntimeHost.checkpoint`、`restore`、`objects` 和命令 seen/pending 结构消除不必要的全量复制；优先按不可变对象共享冷态对象、复用已冻结的 object view、让 checkpoint 复制仅覆盖本次事务可写字段。`structuredClone` 占 51% 有效 CPU，是单张最高收益工单。

**写域**：`apps/game-server/src/engine-runtime/host.ts`、`apps/game-server/src/engine-runtime/runtime.ts` 及 `apps/game-server/tests/**` 中对应 runtime/host 测试。

**预期收益**：先以复制类 CPU 降低 25–35% 为目标，对应每命令约 60–84 ms；同时可减轻 GC 与后半局放大。

**改动风险**：最高。任何浅拷贝泄漏都会破坏 command atomicity、pending choice 回滚、隐藏信息和重复命令幂等；必须保留 `execute`/`choose` 的 rollback boundary 和 seen-command payload hash。

**涉及文件**：`host.ts`、`runtime.ts`，以及相应 host/runtime/pending-choice 测试；不改 room、journal 或 layers。

**验收命令**：

```bash
pnpm --filter @riftbound/game-server typecheck
heavy pnpm --filter @riftbound/game-server exec vitest run --config vitest.config.ts engine-runtime
heavy pnpm --filter @riftbound/game-server test
```

### RIFT-1083-C：engine-runtime projection / journal digest

**目标**：从一次性状态生成 A、B、spectator 三个 projection view 的共享只读中间态，避免每个 view 重复遍历 `host.objects()`；把 journal projection digest 改为增量写入/non-recursive canonical encoder 或安全的内容哈希，仍产生相同的 digest 支持。明确减少 6 次 projected view 构造、5 次 digest 中的重复路径，但不得删 journal 完整性字段。

**写域**：`apps/game-server/src/engine-runtime/projection.ts`、`apps/game-server/src/engine-runtime/journal.ts`、`apps/game-server/src/engine-runtime/runtime.ts` 及对应 projection/journal tests。

**预期收益**：当前 projection 0.57 s 与 digest 1.97 s CPU，stage 合计约 2.55 s；合理目标是先降低这两部分 30–50%，并把后局 event-history 放大压平。

**改动风险**：高。三个视角必须严格保留 hidden-info 分区、digest 排序和 journal 兼容；不得改变 protocol shape、事件顺序、投影身份或 replay validation。

**涉及文件**：projection、journal、runtime 及 tests；不修改 Room 或 storage。

**验收命令**：

```bash
pnpm --filter @riftbound/game-server typecheck
heavy pnpm --filter @riftbound/game-server exec vitest run --config vitest.config.ts engine-runtime
heavy pnpm --filter @riftbound/game-server test
```

### RIFT-1083-D：Room 投影发布与事件历史

**目标**：避免对每个 viewer 重新构造并递归 remap 完整事件历史；为 Room→public player-id 的映射建立单次共享事件投影，并对同一 revision 的两个 viewer 复用安全不变部分。事件历史只追加，应按稳定 revision 缓存而非每命令重新遍历。

**写域**：`apps/game-server/src/room.ts`、`apps/game-server/src/server.ts` 的 V2 publication 相关测试；不改 engine-runtime/internal projection。

**预期收益**：当前 Room/game-server self CPU 与 event remap 约 0.35–0.57 s；WS body 每命令约 `415 KB`，若只发送 revision 增量或复用公共事件 envelope，可把传输体积作为另一条可量化收益，目标先降 20–30%。

**改动风险**：中高。必须保持两客户端各自 private projection、ACK 顺序、事件 seq 和 reconnect/resume 语义；不能改为单视角广播或延迟发送。

**涉及文件**：`room.ts`、`server.ts` 与 server room/transport tests；不改 engine-core。

**验收命令**：

```bash
pnpm --filter @riftbound/game-server typecheck
heavy pnpm --filter @riftbound/game-server exec vitest run --config vitest.config.ts server
heavy pnpm --filter @riftbound/game-server test
```

### RIFT-1083-E：文件存档增长与写入

**目标**：把每条命令追加完整 growing room archive 改为可恢复的 append-only 增量/CAS snapshot（仍保留日志序号、checksum、private archive 恢复），减少 63 KB/命令和后期 95 KB/命令的重复复制/序列化。

**写域**：`apps/game-server/src/file-room-store.ts`、`apps/game-server/src/storage/persistent-room-store.ts`、`apps/game-server/src/storage/**`、`apps/game-server/tests/server/room-restore-isolation.test.ts` 及新增 storage recovery tests。

**预期收益**：正式样本总 archive 4.96 MB、85 records；对长局至少可把持续增长量降到每命令实际 delta 或分段 snapshot，并降低 `room.exportArchive()`、JSON round-trip 和 fsync 放大。CPU self-time 只测得 0.18 s，收益需用文件字节和持久化延迟单独验收。

**改动风险**：高。必须保持旧 archive 可读、严格恢复、失败隔离/quarantine、CAS/checksum 和 SIGTERM 后恢复语义；不能用减少日志条数伪造性能。

**涉及文件**：file room store、persistent store、storage tests；不改 engine/runtime/room public protocol。

**验收命令**：

```bash
pnpm --filter @riftbound/game-server typecheck
heavy pnpm --filter @riftbound/game-server exec vitest run --config vitest.config.ts room-restore-isolation
heavy pnpm --filter @riftbound/game-server test
```

### RIFT-1083-F：事件与 contract 深拷贝清理

**目标**：清理 event pipeline、action adapter、payload 构造中的重复 `structuredClone`/deep freeze；对已冻结的 event object 使用只读引用或结构共享，避免每个 viewer/broadcast 复制完整事件历史。

**写域**：`packages/engine-core/src/events/**`、`packages/engine-core/src/chain/**` 中 event/contract copy 调用及对应 engine event tests。

**预期收益**：直接覆盖 `structuredClone` 51% 热点中的事件路径，目标在 RIFT-1083-B 之外再降复制 CPU 10–20%，并压低后局 `eventProjection`/WS 处理时间。

**改动风险**：高。事件 payload 是 trigger/finalize/LKI 的权威证据；必须保持冻结、顺序、batch、simultaneous group、隐私与严格 replay。

**涉及文件**：`events/pipeline.ts`、`events/action-adapter.ts`、`events/pipeline-types.ts`、`events/producers/payload.ts`、`chain/engine.ts` 相关 copy 点及 tests。

**验收命令**：

```bash
pnpm --filter @riftbound/engine-core typecheck
heavy pnpm --filter @riftbound/engine-core test
heavy pnpm --filter @riftbound/game-server test
```

## 需保持的不变量与风险

- profile 采用 CR v1.5 ruleset、V2 protocol `2.0.0`、`engine-v2` 生产房间；mulligan 按 CR 117 在 turn order 完成，play 的 pending target 选择不能被优化成隐式自动选择。
- RIFT-999/927 stable-layer 复用只能省重复读取，不能删除 478.1.a–478.4 的 dependency/cycle/layer pass 语义；RIFT-1015 attachment signature 变化也必须使缓存失效。
- pending choice 的回滚检查点、选择答案、journal pending record 和 `resumedCommandId` 必须严格保持；当前自然样本的 seq 18/19 是该不变量的审计证据。
- `projectionDigestByViewer` 的 spectator/A/B keys、public/private digest、journal checksum 和 room archive 校验不能减少或改变；旧 profile 1–9 和旧 replay 必须继续严格重放。
- 不以 idle 百分比推断 CPU 成本；共享机 load average 在本轮约 100–150，1 ms 采样只能用于同一 cut 内的相对归因。文件系统 cache/GPFS 抖动也未包含在 CPU profile 中。
- 该样本是单个固定 seed 的 M1 对局，不能证明所有官方卡牌、规则路径或百局回放结果；官方能力和无头百局仍需由各自 owner 验证。

## 未完成项

- 没有进行生产代码优化：任务明确限定只测不改；上面给出的是可独立并行的后续工单。
- 没有用 fixture 生造每类官方卡牌覆盖；本次 78 条自然命令没有产生 `combat-damage` 样本，`choose` 等低频单项统计样本量有限，报告中按调用证据解释而不外推稳定性能。
- 没有把 `write_bytes` 当作存储精度；当前运行所在 GPFS 对该指标返回 0，已改用 archive 文件大小、逐命令 growth 和 record 字节作为可复核证据。
