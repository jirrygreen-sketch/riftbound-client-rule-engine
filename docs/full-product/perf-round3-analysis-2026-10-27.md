# RIFT-1107 第三轮重命令性能分析（2026-10-27）

## 结论

本轮在代码快照 `3e0e494d0250da945ffeef8bddf5f5da68832d05` 上，用固定
`room=69dc614b`、`--deterministic-seed=rift1094`、真实 WebSocket 和文件房间存储跑
3 次完整 M1 自然对局。三轮都是 78 条命令、`player-1` 获胜；按 run 1/2/3 排列，
单局回执 p50 为 `142/134/127 ms`（中位 **134 ms**），p95 为
`807/859/756 ms`（中位 **807 ms**），p99 为 `1495/1402/1403 ms`，最大为
`1495/1402/1403 ms`。把 3×78 条命令合并后，p50 为 134 ms、p95 为 756 ms、p99
为 1402 ms。单房间 p95 仍未达到 300 ms。

按命令类型看，每个类型自己的 p95 超过 300 ms 的是 `mulligan`、`play`、
`choose`、`pass`、`end-turn`。其中只有 `mulligan`、`play`、`choose` 的分布
跨过全局 p95 线；`end-turn` 和少数 `pass` 是 300–700 ms 的稳定尾部来源。
每轮 78 条命令中有 13 条超过 300 ms；按脚本的 nearest-rank 定义，p95 ≤ 300 ms
最多只能留下 3 条超过 300 ms 的命令，当前需要消除每轮至少 10/13 条重命令，
不能只处理每次运行最高的那一条。

尾部不是 room 广播或 fsync 主导。三轮整局命令窗口的有效 CPU 中位数为
`15,713.69 ms`，其中 layers `8,867.54 ms`（56.43%）、engine-runtime/host 与
chain 路径 `2,711.71 ms`（17.26%）、canonical digest `1,055.53 ms`（6.72%）、
copy `999.90 ms`（6.36%）、projection `537.98 ms`（3.42%）、storage
`284.06 ms`（1.81%）；GC 另为 `1,001.79 ms`。层求值是最主要的共同成本。

`choose` 与促使它产生的 `play` 在重放前后承担几乎相同的 CPU：对应样本的三轮中位
active CPU 分别为 **808.94 ms** 与 **819.29 ms**，其中 layers 分别为
**673.11 ms** 与 **672.32 ms**。真实 journal 的 seq 18 是停在
`target:dangerous-duo.unit` 的 `play`，seq 19 的 `choose` 记录
`resumedCommandId=profile-RIFT-955-v2-07-19`，状态版本从 17 到 18、事件序号从
321 到 345。主因是 `choose` 从原命令开始重新执行整条 play，而非 checkpoint
恢复本身。

`end-turn` 中位 active CPU 为 **333.94 ms**，其中 layers **224.46 ms**、
engine **38.98 ms**、copy **17.50 ms**、digest **14.40 ms**、storage
**4.03 ms**。第 3、4 回合恰为约 448–463 ms 的层成本，但每个 `end-turn` 在
其余回合仍引起约 145–221 ms 层成本。事件历史从 143 增长到 1328 条时，projection
只增长到约 15 ms、digest 约 23 ms、storage 约 14 ms；长局历史放大存在，尾部
仍主要来自每回合完整 TurnFlow/Chain/layer 工作。

`mulligan` 六条回执的平均值为 **1201.17 ms**；按每轮先算 active CPU 与各阶段均值、
再取三轮中位，active CPU 为 **1159.14 ms**，其中 engine **620.56 ms**、layers
**424.99 ms**。
函数采样把成本落在
`GameRoom.mulliganProbe -> createEngineRuntime().start -> createMatch ->
attachProgramLifecycle -> TurnFlow.advance`。当前 `mulliganProbe` 在尚未有
setup 时先构造一次 automatic probe，之后每次取 setup projection 又构造一个带
空换牌选择的 preview runtime；接收命令、校验手牌和向两个 spectator 路径广播时
都可能再次调用它。固定开局事实应缓存，最终权威 runtime 仍只在双方选择完成后
创建一次。

推荐顺序是：先做**按权威写世代复用的 LayerPlan/分层求值会话**，再做
**mulligan setup probe 的一次性模板缓存**，最后在保留完整回放的前提下评估
**choice continuation**。A 解决所有重命令共同依赖的层求值基础，但失败边界最多；
B 的写域和作用域最小；C 能消除当前接近一整次重命令的重复执行，但语义和恢复
风险最高。三项都不能单独承诺
p95≤300 ms，必须用同轨迹前后交替、百局轨迹/回放比较和真实生产装配门禁验收。

## 基线与可复现方法

工作树开始与 profile 时：

| 项目 | 值 |
|---|---|
| 分支 | `task/RIFT-1107-perf-round3-analysis` |
| profile 代码提交 | `3e0e494d0250da945ffeef8bddf5f5da68832d05` |
| 当前 integration 合入后 | `393cdbfc`；差异只有 `RIFT-1106` 的两份 beta 文档 |
| Node | `v22.22.2` |
| 平台 | `linux/x64` |
| 房间/seed | `69dc614b` / `rift1094` |
| 存储 | 每个样本独立目录的文件存储 |
| CPU sampling | `--cpu-prof --cpu-prof-interval=1000` |

`integration` 在采样期间前进；`3e0e494..393cdbfc` 只修改
`docs/full-product/desktop-user-guide.md` 并新增 `docs/full-product/m1-beta-quickstart.md`，
没有修改 server、engine 或 storage 代码，因此三轮代码 profile 仍对应当前集成的
运行时。

构建命令：

```bash
heavy pnpm --filter @riftbound/protocol build
heavy pnpm --filter @riftbound/card-data build
heavy pnpm --filter @riftbound/card-dsl build
heavy pnpm --filter @riftbound/engine-core build
heavy pnpm --filter @riftbound/game-server exec tsc -p tsconfig.json
```

每轮命令：

```bash
SWARM_TASK=RIFT-1107-perf-round3-analysis \
SWARM_PORT_BASE=36420 SWARM_PORT_SPAN=20 \
heavy pnpm --filter @riftbound/game-server exec tsx scripts/profile-server.ts \
  --room-id=69dc614b --deterministic-seed=rift1094 \
  --output-dir=/tmp/RIFT-1107-perf-round3-analysis/profile \
  --output-label=RIFT-1107-round3-formal<1|2|3> \
  --max-commands=1000 --command-timeout-ms=120000 \
  --game-timeout-ms=900000 --startup-timeout-ms=180000
```

harness 自动设置 `RIFTBOUND_ALLOW_DETERMINISTIC_RANDOM=1` 和
`RIFTBOUND_DETERMINISTIC_RANDOM_SEED=rift1094`。三次服务进程均使用端口 36420，
运行结束前没有继续下一步命令，收据等待和两个玩家的投影收敛均走真实 WS 路径。

轨迹认证比较全部 78 项的
`type/actorPlayerId/phase/turnNumber/beforeStateVersion/receiptStateVersion/eventSeq/accepted/duplicate`。
三次 SHA-256 都是
`39abce60108edd96033edd87ee54c66e1a753d496e79a83f273d2bcc0466e740`。
按当前 `room-archive-delta` 规则还原 86 个逻辑 archive 后，剔除运行身份、token、
checksum、archive digest 与 wall-clock 字段，三次哈希均为
`ac730fc32db8852f1c62ec9d728c27caa6a130b0e6602553df269cefe4f4125f`。
生产 `PersistentRoomArchiveStore.readArchives()` 也成功读回同一 run 的 86 条记录，
并确认 seq 18/19 的 pending/resume 关系。

证据目录为 `/tmp/RIFT-1107-perf-round3-analysis/`；各轮的 `summary.json`、
`server.cpuprofile`、instrumentation 和 storage 都在其 `profile/` 下。

## 命令耗时分布

回执延迟是从发送 `command` 到客户端收到对应首个 `command-receipt`。分位数先在
每轮内按类型用 nearest-rank 计算，再取三轮中位数；最后一列是三轮合并后的
`>300 ms` 样本数。逐条耗时表按 run 1/2/3 排列。

| 类型 | 每轮次数 | p50 ms | p95 ms | 最大 ms | 三轮合计 >300 ms | 按类型 active CPU 中位数 ms |
|---|---:|---:|---:|---:|---:|---:|
| mulligan | 2 | 1041 | 1495 | 1495 | 6/6 | 1159.14 |
| rune-energy | 38 | 122 | 167 | 244 | 0/114 | 116.96 |
| move | 3 | 142 | 199 | 199 | 0/9 | 139.79 |
| pass | 17 | 61 | 712 | 743 | 6/51 | 125.41 |
| play | 7 | 199 | 827 | 859 | 6/21 | 307.56 |
| choose | 1 | 807 | 860 | 860 | 3/3 | 808.94 |
| end-turn | 10 | 314 | 586 | 603 | 18/30 | 333.94 |
| **全部** | **78** | **134** | **807** | **1495** | **39/234** |  |

`choose` 每轮只有一个样本，所以其 p50/p95/max 相同；`mulligan` 只有两个，p95
等于最大值。这两行适合定位重复路径，不适合宣称总体分位数。

每轮的具体尾部是稳定的：

| 命令位置 | 类型 | 三轮耗时 ms | 解释 |
|---|---|---:|---|
| 0 | mulligan | 1495 / 1402 / 1403 | 第一份 setup 选择 |
| 1 | mulligan | 1041 / 929 / 937 | 第二份选择并建立最终 runtime |
| 19 | play | 827 / 859 / 756 | turn 3 的 Dangerous Duo 等待目标 |
| 20 | choose | 807 / 860 / 756 | 选择答案后从原 play 重放 |
| 23 | pass | 537 / 497 / 455 | turn 3 Chain/结算路径 |
| 24 | end-turn | 568 / 586 / 547 | turn 3 结束 |
| 27 | end-turn | 577 / 603 / 524 | turn 4 结束 |
| 45 | pass | 712 / 688 / 743 | turn 5 Chain/结算路径 |
| 46/49/59/77 | end-turn | 约 306–351 | 后续回合结束 |

因此“p95 以上”要分两种口径：

- 类型自身 p95 大于 300 ms：`mulligan`、`play`、`choose`、`pass`、`end-turn`。
- 达到全局 p95 的样本：每轮都是两条 `mulligan`、一条 pending `play` 和随后的
  `choose`。三轮合并后只有这三个类型；按 nearest-rank 取到第 223 条样本，
  合并轨迹中 `>756 ms` 有 10 条，`≥756 ms` 有 12 条。

`end-turn` 和少数 `pass` 虽然没有跨过全局 p95，仍决定优化后的下一层尾部。
如果只把 mulligan/choice 降到 300 ms 以下，18/30 个 `end-turn` 仍会立即占满新的
p95 尾部。

## 整局 CPU 与函数热点

1 ms CPU profile 的互斥 self time 中位如下。百分比以命令窗口 sampled time
15,713.69 ms 为分母；阶段按最内层匹配栈分类，不能把 inclusive 时间相加。

| 阶段 | CPU ms | 占命令窗口 | 主要函数/路径 |
|---|---:|---:|---|
| layers | 8,867.54 | 56.43% | `LayerEngine.evaluate/evaluateAll -> evaluateGroup -> evaluateDependency -> cloneSnapshot` |
| engine runtime/chain | 2,711.71 | 17.26% | `RuntimeHost.performance/copyValue/deepFreeze`、`TurnFlow`、`ChainEngine` |
| digest | 1,055.53 | 6.72% | `writeCanonical`、`canonicalJsonInto`、`projectionCanonicalJson` |
| copy | 999.90 | 6.36% | Node `structuredClone` |
| projection | 537.98 | 3.42% | `projectionSnapshot`、`projectRuntimeFromSnapshot`、`actionOptions`、事件投影 |
| storage | 284.06 | 1.81% | file archive/delta 写入 |
| journal | 7.35 | 0.05% | `RuntimeJournalWriter.append` |
| other | 1,020.85 | 6.50% | 未归类成功路径 |
| GC | 1,001.79 | 6.38% | V8 |

三轮函数 self-time 中位数：

| 函数 | 位置 | self ms | inclusive ms | 解读 |
|---|---|---:|---:|---|
| `evaluateGroup` | `packages/engine-core/src/layers/engine.ts` | 1,893.08 | 8,336.96 | layer pass、组级依赖和 effect-once 的主体 |
| `evaluateDependency` | 同文件 | 334.67 | 9,097.52 | dependency 读取/缓存/cycle restart 的公共入口 |
| `cloneSnapshot` | 同文件 | 1,285.56 | 2,284.08 | 每个 layered snapshot 的复制/冻结 |
| `snapshotFields` | 同文件 | 880.89 | 1,035.06 | raw/frozen 字段数组规范化 |
| `copyValue` | `apps/game-server/src/engine-runtime/host.ts` | 778.30 | 1,049.63 | host checkpoint、对象视图和事务复制 |
| `deepFreeze` | 同文件 | 447.17 | 761.24 | host snapshot 冻结 |
| `writeCanonical` | `apps/game-server/src/engine-runtime/journal.ts` | 570.39 | 2,307.14 | projection/journal canonical encoder |
| `canonicalJsonInto` | 同文件 | 300.26 | 868.52 | encoder 调度与拼接 |
| `attachmentSignature` | `packages/engine-core/src/layers/engine.ts` | 388.51 | 403.34 | 附件资格失效检查 |
| `matchesObjectPredicates` | `packages/engine-core/src/effects/filters/predicates.ts` | 257.32 | 545.54 | filter 热路径 |
| `numericPredicates` | 同文件 | 253.85 | 253.87 | Might/cost 比较热路径 |

instrumentation 三轮计数完全一致：`runtimeHost.objects` 16,039 次、
host checkpoint 2,461 次、TurnFlow checkpoint 2,478 次、`layer.evaluate`
2,742,123 次、`layer.evaluateAll` 3,070 次、`withStableLayers` 2,448 次、
journal append 76 次。host restore 仅 3 次、TurnFlow restore 仅 4 次，直接说明
回滚恢复调用不是主要耗时；每次重放中的规则与层求值才是。

## 重命令分解

### 1. `choose`：一次选择触发整条 play 重放

| 阶段 | `choose` 中位 | 对照 `play` 中位 |
|---|---:|---:|
| active CPU | 808.94 ms | 819.29 ms |
| layers | 673.11 ms | 672.32 ms |
| engine（不含 layers） | 26.49 ms | 36.32 ms |
| copy / GC | 40.29 / 50.61 ms | 44.73 / 43.60 ms |
| digest | 9.55 ms | 7.46 ms |
| projection | 6.36 ms | 6.23 ms |
| journal / storage | 0 / 2.12 ms | 1.06 / 2.13 ms |
| idle / other（含 GC） | 8.50 / 50.61 ms | 8.51 / 43.61 ms |

真实档案的 seq 18 是：

```text
play profile-RIFT-955-v2-07-19
stateVersion=17 eventSeq=321
pendingReason={choiceId: target:dangerous-duo.unit, ownerPlayerId: A, kind: select-objects}
```

seq 19 是：

```text
choose profile-RIFT-955-v2-07-20
stateVersion=18 eventSeq=345
result.resumedCommandId=profile-RIFT-955-v2-07-19
```

源码路径为 `runtime.submit -> MatchRuntime.choose -> atomicCommand -> execute(original.command)
-> ChainEngine.execute/advance -> TurnFlow -> LayerEngine`。`atomicCommand` 先取得
host/Flow checkpoint；Pending 时恢复事务、记录 pending receipt，随后 `choose` 写
入冻结答案并从原 play 开头执行。第二次执行仍要完成 Finalize、费用/目标合法性、
Chain advance、Resolve、事件、投影和 journal。恢复调用本身很短，整条 play 的
规则工作被重复一次。

run 2 的单轮 CPU 采样中，`choose` 命令窗口的 `submit` inclusive 为 782.83 ms，
`choose` 766.91 ms，`ChainEngine.advance` 754.16 ms，
`evaluateDependency` 492.62 ms，`evaluateGroup` 487.01 ms，
`cloneSnapshot` 183.21 ms，`snapshotFields` 83.55 ms，`host.objects`
217.60 ms。`executeAndCommit`、actor projection、journal canonical JSON 合起来
只占窗口的一小部分。

### 2. `end-turn`：完整 End/Expiration/Next Turn 的层扫描

`end-turn` 每次执行 `TurnFlow.endTurn` 的 `main-end -> ending -> turn-end ->
expiration`，并推进 awaken/beginning/channel/draw/main。其平均 active CPU
333.94 ms 是每轮十个结束回合的平均，不代表所有回合都相同：

| 回合 | 本样本回执 ms | active CPU ms | layers ms | copy ms | digest ms |
|---:|---:|---:|---:|---:|---:|
| 1 | 172 | 166.65 | 116.71 | 7.44 | 5.32 |
| 2 | 212 | 210.14 | 145.56 | 9.49 | 4.24 |
| 3 | 586 | 579.23 | 462.52 | 23.29 | 9.53 |
| 4 | 603 | 579.61 | 448.28 | 24.39 | 9.41 |
| 5 | 306 | 308.24 | 192.77 | 12.72 | 13.77 |
| 6 | 349 | 340.01 | 205.45 | 16.95 | 18.00 |
| 7 | 259 | 250.38 | 155.00 | 15.95 | 20.17 |
| 8 | 344 | 340.81 | 206.95 | 17.00 | 20.18 |
| 9 | 277 | 267.40 | 155.85 | 22.48 | 23.34 |
| 10 | 334 | 320.76 | 157.75 | 25.40 | 23.28 |

单轮 end-turn 窗口累计中，`TurnFlow.endTurn` 2,587.80 ms、
`TurnFlow.advance` 2,658.88 ms、`evaluateGroup` 1,703.77 ms、
`evaluateDependency` 1,763.16 ms、`cloneSnapshot` 571.17 ms、
`snapshotFields` 235.19 ms、`host.objects` 855.99 ms。相较之下，10 条命令的
journal entry/append 窗口合计约 139 ms，storage 约 42 ms。

后半局的 eventSeq 和 archive 确实增长，但同类 `end-turn` 的 projection 仍只有
约 7–15 ms、digest 约 14–23 ms、storage 约 4–14 ms，无法解释 300 ms 以上的尾部。
造成尾部的是 TurnFlow 清理/阶段任务及其层求值；第 3、4 回合较高，后续仍保留
150–221 ms 的地板成本。

### 3. `mulligan`：重复创建 setup preview runtime

按每轮先算两条 mulligan 的 active CPU/阶段均值、再取三轮中位，active CPU 为
1159.14 ms，其中 engine `620.56 ms`、layers `424.99 ms`、copy `50.39 ms`。
相比之下，projection `7.44 ms`、digest `7.43 ms`、storage `1.07 ms`。这不是把两条
命令的耗时相加；六条回执的平均墙钟则是 `1201.17 ms`。

run 2 的两条 mulligan 命令窗口中，`GameRoom.mulliganProbe.start` inclusive
2,193.25 ms，`createMatch` 1,548.63 ms，`attachProgramLifecycle`
481.89 ms，`host.objects` 1,219.97 ms，`copyValue` 518.43 ms，
`deepFreeze` 295.00 ms，`evaluateGroup` 375.80 ms。

源码显示 `mulliganProbe()` 在没有 setup 时先创建 `automaticProbe`，读取首玩家、
战场选择和公共视图；随后又为四张起手/预览创建 runtime。首次 ready、每次
`submitMulliganSetup` 校验手牌、以及每位接收者的 `sendProjection` 都仍可调用这
条路径，最后双方选择完成后还会创建最终 engine runtime。固定 setup 事实与最终
权威 runtime 被混在重复构造中。

## 规则与生产路径证据

规则目标为 Core Rules v1.5，Last Updated 2026-10-09，生效日 2026-10-16。

| 来源 | 版本/生效 | URL |
|---|---|---|
| Core Rules v1.5 | 2026-10-09 / 2026-10-16 | https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf |
| Radiance patch notes/rulings | published 2026-10-09 / 2026-10-16 | https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/ |
| Rules Hub | current index | https://playriftbound.com/en-us/rules-hub/ |
| Official card gallery ingestion | source used by local catalog sync | https://content.publishing.riotgames.com/publishing-content/v2.0/public/channel/riftbound_website/list/riftbound_gallery_cards?locale=en_US |

本地只读依据及哈希：

| 文件 | SHA-256 |
|---|---|
| `/root/swarm-rift/shared/rules/CR-v1.5.txt` | `bbc81327eb21242452db3c56348b0725b1e0b6186c1a682dde541f3c7a864ba2` |
| `/root/swarm-rift/shared/official-effect-order-policy.json` | `1d5f9b0faae6cfd31861b61c0d6c430e3775f05a88ae4ca4fa6a2023d1d0f2f6` |
| `/root/swarm-rift/shared/rules/official-order/source-snapshots.json` | `0883794853dbbee21282ce7e417699016d97c1fa3c385b57295a5832c2e8321e` |
| `packages/card-data/data/deck-catalog.json` | `06d99a589fed6046bff8072847946d5304a8ca43ef1e4e2c680c4a7a0f1df766` |

| 实际交互 | 规则/卡文证据 | canonicalCardId | 处理时间线 | 生产/回归断言 |
|---|---|---|---|---|
| Mulligan 两座位 | CR116、117.1–117.3、118；按 turn order 各选至多两张，补抽后回收，再开始第一回合 | 未触发卡牌效果；M1 decks | command 0 第一座位 keep-all，command 1 第二座位 keep-all；两次 receipt 的 stateVersion/eventSeq 都为 0；随后建立正式 runtime | `apps/game-server/tests/server/engine-v2-mulligan.test.ts`：真实 GameRoom、顺序、四张开手、重连、幂等、最终 journal `header.setup.mulligans`；未来 setup 缓存必须复用此测试并补每 viewer 不重建 runtime 计数 |
| Dangerous Duo 的 Play Effect 与目标选择 | CR355.5、355.7、355.13、355.15 固定 Finalize 选择；CR359.3.e.* retarget/失败分类；CR812.1.b.1、812.1.c 的 Legion 条件；CR383.4.a.2 Play Effect 在永久物 Finalize 后入链 | `card.hash-d4e849d845765608b07bf4af4aa19877f6303dfff539b541d0d070320dd05d91` | `play@seq18` 进入 Pending `target:dangerous-duo.unit`，stateVersion 17/eventSeq 321；`choose@seq19` 写入 `token:19:5`，stateVersion 18/eventSeq 345，result 指回原 play | `packages/engine-core/test/engine-gaps/m1-turn-finalize-history.test.mjs` 覆盖生产 binding/lifecycle 的 Legion、自身排除、Finalize 历史和 rollback；任何 continuation 优化都必须保持该序列及失败回滚 |
| End-turn | CR316.9 结束 Main；317.1–317.3 Ending/Expiration；319、322 Cleanup 触发与重入；317.2.f FEPR 重做 Expiration | 不绑定单卡 | command `end-turn` 完成 main-end、ending、turn-end、cleanup、expiration、下一玩家 start；每个样本 stateVersion +1 | `packages/engine-core/test/rules/turn/317.2.f-expiration-loops-when-fepr-occurs.test.mjs` 与 `316.9-end-main-on-no-discretionary.test.mjs`；profile 必须保持每一 primitive action、事件和 cleanup 次数 |
| 层、依赖、effect-once | CR478.1.a–478.1.c 对象依赖/循环；478.2–478.4 顺序、单次应用、重新评估；479 分层 | M1 当前对象与持续效果 | 每个重命令均进入 `evaluateGroup`；跨对象依赖与 effect-once 仍在该调用内完成 | `packages/engine-core/test/engine-gaps/perf-layer-snapshot.test.mjs`、`m1-layer-evaluation-cost.test.mjs`、`m1-keyword-reexpansion-set.test.mjs`；优化必须迁移/复跑这些既有断言 |
| Chain/Pending/Finalize/Resolve | CR329、334、337.1–337.4、338–340；Finalize 最老，Resolve 最新，不能统一 FIFO/LIFO | Dangerous Duo manifest/trigger | sampled profile 的 pending play 在 receipt 前完整回滚；choose 从原命令开头重放；最终 receipt 才把 stateVersion 加一 | `packages/engine-core/test/rules/chain/337.1-multiple-pending-finalized-oldest-first.test.mjs`、`340.1-lifo-resolution-order.test.mjs`、`383.3.d-simultaneous-triggers-same-player-orders.test.mjs` |

本地 `deck-catalog.json:356` 的 Dangerous Duo 原文要点为
`[Legion] — When you play me, give a unit +2 [M] this turn.`，印刷
`energy=3`、`power=null`。`power:null` 只表示没有印刷 Power，不能被性能代码或测试改成
0。本次没有找到针对该卡的特殊顺序裁定，因此按 CR812 与通用 Finalize/目标规则
解释；不会把某个开源挂载顺序或 YGO 的优先/后进先出规则外推给全部卡。

本轮轨迹没有出现需要多个控制者同时为各自触发排序的分支，不能据此宣称 CR303.2.a、
383.3.d 和全部 LKI 路径已经验证；这些仍是后续性能变更的回放和规则回归门禁。
未知能力继续 `judge-required`/`blocked`，本次只读分析没有把执行能力扩大到任何卡。

## 结构性方案（最多三个）

以下收益是按“layer 阶段下降 20–40%”和当前逐类分解做出的工程估算，不是已经取得
的 SLO；三项收益有重叠，不能相加。

### 方案 A：按权威写世代复用的 LayerPlan / 分层求值会话

**做法。** 在一条网络命令的处理窗口内，为当前 host 写世代保留一份不可变的
`LayerPlan`：对象层快照、dependency/SCC 分组、已应用 effect-once 集合和只读
projection view 的索引。每一层调用仍执行真实的 Finalize/Resolve/Cleanup 语义；
根对象在该世代写入时整体失效。命中条件至少包含 host write generation、effect
registry revision、derived keyword epoch、附件签名和 timing point。新的 host
视图仍以 copy-on-write 方式替换，只有未受写入影响的 base snapshot 可共享。

**预计收益。** 当前 `choose`、`play` 的 layers 约 630–710 ms，`end-turn` 约
145–463 ms。若真实 pass 中可去掉 20–40% 的重复 group/snapshot 工作，估算
`choose` 减少约 126–284 ms、`end-turn` 平均减少约 29–90 ms。该范围依据当前
`evaluateGroup` self 中位 1,893 ms、`cloneSnapshot` 1,285 ms 与端点阶段值；不足以
单独达到 300 ms，但它同时改善所有重命令，是必须的第一步。把同一轨迹各命令按
对应 layer self time 的 20%/40% 保守扣减，三轮 p95 中位数会从当前 807 ms 分别降至
约 672/538 ms，也就是本方案本身带来约 135–269 ms 的 p95 收益估计。该推演没有计入
尚未证明可复用的 pass，故只能作为结构方案的量级依据。

**语义风险。** 最高。任何跨 host write、registry mutation、effect expiry、attachment
改变或 stable-view boundary 的错误复用都会破坏 CR478 的 dependency/cycle/
effect-once、RIFT-927/999 的 reentrant view 或 RIFT-1015 的附件资格。不能把
“跨投影复用”扩大成长期全局缓存。

**改动面。** `packages/engine-core/src/layers/engine.ts`、
`packages/engine-core/src/chain/engine.ts`、必要的
`packages/engine-core/src/programs/lifecycle.ts` / `statics.ts` 以及对应测试；
`apps/game-server/src/engine-runtime/projection.ts` 只在共享只读输入时扩展。

**协议/存档。** 都无需修改；这是进程内计算缓存。

**验证。** 用 `createProgramBinding + ChainEngine/TurnFlow + attachLifecycle` 的真实装配
覆盖：相同状态重复读、真实 action 后的失效、对象依赖/循环同一套、copy/attachment、
effect-once、target lock/retarget、Pending rollback、LKI；比较 cache-on/off 的投影、
事件、journal 和最终逻辑 archive 字节。每个可变状态边界必须有反例。

### 方案 B：缓存 mulligan setup probe，最终 runtime 只建一次

**做法。** 在双方 ready、牌组未变化且 catalog digest 固定后，一次性建立不可
变的 setup template：首玩家、两个战场选择、每座四张 opening hand 及各 viewer
可发布的安全投影。`mulliganProbe`、手牌选择校验和两个 spectator 广播只读取这份
template；用户命令和事故重试无法把它当 runtime。双方选择落定后才创建唯一正式
runtime。缓存键必须包含 room/decks/catalog digest/setup RNG pin，任一牌组变更即失效。

**预计收益。** 每轮 mulligan 的平均 active CPU 为 1036–1159 ms，`createMatch`
相关样本约占 775 ms/命令，host copy 约 259 ms/命令。移除重复的 automatic probe
和 viewer 级 preview 后，保守目标是减少每轮共 500–1000 ms 的重复建局；最终权威
建局仍保留，预计能把单条 mulligan 从约 0.9–1.5 s 拉到接近或低于 0.7 s。收益不是
从提前构造或伪造开局状态获得。把每轮两条 mulligan 合计保守扣减 500/1000 ms 后，
同一轨迹 p95 中位数会从 807 ms 分别降到约 743/712 ms，即本方案本身约 64–95 ms
的 p95 收益估计；这与方案 A 的收益不可相加。

**语义风险。** 中高，但作用域限定在 setup。必须保证首玩家/战场选择/起手顺序与
最终 journal header 完全一致；不同 viewer 只能看到自己的四张牌；重连、重复命令、
deck 变更和错误回滚不能使用旧 template。

**改动面。** `apps/game-server/src/room.ts` 的 `mulliganProbe`、
`setupMulliganProjection`、`finishMulliganSetup`；必要时在
`apps/game-server/src/engine-runtime/runtime.ts` 暴露只读 setup preview，但不得复用
其 command owner。测试放 `apps/game-server/tests/server/engine-v2-mulligan.test.ts` 与
相关 engine-runtime 测试。

**协议/存档。** 都无需修改；最终 journal/archive 仍是现有 `runtime.start()` 的产物。

**验证。** 重复 keep-all、换两张、第一座位/第二座位顺序、两 viewer 隐私、重复
`mulligan` commandId、失败比赛重建、恢复中途等待房、最终 journal header 对拍；
另外用调用计数断言每个 deck/catalog 版本的完整 runtime 构造只有需要的正式一次。

### 方案 C：在 Pending 边界保存可校验的 choice continuation

**做法。** 为 Future/Finalize 的每个合法 choice 定义一个显式 continuation：若选择点
之前的工作可以在事务提交边界证明完成，就冻结该阶段的权威 host/event/layer 视图、
Chain item 身份、已支付成本、已锁目标、LKI 与 choice answer map。`choose` 验证
continuation digest、stateVersion、choiceId 和 owner 后，只执行选择点之后的
Finalize/Resolve/Cleanup，保留 `choose` 作为唯一外部命令和 receipt。若 continuation
无法证明可序列化或恢复，使用现有完整重放 fallback。第一版建议只做进程内能力，
不把 opaque checkpoint 持久化到旧 journal。

**预计收益。** 当前 choose 与对应 play 的层阶段中位各约 673 ms。按 run 2 的最重
样本则约为 692–710 ms，二者之和约 1.4 s。
安全命中时，能消除第二次完整 play 的约 600–700 ms 层/规则工作；配合方案 A，choose
有机会从约 0.86 s 降到 0.3 s 附近。单独的 checkpoint 保存不能降低层求值成本，
因此收益不是把回滚改成跳过。多选择题、中断重连和跨重启仍走 fallback 或需要单独
证明。仅在本轨迹模拟扣减 choose 600/700 ms 时，p95 仍停在下一项 `pass` 的
688–743 ms 区间，故本方案单独对 p95 的收益是 **约 0 ms**，主要价值是削掉 choose
峰值并为后续尾部治理腾出预算；在 A 扣减 20%、B 扣减 500 ms 的叠加上再扣 choose
600 ms，p95 中位估计约 491 ms。

**语义风险。** 最高。CR329/FEPR 的 Pending、Finalize、Resolve、费用支付、可选额外
费用、replacement/prevention、simultaneous ordering 和 LKI 都必须保持同一命令原子性。
不能把任意 JS 调用栈、host 部分写入或未完成的 effect 链当 continuation 保存；
选择之前的 pending mutation 也不能在另一条路径上变成已执行效果。

**改动面。** `packages/engine-core/src/chain/engine.ts`、
`packages/engine-core/src/chain/finalize/*`、`packages/engine-core/src/target/target-plan.ts`、
`apps/game-server/src/engine-runtime/runtime.ts` 及相关测试。

**协议/存档。** `choose` 线格式无需变；若第一版只保存进程内 continuation，journal
与 archive 格式也不变。若后续要跨重启节省重放，必须新增 versioned continuation
记录并保留旧 journal 的完整重放路径，这是独立的存档格式契约变更，不能静默升级。

**验证。** 同一 play/choose 在 continuation on/off 下命令、事件、状态、三视角投影、
journal digest 和终局必须逐字/逐对象等价；覆盖多选择、非法/过期 answer、重复
answer、费用失败、目标离开、replacement/prevention、trigger order、Process crash
后的 fallback。任何未证明卡牌继续 `judge-required`。

## 推荐顺序与可直接拆分任务

1. **`RIFT-1107-A`：LayerPlan 写世代缓存。** 先在真实 M1 装配的 `end-turn`、
   pending `play`、`choose` 建立代码路径计数，再实现可证明的 host generation
   cache。验收值：相同轨迹 3 对交替；`evaluateGroup`/`cloneSnapshot`/对象拷贝的
   真实 pass 计数下降；事件、投影、journal 与 archive 哈希不变；engine-core 全量、
   game-server 全量和百局回放一致。
2. **`RIFT-1107-B`：mulligan setup template 复用。** 在不改协议、不重写最终
   runtime 的前提下，把首玩家/战场/起手和 viewer 投影缓存到房间 setup。验收值：
   两个 mulligan 的结构化调用计数和同轨迹 p95 下降；重连、幂等、隐私和最终 journal
   header 全部不变。
3. **`RIFT-1107-C`：choice continuation。** 以 A 后的新基线测量可省成本，先做
   不可持久化的证明原型，只有所有 FEPR、费用、替代/阻止、LKI 和多层选择测试通过
   后才进入产品路径；任何不完整 continuation 都回退当前完整重放。

每张后续卡都必须使用 `--room-id=69dc614b --deterministic-seed=rift1094` 至少 3 对
base/candidate 交替 profile，先认证命令路径和逻辑 archive 哈希。百局门禁使用
`packages/integration-tests/scripts/m1-hundred-games.mjs` 的每个 seed 独立 worker 模式，
要求同 seed 前后命令、终局、journal 严格对应；worker 逐局返回的 `replayMatches`
全部为真（统计中的 mismatch/exception 为 0），任何已有 blocked、
exception 或规则未闭合状态保持不变并如实报告。不能用 fixture 手工结算、伪造
callback、改 frame/resource/zone 或跳过回合来制造收益。

## 本轮不采用的优化顺序

projection、journal 和 file archive 在本轨迹的 `end-turn` 平均占比分别只有
7.53、14.72、4.24 ms，在 `choose` 上分别 6.36、9.55、2.12 ms。journal writer
self time 只有 0.08 ms/命令，storage 3.64 ms/命令。把 journal 写入批量化的收益
可以压低常数项，但单靠它无法解释或消除当前 600–1400 ms 的尾部。投影 cache 同理；
RIFT-1089 已共享中间态，当前额外的主要瓶颈仍是每个规则阶段的对象层求值。
网络端只推新增事件会改变协议交付形状，已按用户决定留到 beta 之后，本报告不把它
列为本轮结构方案；当前服务端 journal/archive 的 delta 与投影共享继续保留。

## 局限与未完成项

- 三轮 sample 都是同一 M1 自然轨迹；`choose` 每轮只有 1 条，不能把该卡或该类型的
  p95 外推到整个产品。其他卡、多人模式、其它 deck、其它 seed 尚未验证。
- profile 的 CPU 时间按命令墙钟窗口关联；命令间的异步存储、GC 和调度噪声会落进
  相邻窗口。阶段是互斥 self time，inclusive 数值会重叠，不能相加。
- 三个 profile 没有在每轮启动时记录 `/proc/loadavg`，只在构建期间观察到 load
  约 35；因此本文的墙钟分位是共享机证据，不能当生产 SLA。
- 没有做新的网络实现、存储 fsync/IOPS 验证、生产数据库、部署或 push。最终页面
  的 tail 大于 300 ms 的原因已定位到层/重放，但服务器到客户端的真实网络 RTT 仍需
  在独立环境补测。
- 本任务没有代码改动、测试改动、生成数据改动或契约文件改动。

## 证据与复核路径

- `/tmp/RIFT-1107-perf-round3-analysis/profile/RIFT-1107-round3-formal1-ba3ef84ece3e1d2d/`
- `/tmp/RIFT-1107-perf-round3-analysis/profile/RIFT-1107-round3-formal2-ba3ef84ece3e1d2d/`
- `/tmp/RIFT-1107-perf-round3-analysis/profile/RIFT-1107-round3-formal3-ba3ef84ece3e1d2d/`
- `/tmp/RIFT-1107-perf-round3-analysis/profile-formal1.log`
- `/tmp/RIFT-1107-perf-round3-analysis/profile-formal2.log`
- `/tmp/RIFT-1107-perf-round3-analysis/profile-formal3.log`

reference reports:

- `/root/swarm-rift/shared/server-command-profile-2026-10-26.md`
- `/root/swarm-rift/shared/server-perf-acceptance-2026-10-27.md`
- `/root/swarm-rift/shared/RIFT-1094-perf-h-layer-snapshot/evidence-index.json`
