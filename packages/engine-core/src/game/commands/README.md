# RIFT-761 对局命令层（部分交付）

此目录只适配现有公开 `Match` / `TurnFlow` / `ProgramBinding` / zones / layers
接口，不修改协议、旧 profile 或 journal。**不能据此宣布 Standard Move 或 Combat
已经可玩。** 当前分支的 `CombatFlow.move()`、`advance()` 和 `dealDamage()` 仍明确
阻塞这些操作，见下方契约变更请求。

## 接口与 protocol v2 映射

入口为 `src/game/commands/index.ts`，构建后为 `dist/game/commands/index.js`。
包 exports 和 `src/game/index.ts` 的注册属于协调任务；本任务没有改动范围外文件。
v2 尚未导出包子路径，沿用仓库已有的相对 `protocol/dist/v2` 导入方式。

| 接口 | v2 输入 | 当前行为 |
| --- | --- | --- |
| `executeGameCommand(context, actor, command)` | 现有 `V2Command`，运行时严格 guard | 分发、检查玩家/终局/版本，返回前后事件游标及胜者；不吞掉 blocked |
| `move(context, actor, command)` | `move { objectId, to }` | 调用整组预检；合法动作仍以 `standard-move-transaction` 阻塞，零扣费 |
| `inspectStandardMove(context, actor, objectIds, to)` | 内部组接口；单个 v2 move 的 `to` 原样复用 | 根据实时 layers/位置/控制/横置和规则查询，调用 `moveDuelUnitsStandard` 验证；返回当前对象 epoch、目的地和执行阻塞原因 |
| `moveUnits(context, actor, objectIds, to)` | 内部编队接口；当前 wire 没有数组 move | 先检查所有成员，再明确阻塞；绝不拆成多条单单位移动 |
| `declareAttack(context, actor, command)` | `declare-attack { battlefieldId, attackerObjectIds }` | `combat-start-transaction` blocked；不擅自把客户端列表变成攻方身份 |
| `declareDefense(context, actor, command)` | `declare-defense { battlefieldId, defenderObjectIds }` | `combat-designation-task` blocked；CR 466.2.c 是自动指定场上所有对应单位 |
| `assignDamage(context, actor, command)` | 预留映射 `choose { choiceId, answer }` | `combat-damage-choice` blocked；没有由真实 Combat 产生的选择游标，不解析或提交分配 |
| `resolveCombatDamage(context)` | 服务器内部任务，无客户端 settle 按钮 | 调用 `CombatFlow.dealDamage()`，保留 `simultaneous-damage-transaction` blocked |
| dispatcher 的 `play` / `activate` | 不带 cost/targets/picks 的现有 v2 命令 | 经可信 `ProgramBinding` 生成 draft，交给真实 `TurnFlow.execute()`；不支持的选择明确 blocked |
| dispatcher 的 `pass` | `pass` | 真实 Priority/Focus Pass；Neutral Main 时由 `TurnFlow.pass()` 正常结束回合 |
| dispatcher 的 `concede` | `concede` | 调用现有 `concede(match, actor)`；终局后拒绝后续命令 |
| dispatcher 的 `choose` / `mulligan` | 原有命令 | choose 留给宿主恢复挂起操作；mulligan 已由 `createMatch()` setup 完成 |

`to: { zone: 'base' }` 或带当前 actor 的 `playerId` 表示回自己的基地；
基地不使用 `locationId`。战场必须有当前对局的 `locationId`，不接收 `playerId`。
手牌、牌库、废牌堆等目的地不是 Standard Move；不可用公开 move 任意传送卡牌。
编队预检使用一次性派生的 DuelBoard 视图，绝不保存或提交叶子内核返回的副本。
它涵盖已实现的标准移动检查，不代表已构建额外移动费用或要求的付款计划。

`context.match`、`context.stateVersion`、`context.binding` 必须来自可信状态宿主。
actor 来自认证会话。宿主必须已把 binding 连接到该 match 的真实生命周期；
未知、无能力或 judge-required 程序继续遵循现有 registry 的拒绝策略。
能力 ID 当前只支持规范十进制索引，不把未知字符串退化成能力 0。
出牌只接受手牌，激活只接受受控 board 对象；owner 身份不授予控制权。

宿主仍负责 commandId 幂等、版本递增、选择挂起、回执、持久化与恢复。
此函数不创建第二份对局状态或 journal schema，也不宣称一次分发具备外层事务。
同一命令 ID 被用于稳定 draft/cost 身份，使不同进程中的 ProgramBinding 全局序号
不会改变重放事件。命令级失败后的整体恢复仍需要下述共享事务接口。

## 已验证的完整非战斗事件路径

测试从 `createMatch()` 开局：两玩家、40 张明确零费的合成单位、12 枚符文和各自
传说/英雄/三个候选战场。合成单位的真实、经校验的 CardProgram 有一个简单
`effect.move` 激活能力；它是效果移动，不是 Standard Move，也不代表任何官方卡。
没有手改 zone/resource/score/frame，没有伪造结算回调或跳过回合阶段。

1. A 通过公开 play 命令出单位到基地；双方真实 Pass 结算卡牌链。
2. A 激活已注册的移动能力，双方 Pass 结算能力链。
3. `object-moved → object-leaves-base → object-enters-battlefield → contested-applied`
   后真实打开非战斗 Showdown；双方 Pass 后关闭。
4. `showdown-close → control-established → points-gained → conquer → score`，A 得 1 分。
5. B 通过同一入口出单位到其基地。双方正常结束回合，A 的后续七个 Beginning
   分别产生 `points-gained → hold → score`。
6. A 在第 15 回合达到 8 分并由现有 Cleanup 判断获胜。全程没有 `combat-start`。

测试把实际 v2 命令和 actor 序列经 JSON 序列化后在独立新对局重放，严格比较完整
内核快照、事件内容/顺序/身份、Chain trace、阶段、战场、持续效果和胜者。
**这是命令 transcript 重放，尚不是 journal-v1 持久化/恢复验收，也不能替代真实
Combat 到 Conquer 的验收。**

## 契约变更请求（协调任务处理）

1. **公共原子规则任务**：`ChainEngine.atomic()` 是 private；公开的单次 `commit()`
   只能回滚一个动作，`EventPipeline.deferTriggerScan()` 只延后触发扫描。需要公开
   `runRulesTask` / `commitBatch` / `emitBatch` 或等价接口，统一回滚 host、turn 任务
   游标、战场、Chain、layers、频率和时钟。Standard Move 必须同时付 Exhaust，
   再完成整组 Move，最后按真实时点收集触发/清理（CR v1.5 144.2–144.3、420.3）。
   现有 `CombatFlow.move()` 也不接收基地或编队目的地，需一起补足。
2. **战斗结构任务**：同时 combat/showdown 开场，自动攻防指定，已存在 Showdown
   转战斗时保留 Focus（323.13、466.2）；真实分配选择与双方同时伤害、跳过 FEPR
   的战斗特殊清理、Recall、控制/Conquer 与结束 designation（467.2–468.7）。
   `ObjectSnapshot.combatRole` 已存在，但没有公开写 designation 的结构任务。
   不能连续调用 damage 或发出伪 combat-start 事件代替。
3. **wire move 编队与战斗映射**：现有 `V2MoveCommand` 只有一个 `objectId`。
   需要原子编队的正式字段，并明确 `declare-attack`/`declare-defense` 与 CR 自动
   指定的映射，不能允许客户端选择只让部分场上单位获得 designation。
   专用 assign-damage 尚不存在；若复用 choose，需要确定 ordered UID/amount 的
   `answer` 编码、公开选项、两侧选择顺序和版本/epoch 绑定。
4. **journal 与导出集成**：共享 `protocol/src/journal-v1.ts` 的 `JournalCommand`
   仍是 `FullProductCommand`，不是 v2 union；game-server 自有 RuntimeJournal 已
   使用 v2，但不属于引擎公开依赖。请协调统一正式 journal 命令/恢复适配，并在
   server 接入此命令层、更新引擎/协议 exports。不得悄悄改写旧日志或默认 profile。
5. **Finalize 选择与顶层恢复**：需要把 v2 cost/targets/picks 接入现有付款和目标
   计划，以及为命令级挂起提供统一恢复游标。当前提前显式 blocked，避免忽略输入、
   用默认能力代替或把半执行命令报告为成功。

## 验证（2026-10-18）

- `pnpm --filter @riftbound/engine-core build`：退出 0。
- `node --test packages/engine-core/test/game/commands/commands.test.mjs packages/engine-core/test/game/commands/match.test.mjs`：9/9。
- `heavy pnpm --filter @riftbound/engine-core test`：3619 pass、0 fail、234 个既有 TODO。
- `pnpm --filter @riftbound/engine-core typecheck`：退出 0。
- `heavy pnpm typecheck`：退出 0。
- `heavy pnpm --filter @riftbound/game-server test`：因发现既有测试硬编码
  `port: 0` / `listen(0)`，遵守任务只允许 36580–36599 的端口约束，中止本任务
  启动的测试进程，退出 130；不能作为下游整包通过证据。
- 改跑无监听的 `tests/engine-runtime/runtime.test.ts` 与
  `tests/room/current-runtime.test.ts`：7 pass、4 个原有 10 秒阈值超时，退出 1。
  room 的 6 项通过；保持原配置单独重跑 runtime，5/5、退出 0。
  保留首次超时记录，不据此声明下游整包通过。
- 日志在 `/tmp/RIFT-761-game-combat-commands/`，未提交日志或生成产物。
