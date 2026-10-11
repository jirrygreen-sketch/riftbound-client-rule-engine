# Riftbound Client Rule Engine

一个面向《Riftbound》的非官方独立桌面游戏客户端与规则引擎设计仓库。项目目标是把卡牌游戏中容易被遗漏的触发、目标、费用、替代效果和时序交给确定性的规则引擎处理，让玩家主要做真正有策略意义的选择，而不是反复点击卡牌来“触发”效果。

本仓库当前是设计阶段交付物，不包含可运行客户端。目标交付形态是可安装、可离线启动的独立桌面程序，不依赖浏览器页面或 Rift Atlas；联网对战服务端是可选后端。所有设计文档、规则映射、卡牌 DSL 草案、裁判策略和测试矩阵都已按模块放在 `docs/` 中，并在 `outputs/` 提供一份可单独阅读的总方案。

## 目标

- 自动检测并加入强制触发能力。
- 自动执行唯一且没有策略分歧的强制选择，并留下可审计的 `autoReason`。
- 在可改变游戏结果的地方暂停，生成清晰的玩家 Prompt。
- 严格实现 Riftbound 的 `Handle Outstanding Tasks -> Finalize -> Execute -> Pass -> Resolve` 流程。
- 将 `Priority` 与 `Focus` 分成两个独立权限模型。
- 将正式规则、Tournament/Judge Policy、客户端 UX 分层，避免用 YGO 的连锁直觉替代 Riftbound 规则。
- 支持确定性回放、联机一致性、隐藏信息隔离和裁判复盘。

## 阅读顺序

| 文档 | 内容 |
| --- | --- |
| [总方案](outputs/riftbound-client-rule-engine-plan.md) | 适合产品、研发和评审快速浏览的完整摘要 |
| [开发方案](docs/development-plan.md) | 技术选型、模块边界、里程碑、交付门禁 |
| [独立客户端设计](docs/standalone-client-design.md) | 桌面程序形态、本地运行、联网模式和打包方案 |
| [规则引擎架构](docs/rule-engine-architecture.md) | 状态模型、时序、费用、目标、触发、替代效果 |
| [客户端设计](docs/client-ux-design.md) | 桌面牌桌、自动触发、Prompt、日志和可访问性 |
| [卡牌 DSL](docs/card-dsl.md) | 卡牌效果的声明式表示、编译和降级策略 |
| [裁判策略](docs/judge-policy.md) | 线上自动处理、裁判模拟和 Missed Trigger 政策 |
| [测试矩阵](docs/test-matrix.md) | 单元、属性、回放、联机、UI 和 CI 门禁 |
| [资料与版本](docs/sources.md) | 官方规则、文章、参考站点和资料边界 |

## 关键设计决定

### Riftbound 优先，YGO 只作交互参考

YGO 生态对“卡牌详情、响应队列、结算日志、效果脚本化”的产品经验很有参考价值，但 Riftbound 的规则核心不是一个可以直接套用的单一 LIFO 连锁。引擎必须实现 Riftbound 自身的 Pending/Finalized Chain Item、HOT FEPR、Cleanup fixed point、Showdown、Priority 和 Focus。

因此客户端可以用类似“响应队列”的视觉语言帮助玩家理解，但队列中的语义、锁定时机和结算权限全部由 Riftbound 规则层决定。

### 自动触发不等于自动替玩家决策

- 强制且唯一的动作：自动执行，并在日志显示原因。
- 可选触发、可选替代、多个目标、模式、额外费用和会改变策略的顺序：生成 Prompt。
- 目标在 Finalize 时锁定，Resolve 时重新检查合法性。
- 触发、替代效果和阻止效果由独立事件层处理，不把所有行为硬编码成一串普通效果。

### 官方资料版本

设计基线锁定为：

- Core Rules：`v1.5 / Radiance`，以官方规则中心当前发布版本为准。
- Tournament Rules：`2026-10-09`。
- 卡牌数据和勘误：以带版本号的导入快照为准，不能让客户端启动时静默漂移。

版本、下载入口和本地研究资料说明见 [docs/sources.md](docs/sources.md)。公开仓库不提交官方 PDF、官方卡图、Riot/LoL 品牌资产或本地扫描素材。

## 目标技术形态

首个实现建议采用 TypeScript monorepo：

```text
apps/
  desktop-client/   # Tauri 2 + React 的独立桌面牌桌
  game-server/      # WebSocket 会话、房间、权限与回放
packages/
  engine-core/      # 纯函数、确定性、无 DOM 的规则引擎
  desktop-bridge/   # Tauri 命令、文件、窗口和本地存储边界
  card-data/        # 版本化卡牌定义和勘误
  card-dsl/         # DSL AST、校验器、编译器
  protocol/         # Command/Event/Projection 协议
  judge-tools/      # 裁判复盘、修正和证据工具
```

本地单机和联机对局共用 `engine-core`。在线对局由服务器持有权威状态，客户端只接收该玩家可见的 Projection。

## 合规与版权边界

这是一个非官方粉丝项目，不隶属于 Riot Games，也不代表任何官方组织。仓库中的原创架构、接口、测试策略和设计文字采用 MIT License；第三方规则、卡牌文字、卡图、商标、标识和官方文档的权利仍归各自权利人所有。

公开仓库只保留链接、版本信息、抽象示例和占位素材。若未来导入真实卡牌数据，应确认数据来源、再分发许可和地区合规要求；没有授权时只使用用户自有数据或不含官方文案的测试夹具。

## 当前状态

- [x] 规则时序和对象模型设计
- [x] 自动触发与玩家 Prompt 设计
- [x] 客户端信息架构和视觉基线
- [x] Card DSL 与事件层边界
- [x] 裁判策略和测试矩阵
- [ ] 规则引擎 MVP
- [ ] 占位卡池与本地单机牌桌
- [ ] 联机服务器和隐藏信息投影
- [ ] 真实卡牌数据授权评估
