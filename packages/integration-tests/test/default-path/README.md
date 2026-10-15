# 当前 CLI 默认路径快照

基线来源：`3c1fbcdf6c8b6b5506083f3632ce07adcdab0b92`，2026-10-15。
这是现有行为的回归基线，不是官方规则完整性或 v1.5 合规声明。

驱动加载默认路径的真实 `deck-catalog.json`，逐副调用实际 deck validator，使用现有
`fury77-real-decks.ts` 的 A/B 牌组；一个测试额外检查本地紧凑副本与原 fixture 完全相等。
不修改费用、能力文字、catalog digest 或牌组规则。缺少 catalog 时直接失败，不跳过。

构造和执行都经过 `GameRoom` 的公开房间边界：`join → submitDeck → setReady → start →
P4 recorded runtime → submitDuel`。与 CLI 一样传入 `p4` 和
`optional-unit-choice-clock-v4`，并检查实际 room archive 的 journal schema 为 7。
另有测试固定 `index.ts` 的默认配置表达式。不能省略这两个参数：
`createGameServer()` 的库级缺省仍是 v1，P4 factory 的缺省仍是 public-chain-v1。
驱动不调用 runtime dispatch 或任何内部结算函数，不手改 frame、资源、区域、分数，
不注入事件/continuation，也不绑定网络端口。

随机数通过房间已有的可信 `randomIndex` 参数注入 LCG32 固定种子。除脚本 04 使用
149 外，种子都是 77。物理 UID、choice/prompt/option UUID 依首次观察顺序改名；
同一 UUID 在对象、数组、对象键及嵌套 JSON 字符串中始终保持同一别名。
回合、版本、eventSeq、资源、卡牌顺序、目标、事件顺序等均保留。
每一步包含实际 room event 增量、按 room transport 发出顺序排列的公开消息、
双方完整规范化投影的 SHA-256，以及手牌、资源、棋盘、选择、动作等可读摘要。
最终计分单独保存。哈希按排序后的对象键计算，数组顺序不排序。

P4 当前没有向客户端发送逐个 Core commit 的事件载荷；`events` 明确记录实际 wire
消息，`roomEvents` 记录实际房间事件，不把投影差异伪称为引擎规则事件。
`duel-projection` 消息记录 clock/stage；完整投影的变化由该步双方摘要和哈希固定。
部分 ACK 的 appliedVersion 小于紧随其后的投影版本，这是现有自动推进后的实际输出，
没有在快照工具中修正。

| 脚本 | 覆盖与止点 | 当前状态 | 后续语义修改可核对的 v1.5 条目 |
| --- | --- | --- | --- |
| 01 opening-mulligan | 随机先后、战场、起手隐私；实际请求替换两张后记录拒绝；双方保留起手，进入第一回合 Main | 开局与保留完成；替换存在缺口 | 114–118，尤其 117 |
| 02 multi-turn-resources-draw | 横置产能量、回收产领域之力、真实 End、引导/抽牌、资源清空，至第 6 回合 Main | 完成 | 163–167、315 |
| 03 unit-optional-choice-payment | Legion Rearguard 的实际可选额外费用、clock、付款隐私、能量与 Fury 资源；第 3 回合准备就绪入场 | 完成 | 353、355、356、359 |
| 04 targeted-spell-current-boundary | 真实 Vengeance 和真实敌方 Legion；请求出牌在付款/选择目标前被拒，双方投影不变 | 部分完成，未成功施放或选目标 | 155、353、355、359 |
| 05 movement-combat-conquer-hold | 两个真实付款单位；移动/让过焦点、双方战斗分配、死亡清理、征服、固守；第 8 回合比分 2:1 | 完成 | 144、448–455、461–474 |
| 06 play-through-hold-victory | 两单位征服两个战场，多轮真实 End/固守至第 13 回合；player-2 以 8:0 获胜，房间 ended，双方无动作 | 完成 | 471–474、487 |
| 07 reject-opponent-action | 对手盗用当前所有者的 Unit/window 被拒，双方投影不变 | 完成 | 房间认证/动作权限边界 |
| 08 reject-stale-version | 当前 window 搭配旧版本被拒，双方投影不变；新版本重试成功，至第 2 回合 Main | 完成 | 版本防护边界 |

已观察到的两个缺口需要后续 engine/server 任务处理：

- 非空 mulligan：P4 资源命令分支向 `applyDuelResourceCommandV2` 传入空 trusted
  options，没有把房间 RNG 送到两张牌回收所需的随机路径。因此实际投影提供的两张选择
  仍被拒。这里仅固定现状；修复后应按 v1.5 117 显式替换对应快照。
- 目标法术：默认 owner 的 `isDrawSpell`/出牌分支只开放单一抽牌效果；A/B 牌组中的
  Vengeance 无公开 play action，也没有目标提示。未采用改文案、其他 profile、
  内部函数调用或伪造目标 DTO 来制造成功施法。需求中的“成功施法含目标”尚未覆盖。

日常运行：

```sh
heavy pnpm --filter @riftbound/integration-tests test
pnpm --filter @riftbound/integration-tests typecheck
pnpm --filter @riftbound/integration-tests exec tsc --noEmit --project test/default-path/tsconfig.json
```

包 test 脚本保留原配置，再运行本目录的独立配置，因此原 39 条与新增 10 条都执行。
只跑本门禁可用：

```sh
heavy pnpm --filter @riftbound/integration-tests exec vitest run --config test/default-path/vitest.config.ts
```

有意更新必须先审阅差异，并在 `DEFAULT_PATH_SNAPSHOT_REASON` 和提交说明中列出
v1.5 条目、行为变化与原因。初始生成的原因是本任务固定现有默认行为；没有规则实现变更。
普通测试不写入仓库中的快照，即使快照缺失也会报错。

```sh
UPDATE_DEFAULT_PATH_SNAPSHOTS=1 \
DEFAULT_PATH_SNAPSHOT_REASON='CR v1.5 <条目号>: <有意变化及原因>' \
heavy pnpm --filter @riftbound/integration-tests exec vitest run --config test/default-path/vitest.config.ts
```

三连跑证据可给每次设置独立的
`DEFAULT_PATH_EVIDENCE_DIRECTORY=/tmp/$SWARM_TASK/run-1`（依次 run-2、run-3）。
测试会保存实际生成的 JSON，仍与提交的快照逐项比较；随后可比较三个目录的
SHA-256 和文件内容，证明比较路径本身也确定。
