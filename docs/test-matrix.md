# 测试矩阵

## 1. 测试目标

测试不仅要验证“结果对不对”，还要验证：

- 触发何时进入 Chain。
- 选择何时锁定。
- Cleanup 是否达到 fixed point。
- 隐藏信息是否只出现在正确的 Projection。
- 同一 seed 和 Command 是否永远得到同一结果。
- UI 是否把 Pending、Finalized、Resolve 和 Prompt 区分清楚。

## 2. 分层

| 层级 | 重点 | 触发方式 |
| --- | --- | --- |
| 单元测试 | 成本、目标、区域、事件、替代效果 | 每次提交 |
| 属性测试 | 身份唯一性、区域唯一性、哈希确定性 | 每次提交 |
| 状态机测试 | HOT FEPR、Showdown、Combat、Cleanup | 每次提交 |
| 卡牌组合测试 | 真实文本的互相作用 | PR |
| 回放测试 | 事件重放与快照一致 | PR |
| 联机一致性 | 服务器权威和隐私 Projection | nightly/PR |
| UI 自动化 | Prompt、牌桌、回放、断线 | PR |
| 兼容性 | 规则版本和旧回放 | release |

## 3. 核心不变量

1. 一张卡同时只能位于一个 Zone。
2. `eventSeq` 严格单调递增。
3. `GameObjectId` 在 Non-Board 边界变化时生成新身份。
4. `ownerId` 不能被控制权效果改写。
5. Token 离开 Chain 进入 Non-Board Zone 后不再存在。
6. 每个 Prompt 有 owner、取消策略、超时策略和唯一 id。
7. 每个自动决策都有 `autoReason`。
8. 状态哈希只依赖状态内容，不依赖对象内存地址或 UI 顺序。
9. 同 seed + 同 Command 序列得到相同 Event 序列和最终哈希。
10. 隐藏信息不出现在对手 Projection、普通网络包和玩家日志。
11. Cleanup 完成前不能 Finalize、Resolve、传递 Priority 或 Focus。
12. Repeat 不会凭空增加第二个 Chain Item。

规则 fixture 版本基线为 [rule-fixtures.md](rule-fixtures.md) 中的
`official.core-1.5-radiance.2026-10-11`。该 fixture 的 `asOf` 是
`2026-10-11`。2026-10-12 时，当前生效 Core Rules 是 `v1.4 / 2026-07-16`；
Radiance 与 2026-10 Tournament Rules 虽然已在 2026-10-09 发布，但到官方核实的
`2026-10-16` 才生效，因此是 future target。生效前的对局不得把它们当成默认
权威。

## 4. 回归用例

| ID | 场景 | 断言 |
| --- | --- | --- |
| RB-001 | Unit 进入 Board 前的响应 | 普通响应不能在进入前插入 |
| RB-002 | `Hidden Blade` 目标离场 | linked draw 不执行 |
| RB-003 | Repeat | 每次执行独立选择目标 |
| RB-004 | `Cruel Patron` 追加费用后非法 | Play 取消并撤销支付 |
| RB-005 | Flow 卡被 Counter | 进入 Banishment |
| RB-006 | Cleanup 新触发 | 新能力加入下一轮 FEPR |
| RB-007 | 全部目标失效 | play trigger 仍可触发，效果可全被忽略 |
| RB-008 | Counter | 已支付费用不返还 |
| RB-009 | Resolve 时禁止动作 | 跳过受禁指令，其他可执行部分继续 |
| RB-010 | Facedown | 不自动赋予 Ambush |
| RB-011 | Token 出 Chain | 进入 Non-Board 后消失 |
| RB-012 | Board 到 Hand | 生成新 `GameObjectId` |
| RB-013 | Control change | `ownerId` 不变 |
| RB-014 | Counter 的 played trigger | 不触发 `when played` |
| RB-015 | 完全 Prevention 的伤害 | 不触发 `take damage` |
| RB-016 | 同回合发现 Missed Trigger | 按赛事政策生成对手选择或判定为错过 |
| RB-017 | 跨回合发现 Missed Trigger | 默认不补，除非政策 profile 明确允许 |
| RB-018 | Finalize 时拒绝可选触发 | 记录 `declined`，不伪造为漏触发 |
| RB-019 | 完全确定循环 | 可快捷执行并记录迭代摘要 |
| RB-020 | 含隐藏信息的循环 | 必须逐步 Prompt，不得自动快捷执行 |
| RB-021 | Simple Rewind | 通过 `JudgeCorrectionEvent` 恢复并可重放 |
| RB-022 | Complex Rewind | 要求证据包和随机恢复策略 |
| RB-023 | Slow Play | 计时事实与违规裁决分离 |

### 4.1 官方 fixture 映射

以下 RB 用例的 fixture 映射如下：

| RB ID | Fixture ID | 官方引用 | decision |
| --- | --- | --- | --- |
| RB-006 | `cleanup.recursive-fixed-point`（部分） | CR 322、322.1 | auto |
| RB-009 | `execute.partially-impossible` | CR 55、55.1 | notImplemented |
| RB-010 | 未映射 | CR 107.3.f、128.4 | - |
| RB-011 | `object.identity.non-board-boundary` | CR 124、124.1 | notImplemented |
| RB-012 | `object.identity.non-board-boundary` | CR 124、124.1 | notImplemented |
| RB-016 | `judge.tournament-policy-separate-layer` | CR 333、Tournament Rules | judgeRequired |
| RB-017 | `judge.tournament-policy-separate-layer` | CR 333、Tournament Rules | judgeRequired |
| RB-020 | 未映射 | CR 128.6、128.6.a | - |
| RB-021 | `judge.tournament-policy-separate-layer`（部分） | CR 333、Tournament Rules | judgeRequired |
| RB-022 | `judge.tournament-policy-separate-layer`（部分） | CR 333、Tournament Rules | judgeRequired |
| RB-023 | `judge.tournament-policy-separate-layer`（部分） | CR 333、Tournament Rules | judgeRequired |

没有完整映射的 RB 用例仍属于卡牌组合或具体效果层。不得为了凑满矩阵而虚构官方语义；
应先为每个用例登记来源、版本和适用条目，再创建 fixture。

## 5. 属性测试

### 区域和身份

- 任意随机移动序列后，每个对象最多在一个 Zone。
- Board -> Hand -> Board 的每次 Non-Board 边界都生成新对象身份。
- Token 进入任何非 Chain 的 Non-Board Zone 后最终不存在。

### FEPR

- 任意合法 Command 序列不会在 Cleanup 中 Resolve。
- 没有 Pending Item、Outstanding Task、Showdown 或 Combat 时，游戏才能授予下一步 Priority。
- Finalize 顺序总是按 Pending Item 加入顺序。
- Resolve 顺序总是最新 Finalized Item 优先，但 Unit/Gear/Add 的规则例外必须保留。

### 确定性

- 相同 seed、规则版本、初始快照和 Command 序列产生相同 Event digest。
- 不同 UI 点击顺序但等价 Command 序列，结果相同。
- 完全确定循环的快捷执行与逐步执行产生相同最终状态和可比对摘要。
- Rewind 只通过修正事件改变回放分支，不修改原始 Event 历史。

### 裁判政策

- `TournamentPolicyProfile` 的变化不会改变规则层在没有政策介入时的结果。
- Missed Trigger、超时和 Slow Play 的政策决定都带有 profile 版本和证据引用。
- `Simple Rewind` 与 `Complex Rewind` 使用不同的证据要求和随机恢复策略。
- 训练模式可以注入漏触发和超时，但线上自动模式不会因未点击卡牌而漏掉强制触发。

## 6. 隐私和联机测试

- 对手手牌正面不可从网络响应中搜索到。
- 牌库顺序和牌库顶私密信息不出现在公共日志。
- Facedown 卡的正面只发送给正确控制者。
- 服务器拒绝客户端伪造 `stateHash`、支付结果或随机数。
- 重连后补发事件与新快照的最终哈希一致。

## 7. UI 测试

- 强制触发自动出现在触发队列和来源卡上。
- 多目标 Prompt 不会自动选择第一个候选。
- Pending/Finalized/Resolving/Resolved 状态有独立视觉表现。
- `1280x800` 不出现主 Prompt 被牌桌遮挡。
- 中文长卡名、长规则文本和多行 Prompt 不越界。
- 关闭动画后事件顺序和可操作性不改变。
- 高对比和色弱模式不丢失目标状态。

## 8. CI 门禁

Pull Request 必须通过：

1. 类型检查和 lint。
2. 单元、属性和状态机测试。
3. 回归卡牌组合测试。
4. 回放 golden fixtures。
5. 隐私序列化测试。
6. 关键 UI Playwright 测试。
7. Markdown 链接和敏感文件扫描。
8. 规则 manifest 与卡牌数据 digest 校验。

任何 `judgeRequired` fixture 的行为改变，都要求更新原因、资料引用和测试预期。
