# Riftbound 客户端与自动规则引擎总方案

## 一句话结论

先做一个独立桌面游戏客户端和权威游戏服务端：服务端运行服务器权威、事件驱动、可确定性回放的规则引擎，客户端用 Tauri 2 + React 呈现 Projection。卡牌强制触发由引擎自动检测，可选和战略选择通过 Prompt 交给玩家；YGO 只借鉴卡牌生态和交互表达，不直接套用 YGO 连锁规则。

## 1. 产品目标

- 自动检测、自动加入和自动结算没有策略分歧的卡牌触发。
- 只在目标、费用、模式、替代效果和顺序会改变结果时要求玩家操作。
- 把 Pending、Finalize、Priority、Focus、Cleanup 和 Resolve 的状态讲清楚。
- 以联机对局为主，支持开发沙盒、裁判复盘和事件回放。
- 规则版本与卡牌数据版本可锁定，旧回放可重现。

## 2. 总体架构

```text
Desktop Client (Tauri 2 + React)
  <-> WebSocket Protocol
Authoritative Game Server
  -> engine-core
  -> card-data + card-dsl
  -> event journal + replay
  -> player projection / judge projection
```

建议使用 TypeScript monorepo：

```text
apps/desktop-client
apps/game-server
packages/engine-core
packages/desktop-bridge
packages/card-data
packages/card-dsl
packages/protocol
packages/judge-tools
```

## 3. 规则核心

主循环：

```text
Handle Outstanding Tasks
  -> Finalize
  -> Execute
  -> Pass
  -> Resolve
```

必须实现：

- Pending Chain Item 按进入 Chain 的顺序 Finalize。
- Finalized Item 按最新优先 Resolve。
- Unit、Gear、Add Ability 的立即 Resolve 例外。
- Cleanup 是阻塞式 Outstanding Task，并运行到 fixed point。
- Cleanup 期间不 Finalize、Resolve、传递 Priority 或 Focus。
- Priority 与 Focus 分离；Showdown 中 Pass Priority 不代表失去 Focus。
- Closed State 由 Chain 是否存在决定，不能直接画成普通 YGO 堆叠。

## 4. 对象模型

对象至少包含：

```text
PhysicalCardId
CardDefinitionId
GameObjectId
AbilityId / TokenId / CounterId
ownerId / controllerId
zone / location
zoneEntryId
faceDown / hidden / ambush / revealed
```

Card、Token、Counter 分开建模；Owner 与 Controller 分开；Zone 与 Location 分开。卡牌跨 Non-Board Zone 时生成新的 `GameObjectId`，Token 离开 Chain 进入 Non-Board Zone 后消失。

## 5. 费用、目标和效果

费用阶段：

```text
Base -> Alternate -> Additional -> Increases -> Discounts -> Total -> Payment
```

目标在 Finalize 时锁定，在 Resolve 时重新检查。Repeat 的每次执行独立选择目标。Replacement、Prevention、Modification 用事件层建模，不混入普通 Effect 列表。

自动化策略：

- 唯一合法、强制、无策略分歧：自动执行并记录 `autoReason`。
- 可选触发、多个目标、模式、额外支付、顺序选择：生成 Prompt。
- 解析不确定或规则资料冲突：`judgeRequired`。

## 6. 客户端交互

设计基准为 `1920x1080`，最低支持 `1280x800`。牌桌中心显示 Base、Battlefields 和 Chain；右侧显示触发队列、当前 Prompt 和事件日志；底部显示手牌、资源和可行动作。

自动触发使用紫色语义色，并同时显示在：

1. 触发队列。
2. 来源卡徽标。
3. 事件日志。

颜色必须搭配图标和文字。中文长文本支持换行，动画可关闭，回放支持单步和跳到 Cleanup。

## 7. Card DSL

```text
Card Text / Structured Authoring
  -> AST
  -> Semantic Validation
  -> Trigger + Cost + Target + Effect IR
  -> engine-core
```

DSL 必须能表达：

- 触发与控制者。
- Base/Alternate/Additional Cost。
- Target、非目标选择、固定引用。
- `up to`、`any number`、Group Target。
- Repeat 独立选择。
- Linked Effect。
- Replacement/Prevention。
- 隐私读取和 `judgeRequired`。

未实现卡牌不能静默猜测结果，应暂停给裁判处理。

## 8. 裁判策略

```text
Rules Engine -> Tournament/Judge Policy -> Client UX
```

正式线上模式消除普通 Missed Trigger；裁判模拟模式保留漏触发、错误顺序和超时测试。超时、非法动作、历史修正和规则资料冲突都由政策层处理，并写入可审计事件。

## 9. 必须先写进回归测试的案例

1. Unit 进入 Board 前不能被普通响应。
2. `Hidden Blade` 目标离场后，linked draw 不执行。
3. Repeat 每次执行独立选择。
4. `Cruel Patron` 追加费用支付后最终状态非法，整次 Play 取消并撤销支付。
5. Flow 卡被 Counter 后进入 Banishment。
6. Cleanup 触发新能力并进入下一轮 FEPR。
7. 所有目标失效但 play trigger 仍触发。
8. Counter 不返还费用。
9. 被禁止动作通常在 Resolve 时跳过。
10. 牌面朝下不等于 Ambush。
11. Token 离开 Chain 进入 Non-Board Zone 后消失。
12. Board 回到 Hand 生成新的 `GameObjectId`。
13. 控制权改变不改变 Owner。
14. Counter 不触发 `when played`。
15. 完全 Prevention 的伤害不触发 `take damage`。

## 10. 里程碑

| 阶段 | 交付 |
| --- | --- |
| M0 | 包边界、State/Event/Command/Prompt、版本 manifest |
| M1 | 回合、四种 Turn State、Chain、HOT FEPR、Priority/Focus |
| M2 | 费用、目标、移动、控制权、伤害、Cleanup |
| M3 | Card DSL、编译器、替代效果、裁判降级 |
| M4 | Tauri 2 桌面客户端、牌桌、触发队列、Prompt、日志和回放 |
| M5 | 服务器权威、隐私 Projection、重连、裁判工具和发布门禁 |

## 11. 版本和版权

设计基线为 Core Rules `v1.5 / Radiance` 与 Tournament Rules `2026-10-09`。每局回放写入具体版本和卡牌数据 digest。

这是非官方粉丝项目，不隶属于 Riot Games。公开仓库只提交原创设计、抽象示例、链接和版本信息，不提交官方 PDF、卡图、Logo、商标资产或未授权的完整卡牌数据库。

## 12. 文档索引

- [开发方案](../docs/development-plan.md)
- [规则引擎架构](../docs/rule-engine-architecture.md)
- [客户端设计](../docs/client-ux-design.md)
- [卡牌 DSL](../docs/card-dsl.md)
- [裁判策略](../docs/judge-policy.md)
- [测试矩阵](../docs/test-matrix.md)
- [资料与版本](../docs/sources.md)
