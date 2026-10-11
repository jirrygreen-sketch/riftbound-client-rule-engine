# 开发方案

## 1. 项目定位

项目先做“规则正确、触发自动、状态可回放”的独立桌面客户端内核，再扩展牌组工具、联机房间和裁判工具。第一阶段不追求复刻现有站点的全部视觉资产，也不把官方卡图作为技术前置条件。客户端应当安装后直接启动，离线模式不依赖浏览器、网页标签或远程页面。

核心用户：

- 想快速进行本地测试和熟悉规则的玩家。
- 需要查看触发顺序、目标锁定和费用变化的竞技玩家。
- 需要复盘争议时序的裁判或赛事组织者。
- 负责维护卡牌数据和规则版本的项目维护者。

## 2. MVP 范围

### 必须有

1. 2 人标准模式的完整状态机。
2. 主牌、符文牌、英雄传说、选定英雄、战场、基地、手牌、牌库、弃牌堆、放逐区、链。
3. 回合、Main Phase、Showdown、Combat 的最小闭环。
4. HOT FEPR：Outstanding Tasks、Finalize、Execute、Pass、Resolve。
5. 费用计算、支付撤销、目标锁定和 Resolve 时重新检查。
6. 强制触发自动入链，可选决策生成 Prompt。
7. Cleanup fixed point、死亡/致命伤害、控制权和战场状态。
8. 事件日志、确定性 seed、回放导入导出。
9. 每个玩家只收到自己的隐藏信息投影。

### 后置范围

- 多人/组队模式。
- 完整赛事服务、排名、社交和商业化。
- 全卡池自动解析。
- 移动端专用布局。
- 官方美术资源。

## 3. 技术选型

| 层 | 建议 | 约束 |
| --- | --- | --- |
| 语言 | TypeScript | 规则包不得依赖浏览器 API |
| 桌面客户端 | Tauri 2 + React + Vite | 独立可安装程序；用组件状态呈现 Projection，不直接改引擎状态 |
| 桌面桥接 | Rust/Tauri commands | 文件、窗口、系统菜单、导入导出和本地存储都通过窄接口访问 |
| 状态 | 不可变 State + Event Journal | 允许快照、回放和状态哈希 |
| 联机 | WebSocket | Command 上行，Event/Projection 下行 |
| 本地 | 同一 `engine-core` | 本地与服务器同 seed 必须一致 |
| 测试 | Vitest + fast-check + Playwright | 规则和 UI 分层验证 |
| 包管理 | pnpm workspace | 依赖锁文件提交到正式实现仓库 |

不建议把规则实现放进 React store，也不建议让 UI 组件直接调用“造成伤害”“杀死单位”这类旁路函数。所有改变状态的行为都必须先形成 Command，再由引擎返回 Event。

## 4. 独立客户端边界

独立客户端是产品主入口，浏览器不是运行前提。MVP 的本地模式直接在桌面进程中加载版本化 `card-data` 和 `engine-core`：

- 离线练习、AI 对手和本地双人对局由桌面客户端内嵌引擎驱动。
- 联网对局由 `game-server` 持有权威状态，桌面客户端只提交 `Command`、接收自己的 `Projection`。
- 回放文件、牌组文件和测试场景可以从本地磁盘导入导出。
- 客户端不能通过 DOM、网页脚本、屏幕抓取或模拟点击依赖 Rift Atlas。
- 网页牌桌可以作为未来的调试工具，但不属于 MVP 客户端交付物。

## 5. 模块边界

```text
Command
  -> Permission and Timing Gate
  -> Cost / Target / Mode Plan
  -> Rule Engine
  -> Event Journal
  -> Player Projection
  -> Client View
```

### `engine-core`

纯规则层，负责：

- 状态转移和不变量。
- 费用、目标、效果、触发、替代效果。
- HOT FEPR、Cleanup、Showdown、Combat。
- Deterministic RNG、状态哈希和事件序号。

### `card-data`

负责版本化数据，不负责运行时状态：

- `CardDefinitionId`、打印费用、类型、域、标签。
- 能力的 DSL 源和编译后 IR。
- 勘误、发布日期、适用规则版本。
- 数据校验报告。

### `protocol`

负责网络和回放契约：

- `Command`：玩家请求。
- `Prompt`：引擎等待的策略选择。
- `Event`：权威事实。
- `Projection`：按玩家隐私裁剪后的视图。
- `ReplayEnvelope`：版本、seed、初始快照和事件流。

### `game-server`

负责房间、鉴权、重连、超时、回放存储、服务器权威和反作弊。它不应复制一套规则逻辑。

### `judge-tools`

负责裁判模式的暂停、修正、证据标注、对比两个状态快照以及将裁判决定写入回放。普通玩家模式不暴露任意改状态权限。

## 6. 里程碑

### M0：规则基座

- 建立仓库、包边界、版本 manifest。
- 定义 State、GameObject、Zone、Event、Command、Prompt。
- 建立状态哈希和最小回放格式。

完成标准：空局可以初始化、序列化、重放，两个实现对同一 seed 得到相同哈希。

### M1：回合与链

- 实现四种 Turn State：Neutral Open、Neutral Closed、Showdown Open、Showdown Closed。
- 实现 Pending/Finalized Chain Item。
- 实现 Priority 与 Focus。
- 实现 HOT FEPR。

完成标准：可以用占位卡完成“打牌、响应、双方 Pass、逆序 Resolve、链清空”。

### M2：状态动作

- 费用和资源。
- 移动、进入 Board、控制权。
- 伤害、致命伤害、Kill、Recall、Banish、Recycle。
- Cleanup 和战场控制。

完成标准：回归案例覆盖所有对象身份和区域迁移规则。

### M3：卡牌 DSL

- DSL AST、语义校验和 IR。
- 触发条件、目标计划、效果 IR、Replacement/Prevention。
- 无法编译的卡进入“裁判介入”状态，不静默按猜测执行。

完成标准：示例卡可在本地运行，卡牌数据版本可追踪。

### M4：独立桌面客户端

- 桌面优先牌桌布局。
- 自动触发队列、目标高亮、Prompt、事件日志、回放。
- Tauri 2 启动壳、本地数据目录、离线启动和窗口生命周期。
- 断线重连和动画降级。
- Windows 安装包/便携包；macOS 和 Linux 打包作为后续门禁。

完成标准：在 `1280x800` 下关键控件不遮挡，在 `1920x1080` 下信息密度足够。

### M5：联机和裁判工具

- 服务器权威、隐私 Projection、重连、超时。
- 裁判复盘、暂停、修正和导出证据。
- 联机确定性和篡改检测。

完成标准：两个客户端不能通过网络包看到对方手牌或牌库顺序，回放可复现最终状态。

## 7. 数据导入和版本策略

每个卡牌数据包必须带有：

```json
{
  "dataVersion": "2026-10-09-radiance",
  "coreRulesVersion": "1.5",
  "tournamentRulesVersion": "2026-10-09",
  "sourceDigest": "sha256:...",
  "errataApplied": true
}
```

启动对局时将规则和卡牌版本写入回放。更新数据只能创建新版本，不允许覆盖进行中的对局所使用的定义。

## 8. 安全、隐私和可观测性

- 服务器只接受 Command，不接受客户端上传的“结果状态”。
- 日志按玩家可见性裁剪；服务器审计日志可以保留完整信息，但不得发送给客户端。
- Prompt、自动决策和超时都写入事件流。
- 每个事件带单调递增 `eventSeq` 和前置状态哈希。
- 生产环境记录规则版本、卡牌数据 digest、客户端版本和 replay id，不记录不必要的手牌明文。

## 9. 风险和应对

| 风险 | 应对 |
| --- | --- |
| 卡牌文本歧义或新机制 | DSL 支持 `judgeRequired`，不自动猜测 |
| 规则版本变化 | manifest + 版本化定义 + 回放锁定 |
| 隐藏信息泄漏 | 服务器 Projection 和网络测试 |
| UI 让玩家误解时序 | 使用“待锁定/已锁定/可响应/结算中”状态，而不是单纯动画 |
| 自动操作过度 | 对策略节点一律 Prompt，对唯一动作才自动化 |
| 规则与赛事政策混杂 | 三层架构：Rules -> Judge Policy -> UX |
