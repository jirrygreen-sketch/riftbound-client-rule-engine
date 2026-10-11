# 独立桌面游戏客户端设计方案

## 1. 结论

当前项目的规则引擎方向正确，但原方案中的 `apps/web-client` 命名和交付边界不够准确。目标不是做一个依赖浏览器的网页牌桌，也不是把 Rift Atlas 嵌入桌面窗口，而是做一个可以安装、独立启动、支持离线运行的游戏客户端。

修订后的产品形态：

```text
独立桌面客户端
  ├─ 离线练习 / 本地双人 / AI：本地 engine-core
  ├─ 回放、牌组、测试场景：本地文件
  └─ 联网对战：可选连接 game-server
```

## 2. 产品边界

### 必须满足

- Windows 客户端安装后可以直接启动，不要求打开浏览器。
- 离线模式不依赖网络、网页标签或第三方站点。
- 卡牌的强制触发、费用、目标、替代效果和结算顺序由规则引擎自动处理。
- 玩家只在目标、模式、费用、替代效果和顺序等真正影响结果的地方做选择。
- 联网模式不能让客户端提交“已经结算好的结果”，只能提交规则命令。
- 每局对局都带规则版本、卡牌数据版本、随机种子和事件日志，能够重放。

### 明确不做

- 不通过 iframe、DOM、网页脚本或屏幕抓取复刻 Rift Atlas。
- 不把页面端当成游戏规则的权威来源。
- 不在客户端里硬编码一套绕过 `engine-core` 的卡牌效果。
- 不在没有授权时打包官方卡图、Logo、角色立绘或完整卡牌数据库。
- 不把浏览器网页作为独立客户端的第一交付形态。

## 3. 技术方案

### 3.1 桌面壳

采用 **Tauri 2 + React + TypeScript**：

- Tauri 负责窗口、菜单、文件选择、系统路径、安装包和桌面生命周期。
- React + Vite 负责牌桌、卡牌、Prompt、日志和回放视图。
- Rust/Tauri command 只暴露窄接口，不把规则判断放进桌面桥接层。
- `engine-core` 保持纯 TypeScript、无 DOM 依赖，供离线客户端和服务端复用。

选择 Tauri 的原因是桌面交付体积和资源占用更适合卡牌客户端，同时保留前端快速迭代能力。若后续规则引擎需要更高性能，可以把经过验证的核心模块编译成 WASM，但这不是 MVP 前置条件。

### 3.2 仓库结构

```text
apps/
  desktop-client/       # Tauri 2 + React 的独立桌面客户端
  game-server/          # 联网房间、权威状态、隐藏信息和回放

packages/
  engine-core/          # 纯规则引擎；离线模式和服务端共用
  card-data/            # 带版本的卡牌定义、勘误和数据 manifest
  card-dsl/             # 卡牌文本到效果 IR 的编译链
  desktop-bridge/       # Tauri commands 和桌面能力的类型化接口
  protocol/             # Command / Prompt / Event / Projection
  judge-tools/          # 裁判复盘、修正、证据和回放工具
```

### 3.3 运行模式

| 模式 | 状态权威 | 网络 | 用途 |
| --- | --- | --- | --- |
| 离线练习 | 本地 `engine-core` | 不需要 | 学习规则、验证卡牌、AI |
| 本地双人 | 本地 `engine-core` | 不需要 | 同一设备轮流操作 |
| 联网对局 | `game-server` | 必需 | 对战、隐藏信息、反作弊 |
| 回放/裁判 | 本地回放引擎或裁判工具 | 不需要 | 复盘和争议处理 |

离线模式与联网模式必须使用同一套状态模型、Command 和 Event 语义。差别只在于谁持有权威状态：离线模式由桌面客户端本地进程持有，联网模式由服务端持有。

## 4. 客户端内部架构

```text
React View
  -> Client Controller
  -> Command Builder
  -> Local Engine Adapter / WebSocket Adapter
  -> Event Journal
  -> Player Projection
  -> View Model

Tauri Rust Bridge
  -> replay files
  -> deck files
  -> card-data manifest
  -> window/menu/system integration
```

### 4.1 `Client Controller`

负责输入和显示流程，不负责判定规则：

- 将点击、拖拽、快捷键转换成玩家意图。
- 显示引擎返回的合法行动、Prompt 和错误原因。
- 处理断线、重连、版本不兼容和本地文件错误。
- 把 `autoReason`、`eventSeq` 和状态哈希呈现给玩家或裁判。

### 4.2 `Local Engine Adapter`

离线模式直接调用 `engine-core`：

- 启动时加载固定版本的 `card-data`。
- 使用确定性 seed 创建对局。
- 自动执行唯一且强制的选择。
- 在可改变结果的节点暂停并生成 Prompt。
- 将所有状态改变写入 Event Journal。

### 4.3 `WebSocket Adapter`

联网模式只发送：

```text
Command + clientSequence + knownStateHash
```

客户端接收：

```text
Event / Projection / Prompt / Error
```

服务端拒绝客户端提交的结果状态、费用结果、目标结果或随机结果。客户端显示的牌桌只是服务端投影，不是可信状态来源。

## 5. 卡牌交互

目标体验是“自动处理卡牌流程，玩家只做策略选择”：

1. 玩家点击或拖动卡牌表达 `PlayIntent`。
2. 引擎检查时机、费用、目标和模式。
3. 强制且唯一的触发自动进入 Chain，并记录 `autoReason`。
4. 有多个合法目标、模式、替代效果、额外费用或顺序时，客户端显示 Prompt。
5. 玩家确认后引擎锁定选择、继续 `Finalize -> Execute -> Pass -> Resolve`。
6. Resolve 时再次检查目标和效果合法性，失效部分按规则处理。

UI 不提供“再次触发”按钮，也不要求玩家手动点击每个被动能力。卡牌点击默认打开检查器，明确的行动按钮才提交 Command，避免误触。

## 6. 桌面体验

- 主窗口基准 `1920x1080`，最低支持 `1280x800`。
- 启动后直接进入首页或牌桌，不显示网页地址栏。
- 离线模式在网络不可用时仍可打开已有牌组、测试场景和回放。
- 牌桌布局保留 Base、Battlefield、Chain、双方手牌、Prompt 和事件日志。
- 侧栏支持触发队列、事件日志和卡牌检查器切换。
- 所有长文本可换行，支持高对比度、减少动画、键盘导航和字体放大。
- 客户端更新不改变进行中的对局所使用的规则和卡牌数据版本。

## 7. 本地文件与版本

客户端数据目录分为：

```text
data/
  card-data/<dataVersion>/
  replays/
  decks/
  scenarios/
  logs/
```

每个对局写入：

```json
{
  "coreRulesVersion": "1.5",
  "tournamentRulesVersion": "2026-10-09",
  "dataVersion": "2026-10-09-radiance",
  "sourceDigest": "sha256:...",
  "seed": "...",
  "clientVersion": "...",
  "eventJournal": "..."
}
```

进行中的对局不能静默替换规则或卡牌数据。数据更新以新版本目录安装，旧回放继续使用自己的 manifest。

## 8. 打包与交付

### MVP

- Windows：安装包和便携包。
- 内置占位卡框、测试卡和规则版本 manifest。
- 离线启动、牌组导入导出、回放导入导出。
- 可选服务器地址配置，不影响离线使用。

### 后续

- macOS `.dmg`。
- Linux AppImage。
- 自动更新、安装包签名和崩溃报告。
- 可选的联网大厅、账号和赛事服务。

## 9. 验收标准

独立客户端 MVP 必须同时满足：

- 在没有浏览器和网络的情况下启动并完成一局本地测试对局。
- 不手动点卡触发强制效果，且日志能解释自动触发原因。
- 对目标、模式和替代效果产生可操作 Prompt。
- 关闭客户端后可以导出并重新载入回放，状态哈希一致。
- 联网适配器不能越过服务端权威状态。
- 通过 `1280x800` 和 `1920x1080` 两个桌面尺寸的 UI 测试。
- 不包含未授权官方图片、商标和完整卡牌数据。

## 10. 修订后的里程碑

| 里程碑 | 交付 |
| --- | --- |
| M0 | `engine-core`、事件模型、版本 manifest 和占位卡 |
| M1 | 回合、Chain、HOT FEPR、费用、目标和 Cleanup |
| M2 | Tauri 2 壳、离线牌桌、本地文件和回放 |
| M3 | 卡牌 DSL、自动触发 Prompt、卡牌检查器 |
| M4 | 联网服务端、隐藏信息投影、断线重连 |
| M5 | 裁判工具、打包签名、性能和发布门禁 |
