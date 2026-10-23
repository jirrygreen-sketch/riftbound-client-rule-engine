# M1 beta 就绪重核（2026-10-23）

核验基线：`e886dc17`（本地 `integration`，已包含 RIFT-996）。核验范围只读产品代码与远端真实 WebSocket/V2 runner；生产代码未在本任务中修改。本文是 RIFT-899 九项缺口的当前重核和父级下一批任务输入。

## 结论

**未达到“两名真人用两个桌面窗口，以 Rumble SFD 对 Fiora SFD 自然打完一局”的 beta 放行条件。** 脚本、本地服务、catalog/preset 闸门、V2 独立会话、预组 UI、归因 ACK 等基础能力已经存在，但真人入口在当前 checkout 会加密重连循环，V2 面板没有完整暴露回合/伤害控制，固定种子双 WS 验收在 `e886dc17` 为 **0/6 自然终局**。这不是隐私泄漏或 catalogs 缺失，而是开局、目标牌/选择回执和 UI 动作面未形成闭合产品链。

### 当前实测摘要

| 证据 | 结果 |
| --- | --- |
| 一键脚本 Linux 真跑 | 服务端 `33680` health `ok`；Vite `33681`、`33682` 均返回 200，脚本可 `--status`/`--stop` |
| 两独立浏览器 | 首页可加载；V2 地址填 `ws://127.0.0.1:33680/ws` 后均显示已连接；客户端 A 可建房并写入本地 room/session |
| 建房后的 UI | 客户端进入“连接中”、显示 `Game events are not available before the game starts`；服务端持久化显示该 seat 已断开，页面反复重连 |
| `RIFT-955` 固定种子（六局） | **6/6 失败**：3 局目标/选择牌 ACK 超时，1 局 `Stupefy` 目的地连续拒绝，1 局 `Frigid Touch` ACK 超时，1 局 `Wages of Pain` ACK 超时；隐私审计均通过 |
| 预组 program registry | 51 个 canonical identity 中 47 `executable`、4 `no-ability`、0 missing；绑定可执行不等于 51 张卡**整卡 golden 已验收** |
| 目标投影代码 | RIFT-996 已出现服务端 `targetRequirements` 和客户端目标选择，但本轮 runner/UI 实测仍未进入稳定生产闭环 |
| 回放 | V2 会话没有接入本地 `liveReplay` 捕获；现有保存按钮依赖旧 `duelProjection`，strict V2 viewer 不在用户可操作路径 |

## 九项缺口逐项

### 1. 唯一公开生产 Duel profile — 未闭合

**现状。** V2 新建房固定 `engine-v2`（`apps/game-server/src/server.ts:690-703`），V2 独立会话先发 `2.0.0` hello 再建房（`apps/desktop-client/src/full-product/v2/V2MatchSession.ts:161-173,279-285`），因此“协议和运行时选择”本身已统一到 V2。问题在产品入口未闭合：建房后 `useV2Match` 以 `session/resumeToken` 为 effect 依赖重建控制器（`apps/desktop-client/src/hooks/useV2Match.ts:110-150`），恢复 hello 带 `afterEventSeq:0`（`V2MatchSession.ts:405-407`）；开局前 `sendEvents/validateResumeCursors` 对 `afterEventSeq` 返回 `Game events are not available before the game starts`（`apps/game-server/src/room.ts:928-946,1024-1046`），造成重连/重建循环。

**建议写域。** `apps/desktop-client/src/hooks/useV2Match.ts`、`apps/desktop-client/src/full-product/v2/V2MatchSession.ts`、`apps/game-server/src/room.ts`、`apps/desktop-client/tests/v2/useV2Match.test.ts`、`apps/game-server/tests/server/engine-v2-websocket.test.ts`。

**依赖/估算。** 无新协议字段也可先修：等待房恢复不请求 game event cursor；session 写入不得重建首次 socket。M（0.5–1 天，含两个真实浏览器回归）。

### 2. 共享可信 Rumble/Fiora 预组目录与建房选择 — 已闭合

**证据。** 两套预组来自 tracked `docs/plans/m1-decks.json`，经服务端 catalog 构造为 1/1/39/12/3（`apps/game-server/src/presets/catalog.ts:257-313`）；服务端 `/api/presets` 与 preset digest 白名单（`server.ts:237-250,897-905`）；客户端下拉仅列 `rumble-sfd`、`fiora-sfd`（`V2MatchBoard.tsx:234-246`）。脚本以 `RIFTBOUND_M1_PRESETS_ONLY=1` 启动，实测提交空牌组得到 `M1 beta rooms only accept ...`。两个全新浏览器可建房/显示预组控件；但第 1 项重连缺陷使“持续留在房间并完成准备”无法端到端验收。该项目录/身份边界已完成，真人入座链由第 1 项阻塞。

### 3. 51 张 M1 能力边界与自然局 gate — 未闭合

**现状。** 当前 registry 统计为 47 executable、4 no-ability、0 missing；历史 manifest `docs/plans/m1-two-precons-manifest.json:summaries` 仍记录 24 judge-required、47 unproven、0 fullyAccepted。manifest 是历史证据，不能覆盖当前 registry，也不能把 registry 状态等同于整卡验收。

`e886dc17` 六局固定种子为 0 winners：

- `RIFT-955-v2-02`、`08`：`Stupefy` 被生成带永久物 `destination` 的 `play`，服务端在 `runtime.ts:493-499` 拒绝，runner 以 `repeated command-rejected` 停止。
- `03`：`Wages of Pain` 的 play 等待 60 秒无 receipt。
- `07`：`Frigid Touch` 的 play 等待 60 秒无 receipt。
- `10`：`Stupefy` 的 play 等待 60 秒无 receipt。
- `11`：`Wages of Pain` 的 play 等待 60 秒无 receipt。

六局 privacy 均通过，但自然胜负为 0。原 `6/6` 报告在 `0bf2bd14` 与当前 `e886dc17` 不能互相替代。

**建议写域。** `packages/integration-tests/src/v2-duel/bot.ts`/`runner.ts`，以及 `apps/game-server/src/engine-runtime/runtime.ts` 与各具体卡/效果唯一 owner；不能把目标派生、超时重试或“选第一项”作为卡能力修复。

**依赖/估算。** 先修第 4 项 wire/runner 契约，再由卡 owner 分别处理 Wages of Pain、Frigid Touch、Stupefy 的证据与回执；之后重跑固定六局和 100 局自动自然终局 gate。L（至少 2–3 天，且按卡拆分）。

### 4. target、cost option、rune exhaust/recycle、pay-pending 与所有 pending choice 的 authority + UI — 部分完成

**已具备。** V2 command 支持 `play.targets`、`cost.optionId`、rune-energy/power、通用 choose（`packages/protocol/src/v2/commands.ts:46-143`）；服务端投影 owner-only choices、target requirements 与 zone-entry identity（`apps/game-server/src/engine-runtime/projection.ts:214-294`）；面板有五类 choice 控件和 target requirement 选择（`V2MatchBoard.tsx:308-323,378-412,446-455`）。

**未闭合。** 当前 runner/prod 路径产生 spell `destination`/targets 错配并导致 6/6 阻塞；显式 energy/power/xp/exhaust/recycle/hidden 费用组件仍在 `runtime.ts:502-506` fail-closed，没有完整外部 Pay Costs continuation；“rune power/recycle 的所有卡费用场景”未由真人 UI 验收。RIFT-996 的实作已存在，但本轮实测和固定种子门禁未绿，不能判闭合。

**建议写域。** `runtime.ts`、`engine-runtime/projection.ts`、`packages/integration-tests/src/v2-duel/{bot,runner}.ts`、`V2MatchBoard.tsx` 和对应 tests；共享 wire 改动由父级协调。M/L（1–2 天）。

### 5. 真实 M1 移动、Showdown/Focus、战斗与 Conquer/Hold/Score — 部分完成

**现状。** 服务端已有 move、advance、combat-damage（`runtime.ts:474-485,543-554,604-655`），投影有 battlefield/combat/priority/focus（`projection.ts:297-339`）。真实旧一轮种子曾完成 move/attack 与 8 分胜负。当前 `e886dc17` 六局没有自然终局，coverage 的 `combat-damage`/`advance`/`rune-power` 均为 0。

**UI 缺口。** `V2MatchBoard.tsx:333-355` 有“宣告攻击/防守”按钮，但服务端现明确拒绝这两个命令并说明 CR 466.2.c 自动分配所有在场单位（`runtime.ts:555-557`）；面板没有显式 `end-turn`、`advance` 或 `combat-damage` 命令构造/按钮，只显示战斗和 Focus 文本（`V2MatchBoard.tsx:434-458` 的链区显示位于同名代码末段）。因此当前 UI 无法驱动默认服务端要求的伤害分配/推进步骤。

**建议写域。** `apps/desktop-client/src/full-product/v2/V2MatchBoard.tsx`、`apps/desktop-client/tests/V2PlayableActions.test.tsx`、game-server/engine-core 的唯一战斗 owner。

**依赖/估算。** 先以 `actionOptions.canEndTurn/canAdvance` 和 `combat.damage.expectedPlayerId` 驱动 UI；移除与当前自动交战规则相冲突的“宣告攻击/防守”误导控件。L（1–2 天 + 规则 owner 联调）。

### 6. 显式、可审计的回合开始/结束与阶段推进 — 部分完成

**现状。** 协议已有 `end-turn`/`advance`（`commands.ts:108-125`），服务端真实调用 TurnFlow（`runtime.ts:539-552`），runner 会发 `end-turn`（`packages/integration-tests/src/v2-duel/bot.ts:115-125,205-207`）并在旧六局记录成功。桌面 V2 面板 **没有** 将这两个命令暴露给真人；也没有 Lobby 的 prep/mulligan UI 与服务端实际开始状态的完整对齐。**Prepared start now skips mulligans:** `room.ts:230-316` 的 `engineRuntimeOptions()` 不传 `mulligans`，`createMatch` 按空调度开始；`V2MatchBoard.tsx:318` 的“确认起手”仍是残留按钮，服务端 `runtime.ts:472` 明确拒绝对局开始后的 mulligan。

**建议写域。** `V2MatchBoard.tsx`、`useV2Match.ts`、game-server room/turn owner、shared protocol tests。M/L（0.5–1.5 天）。

### 7. 选定 profile 的完整回放与 strict journal reconstruction — 未闭合

**现状。** 服务端在 `FileRoomStore` 中保留 V2 engine journal（`room.ts` 的 archive/journal export 与 `currentJournalRevision`）；但这不等于用户能回放。桌面 replay capture 只接收旧 `duelProjection` 且要求旧 `roomId`（`apps/desktop-client/src/app/useAppState.ts:143-167`），300 帧上限（同处 153-155）；V2 `v2Match.state.events` 不进入该 ref，V2 UI 也没有保存入口。权威 replay 的路由/UI 未闭合。

**建议写域。** `apps/desktop-client/src/app/useAppState.ts`、`apps/desktop-client/src/replays/*`、`apps/game-server` read-only replay route（若契约需新增由父级决定）、`packages/replay-core` V2 tests。M/L（1–2 天）。

### 8. 两个真实客户端的隐私、ACK、重连、重复命令、自然胜负与回放 — 部分完成

**已有证据。** 公共 WS/room tests 验证私有投影、resume、duplicate receipt 和 server restart recovery；本轮固定种子六局的 privacy checks 全部通过。RIFT-996 给异常补 request/command correlation。

**失败证据。** 当前两浏览器建房流程触发 session effect→恢复 hello→非法 waiting-room event cursor 的重连循环；六局固定种子 0 winners；V2 UI 没有 strict replay。三次选择/出牌类 ACK 在 60 秒后超时，说明服务器 receipt 仍不是所有生产命令的闭环。故 hold 住通过结论。

**建议写域。** `packages/integration-tests/src/v2-duel`、desktop V2 session/hook、game-server server/engine-runtime hook；父级跑真实双窗口 E2E 与隐私/重连/坏 ACK 回归。M/L（1–2 天）。

### 9. Mac 本地数据 bootstrap、端口、Tauri/浏览器双窗与故障提示 — 已完成（脚本/指南层）

**证据。** `scripts/beta/check-m1-beta.mjs` 检查 Node/pnpm、git integration 落后、catalog schema、M1 plans、storage 可写和端口；`scripts/beta/start-m1-beta.sh` 在缺失 catalog 时停止并给出 `pnpm cards:sync`，构建/启动/状态/停止均围绕本脚本记录的 PID；Linux 实际运行 server+两 Vite 成功并打印两个 URL/端口。指南明确使用独立存储上下文、Mac Tauri 需 Rust 1.90、日志收集与已知限制。

**限制。** 没有 Apple Silicon 硬件，Tauri 原生窗口未在本机启动；Mac 步骤依据 `apps/desktop-client/src-tauri/tauri.conf.json` 与 `rust-toolchain.toml` 记录。脚本的管理仅覆盖自己启动的三个 PID；不识别或终止其他任务。

## 父级下一批必须完成（按依赖）

1. **[P0，desktop/server] 修复 V2 waiting-room resume loop。** 在 `useV2Match`/`V2MatchSession` 保证 session 落盘不重建当前 socket；恢复 hello 在未开局时不发送 game event cursor，或房间返回合法的“尚未开始”恢复状态。验收：两次真实浏览器建房、刷新、入房、预组、准备，且无重连。
2. **[P0，integration/server] 修复 spell play 的 destination/target contract。** 不发送 `destination`；修正 runner 与 UI 使用当前 `actionOptions` 的目标/目的地语义；复现 `Stupefy` 的拒绝和 `Wages of Pain`/`Frigid Touch` 的无回执。验收：带目标 M1 卡真实 WS 结算、非法目标零副作用、每次命令有相关 receipt。
3. **[P1，desktop V2] 暴露回合/军衔/战斗的控制。** 由 `canEndTurn`、`canAdvance`、`combat.damage.expectedPlayerId`/`combatId` 生成按钮与金额选择；禁止提示会固定拒绝的 declare-attack/defense；验收 UI 能真实完成 Showdown、Focus、damage 分配、end-turn。
4. **[P1，room/engine] 取消伪 mulligan UI 或接入真实 mulligan service。** 在 `room.ts` 的 engine runtime options 传受信 mulligan 输入，或从 beta UI 移除按钮并写清准备即开局；验收每侧的预组/开局/起手与规则时间线。
5. **[P1，cards] 对 `Wages of Pain`、`Frigid Touch`、`Stupefy` 逐卡交还原唯一卡 owner。** 保留 fail-closed、补真实生产路径测试，不由本任务改 card-dsl。验收目标/费用/结算与 ACK。
6. **[P1，integration/UI] 重跑六固定种子，要求 6/6 自然 winners；再跑 100 局自然局 gate。** 同时记录 privacy、重复命令、reconnect、replay digest；不通过不得放行 beta。
7. **[P2，desktop/replay] V2 本地/权威回放。** 为 V2 投影接捕获或只读 server journal route；两人各自结束局后可查看，旧日志 read-only。
8. **[P2，data/ops] 在 Apple Silicon 真机跑脚本，确认 Tauri 1.90、两个独立窗口、catalog 同步和缺图提示。** Linux 已有脚本实证但不替代 Mac GUI 验证。

## 契约变更请求

当前没有**必需**的协议 shape 变更可用于先修复 P0：V2 已有 `end-turn`、`advance`、`combat-damage`、target requirements 和 rune 命令；本任务的失败来自客户端 effect/恢复时机、runner 对 actionOptions 的使用、以及服务端未返回的某些 play/choice receipt。

若父级决定把 V2 作为唯一生产 profile 并提供完整费用支付，则建议后续单独评审：

- `packages/protocol/src/v2/commands.ts` 的显式 finalized-cost/payment continuation 是否需要更明确的状态查询/回执；
- `V2MatchBoard` 是否需要基于 `actionOptions` 的显式 `end-turn`/`advance`/combat-damage 控件与规则 owner 的契约（目前 command 已存在，UI 没有使用）；
- waiting-room resume 是否应有独立的 room-only cursor，不从 `afterEventSeq=0` 推断 game started。

这些请求不构成本任务对产品代码的修改；如果父级要求改变 wire shape，由 protocol/父级 owner 统一处理。

## 证据文件

- `/tmp/RIFT-991-m1-beta-readiness/integration-v2-fixed-seeds-e886.log`：`e886dc17` 六局固定种子 6 failed。
- `/tmp/RIFT-991-m1-beta-readiness/v2-duel/*.ndjson`：每局 termination、blockedReason、coverage、privacy、trace。
- `/tmp/RIFT-991-m1-beta-readiness/start-script-runtime4.log`：服务端+dou 客户端启动、健康打印。
- `/tmp/RIFT-991-m1-beta-readiness/cdp-ui-smoke3.log`：两个 CDP 浏览器加载、连接、建房和本地 session 证据。
- `/tmp/RIFT-991-m1-beta-readiness/beta-runtime4/rooms/**/archive.log`：真实房间 archive（含断开/无 game state；仅供维护者）。
