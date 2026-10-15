# Full-Product 完整交付验收清单（delivery goal）

Last updated: 2026-10-15（当前事实归并；远程验证使用无 `.git` 的源快照；本机为 managed worktree；基线 `codex/full-product@8d3929d` 的 managed detached HEAD，无 commit / push / deploy）

## 当前状态（2026-10-15）

- **战斗后的费用阻塞已在新 P9 修复**：A4/B4 第 5 回合军团后卫在物理链87拒付额外费用被拒，原 schema8 日志保持原样，旧 P8 仍严格重放到原拒绝。显式 P9 `optional-unit-resolved-history-v5` / schema9 只认可真实 native 已结算离场历史；重新执行原27条 GUI 命令后，decline88、两次符文产能89/90、pay92，单位横置入基地，重复付款不二次结算，新9严格回放一致且错 profile gate 拒绝。正式两项回归及23.5KB精简输入已由主控复跑通过。**这是原 GUI 输入的服务端再执行，尚非新版双 GUI 完整整局。**见 `../../outputs/coordination/resume-20261013/artifacts/post-combat-profile9-parent/PARENT-FORMAL-REGRESSION.json`、`../../outputs/coordination/resume-20261013/artifacts/post-combat-profile9-parent/REAL-TRAJECTORY.json`。

- **A4/B4 实时验收（room `5b811e0c`）**：两个实际原生窗口从准备/调度走到 Main4，**25 GUI commands / 25 deliveries / 0 duplicates**，stateVersion/eventSeq **74/74**。B 拒付额外费、实付2能量后横置入场；A 实付3能量1炽烈后就绪入场；随后移动、双方焦点、征服与战斗互杀由引擎结算，A1/B0、各弃牌1、场上0。双方3条公聊与保存回放确认；原7,949,381字节schema8日志严格fresh replay0且原SHA不变。后续 A5/B5 已在 Main1 实测聊天标题、输入框、3条公聊、独立滚动和双方保存回放，1024×720仍可用；当前新卡牌交互另行开发验收。见 `../../outputs/coordination/resume-20261013/artifacts/replay-focus-parent-integration/native4-main4-strict-replay.json`、`../../outputs/coordination/resume-20261013/artifacts/native5-chat-parent/PARENT-REVIEW.json`。
- **最新全工作区冻结源码门禁（wave386）**：643份源码/测试/配置/文档哈希运行前后相同，离线 frozen install、冷 typecheck、单次全仓 test、build 全部退出0；9包 **2929 passed / 0 skipped**。原始 build 日志确认客户端 tsc 与 Vite 构建成功，修正 worker 摘要误称客户端无 build 脚本。该快照包含 P9、Point内部服务与聊天CSS，早于新卡牌交互及随后新增的两项P9正式回归，**不能当作最新 UI 或干净 Git/Windows/全产品验收**。见 `../../outputs/coordination/resume-20261013/artifacts/current-p9-frozen-parent-review/PARENT-REVIEW.json`。

- **管理状态**：managed detached HEAD `8d3929d`；原目录所有脏改动保留；无 commit / push / deploy；原 23 项完整交付目标 **active（未完成）**。远程 CLI 在无 `.git` 的冻结源快照中执行；本机 managed worktree 保留既存脏改动，均不能当作当前干净 Git 检出。
- **运行时 profile 边界（P8/P9 均显式 opt-in）**：CLI 默认仍是房间 `p4` + runtime `optional-unit-choice-clock-v4`，落盘 **schema 7**；SDK / 权威运行时工厂默认 `public-chain-v1`，落盘 **schema 4**。显式 `optional-unit-physical-chain-v4` 为 **schema8**，显式 `optional-unit-resolved-history-v5` 为 **schema9**；两者都走物理单位链，新9另接受经过原生证明的已结算离场历史。旧1–8执行语义不迁移，CLI / SDK 默认不变。见 `../../outputs/coordination/resume-20261013/artifacts/post-combat-profile9-parent/REAL-TRAJECTORY.json`、`runtime-profiles.md`。
- **卡牌点击/拖拽交互在途**：按用户新要求，把可用动作及费用/目标选择放在牌旁浮层，拖放到服务端合法区域后直接执行或补选；结束/让过保留直接按钮，原动作栏收为“更多操作”。wave388四个独立写域正在实现，需收齐真实模块、客户端回归与新版双原生验收，当前不记为已交付。
- **P8 wire 矩阵（真实 TCP，父已签收）**：真实 profile8 物理链 **25 commands / 25 exact-duplicate resends / 10 rejections / 30 checks passed**、**780 wire frames / 405 projections**（A 402 消息 / 207 投影，B 378 / 198；invalid 0、跨座位 token frame 0）。**第三个视图是 project(null) journal 观察，不是第三个 TCP 连接**。范围限 **InMemoryStore** 与 Main4 Combat 轨迹，**不含** FileRoomStore 重启 / 完整整局 / Hold / 新 Gear / Point 执行。见 `../../outputs/coordination/resume-20261013/artifacts/actual-profile8-wire-parent-recheck/PARENT-REVIEW.json`。
- **P8 原生 `02803bb8`（分开记录实时与回放）**：迭代2真实 **16 GUI commands / 16 deliveries / 0 duplicates** 至 Main3，A 支付 3 Energy + 1 Fury 后就绪入场、B 拒额外但付本体 2 Energy 后横置入场。最新 **A4/B4** 两包均构建成功，在其各自真实保存回放上完成 **17 帧播放、展开牌桌、前后翻帧、卡牌详情与两级 Esc 退出**；1280×800 / 1024×720 均能看见完整卡垫。B4 第16帧实际显示 A 的 Energy3/Fury1/Order0/Any0。该17帧记录是先前的只读回放验收；其后新实时轨迹见顶部 `5b811e0c`。 见 `../../outputs/coordination/resume-20261013/artifacts/replay-focus-parent-integration/NATIVE-ACCEPTANCE.json`。
- **Playmat 与领域计数**：顶部对手手牌背面、底部自己手牌、上下镜像基地与符文区、中间双战场；每座位只显示该传奇两域、能量和通用符能，保留零值。A4/B4 真实回放完整牌面/就绪状态、短屏支付计数与隐藏手牌边界已验；不同传奇域、错版目录和旁观的 App 接线另有8项结构测试，不能称为那些场景的原生对局。见 `../../outputs/coordination/resume-20261013/artifacts/playmat-layout-parent/UI-ACCEPTANCE.json`、`../../outputs/coordination/resume-20261013/artifacts/legend-domain-counter-parent-review/PARENT-REVIEW.json`。
- **full-workspace（冻结 Linux 597源，非本机）**：9项目 **2878 passed / 0 skipped**、build0，冷 typecheck 先失败2、build后0，源哈希前后相等。后续当前集成客户端独立 **56文件 / 798 passed / 0 skipped**，根 typecheck0；两原生包构建0。**这些不同运行不得拼接成当前全工作区总数**。worker364自述全工作区通过但未交原始日志，不据其新增总数。见 `../../outputs/coordination/resume-20261013/artifacts/current-playmat-workspace-parent-review/PARENT-REVIEW.json`、`../../outputs/coordination/resume-20261013/artifacts/replay-focus-parent-integration/PARENT-REVIEW.json`。
- **P8 聊天、真实进程重启与续付（主控已复跑）**：真实双 GameClient/TCP，选择/支付窗口双方公聊共4条，不改Duel时钟；旧PID29120退出、原端口关闭，新PID29144从同一FileRoomStore恢复，schema8与原1026919字节日志前缀保持。35/35的同一payment、cursor8、四消息序列恢复，单次续付后唯一就绪入场，最终41/41。主控脚本增加双方room-view达到已确认receipt版本的等待，初次缺少同步等待的脚本出现超时，原证据保留；**未放宽产品版本/ACK guard**。范围是这条支付/聊天路径，非所有对局阶段。见 `../../outputs/coordination/resume-20261013/artifacts/profile8-process-parent-recheck/PARENT-REVIEW.json`。
- **冷启动 typecheck 顺序修复**：根 `scripts.typecheck` 改为先 `pnpm --filter './packages/**' run build` 再递归 typecheck；父已把**恰好两个文件**（`package.json`、`docs/full-product/workspace-verification.md`）合入，依赖 / lockfile / apps / packages 源码未改；主控独立运行当前 `pnpm typecheck`，退出码 **0**；原冷启动 TS2307 与负控制 TS1109 日志保留。**冷复制（cold copy）不是 Git clean**。见 `../../outputs/coordination/resume-20261013/artifacts/cold-workspace-typecheck-parent-review/PARENT-REVIEW.json`、`workspace-verification.md`。
- **source 绑定（≠ 可执行）**：新 Equip107 / Beginning86 / 组合110 是 **DSL 与 Server 的“来源绑定”**，**不代表可执行**（父记 “source107/86/110 are both DSL and Server source bindings, not executable coverage”）。默认 65 / 显式 77 与旧 7 工厂摘要不变。
- **官方 catalog（不变）**：**1381 printings**；persisted effect **executable 0 / judge-required 1348 / no-ability 33**，**不得**改口为官方完整。
- **内部集成与公开路径边界**：Point 目标/来源证明、费用与效果服务工厂已通过父级定向测试并合入；Point81 正常开局与 Unit Chain 来源检查已合入，仍未公开 Point 出牌/伤害路径。Gear / Equip / Hold 继续独立审查或返工，尚未合入公开运行时。
- **灼焰飞龙（Blazing Scorcher，`ogn-001-298`）疑点已澄清**：曾被怀疑的“advertised 能力错开放”已由 catalog 证实为 **pureAccelerate**（`energy:5 / power:null / might:5`，能力文本即 `[Accelerate]`）。该“能力错开放”假设已否定，也不据此要求 schema9。另一个不同问题已由主控真实双 TCP 复现：先付清军团后卫，再施放仅余最多1能量的飞龙、拒付额外费后，本体5能量窗口没有撤销出口。见 `../../outputs/coordination/resume-20261013/artifacts/unpayable-chain-parent-recheck/PARENT-REVIEW.json`；Core撤销修复在途，未把该反例写成已修。
- **公开链路**：公开 P4 / Room / V2 **现已接入**；actual two **56-deck**；payment / resources / play / Move / Focus / Combat 已有真实 WS 与 native bounded 证据。
- **legacy 真实原生整局（父核链；属 legacy，不充作 P8）**：`4083c787` 为**历史执行版本**的完整整局，22 回合 B 8 分、stateVersion 258、34 独立 commands / 48 deliveries / 14 dups；其 source 严格 fresh replay **原 log bytes 未变**；验收项 1 / 18 / 19 已有父明确验收，但**仅覆盖该 legacy profile**。`17cecbea`（历史 layout/schema4）真实 19 GUI commands、Progress Day 6 Energy 1 Mind、双方 priority pass → Draw4；`06a8a0d2`（legacy）28 GUI commands、真实双方 4 Might combat 互杀 trash1、Main 9A0B1，严格 fresh replay 且父保持旧字节；`1280x800` / `1024x720` 双方战斗 unit 并排真实卡图与对决/战斗时点已见。独立 Home 6 菜单、房间 deck picker / roster / ready / chat、手牌 / 资源 pool / actions / settings / chat 都已接。**以上均为 legacy 证据，不得计入 P8 整局。**
- **公开 profile7 原生房间 `2ba8404c`（属 schema7，不是 P8）**：曾到达真实 **Main3 / stateVersion 46**，共 **16 actual commands**；B 拒付额外费用但仍支付本体 **2 Energy** 后横置入场，A 支付 **3 Energy + 1 FuryPower** 后就绪入场；两端房间/局内聊天与保存回放已验。其后源码对该 **3,388,491 字节**原始 log 严格 fresh replay exit0，**原字节 SHA `04ba926d4a5eada935d532579ccfef75cba84d98b644e635a030aecb3a98a404` 不变**。该房间属 **schema7** 轨迹，**不得当作 P8 证据**。
- **基地资源带（历史快照，限当时战斗回放布局）**：横排资源带与按内容分配的外层高度曾在真实 1280×800 与 1024×720 两个原生窗口验证：看见完整符文卡面、属性和就绪文字；左右翻看按钮实际访问资源带末端。证据见 `../../outputs/coordination/resume-20261013/artifacts/base-ribbon-resource-visibility/final-native-verification.json`。**该验收限当时战斗回放布局**，不代表当前整轮。
- **短屏手牌布局（历史快照）**：付款资源移右栏、短屏手牌/双单位横排和中性战斗时点，曾在真实双 Native 的 room30ef4ae4 跑 25 GUI 命令至 Main4/version72、A1B0/board0/各trash1/pool0，strict replay0；当时 client765/0skip、双包构建0；其后仅修两列资源 CSS 优先级并重建两包0，A 实际 Replay13/25 可见两列；A 最终截图白 padding 只证明内容，不用于几何验收。**该 765 为当时快照，与后续独立 client 779 不同轮，不得相加。** 见 `../../outputs/coordination/resume-20261013/artifacts/payment-resource-sidebar-parent/PARENT-REVIEW.json`。
- **可选额外费用（schema7 历史证据）**：schema7 已用明确的内核事件推进选择窗口状态，保持客户端 ACK 检查。父曾验真实 GameClient、双 TCP WS 的支付 / 不支付、重复请求、重启恢复与三方严格回放；旧 schema6 两份原日志严格重放后 SHA 与字节不变。原生房间 `2ba8404c` 中 B 拒付额外但支付本体 2 能量后横置入场、A 支付完整 3 能量及 1 炽烈符能后就绪入场，均只入场一次。选择支付但费用减为 0 的语义已有内核机制测试，**尚无真实公开 / 原生零费用路径**。
- **Hold / Recruit（当前）**：RecruitV3 canonical tokenChain 与 F1 修复仅 **Core-only** 验证；普通 mutation 必须保留原 admitted 数组身份，toJSON/entry/getter 攻击回归通过。**Hold 候选独立审查返回返工**：存在 pending session 丢失、回调生命周期、source 行为性载体和既有 V3 兼容回归；lineage 候选已返回但整条Token支付未闭合、6个genericV3回归仍失败；wave375继续修复生命周期/比较器/兼容，未合入（见 `../../outputs/coordination/resume-20261013/artifacts/hold-v3-independent-parent-review/PARENT-REVIEW.json`），public Hold / source / entry / 恢复仍未接；不能把 108 静态 source 或 DTO 当闭包。
- **整体边界**：全部官方效果、完整 FinalPoint / 当前终局链、Windows NSIS 与 Windows 运行、clean Git 复现、当前整轮全绿**均未完成**。CLI 默认7 / SDK4、旧 1–7 日志版本不变。**Point 仅内部部件已父验收，Gear / Equip / Hold 仍未集成公开路径**；新来源 / 内核不替代公开新 profile 或完整官方效果。

材料相对链接（相对本文件）：
- 接续记录：`resume-20261014.md`
- 进度：`progress.md`
- 原生整局核链：`../../outputs/coordination/resume-20261013/artifacts/native-desktop-current/native-fullmatch-verification.json`
- 原生 48 投递 replay：`../../outputs/coordination/resume-20261013/artifacts/native48-ui-chat-current-replay/verification.json`
- 新版 layout/schema4 与 GUI：`../../outputs/coordination/resume-20261013/artifacts/native-layout-current/UI-ACCEPTANCE.json`
- 可选 Unit public wire：`../../outputs/coordination/resume-20261013/artifacts/optional-public-wire-parent-recheck/verification.json`（原 logSHA：`.../original-schema6-log-hashes.json`）
- 可选 clock 反例：`../../outputs/coordination/resume-20261013/artifacts/optional-clock-parent-counterexample/PARENT-REVIEW.json`
- 基地资源带：`../../outputs/coordination/resume-20261013/artifacts/base-ribbon-resource-visibility/PARENT-REVIEW.json`
- 真实 public Combat WS：`../../outputs/coordination/resume-20261013/artifacts/actual-public-combat-parent-recheck/ws-combat-trajectory.mts`
- Fury77 真实构筑：`../../outputs/coordination/resume-20261013/artifacts/fury77-real-constructed-rosters/verification-report.json`
- Recruit TokenPlay 费用/entry 映射：`../../outputs/coordination/resume-20261013/artifacts/recruit-token-cost-source-map/REPORT.zh.md`
- 默认 65 / 显式 IR 绑定：`../../outputs/coordination/resume-20261013/artifacts/accelerate-opt-in-official-ir-binding/PARENT-REVIEW.json`
- 新 Core 物理链 workspace 快照：`../../outputs/coordination/resume-20261013/artifacts/physical-chain-core-workspace/verification.json`
- Recruit TokenPlay / UI workspace 快照（历史 2632）：`../../outputs/coordination/resume-20261013/artifacts/recruit-token-play-ui-workspace/verification.json`

本任务读取的父签收 receipt（相对本文件；未凭文件名猜内容，均逐个读取）：
- P8 runtime profile 边界：`runtime-profiles.md`、`../../outputs/coordination/resume-20261013/artifacts/runtime-profiles-parent-review/PARENT-REVIEW.json`
- P8 wire 矩阵：`../../outputs/coordination/resume-20261013/artifacts/actual-profile8-wire-parent-recheck/PARENT-REVIEW.json`
- P8 原生 GUI 与 Playmat：`../../outputs/coordination/resume-20261013/artifacts/playmat-layout-parent/UI-ACCEPTANCE.json`、`../../outputs/coordination/resume-20261013/artifacts/playmat-layout-parent/live-counter-verification.json`
- 冻结 `597` 源快照 2878：`../../outputs/coordination/resume-20261013/artifacts/current-playmat-workspace-parent-review/PARENT-REVIEW.json`
- 冷启动 typecheck 顺序修复：`../../outputs/coordination/resume-20261013/artifacts/cold-workspace-typecheck-parent-review/PARENT-REVIEW.json`、`workspace-verification.md`
- 桌面操作指南：`desktop-user-guide.md`

> 说明：本仓快照未全量携带 native PNG；`PARENT-REVIEW.json` 等已由父核过目。缺 PNG **不否定父实测**，核链路径见上及各 `PARENT-REVIEW.json`。

历史增量材料（早期轮次，仅存档）：
- 双原生支付/战斗UI：`../../outputs/coordination/resume-20261013/artifacts/payment-resource-sidebar-parent/PARENT-REVIEW.json`
- PointSpell内核：`../../outputs/coordination/resume-20261013/artifacts/point-spell-parent-integration/PARENT-REVIEW.json`
- 当前整轮失败与重跑：`../../outputs/coordination/resume-20261013/artifacts/current-ui-core-source-workspace-retry/verification.json`、`../../outputs/coordination/resume-20261013/artifacts/current-ui-core-source-workspace-serial/verification.json`

## 规则版本基线（不可混用）

- 本轮当前生效基线：**Core Rules 1.4**。该 PDF 的 LastUpdated 为 **2026-07-16**（并非
  2026-10-12 才生效）；本轮 full-product 以 v1.4 为当前生效规则基线。官方 PDF：
  `work/rules/CR-v1.4.pdf`，
  sha256=`9c5fb8b8638f2cd19ceda237929fa2c37aac23c797cc7410294993470ba5a30b`（已验证）。
- Core 1.5 官方已于 **2026-10-09** 公告、将于 **2026-10-16 生效**；截至本轮
  （2026-10-12）**尚未生效，不得混入**任何实现、测试或文档结论（公告：
  `https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/`）。
- 1v1 格式：Duel 485.4 / 485.5 为**各带 3 个随机选 1、共 2 个**（shared 2）。用户
  当前明确要求交付真实 1v1 Duel，**不要求 BO3**；BO3 Match 486.5 是**不同格式的后续
  边界**，其规则与 Duel 不同，需独立验收，不得用 Duel 结果替代，也不得因未做 BO3 而
  阻塞当前 Duel 完整交付。

## 状态口径

- `待完成`：尚无实现或仅有实验性代码，无本轮可观察证据。
- `待验收`：实现已存在，缺本轮端到端可观察证据或主控验收。
- `已有局部证据`：存在局部/组件级证据（如 SSR 渲染、单协议测试），**不等于**完整对局证据。
- 里程碑只是**实施顺序**，不改变任何条目的完成标准。

## 验收项

> 下表第 3/4/5 列（可观察验收通过条件、所需证据）保持原 1–23 条目**逐字不变**；仅「现状」列按 2026-10-15 当前事实更新，未验收者**不写成已验收**。

| # | 验收项 | 可观察验收（通过条件） | 所需证据 | 现状 |
| --- | --- | --- | --- | --- |
| 1 | 真实 1v1 双共享战场 | 两名真实玩家进入同一对局，共享且共同可见 2 个战场；任一客户端可观察到对方在同一战场上的行动 | 双客户端对局录像/回放 + 双方投影中战场集合一致 | 已验收：真实 A/B 两 `.app` 共同可见 2 个战场并观察同一 Move；房间 4083c787 的 48 次投影逐步双方 board 全相同；终局 22 回合/B 8 分；显式 legacy 执行版本下 fresh replay 严格复验，原日志未变。见 native-desktop-current/native-fullmatch-verification.json、native48-ui-chat-current-replay/verification.json |
| 2 | 官方开局 | 洗牌、起手与调度（mulligan）、先手决定、Battlefield 选择、rune channeling、sideboard 流程按 1.4 执行，且步骤与规则条目可对应 | 开局逐步日志 + 规则条目映射 + 端到端对局片段 | 待完成：公开 P4/V2 已接，真实原生已走 setup → 双方 mulligan → turn；内部 setup/constructor 内核存在；rune channeling/sideboard 的完整公共流程未闭合 |
| 3 | 官方回合结构 | 回合/阶段/优先权与规则 1.4 一致，非法时机动作被拒 | 回合状态机测试 + 非法动作拒绝用例 | 待验收：公开回合已可达 Main（`17cecbea` 真实 19 命令、Progress Day 支付与双方 priority pass → Draw4，属 **legacy** 证据）；P8 真实回合证据限 Main3/Main4 轨迹；full turn seam（Ending/Combat/card-play/priority 全时序）尚未整体验收 |
| 4 | 符文（Rune）机制 | 符文池/频道/消耗与回收行为按 1.4 正确 | 符文相关单元与端到端用例 | 待验收：内部资源内核 `src/duel/resources.ts` + oracle 1161 cases 0 mismatch；可选 Unit 已做真实 native Rune 筹资；完整 public channel/回收未闭合 |
| 5 | Move / Location | 单位在 Location 间移动（含免费/付费、消耗与限制）结果与规则一致 | 移动用例 + 投影中 Location 变化证据 | 待验收：内部 StandardMove 内核 17 例（CR 420.3 Discretionary + Main/Turn/Priority 门禁）；现有真实 WS/原生 Move 有界证据，触发/cleanup 完整面未验收 |
| 6 | Control 与 Contested | 战场控制判定、争夺态进入/退出正确，且对未知情玩家不可见相关隐藏信息 | 控制/争夺状态用例 + 双方隐私投影差异 | 待验收：board 内核含 contested/controller 关系校验；原生 4083c787 Hold 至 8 分已有界；公开三视图与隐藏信息差异快照未验收 |
| 7 | Showdown | 对决触发、顺序与结算按 1.4 执行 | Showdown 流程端到端片段 | 待验收：board 内核含非战斗 showdown 起止与 Open cleanup；原生战斗时点已见，完整 Showdown 结算未验收 |
| 8 | Combat / 战斗伤害 | 战斗组队、伤害分配、清算与 Deathknell 顺序正确 | 战斗用例 + 结算日志 | 待验收：已有真实 public WS Combat 轨迹与 **legacy** 原生 `06a8a0d2` 双方 4 Might 互杀 trash1 有界证据；P8 有 Main4 Combat 轨迹（不完整整局）；组队/Deathknell 全序未验收 |
| 9 | Conquer / Hold | 征服与固守的计分触发条件与得分按 1.4 执行 | 计分用例（含边界：不得分条件） | 待验收：`src/duel/scoring.ts` 14 例；原生 4083c787 Conquer/Hold 至 8 分已有界；边界（不得分）用例未验收 |
| 10 | Final Point 与胜负 | Final Point 结算与官方胜负条件（含 Battlefield Count 2）正确，对局能真实结束 | 胜负判定用例 + 一局完整对局到结束的回放 | 待验收：scoring 内核含 8 分/唯一领先者判定，原生有 B 8 分真实结束；完整 FinalPoint/终局链闭包未验收 |
| 11 | 官方卡池能力 | 官方卡牌效果被 EffectIR 表达且可执行；未实现效果保持 `judge-required`/`blocked`，**不得近似实现** | 本地 sync manifest/来源 URL/hash/计数/同步日志可复现（官方版权 catalog/images/PDF 保持 `.gitignore` 忽略，**不要求提交全量版权数据**）+ executable/judge-required 计数（本轮重新采集）+ 代表性卡牌端到端用例 | 待完成：catalog 1381 printings / persisted effect executable **0**；source 默认 65、显式 77 来源 IR ≠ 77 全部可执行；card-dsl 定向套件通过，**持久化覆盖率文件仍记为 0**，已实际接通的少量运行能力以各端到端证据为准；未实现效果保持 `judge-required`/`blocked` |
| 12 | 完整构筑（Constructed） | 合法牌组按官方构筑规则校验，含 Domain Identity、Champion/Legend/Signature 与区域可用性限制 | 构筑校验用例（合法/非法两侧）+ 规则条目映射 | 待完成：Fury77 两副真实 56 张构筑 valid/issues0、全部 printing 有 ref、143 Legends / 60 Signatures 唯一定 family 已有局部证据；Colorless 战场域 / sideboard CR 103 / 区域可用性 / 现行 TR 未裁定 |
| 13 | 服务端权威 | 所有状态变更经服务端权威命令；客户端无法本地伪造结果 | 越权/伪造尝试被拒的端到端用例 | 待验收：公开 P4/Room/V2 已接、真实双 TCP WS 命令路径存在；服务端权威越权/伪造端到端用例未整体验收 |
| 14 | 隐私 | 每个 view 只暴露该玩家可见信息，隐藏区信息不泄漏 | 双方投影字段差异快照 + 泄漏检测用例 | 待验收：可选 Unit 三方 Replay 有 publicDigest/private journal digest 证据；完全失去合法目标的 restored authority repair 与完整隐私快照未验收 |
| 15 | 幂等 | 重复命令/重复投递不产生重复结算 | 重放同一命令的幂等用例 | 待验收：原生 4083c787 含 14 幂等重试且私有态保持；可选 Unit 含 duplicate funding/pay 不变证据；公开全指令幂等未整体验收 |
| 16 | 断线与重连恢复 | 断线后重连基于 `stateVersion` 恢复一致视图，可继续对局；恢复失败有明确错误 | 断线→重连→续玩端到端证据 | 已有局部证据：P8真实双TCP在支付窗口经session+room-event cursor8恢复，payment/35时钟/4chat一致并可继续支付；完整Duel所有阶段与故障侧未整体验收。见profile8-process-parent-recheck/PARENT-REVIEW.json |
| 17 | 重启恢复 | 进程重启后从持久化存储恢复房间/对局并一致续玩 | `RIFTBOUND_STORAGE_DIRECTORY` 下重启恢复流程日志 | 已有局部证据：P8真实不同PID重启、同FileRoomStore/schema8原日志不变、支付/聊天恢复后唯一续付入场，主控复跑0；不代表完整对局所有状态均恢复。见profile8-process-parent-recheck/PARENT-REVIEW.json |
| 18 | 回放 | 对局可被完整回放并复现终局，回放校验通过 | 回放文件 + 校验命令退出码 0 + 终局一致 | 已验收：真实原生房间 4083c787 完整 48 投递 / 34 独立命令由当前源码严格 fresh replay，逐步私密指纹/三方投影及双方终局一致（22 回合/B 8 分/stateVersion258）；主控复验 exit0，原完整日志字节未改；另 `17cecbea` schema4 双视角严格恢复通过。见 native48-ui-chat-current-replay/verification.json、native-layout-current/strict-replay/verification.json |
| 19 | 真实双客户端完整对局 | 两个真实客户端（双进程/双 GUI）完成一整局到胜负，非协议级模拟 | 双进程/双 GUI 对局录像 + 各自终端日志 + 完整对局回放 | 已验收（**限 legacy**）：两个真实独立 macOS 原生 `.app` 经完整 GUI 从构筑/房间/调度/资源/出牌/Move/Focus 至 22 回合 B 8 分胜负；截图、AX、GUI trace 与完整持久化命令日志已独立审计（34 独立/48 投递/14 重试）。**不覆盖 P8**：P8 最新真实双客户端证据为 `02803bb8` 至 Main3（16 commands/16 deliveries）与 wire 矩阵至 Main4，均非完整整局；不代表新 Spell 双 GUI 或全部官方能力 |
| 20 | 桌面包构建与安装运行 | 交付用的桌面包可构建、可安装、可启动并连上服务端完成对局 | 构建产物（含 hash）+ 安装与运行日志（在目标平台执行） | 已有局部证据：当前A4/B4 unsigned arm64应用均构建/启动成功，1280×800与1024×720真实17帧回放、展开/详情/两级Esc/计数已验；迭代2双GUI实时16命令证据保留。无Windows NSIS/目标平台安装运行。见replay-focus-parent-integration/NATIVE-ACCEPTANCE.json |
| 21 | 干净 checkout 复现 | 从干净 checkout 按文档安装依赖并跑通全部回归，无本地缓存依赖 | 干净目录下 `pnpm install --frozen-lockfile`、`build`、`typecheck`、`test` 退出码 0 日志 | 待完成（managed worktree 有既存脏改动；本任务快照**无 `.git`**；尚未完成当前源码的干净 Git checkout 复现。冷复制 cold copy **不是** Git clean） |
| 22 | 完整自动化回归 | 全量测试通过，覆盖引擎/服务端/客户端/集成/回放，无因缺数据被跳过的用例 | 全量测试报告（含用例数与逐项退出码）+ 无跳过说明 | 待重新验收：wave386冻结643份源码的单次全仓 **2929 passed / 0 skipped**，offline frozen install/冷typecheck/test/build均0，哈希前后相同；新卡牌交互及随后新增两项P9正式回归不在该轮总数内，集成后另验。 |
| 23 | 文档 | 面向交付的文档完整：规则版本（1.4/PDF hash）、运行步骤、复现命令、验收标准与边界（哪些仍 `judge-required`） | 文档清单 + 文档内命令可复现证据 | 待验收：本清单与接续记录已收敛；`desktop-user-guide.md` / `runtime-profiles.md` / `workspace-verification.md` 已读并作为证据；运行步骤/复现命令/`judge-required` 边界清单未整体签收 |

## 当前红线（验收时必须同时检查）

- **全部官方效果未完成**：catalog 1381 printings 下 persisted effect executable 仍 **0**；
  source 默认 65、显式 77 来源 IR ≠ 77 全部可执行。不得凭机制/定向测试推断完整官方效果。
- **整局 / 终局链闭包未完成**：有一局真实原生整局到 8 分，但它是 **legacy profile**，**不得**据此声明完整
  FinalPoint / 终局链闭包、全部官方规则、整局确定性或跨 profile 等价；**P8 尚无完整整局**。
- **Windows / clean checkout 未完成**：无 Windows NSIS、无 Windows 目标平台安装运行、无当前 clean Git 复现。
- **必须挂起源**：未知卡能力保持 `judge-required`/`blocked`，**不得近似实现**；`energy:null/power:null`
  保持“无 printed cost”，**不得改写为 0** 来代替 total cost。
- **ACK guard 不放宽**：原生选择窗口的状态推进已由 Core 版本化事件修复，
  **不得**改客户端 ACK guard 或用重连 / 假 DTO 绕过。
- **旧双 native 整局不自动替代新 profile**：`4083c787` legacy 完整整局**不构成** P8 整局；108 静态
  all-unknown 来源映射**不构成** TokenPlay 闭合；Hold/Recruit 完整 TokenPlay 缺 proof 保持 pending。
- **组件/包快照 ≠ 完整交付**：历史 Core814 / server562 / client763（及 Core771 / client760）与冻结源快照
  2878 均为组件/快照级证据，非 full-workspace 当前整轮 / 远程 CI / native / 完整对局证明；内部 kernel /
  facade 一律不得当验收项完成。
- **P8 现为显式 opt-in，默认未升级**：schema8 `optional-unit-physical-chain-v4` 已接线但**仅显式 opt-in**；
  CLI 默认 schema7、SDK 默认 schema4 不变，旧 1–7 日志不得升级，且 P8 尚无完整整局。P8 wire 矩阵的
  **第三视图是 project(null) journal 观察，不是第三个 TCP 连接**；原生 `02803bb8` 的 **A4/B4** 已验各自保存回放，另有新包25条实时命令至Main4，但仍不能称新包已完成整局。

## 历史快照（2026-10-14 及更早，仅作历史，不代表当前）

> 以下计数与“未接 / 无 public Main / Core434 / server251 / client335”等描述为当时快照；**不得**当作当前缺口判定。
> 部分当时标注“未接”的能力（公开 P4 / Room / V2、Combat、真实 public Main 路径）现已接入，见上文“当前状态”。

- **2026-10-14 更早包快照（仅历史）**：`engine-core` **771/771**、`desktop-client` **760/760（55 files）**、
  `game-server` **562/562（84 files）** 为更早一轮组件快照；上轮 full-workspace 整轮为 **2632 passed / 0 skipped（9 包）**。
  二者均**早于**本轮 Unit V4 / Spell chain-first 合入，**不得**与后续冻结 `597` 源快照的 `engine-core` 870 /
  `desktop-client` 769（全工作区 2878 / 0 skip）混用。
- **第十一次刷新快照（2026-10-13）**：`engine-core` 434/434、`protocol` 64/64、`card-dsl` 130/130、
  `desktop-client` 335/335（28 files）、`game-server` 251/251（29 files）；V2 能力落地但当时 room/server/store 零接入；
  效果 executable 0（`fullyBound 3 / partial 10 / unknown 1368`、registry `52 resolved / 1329 unknown`）。
- **第五次刷新快照（2026-10-12 深夜）**：Draw/Burn Out 推广当时整包 182；SharedBattlefields 布局 58、前端 198；
  服务地址恢复后前端 210/19 files；wave-53 已 cancelled、wave-59 begin-turn only、review 56 FR1–FR4。
- **更早计数**：`182 / 210 / 198 / 248 / 313 / 163 / 165 / 195` 等均为相应当时组件快照，非当前值。
- **更早边界描述**：“V2 未接”“无 public Main”“无 Combat”“无正式 Combat 内核”等为当时状态；
  当前公开 P4/Room/V2 已接、已有真实 WS/原生 Combat 有界证据（见“当前状态”与验收项 3/5/8）。

## 证据与命令

- 每项验收需附：命令、退出码、日志路径、产物 hash；缺失即视为**未验收**。
- 正确专用命令（full-product 单跑）：
  `pnpm --filter @riftbound/integration-tests exec vitest run --config test/full-product/vitest.config.ts`。
  不要用 `pnpm --filter @riftbound/integration-tests test -- test/full-product`（该写法并非
  专用命令，会落入默认 test 目标，不是正确命令）。
- 全量回归：`pnpm install --frozen-lockfile`、`pnpm build`、`pnpm typecheck`、`pnpm test`，
  以及双客户端对局与回放校验；最终整体验收数字由主控集成后填写。
- 组件/包命令示例：`pnpm --filter @riftbound/engine-core test`、`pnpm --filter @riftbound/game-server test`、
  `pnpm --filter @riftbound/desktop-client test`。

## 里程碑（仅实施顺序，不改完成标准）

1. 规则内核：开局 → 回合/符文 → Move/Location/Control/Contested/Showdown/战斗/
   Conquer/Hold/Final Point/胜负。
2. 数据与构筑：官方卡池 EffectIR 能力 + 完整 Constructed 校验。
3. 服务端：权威/隐私/幂等 → 断线与重启恢复 → 回放。
4. 客户端：真实双客户端完整对局（双进程/GUI）。
5. 交付：桌面包构建/安装/运行 → 干净 checkout → 全量回归 → 文档。
