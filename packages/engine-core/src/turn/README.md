# RIFT-124：批 5 回合驱动（部分交付）

`TurnFlow` 是批 4 `ChainEngine` 上的 1v1 阶段任务驱动。它只接收内部可信
`PipelineHost`、玩家只读查询和两个战场的初始控制者；没有接入 game-server，
也没有切换任何旧 runtime/profile/journal。

`start()` 从初始局面推进至 Main，或停在待结算的触发链。
`execute(draft)` 仍由批 4 检查合法时机；`pass(player)` 仍由批 4 处理
Priority/Focus。外部提供选择答案后调用 `advance()` 恢复当前任务。
每个任务只提交一次动作/时点；宿主 checkpoint 同时保存阶段队列、计分记录和
战场状态，选择挂起时不会留下重复抽牌、重复计分或已消费的计分资格。

已实现：

- CR v1.5 315–317 阶段次序、各已登记开始/结束时点、Awaken、Channel、Draw。
  1v1 后手第一次 Channel 额外引导一枚（487.7）；牌库耗尽时显式 blocked。
- 每个时点与动作通过批 4 管线产生事件、扫描触发、入链、FEPR；阶段任务等待链结束。
- Ending Step 的触发先结算；`TurnPhaseLayers` 只适配本驱动，在 Ending 特殊清理中
  才调用原 layers 的到期逻辑。旧 layers/duel 行为不变。
- 普通清理的致命伤害处理、开放状态丢失空战场控制、Ending 特殊清理治疗和效果到期。
  特殊步骤只执行一次，追加清理为普通清理；FEPR 后重新执行 Expiration。
- 效果移动后的地点时点和 Contested 与真实动作一起提交；清理挂起 Showdown/Combat。
  非战斗 Showdown 复用批 4 焦点与连过，建立控制后执行 Conquer。
- Hold/Conquer 按玩家、战场、回合记录；Final Point Conquer 改为真实抽牌；
  得分和战场计分事件分开。一次 score 动作发布完整计分触发波，避免达到胜利分后
  先进入清理而漏发 Hold/Conquer。最终胜利由真实清理第 1 步检查。

这不是完整的 Combat 实现。基础分配叶子内核保持原样；未增加无法从合法状态
到达的伤害/结果伪实现。具体场景登记见 `../../test/turn/SCENARIO-COVERAGE.md`。

## 契约变更请求（需协调任务处理，未修改共享文件）

1. **批 4 原子规则任务接口**：需要 `runRulesTask` / `commitBatch` / `emitBatch`
   或等价接口，统一回滚 host、layers、Chain items、频率、时钟与任务游标；一个
   simultaneous wave 在全部状态提交后才扫描。选择挂起后重跑整个事务。
   `EventPipeline.deferTriggerScan` 只延迟扫描，不提供 ChainEngine 整体回滚。
   不能用连续 `commit()` 或虚构 Add 能力替代。
   该接口阻塞 Standard Move 的 Exhaust+Move（144.2）、同时战斗/Showdown 开始
   与身份指定（466.2）、非战斗 Showdown 转 Combat 保持焦点（323.13）、同时伤害
   （467.2.c.1.a）、伤害后跳过 FEPR 再做 Combat 特殊清理（467.3/468.1）。
2. **符文池清空原语**：GameAction 没有 CR 316.3 / 317.2.d 的清空动作。
   非空 Energy/Power 时 `empty-rune-pool` blocked，不能伪装成支付费用或负增益。
3. **Recall / Stun / Hidden 的明确状态与动作**：Recall 必须独立于 Move，且保留
   损伤和横置（458–460）；Ready 必须支持 Stun 的规则消费；Hidden 不能用 faceDown
   猜测。遇到需要这些清理/重置的局面分别 blocked。
4. **Burn Out 与 Scoring 的结构任务**：支持 CR 432 的回收、对手选择、重复燃尽
   后不可替代得分及立即胜利，以及被替代点数仍保留战场计分事实。
   当前普通得分/正常 Final Point 抽牌可运行；燃尽或替代计分显式 blocked。
5. **时点与快照缺口**：契约 3.8 的 `combatRole` 尚未存在于实际 ObjectSnapshot；
   Ending 开始/结束、Expiration、治疗、持续效果到期/特征改变的已提交时点也未齐全。
   需要这些接口才能覆盖 Mighty 到期触发、Expiration FEPR 循环和完整 Combat。
   当前 `TriggerSpec` 的 EventPattern 枚举也不能表达 `turn-end` + 玩家过滤，
   尽管 TimingPointId 已登记该时点。

## 验收状态

- 场景规格转测试：部分完成；逐项覆盖与未覆盖原因均登记。
- 两名玩家完整回合：已覆盖从初始局面连续经过 A、B 完整回合。
- 一次真实 Combat 到 Conquer：未完成，受上述原子规则任务接口阻塞。
  非战斗 Showdown 到 Conquer 的精确事件序列不作为 Combat 验收替代。
- 本模块不声明完整清理、卡牌/关键词、多人或赛事模式支持。

## 本轮验证（2026-10-16，基线 891c4fa）

- 新增聚焦测试：`node --test packages/engine-core/test/turn/flow.test.mjs packages/engine-core/test/combat/flow.test.mjs`，28/28。
- `heavy pnpm --filter @riftbound/engine-core test`：2541 通过、4 失败。
  `effect.banish` 1 项、`Vision` 3 项；用 HEAD 源码在任务临时目录独立构建后，
  对应两个测试文件仍为 35 通过、相同 4 失败。未修改这些范围外文件。
- `pnpm --filter @riftbound/engine-core typecheck`：退出 0。
- `heavy pnpm --filter @riftbound/integration-tests test`：39 + 10，共 49/49。
- `heavy pnpm typecheck`：退出 0。
- `heavy pnpm --filter @riftbound/game-server test`：超过 10 分钟后中止；此前
  已报告区域存档恢复和 P4 持久化等共 7 项失败，无完整汇总，不能作为下游通过证据。
  通过执行会话发送中断后退出 130，确认无进程继续持有该测试日志。
- 证据目录：`/tmp/RIFT-124-engine-batch5-turn-combat/`；最终结果索引为
  `verification.json`，引擎对照日志为 `baseline-failures.log`。
