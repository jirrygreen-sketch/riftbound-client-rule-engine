# 当前房间运行时

`CurrentDuelRuntime` 是 `GameRoom` 的唯一 Duel owner。房间只调用 `create`、
`dispatch`、`project`、`exportJournal` 和 `restore`，不根据房间参数或 archive
schema 选择执行器。房间的 seat、deck、ready、认证、socket binding 和请求去重
仍由同一 `GameRoom` 管理；开局把已验证的双方 roster 交给 owner。

当前 owner 固定保留原 CLI 的 choice-clock 能力集合，经批 B recorder 写 journal v1。
旧机制服务的调用方式保持不变，批 E 再迁移；这不是完整官方规则实现。
current recorder 仍使用实际 owner 捕获的回执、熵和 viewer observations，额外保留
成功但没有推进 Core 时钟的命令（例如第一方战斗分配），以带原 packet/ACK/entropy
的 dispatch operation 记录，确保下一条命令可严格恢复，不放宽 command entry 的版本约束。
拒绝和 duplicate 不新增记录；没有手改时钟、状态或模拟结算。journal 按命令追加并缓存
已确认记录，导出 checkpoint 不再反复重建同一日志。
`recordingFactory` 是 durable adapter 的可信 owner 注入点，不能从网络、环境变量或
journal 选择。未传该注入点的批 C 调用保留原接口和行为。

| 房间入口 | 已删除的分派 | 当前调用 |
| --- | --- | --- |
| start | `duelProfile` 选择 V1 session 或 P4 recorded owner | `CurrentDuelRuntime.create(runtimeOptions())` |
| submit | V1 execute / P4 dispatch 两个分支 | `duelRuntime.dispatch(authenticatedPlayerId, packet)` |
| projection | V1 project / P4 project 两个分支 | `duelRuntime.project(viewer)` |
| archive restore | V1 session restore、P4 archive restore、schema 1–9 反推 profile | `CurrentDuelRuntime.restore(options, journal)`，存储模式再打开受保护 head |

当前 room archive 只保存 `journal`，不再写 `duelSession`、`duelProfile`、
`duelRuntimeProfile` 或 `duelJournal`。旧 profile/schema archive 由冻结的历史
replayer 处理；当前入口明确拒绝，不升级或重写历史日志。
`trustedDeckDigest` 绑定双方牌组和可信地区上下文；移植 eventDate 或地区会在恢复时被拒绝。

配置 `RIFTBOUND_STORAGE_DIRECTORY` 后，房间元数据仍由 `FileRoomStore` 保存。
新开局先保存含 genesis journal 的 room checkpoint；下一次事务或服务重启时，
在 `<storage>/duel-journals` 内建立或打开批 C 的受保护 CAS head。独立子目录避免
被 FileRoomStore 当成房间 archive 扫描，也不要求元数据根目录采用 CAS 的权限。
所有对局命令都先经过 CAS，再由 room transaction 保存元数据、发布 ACK 和投影。
同一服务的 room mutation queue 继续串行化会话和对局操作。

CAS 已成功而 room checkpoint 保存失败时不发送成功 ACK，也不回滚已确认的 CAS
head。重启先验证旧 checkpoint 的可信 roster/catalog，再打开受保护 head 恢复最新
journal；重试返回原命令的 duplicate 回执。拒绝、重复与纯重连不追加对局 journal。
重连先刷新受保护 head，不执行 pending 工作；room transaction 使用
`stateVersion/eventSeq`、journal revision 以及 room/chat 时钟检测变更。
IO 失败冻结的 adapter 在重连事务前重新打开受保护 head，只读取实际落盘证据，
不自动重发失败命令；原 commandId 的重试仍由幂等回执判断。

`RIFTBOUND_DUEL_PROFILE`、`RIFTBOUND_DUEL_RUNTIME_PROFILE` 与同名 server options
保留合法值解析并记录 deprecated 日志，不影响新房间执行器或恢复路径。

定向验证：

```sh
heavy pnpm --filter @riftbound/game-server exec vitest run --config vitest.config.ts tests/room/current-runtime.test.ts tests/server/current-runtime-websocket.test.ts tests/duel/runtime/room-recovery.test.ts
```

WebSocket 测试仅使用任务端口 40520–40522。测试涵盖双方建房/交牌组/ready、真实
mulligan/Main/符文命令、断线重连、隐私、重启后的 journal/投影一致与 duplicate、
恢复后继续 End、CAS 超前于 room checkpoint 的恢复、元数据写失败时扣留成功 ACK。
`tests/room/default-path-current.test.ts` 迁移了测试驱动的启动步骤，复用原有八个
scenario，逐项比较未修改的事件/双方投影哈希/最终计分。原 integration driver 中
对 profile/schema 7 的硬编码门禁仍需协调者在其写入范围迁移，原测试没有被放宽。

## 本任务验证（2026-10-16）

工作区基线为 `891c4fa`。未修改规则、卡牌数据、协议契约、依赖或 lockfile。
按 Mac 执行机约束不操作 git index、不提交、不推送。证据保存在
`/tmp/RIFT-254-server-batch-d-room-dispatch/`，不纳入提交。

| 验证 | 结果 | 证据文件 |
| --- | --- | --- |
| `heavy pnpm typecheck` | 退出 0；最后的 game-server typecheck 也退出 0 | `typecheck-final-all.log`、`typecheck-server-final.log` |
| 批 C durable + current recovery + current WebSocket 定向回归 | 28 passed | `durable-final-confirmed.log` |
| 当前房间/地区上下文/恢复定向验证 | 10 passed | `room-recovery-final.log` |
| 复用原八个场景的业务快照（原事件、投影哈希、计分） | 8 passed，含两次战斗分配与严格 archive 恢复 | `default-path-final.log` |
| `SWARM_PORT_BASE=40530 heavy pnpm --filter @riftbound/game-server test` | **未通过**：627 passed / 22 failed / 37 skipped；新增测试无失败 | `game-server-final.log` |
| `heavy pnpm --filter @riftbound/integration-tests test` | 原套件 39 passed；旧默认路径结构门禁 1 passed / 9 failed | `integration-final.log` |
| 旧 WebSocket 重启恢复用例单独复跑 | 1 passed（其余由名称筛选，不新增 skip） | `legacy-websocket-restore-final.log` |
| 旧 optional-unit 严格回放用例单独复跑 | 1 passed（其余由名称筛选，不新增 skip） | `legacy-optional-replay-final.log` |

全量服务端失败分为：15 项仍要求 V1/P4 房间、旧 profile/schema 或 sticky rejection；
5 项旧 protected archive 测试在 HEAD 源码对照中同样失败；2 项为全量运行中的超时，
两项在独立复跑中均通过。WebSocket duplicate 还改为直接读取受保护的原成功回执，
不重建 proposal；actor、payload、expectedVersion 校验保持严格。旧档案不由本任务改写或升级。
HEAD 对照见 `baseline-comparison.log`、`baseline-atomicity.log`；范围核对见
`change-inventory.json`（13 个文件，无越界文件）。

需要对应 owner 迁移旧房间测试，以及 integration-tests 的
`src/default-path/driver.ts` 和 `test/default-path/snapshots.test.ts` 中的启动结构断言。
应检查当前 journal 的完整性、固定 owner 和 deprecated 参数无影响，并保持原业务
断言；历史 profile 行为继续由冻结的历史 replayer 验证，不能靠删断言或扩大容差过门禁。
因此本任务的实现及定向验收完成，**全量门禁尚未满足任务卡的全绿要求**。
