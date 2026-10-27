# RIFT-1103 Mulligan 回执延迟（2026-10-27）

## 结论

第二个 Mulligan 回执的同步热点位于本工单写域内的
`EngineRuntimeHost -> RuntimeBoardHost` 边界，而不是 WebSocket 序列化、文件存档或
`room.ts`。旧实现每次 primitive action 都调用一次 `RuntimeBoardHost.perform()`；执行前后各
失效一次 object cache，并在执行后扫描整个 host object view，把任何 zone 为
`base`/`battlefield` 的 Unit/Gear 改写为 `board + location`。初始建局会连续做 100 多次
create/move，因此每个小写入都会重新复制和冻结当时全部对象，随后 core 的 TurnFlow layers
又重复读取这些累计快照。

优化只处理“这次 `move-zone` 实际移动的那一个 Unit/Gear”：直接解析命令所命中的当前或
choice-retained incarnation，不再为了规范化而取得完整 authority object view。被移动对象仍经
同一 host primitive 校验、写入 `location`、写入目标 zone、增加 `zoneEntryId`；旧的 zone list
清理与 `board` 插入规则、失败后的回滚、final projection 和 journal 内容都保持不变。

真实 `GameRoom`、固定 battlefield RNG、同一 M1 预组、在共享开发机的 5 轮稳定样本中，第二个
Mulligan 同步调用从 `930.94, 933.75, 951.72, 955.08, 952.24 ms`（中位 `952.24 ms`）降到
`714.33, 737.12, 704.01, 714.86, 722.45 ms`（中位 `714.86 ms`），中位改善 **24.93%**。
同批样本的第一份 Mulligan 中位从 `1,402.21 ms` 降到 `1,067.13 ms`，setup projection
从 `469.57 ms` 降到 `357.46 ms`。开发机样本的第二个命令因此低于 1.5 s 目标；共享机曾把
同路径孤立拉到数秒，不能把单轮墙钟写成稳定上限。正式 profile-server 三对轨迹得到更保守的
`938 → 907 ms` 中位，详见下文。

## 真实 Room 计时分解

探针通过真实 `GameRoom` 的 `submitDeck -> setReady -> submitEngineV2` 公共内存入口执行，使用
生产 `loadCardCatalogRuntime()`、M1 预组、固定 `duelRandomIndex=() => 0`。每次开局的结构固定：
112 个 authoritative objects、47 个 opening events；最终状态为 `playing`。样本保存于
`/tmp/RIFT-1103-mulligan-latency/evidence/baseline-timing.jsonl` 与
`/tmp/RIFT-1103-mulligan-latency/evidence/candidate-timing-integration-43b57d05.jsonl`；探针源码保存为
`/tmp/RIFT-1103-mulligan-latency/evidence/baseline-latency-probe.ts`。

基线稳定轮（排除共享机 16–18 s 异常轮）的第二个 Mulligan 约为 `0.93–0.96 s`，其中：

| 阶段 | 基线证据 | 处理 |
|---|---:|---|
| 最终 `createEngineRuntime().start()` | 约 `0.50–0.62 s` 墙钟，`0.54–1.01 s` CPU | 建立 112 个对象、执行 setup、首次抽牌/符文/回合前缀并连接 program lifecycle；第二个 Mulligan 的主要热点 |
| 最终 journal 初始化 | 约 `0.03 ms` `journal()` 快照读取 | 不计入可疑热点；初始化摘要本身混在上述 start 内 |
| 两份 player projection + `publicEngineProjection` | 约 `0.34–0.47 s`；最终发布 7 个 outbox message | 每份构造走入 `projectionSnapshot` 和 core layers；不是主要复制来源 |
| Room event/持久化 | `exportArchive` 约 `0.15 ms`，空 recipient 广播在该探针内约 `0 ms` | 非热点 |
| 首份 Mulligan 重复预览 | 约 `1.00–1.40 s` | `mulliganProbe` 每次重建 runtime；属 `room.ts`，本工单未改 |

1 ms CPU profile 在正常 Room 样本中确认了调用位置：`RuntimeBoardHost.perform ->
EngineRuntimeHost.objects -> captureAuthority` 从 `createMatch` 的每次 `createDeckCards` /
`createToken` 中被反复命中。基线 `host.ts` 的 self samples 合计为 `2,185.45 ms`；
`evaluateGroup` 落入 core 的 attributed samples 只负责依赖和 layer 规则，不能直接归因成
重复 layer pass。合并 `43b57d05` 后同一单局路径的 `host.ts` self samples 从 `2,185.45 ms`
降到 `1,107.11 ms`；`captureAuthority` self time 从 `118.94 ms` 降到 `49.79 ms`。GC 和 `evaluateGroup` 的短样本
波动方向相反，未用来宣称 layer 提速。原始 profile 位于
`/tmp/RIFT-1103-mulligan-latency/evidence/baseline-game-room.cpuprofile` 与
`candidate-game-room-43b57d05.cpuprofile`。

## 确定性关键路径

新增 `tests/engine-runtime/v2-mulligan-latency.test.ts` 使用生产
`createEngineRuntime -> createMatch -> createProgramBinding/attachLifecycle` 路径。先确实执行一次
`move-zone` 到 Base，断言规范化期间 `EngineRuntimeHost.objects()` 调用数为 **0**；随后验证对象
仍为 `zone=board`、location 为 `base/A`。再以旧 incarnation 发起被拒绝的 Trash move，验证
host 回滚后对象仍是同一个 Board/Base incarnation；再用第二次真实 `move-zone` 覆盖
Battlefield location，同样要求规范化期间 object-view 读取为 0。测试不设墙钟阈值。

定向 vitest（新增测试，以及既有 playable-turn、can-pass、card-play completion、host
checkpoint）共 **18/18** 通过。正常改动前后 `journalBytes=1441`、`archiveBytes=5970`、
status=`playing` 均一致。

规定的完整验证也已通过：game-server `141` files / `838` tests 通过（`0 fail`，
existing `6` skipped files；`37` skipped / `46` todo tests）；desktop-client `84` files /
`982` tests 通过且 typecheck exit `0`。`m1-hundred-games.mjs --games=20
--concurrency=1` 得到 `natural-win: 20`，`blocked/exception/timeout/command-limit/
turn-limit/no-progress/replay-mismatch` 均为 `0`，summary 内 20/20 条
`replayMatches=true`。证据见
`/tmp/RIFT-1103-mulligan-latency/headless-20-43b57d05/m1-stats-summary.json`。

## 固定工具轨迹的三对交替

按 RIFT-1090 的固定 `--deterministic-seed` 轨迹要求，在最终 integration cut
`43b57d05` 上用 `apps/game-server/scripts/profile-server.ts` 严格按
`base, final, base, final, base, final` 运行三对。两变体均固定
`--room-id=69dc614b --deterministic-seed=rift1091`、本任务端口段与完整命令预算：

```bash
SWARM_TASK=RIFT-1103-mulligan-latency \
SWARM_PORT_BASE=36360 SWARM_PORT_SPAN=20 \
heavy env SWARM_TASK=RIFT-1103-mulligan-latency \
  SWARM_PORT_BASE=36360 SWARM_PORT_SPAN=20 \
  pnpm --filter @riftbound/game-server exec tsx scripts/profile-server.ts \
  --room-id=69dc614b --deterministic-seed=rift1091 \
  --output-dir=/tmp/RIFT-1103-mulligan-latency/profile-alternation \
  --output-label=RIFT-1103-<base|final>-formal<1|2|3> \
  --max-commands=1000 --command-timeout-ms=120000 \
  --game-timeout-ms=900000 --startup-timeout-ms=180000
```

6 轮都是 78 条自然命令、`player-1` winner，命令身份/actor/receipt version/event seq/
phase/turn 的轨迹 SHA-256 全部为
`7bc3856c05e68dbb5273344afa2fc0ebfcfd531fb784a076d0e67fb697cf330a`；archive 期末均
`253,751 B`。该探针只做两次 mulligan 后继续同一自然对局，第二个 mulligan 的系统耗时中位
从 `938 ms` 降到 `907 ms`（−3.31%），6 轮分别低于 1.5 s。整局 profile 墙钟中位
`18,570 → 21,163 ms`，active CPU 中位 `15,818 → 18,178 ms`；这一探针在最终主机负载下没有
观察到整局加速，也不会把这些全局指标当作提速声明。

| 阶段（第二个 mulligan 的 1 ms CPU samples） | base 三轮中位 ms | final 三轮中位 ms |
|---|---:|---:|
| engine execution，含 host 复制 | 490.81 | 326.54 |
| layers | 345.17 | 401.44 |
| projection | 6.37 | 7.43 |
| digest / canonical JSON | 6.37 | 6.37 |
| storage | 1.08 | 1.06 |
| copy（独立最内层 sample） | 40.39 | 44.62 |

第二个命令的 active CPU 中位从 `932.55 ms` 降到 `900.97 ms`（−3.39%）；host 修改使 engine
采样下降，而共享负载令 layer 采样仍波动，所以后者不能独立证明 layer 回归或改善。原始六份
`summary.json`、`game-summary.json` 与
`server.cpuprofile` 位于
`/tmp/RIFT-1103-mulligan-latency/profile-alternation/`；聚合结果见
`/tmp/RIFT-1103-mulligan-latency/evidence/profile-alternation-summary.json`。

第一个 mulligan 仍约 `1.41 s`，因为 `room.ts` 的 `mulliganProbe()` 每次都重建 112-object
预览 runtime；这不在本工单写域内。建议的父级后续改法是只保留第一次 probe/runtime，两个
座位共享同一不可变 opening preview，并在第二份选择到达时只做一次带两份 choices 的正式 start。

## 回放与语义边界

- CR v1.5 110–118：保留同一 setup action 顺序、四张开手、逐个玩家 Mulligan，并在两份选择完成后开始第一回合。
- CR v1.5 303.1–303.2.a：每个内部 primitive action 仍逐项完整执行，没有合并、跳过或改成同时结算。
- CR v1.5 478.1–478.4：没有减少 layer pass；优化只减少 host 为规范化单个移动对象而制造的额外 object snapshot。
- journal 版本、header、命令记录、digest 算法与旧 replay 均未改动。

规则原文：`/root/swarm-rift/shared/rules/CR-v1.5.txt`，读取章节为 110–118、303.1–303.2.a、478.1–478.4。
