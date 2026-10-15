> 2026-10-14 当前状态以 [接续记录](resume-20261014.md) 与 [验收清单](delivery-goal.md) 置顶说明为准：真实双 native 第 22 回合/B 8 分及 48 投递 strict fresh replay 已验收；完整 23 项 goal 仍 active。下方第十一次及更早快照为历史；不得把历史“public Main 未接”当作当前状态。可选额外费用须按 CR 355.1.a/356.2.b.1/356.4.f.1 显式选择并保留零费用条件效果，生产接线与官方卡验收待完成。

> 下述 2026-10-13 刷新与计数属于历史快照；当前状态以上方接续记录为准。
>
> 2026-10-13 08:07 最新验收：资源计数器、来源入口及权威费用摘要已做实际浏览器复核，交互样例在 `http://127.0.0.1:5207`。三个窗口尺寸无横向溢出，资源区不再被内部滚动裁剪，两个战场保持可读高度；金币和支付按钮各单次派发原命令。样例的“支付后余额”是投影夹具，不能视为真实双端支付。
>
> 165 已修 Recruit 本源特征、席位与出生/退役历史顺序，56 次局部回归通过；168 已修支付后的私有回合游标续接、准确 pending 重入和同阶段新增来源结算，独立集中复核 179 与组合验证 178 仍在运行。169 新阶段查询已由 177 严格包级验证，107 次测试通过，但仅 awaken/begin/hold 可形成已支持阶段证明，其他九种阶段保持 unknown。
>
> （08:07 时点）核心写域：170 完整来源/效果队列边界模块、180 V2 私有归档和恢复准入。真实 public Main、全卡能力、双端完整对局、桌面及 Windows 交付仍未完成，整体目标保持 active。

# Full-Product 当前进度与本轮优先级

Last reviewed: 2026-10-13（第十一次刷新；快照基线 `8d3929d`，worktree HEAD 仍为 `8d3929d`，worktree 有未提交改动，无 commit / push）

> 本轮所有测试数字均为**组件/包快照**，不是 full-workspace / 远程 CI / native 证明。旧 b608 macOS 二进制内嵌的是**旧 front**，不是本次 desktop UI 验证。

开发在**隔离 worktree** 进行；原 checkout `codex/full-product` 保持干净，本轮无
commit / push。

本文件是本轮 full-product 工作的**当前状态快照**，用于替代仓库中已经过时的
“暂停 / 未提交 / 测试被删 / 构建失败”等描述。本轮已有**部分可核验的实测证据**
（见第一节之二至之五），据此可对**单项**标注 `已验收`；未取得本轮证据的条目仍标
`实施中 / 待验收`。本文不预填未经运行的结果。整体交付验收由主控在集成后统一确认。

第十一次刷新要点（2026-10-13；相对第十次只做**事实增量覆盖**，旧数字以当前观察替换。
**本节为最新置顶**；第五次及以后各次刷新要点按时间列于下方，作历史保留）：

- **当前组件/包快照（取代第九/十次旧值）**：`pnpm --filter @riftbound/engine-core test`
  **434/434**（`v2-catalog-card-type-role-fix/engine-full.tap`；推移链 425 → 430 `projection-v2.ts` → 434 card-type/role 修）、
  `pnpm --filter @riftbound/protocol test` **64/64**（`protocol-v2-compatibility-fix`）、
  `pnpm --filter @riftbound/card-dsl test` **130/130**（**主控已复验**；原 91）、
  `pnpm --filter @riftbound/desktop-client test` **335/335（28 files）**（原 313 / 294）、
  `pnpm --filter @riftbound/game-server test` **251（29 files）**（**主控实测**；支撑 artifact 由主控补落，
  本轮最接近的 server 侧局部证据为 focused `25/25`）。**旧 248 / 47 / 91 / 313 / 213 均为此轮之前的组件快照，不再是当前值**。
- **V2 能力已落地但 room 零接入**：`packages/protocol` 双向支持 V2（`DUEL_PROJECTION_SCHEMA_V2='riftbound-duel-v2'`、
  `DuelProjectionAny`/`isDuelProjectionV2`）；`packages/engine-core/src/duel/projection-v2.ts`（`projectCanonicalDuelMatchV2`）；
  `apps/game-server/src/duel/runtime-v2.ts`（V2 facade：`createDuelRuntimeSessionV2`/`projectDuelRuntimeV2`/`executeDuelRuntimeCommandV2`
  + turn 转发，自含测试 `apps/game-server/tests/duel/runtime-v2.test.ts` 9/9）。**但 `room.ts`/`server.ts`/`file-room-store.ts`/`room-store.ts`
  对 V2 符号零命中**，公开 room 仍构造 V1 `DuelCommandSession`。
- **仍缺（不得因能力落地标高完成度）**：**生产 phase provider（registry/index + service）**——`runDuelStartOfTurnV2` 缺 `sources`
  即 `pending`，真实 turn-start 仍停 pending；**V2 archive codec**——`session-archive.ts` 仍 V1 schema1，durable V2 restore 是真正断点
  （`"unadmitted V2 session; JSON is not restore"`）；**公开 CardPlay/Move/Combat 命令**——wire 仍 5 条、无对应执行器；
  `phase-source-closure-v2.ts` 仍未从 barrel 导出（孤儿模块）；**public Main / fullmatch** 仍缺。
- **资源折叠小块已实现并独立审查**：compact `ResourcePoolPanel` 折叠态为真实小块（1280×720 实测 resourcePool 512×34）、
  无隐藏大空白、权威语义无退化；但只读提示/chip/支付/来源/计数/留存**全部在 `<details>` 内**，
  `DuelMatchBoard.tsx` **生产永不传 `counterActions`**；审查 findings **F1–F8 均低危、无阻断项**（`resource-small-block-review/findings.md`）。
- **bundle 名（当前可核值）**：桌面 fresh dist = `index-jtpbai2r.js`（419659 B, sha256 `5540cd1e…`）/
  `index-KqGUXhFw.css`（56669 B, sha256 `b55f3579…`），`2026-10-13 13:20:09` 构建、晚于 `src/` 最新 mtime（12:53:53）。
  旧 `index-ByPJLsZc.js` / `index-mKmMabGy.js` / `index-Bx6ry0KG.js` / `index-3Ow5BSsp.js` / `index-Dn_nryXp.css` /
  `index-FccGea0j.js` / `index-vCEFtKWK.js` **均已过时**；`bundle.targets=["nsis"]` 仍 Windows-only。
- **整体目标仍 active / 不 complete**：无 production source registry、无 public Main/fullmatch、效果可执行数仍 **0**；
  provider / archive / cardplay / combat、真实双端完整对局、当前原生 / Tauri / Windows 包、clean-checkout 全 CI **均未完成**。

第十次刷新要点（2026-10-13；相对第九次只做**事实增量覆盖**，旧数字以当前观察替换。
**本节为最新置顶；第五次及以后各次刷新要点按时间列于下方，作历史保留**）：

- **最关键用户可见缺口（不变）**：真实 public 对局仍停在
  `setup → 双方 mulligan → awaiting-turn-start`，**没有任何公有“开始回合/进 Main”命令**；
  `apps/game-server/src/duel/runtime.ts` 在 `awaiting-turn-start|ended` **直接返回空动作**，
  而 turn-start 需要受信 provider（draw/channel/CostResolver/source attestation），当前**一律 pending**。
  故**真实 Main 资源支付、连续支付、任意 `+/-` 均未接**。证据：
  `task-artifacts/resource-pool-product-gap-evidence/report.md`（166）。
- **用户资源行为设计（已定，尚未在正式房间生效）**：能量为**独立计数**、符能显示**合计 + 六域 + 任意**；
  三条“获取资源”来源动作——横置基本符文 **+1 Energy**、回收基本符文 **+1 精确单域 Power**、
  横置并消灭金币 **+1 任意 Power**；**先入本回合池，支付只扣所选 plan、余额保留**；
  **Main 开始与 Ending 依 CR 清双方池**（面板文案「余额在本回合保留，回合结束时清空」/
  「主阶段开始时同样清空资源池」）。原型 `duel-tabletop` 的 `+/-`/空造余额**只是沙盒**，
  权威对局客户端**不得自造**（`GameClient.submitDuelCommand` 强校验 + `DuelMatchBoard` 二次 gate）。
- **131 / 141 已 terminal，不再是“仍在写”**：160 对冻结 130→131-141 实测 engine-core 全量
  **346/346**、protocol **57/57**、strict `--noEmit` + compile 全 exit 0，84/84 冻结 hash 相符，
  首次失败仅**文件级**缺 `card-data` fixture（未改任何 test/assert）。**计数是 executions 不是唯一场景**：
  phase-source-authority 7 例被 turn test import **重复注册**。**仍无 production source registry、无 public Main/fullmatch**。
- **158 独立审（131 token，complex-engine）**：原 35（11 token + 14 S1a + 10 V2）与独立
  **27 framework probes** 全部执行 PASS，但 **#17–22 等是“证明不安全接受”的 PASS，不是机制正确**；
  P1（restore ready 改写可造资源 #20、Recruit 本源不变式 #21/#22）、P2（history 结构非独立认证 #17/#18/#19）
  为 findings，**已派 165 修**。**不得据此签收 token 恢复或整体 release**。
- **164 Gold 命令 + continuation 去重（局部验收）**：自有 build Gold **15/15**、continuation **13/13**、
  combined regression **83/83**；**15 = 8 distinct（7 import 重复）、13 = 6 distinct（7 import 重复）**；
  pre-159 negative control 11 pass/2 fail（恰为 completed-continuation 重用两例）证明 guard 承载而非空转；
  **137 的 `continuationId` 重用 P1 在此 slice 关闭**（159 两处编辑保留，source sha `f3b0f3b9…`）。
  **factory/oracle 是内部 fixture；real sourceIR 与 public Main 未接**。
- **163 replay-core 正式产物**：正式 build + typecheck exit 0，`file-event-store.js` → `802fc017…`，
  与 151/155 私有产物**逐字节一致**；正式 replay 套件 **77/77**；12 发布文件与 151/155 `cmp` 相同。
  **当前 8795 仍 144 旧 cached imports，非新正式 runtime**。
- **162 只读取证 / 166 资源产品缺口取证**：162 只做 CR/卡面 zone 关键词机械命中，**不赋 keyword 能力、不算 IR**
  （binding 仍 **52 resolved / 1329 unknown / 1381**，**自动执行 0**）；166 确认正式资源 UI 计数存在，
  但来源动作被 `awaiting-turn-start` 阻断、任意 `+/-` 未接。
- **161 独立审已收尾（findings 已采纳，非机制通过）**：P03/P16 的支付实际 `applied`，真实能量已扣除；
  随后 Ending 因私有游标绑定丢失而拒绝。P13 复现 `runStart` 绕过待处理任务；P11 复现同阶段新增来源 handler 漏结算。
  原 29 次测试执行通过，独立三组分别 11/12、2/3、1/2，三项业务红测保留。对应修复为 168；全来源与队列证明仍待 169/170。
- **167 资源界面局部改动已通过代码检查**：获取按钮、余额保留提示、唯一权威费用摘要直接可见；55/55 focused 测试、typecheck 和自有 build 通过。
  实际浏览器布局待 172 样例验收，真实 public Main 未接。
- **在途待验（不得当 pass）**：165（token 不变式修，pid 72216,
  gpt-6-sol xhigh）、168（payment/cursor 重入修，pid 72805，gpt-6-sol xhigh）、
  169（DSL phase/event scope，pid 73230，gpt-6-sol xhigh）、170（phase-source 完整性模块，pid 73767，gpt-6-sol xhigh）。
  **源码在其独占写域内，均未验收。**
- **整体目标仍 active / 不 complete**：剩余 **provider / source closure / 全卡能力 / V2 公共协议 /
  replay durable / Main / payment 双 GUI / native Windows** 均未完成。

第五次刷新要点（相对第四次：`docs` 只做**事实增量覆盖**，旧数字以当前观察替换）：

- **Draw / Burn Out（原 43 checkpoint）已正式推广进 src**：
  `packages/engine-core/src/duel/draw-burnout.ts` 经 `./duel` 出口导出，
  root 已核对 staged→formal **仅 import 差异**（输入 12，旧 summary 记 9 为陈旧）；
  `duel-draw-burnout` **12 compiled cases**、整包 `pnpm --filter @riftbound/engine-core test`
  **182**、`typecheck` exit 0。**这是一份最新已验证的 Draw 推广 snapshot，不是当前仍在
  统一中的核心源码的“最新全包证明”。**
- **SharedBattlefields 桌布布局（58）**：上对手基地 / 中央两 field / 下自己基地，
  viewer 切换 / 乱序 / spectator **+3**，原 13 例保留，该时点整个 frontend **198**；
  **但 App 仍未接此正式 Duel 组件**。
- **服务地址恢复修复（`connection-address-restoration-fix`）**：新增只读
  `activeServerUrl` getter/hook/App/Panel 初值 + 未编辑后台同步；本 worktree 实测前端
  **210 tests / 19 files + typecheck 0 + build 0**，fresh dist `index-Bx6ry0KG.js`
  （原 198 保留，新增 12）。此前的“**no GUI / no pnpm build**”陈述据此**作废**。
- **真实 GUI（root 本轮）**：`outputs/coordination/full-product-20261012/gui-room-proof/`
  的 `verification.json` **13 checks**（卡组编辑 / 非法 deck / 合法 submit /
  missing version / drop ACK timeout / disconnect+resume / captured switch / 两 client
  room / other broadcast 不能假确认 / 临时 WS probe 清理）；追加
  `service-address-verification.json` **5 checks** + JPG（旧显示 8787、full reload 实连
  URL 8793/ws、手输 9000 不被房间同步覆盖、恢复 8793 且 A 已确认 submit）。**均为
  Foundation room 的真实 room/deck GUI，不是 officialDuel、不是完整对局**；
  owner-deck confirmation reload gap 仍在，HTTP catalog URL reload 回 8787 属后续配置
  保留 gap，**不推断服务端已修**。
- **核心进展边界**：原 **turn 53 已 cancelled**（实际 runner/worker absent；46min 只有
  copies、无执行器 source），新 **59 拆 begin-turn only + CombatDamage**；**不得记 53
  running/succeeded**。stage **43/48/49** producer 原 closure，**review 56** 出
  `integration-contract.md` + `evidence.json`：FR1（429.3 required-cost 无 ordinary
  Priority）/ FR2（nullable Champion）/ FR3（单一 stateVersion/eventSeq）/ FR4（Draw
  retry identity）等；**wave 60 正在 formal 统一、仍未验收**。**public Duel / 真实 1v1 /
  完整 abilities 仍缺**；source `0 / 1381 / 33 no-ability` 界限不改。当前 root 仍有
  **3 个核心（turnStart / CombatDamage / canonicalIntegration）与 review 56 收尾，仅待
  验收，不当完成**。
- 卡数据 / construct-policy / Karma / backends **168** / DSL **45** 等已验事实保留，
  不为文档复测。**整体目标仍不 complete。**

第六次刷新要点（2026-10-13；相对第五次只做**事实增量覆盖**，旧数字以当前观察替换）：

- **83 Start-through-Main / 88 Ending-Expiration 正式推广进 `packages/engine-core/src/duel/`**：
  `turn-flow.ts` / `turn-start.ts` / `ending.ts` 经 duel barrel 导出；`duel-turn-flow` 8、
  `duel-turn-start` 7、`duel-ending` **12** 全通过。`duel-turn-core-formal-build-verification`
  （97）对**正式 dist** 跑核心套件 `node --test test/*.test.mjs test/full-product/*.test.mjs`
  → **245 tests / 245 pass / 0 fail**，engine-core `build` exit 0、strict `typecheck --noEmit`
  exit 0；dist 新增 `duel/turn-flow.js`、`duel/ending.js`，barrel 84 导出 + core barrel 11 导出
  smoke 通过。**245 = 前序核心快照 225（含 turn-start 7）+ turn-flow 8 + ending 12**。
- **game-server 生产构建 + 全套件 213**：`duel-room-archive-integration-fix`（92）只改
  `apps/game-server/src/room.ts` 3 处——(a) private duel archive helper 改从本仓
  `./duel/session-archive.js` 导入（原错从 `@riftbound/engine-core/duel` 导入，运行期
  `TypeError`）；(b) legacy 空 archive 兼容 0-seat（**Duel 分支仍要求 1..2 座 + 全部原有
  fail-closed 校验**，未放宽 duel 要求）。focused 4 files / 27 pass，**full server 25 files /
  213 pass / 0 fail**（原 14 failed/199），strict `typecheck` exit 0。`duel-server-production-build`
  （93）正式 `protocol build` + `game-server tsc` exit 0（`apps/game-server/dist` 20 个 js）。
- **protocol 全包 47/47 + typecheck 0**：`duel-protocol-evidence-doc-count-fix` 一次
  `pnpm --filter @riftbound/protocol test`（含 build）**47 pass / 0 fail**、strict
  `tsc --noEmit` exit 0；47 = action-options 6 + duel-contract 24 + duel-room-ruleset 2 +
  full-product-contract 7 + protocol 8。用例**纯包 fixture**（仅 import 本包 `../dist` 与
  `node:*`，**不依赖 engine-core/dist**），两次 build dist 6 文件 sha256 一致。旧 21 为早期 snapshot。
- **desktop-client build + 全套件 294/25**：`duel-local-card-images-build`（96）把 Duel
  `resolveCard` 改为**本地 `/api/card-images/<printingId>` 优先、远端 catalog 兜底**（仅显示层，
  不改 authority/protocol），正式 build exit 0 → 新 dist `index-FccGea0j.js`（412766 B）/
  `index-Dn_nryXp.css`（54721 B）。96 初跑全量 **293/294（1 fail）** 是
  `DuelAppRoute.test.tsx:68` 仍断言旧远端 CDN 的**过时 SSR 期望**（**非遗留源码 regression**）；
  `duel-local-image-route-test-fix`（97）就地修正该 1 行 expect（并加 `not.toContain` 反向断言）后
  **full frontend 25 files / 294 pass / 0 fail**、`typecheck --noEmit` exit 0。
- **真实 App（非 harness）GUI 证据（Root，`gui-room-proof/`）**：
  `actual-duel-05715086-verification.json`（真实 Duel room `05715086`，两个独立浏览器客户端
  `:4173`/`:4174` 对 compiled server `:8794`，ruleset `riftbound-duel`）——创建/加入、两卡组
  提交+准备门禁、**两块相同共享战场（上对手/下自己）**、先行动 B 调度 2 张后 A 调度 0 张、
  各自 4 张可见手牌且对手只有数量、**compiled server graceful stop/start 后双端重连**；
  重启前后**可见手牌顺序/战场/阶段/0 余额一致**。**此为 setup→双方 mulligan→`awaiting-turn-start`
  面，不含 Main / 资源支付 / 完整对局。**
- `actual-duel-layout-3-viewports.json`：**真正 App**（非 harness）在 1440×900 / 1280×720 /
  1920×1080 三档均 pagefit（`scrollH == h`）、手牌与计数器可见、**10 张本地图片**
  （`:8794/api/card-images/*`）全部 loaded。`actual-duel-metadata-rulemode-verification.json`：
  编辑器地址仍 8787（无连接），Duel 卡图/中文名走 `:8794`、fresh reload 后仍加载、加载态显示
  `1v1 对局（开发预览）` 为当前模式（Foundation/Synthetic 按钮禁用）、偏好保留。
- **93 private-room 边界独立审查（security-permissions）**：`duel-private-room-boundary-review/
  review.md` **PASS（8 tests / 2 files，exit 0）**，但**严格限定于当前已接入的
  `setup → 双方 mulligan → awaiting-turn-start` 公共 Duel 面**；未发现未认证/旧 socket/异座位
  经公开 `/ws` 取得对方手牌/私有 payment source、重放历史成功命令、或保存失败前收成功 ACK 的
  可达路径。**不为尚未接入的 full turn / CardPlay / effect IR / 私有 source 恢复 / GUI / native 背书。**
- **97 集中式复杂引擎复审（`duel-turn-flow-ending-independent-review`，complex-engine）**：
  本轮刷新点其产物 `review.md`（2026-10-13）结论为**跨回合链路 FAIL**——`runDuelEndOfTurn`
  在存在非 `undefined` `endingProgress` 时恒返回 `task-conflict`，首回合 terminal cursor 未在
  次回合清除，致第二回合合法 End 被拒、无法正常进入第三回合（六组 probe 本身 6 PASS/0 FAIL，
  其中 P2 断言确认该实际失败）。**故 83/88 仍不得标 PASS / 完成**；修复 scope 交主控重定。
- **资源交互（组件/内核级已验）**：能量为**独立计数**、符能（Power）显示**合计 + 六域 + 任意**
  明细；Rune tap → +1 Energy、Recycle（含横置）→ 对应 Power、Gold tap（Kill）→ +1 Any Power；
  **先入本回合池**，payment **只扣所选 plan**、余额保留；**Main 开始与 Ending 依 CR 清双方池**。
  内核侧（`src/duel/resources.ts` + 独立 DFS oracle 1161 cases 0 mismatch）与 UI 组件（27 例，
  `duel-projection-match-board`：DuelMatchBoard 8 + ResourcePoolPanel 18 + SSR 1）已验证。
  **但真实 publicRoom 仍未进 Main、未生成 tokens、无 pending cost**，故**不得**声称已双端实际支付；
  亦**不**以过时 `proxySource` fixtures 充当 acceptance。
- **整体仍不 complete**：canonical Legend/Gear/ownership/attachments authority、trusted production
  readiness/effect IR/CostResolver 与 source attestation、private 83/88 cursor 的 archive
  注册/恢复、真实 CardPlay/Move/Combat/EndTurn 公开命令与完整 gameEvents replay、真实 full match /
  双 Tauri / 当前 native / Windows NSIS / clean-checkout 全 CI —— **均未完成**（详见一之七、第四节、
  第七之二）。

第七次刷新要点（2026-10-13；相对第六次只做**事实增量覆盖**，旧数字以当前观察替换）：

- **97 跨回合 FAIL 已是历史（99 修复 → 103 复核）**：第六次记录的 97 结论
  （`runDuelEndOfTurn` 恒返回 `task-conflict`、第二回合合法 End 被拒）属**当时代码**的历史 FAIL；
  `duel-ending-cross-turn-cursor-fix`（99）在 `ending.ts` 新增严格 `parsedCursor`/私有
  `priorEndingTurns` sidecar，只在上一回合真实 terminal + 当前真实 Main 就绪时创建新 Ending cursor，
  旧 task ID 只返回 `duplicate`、不重放 provider/RNG/资源。**旧 core 245 与 97 FAIL 均不再作当前状态引用。**
- **103 正式核心套件实测 248/248（取代 245）**：`duel-cross-turn-formal-verification` 对**正式 dist** 跑
  `node --test --test-reporter=tap test/*.test.mjs test/full-product/*.test.mjs` → **actual 248 / 248 pass / 0 fail**
  （`raw core-full-tests.tap`、`core-full-tests.summary.txt`），engine-core `build` exit 0、strict
  `typecheck --noEmit` exit 0；source-hash pre==post（仅 4 行 header 差异）、build 幂等、dist 仅
  `.tsbuildinfo` + `duel/ending.{js,d.ts}` 变化（`dist-hash.diff`）。**245 为该时点旧快照、248 为当前观察**
  （跨回合 trio：`duel-ending` 15 + `duel-turn-flow` 8 + `duel-turn-start` 7 = 30）。
- **103 定点独立复核 4 PASS（真实构造器跨回合）**：`duel-cross-turn-targeted-independent-review/report.md`
  （`raw.jsonl` 机读 `passed:4, failed:0`）——A 真构造器链路
  `createDuelMatch`→双方 mulligan→Main1→**End1→Start2→End2→Start3→End3→Start4** 全 `awaiting-turn-start`、新 Main 真实进入；
  首玩家 Start1 Channel=2、**次玩家 Start2 首 Channel=3**、Start3=2、Start4=2，累计 Base rune 3→5，
  `firstChannelProcessedPlayerIDs=[bob]` 保留；三个 Ending 双方 Energy 与全部 Power pool **均清空**、双 clock 成对一致；
  B 旧未完成/未知 task ID `wrong-task`、新 Ending pending 不消费、已消费 ID（turn 1/2/3）**latest `duplicate`** 且不重放；
  C 16 项篡改原子拒绝（`invalid-session`）；D 缺 provider 仍 `pending`。**PASS 严格限定为已修复的
  fixture-certified-no-effect 普通 Duel 4 回合链路**：**不**等于生产 IR/provider 完整，也**不**背书
  extra/queued turn、card IR、完整 FEPR、生产 source/服务端恢复或 GUI 集成。
- **组件快照 47 protocol / 213 server / 294 front 均为过去已验收的组件/包快照，不是当前 Source**：
  `packages/protocol` 正在做 **102 owner-deck-confirmation（新私人 owner 消息）** 源改动
  （`packages/protocol/src/{owner-deck-confirmation.ts,index.ts}`、`apps/game-server/src/room.ts`、
  `apps/desktop-client/src/{net/GameClient.ts,decks/owner-deck-confirmation.ts}` 等），**102 未完成**，
  故 47/213/294 不代表当前工作区源码状态。
- **98 V2 设计与 Root decisions 是设计、非实现**：`duel-permanent-canonical-contract/contract.md`
  （`physicalCardsByUID` / `legendStates` / `gears` / `retiredPhysicalUIDs` 最小共享契约）与
  `contracts/permanent-v2-root-decisions.md`（Root 对 CR124 全域、可信 journal 创建证明、未知 BF readiness override 的决定）
  均标注 **design not implemented**；**106** `duel-permanent-authority-module`
  （`packages/engine-core/src/duel/permanent-state.ts`）为**正在开发的新 authority 模块**，**不是 V2 已切换**
  （目标文件与 artifact 尚未落盘）。
- **104 legacy prompt authority 修复 与 105 creation journal 迁移证据 均未签收**：104
  `legacy-prompt-authority-repair`（engine-core `index.ts`/`state.ts` + legacy-prompt-authority test）依据 101
  `legacy-prompt-authority-repair-evidence/report.md` 的残留可达性（全失效目标 → public `prompt=null` 而 authority 仍
  pending）正在开发；105 `duel-creation-provenance-storage-evidence/report.md` 为**只读取证**：底层
  `FileEventStore.readEvents` 可读 genesis，但 `PersistentRoomArchiveStore` 只暴露 tail、**未在真实 live v1 归档验证**，
  不能声称可自动迁移 live v1。两者均**未由主控签收**。
- **公开 realRoom 边界不变**：真实 public room 仍停在 **setup→双方 mulligan→`awaiting-turn-start`**；
  **Main 银行资源交互、CardPlay、移动/战斗、完整 replay / native / Windows 均未接**。**整体目标仍不 complete。**

第八次刷新要点（2026-10-13；相对第七次只做**事实增量覆盖**，旧数字以当前观察替换）：

- **108 私有房间存档历史读取 API 已落 src 并已由 Root 验收（只读 API + 31 个针对测试已验收；全 server 套件/typecheck 当前 snapshot 仍待 102 稳定后验收）**：
  `apps/game-server/src/full-product/persistent-room-store.ts` 纯新增 111 行（0 删除）——新增只读
  `PersistentRoomArchiveStore.readArchives(roomId, afterArchiveSeq=0, limit=1000)`：按 `FileEventStore`
  日志 seq 顺序返回**已校验、已 detached** 的 `{archives:{archiveSeq,archive}[], hasMore, nextCursor}`，
  **不追加、不产生 mutation/version/ACK、不对外 HTTP/ws 暴露**（`full-product/index.ts` 未 re-export、
  `server.ts`/`room.ts` 无引用）。校验 fail-closed（参数安全整数、cursor 超 head reject、逐条必须
  `type==="room-archive"` 且 `roomId` 一致且 archive validJson）、roomId 同实例绑定、每条 deep clone
  （caller 变更不污染 store 缓存/`load` tail）。新测试
  `apps/game-server/tests/persistent-room-archive-history.test.ts` 7 cases，与旧 24 共 **3 files / 31 tests 全通过**；
  **定向 strict `tsc` exit 0**。**Root 已据真实源码 + 31 个针对测试 + 定向 typecheck 0 正式验收该只读 API**；
  但**全 server 套件/typecheck 当前 snapshot 仍不能报 PASS（待 102 稳定后验收）**——范围不同：对 `apps/game-server` tsc **exit=2**，
  **全部错误在 `src/room.ts`**（File102 正在写的新 protocol types 缺失：`OWNER_DECK_CONFIRMATION_SCHEMA` /
  `OWNER_DECK_ZONES` / `OwnerDeckConfirmationMessage` / `OwnerDeckEcho` 等），**本文件 0 错误**
  （`server-typecheck.log`）。**readArchives 是 opaque 私有历史**：**不认证 owner/CardIR**、**不判断迁移合法性**、
  **不是游戏 event replay**；整文件重写 + 重算校验和仍可绕过（corruption/shape 检查，**非 MAC**）。
  artifact：`…/task-artifacts/private-room-archive-history-reader/{report.md,raw.json,rawprobe.json,probe.ts,…}`。
- **109 live Duel room `05715086` 存档创建溯源核对 PASS（仅证明“具备迁移输入”，未做任何 state 变更）**：
  对真实 `archive.log`（`bytes=1107677`、**`mode=644`**、`completeRecordCount=70`、逐条
  `sha256(stableStringify)==checksum`、`eventSeq` 1..70 连续、全 `type=room-archive`/`roomId=05715086`）**只读**核对：
  **genesis = 最早已证含 `duelSession` 的记录 = log seq 6**（`stage=setup/stateVersion=0/mulligan`），
  **tail = seq 70**（`playing/stateVersion=2/matchEventSeq=2`）；strict decoder（`session-archive.ts`）对 genesis 与 tail
  均 `ok=true`；存档 catalog digest/dataVersion == 当前 runtime（`sha256:53b974…`）；`rosterMatchesArchiveSeats=true`；
  提交卡组按 cardID 拷贝数与 genesis 一致（主牌 13×3=39、runes 12、champ/legend 各 1）；每玩家 **53 UID**、
  genesis↔tail 集合 digest 相等、跨玩家互异。**仅证明 live v1 具备迁移输入**：Source 98 V2 设计、Source 106 authority
  **均未接入**，**未做任何自动迁移/state 变更**；未读旧 `gui-room-state`。artifact：
  `…/task-artifacts/live-duel-creation-provenance-verification/{report.md,rawprobe.sanitized.json,probe.ts}`。
- **private journal 权限风险修正（Root 已对自己实际 regular 文件用 fd-verified `chmod 600`，不读取任何令牌）**：
  109 观察真实 `archive.log` **`mode=644`**（含私有恢复令牌），105 fixture 的 **0600 不是通用保证**；Root 对**自己的
  实际 regular 文件**执行 fd-verified 就地修正（`beforeMode 0o644 → afterMode 0o600`、`sameInode=true`、
  `contentsRead=false`），证据 `gui-room-proof/actual-archive-permissions.json`。但**源码级默认创建/既有权限修复
  （110 `private-file-store-permissions`）尚未验收**（`runs/private-file-permissions-wave110/status.json` 显示
  自 `2026-10-12T20:47:21.918Z` 起 running、pid `99355`、assistant-model `gpt-6-sol`；已**非** prepared），**不得**声称通用权限问题已修复。
- **106 仅新增 internal candidate，未接线**：`duel-permanent-authority-module`
  （`packages/engine-core/src/duel/permanent-state.ts`）自身 isolated-results **14/14 通过**
  （`isolated-tap.log` `pass 14 / fail 0`），但**进程仍未退出 / Root 未完成源码验收**——**仅新增 permanent-state
  内部 candidate**，**未接**构造器 / canonical / V2 archive / wire / Main；**不把 14 加入旧核心 248 正式总数**。
  **不是 V2 已切换**（98 设计仍 design not implemented）。
- **并行 writers 当前状态（不能宣称他们完成）**：102 `owner-deck-confirmation-restore`（新私人 owner 消息）
  仍在开发；104 `legacy-prompt-authority-repair` 仍在开发；105 只读 journal 取证未签收。**故 47 protocol /
  213 server / 294 front 为过去已验收的组件/包快照，不是当前 Source**。
- **旧稳定快照保持**：Core **248**（103 正式 dist 实测）/ proto **47** / server **213** / frontend **294** 与
  过去跨 turn 99/103 的 **4 PASS** 接受事实**保持不变**；有 writers 的当前源码**不能冒认 whole pass**。
  **整体目标仍不 complete。**

第九次刷新要点（2026-10-13；相对第八次只做**事实增量覆盖**，旧数字以当前观察替换）：

- **145 + 147 + 154 —— Basic Rune 官方 IR（CR 164.2）加入 card-dsl 并正式 build**：对**精确 30 个 Basic Rune
  printing**（6 域 × 5：Fury/Calm/Mind/Body/Chaos/Order 各含 `ogn-0NN`、`rad-r0N`、`rad-r0Na` 等）绑定
  **CR-v1.4:164.2** 授予的两条 Reaction activation——`[exhaust-source]` → 向 ability-controller Rune Pool Add
  **1 Energy**；`[recycle-source → source-owner Rune Deck]` → Add **1 精确 source 单域 Power**（至 pool reset）；
  **不把 `[NO TEXT]` 当能力**。source gate 仅精确 30 ID + 完整 source tuple，source 变更返 unknown，禁通配。
  `duel-official-programs` registry 计数 **52 resolved / 1329 unknown（1381 总）**（原 22 + 新 30）。145 自测
  **91/91 TAP**（原 75 + 新 16）；147 对旧测试做**纯机械 3 处适配**（`knownProgramCount` 22→52、空文本非 Unit
  「一律 unknown」→ Basic Rune 必须 resolved、unknown 1359→1329），适配后 30/30 通过、旧预期在同一 emit 下恰好
  `#2/#12/#27` 三例失败（即被修正处）。154 对**正式包 tsconfig** 编译入 `packages/card-dsl/dist`，build/typecheck
  exit 0、API smoke exit 0、与 145 私有 `compiled/` **16/16 产物逐字节 `cmp` 相同**，source SHA
  `d2af6d51…`（= Root 核验值）。**IR 自动执行依旧为 0**；不声称 public 资源支付 / Main 已接。
- **153 —— whole-program unknown 只读清单（供拆 scope）**：1329 unknown 中**唯一完整文本 1131**（canonical 1057、
  重复模板组 143），unknown 内空文本 / `[NO TEXT]` 均 **0**；按 cardType 分 Unit 714 / Spell 268 / Legend 137 /
  Gear 133 / Battlefield 75 / Token 2 / Rune 0。机械词匹配（play 485 / conquer 74 / hold 74 / attack 68 …）
  **只是排期证据**，**不赋 keyword 规则能力，不当实现**、不猜 no-effect。
- **143 —— 前端 fresh 验证**：`tsc --noEmit` exit 0、**313/313（26 files）**、production build exit 0 →
  `dist/assets/index-ByPJLsZc.js`（418711 B，sha256 `68026d1d…`）/ `index-Dn_nryXp.css`（未变）。
  冻结 protocol = checkpoint `core-v2-130`（`owner-deck-confirmation.ts`=`46578a…`）；**未链接 131/141 liveCore**。
  PASS 仅代表机械 typecheck/tests/build，**不等于** UI/重连恢复。
- **152 —— 卡组计数文案澄清（仅 1 行）**：`<p>卡组总计 N 张 · 当前区域：X</p>`（原 `N 张 · X` 在战场 tab 误导），
  用原 `deckCardCount`（`DECK_ZONE_ORDER` 全区合计，Root 实点 39+12+1+1+3 = **56**）与 `DECK_ZONE_LABELS`；
  App.tsx 与 143 冻结副本**仅差该 1 行**（其余 1404 行字节一致，含私有 echo 逻辑区）；typecheck/build exit 0、
  JSX 校验通过。**不改计数来源 / 选卡 / 确认 / 准备 / 会话逻辑**。152 自有 build `index-mKmMabGy.js`。
- **144 → 150/151 → 155 —— 原 server 3 项回归的根因、修复与独立合并**：144 实测原 server **229 中 226 pass /
  3 fail**（`PersistentRoomArchiveStore` 目录缓存恢复；`game-server` 两例 resolve 后 Bob life 仍 20 vs 期望 19）。
  **148/149 Root 已核根因**；150 `synthetic-default-target-regression-fix` 只给 `defaultTargets` 第二分支
  `isCurrentlyLegalEffectTarget` 加 `SYNTHETIC_RULESET_ID` 短路（与第一分支一致；Foundation/legacy 仍全来源/对象
  校验），Root 核 **34 case + 18 行为 probe 全 PASS**；151 `private-ignored-directory-cache-fix` 让 ignored 模式对
  **真实目录**缓存跳过读取、回退已验证私有日志（symlink/FIFO 仍严格拒），Root 核 **59 原 + 18 新 = 77** 及原
  store **9/9** PASS。**155 独立机械合并**（4 个已审文件覆到 144 冻结基线，其余逐字节相同）：**server 27 files /
  229/229 pass / 0 fail**、4 项目 strict typecheck 0、build 0（127 dist）、module smoke 0——3 项 144 回归全关。
  **此 229 是冻结合并快照，不是 live worktree 整包**，未自启常驻服务、未触 8795 等真实 room/token。
- **137 —— 129 V2 session × 134 Gold IR 独立审查：部分 PASS 但 release BLOCKED**：冻结切片 **14 框架 probe PASS**，
  但 `review-probes.mjs` **第 12 例复现 P1 continuationId 重用缺陷**（task/payment ID 换新、continuationId 保持原值
  仍 `applied`）——**故不得写“机制全正确”**。另 P1：旧 immutable session 可内存分叉需外部 CAS/串行持久化后 ACK；
  非可信调用者可伪 issuer/priority attestor。Root 已定 **146：签发必付任务须拒绝此前已签发 continuationId
  （issued/active/completed 全覆盖），等 141 释放 `canonical-session-v2.ts` 后实施，不抢写**。
- **140 —— CoreV2 最终历史恢复独立验证**：冻结 130 Core + 129 兼容，原测试 **50/50**、strict noEmit 0、自有 emit
  19；**真实独立 genesis + 精确有序历史**下：合法 restore → **可继续 commit**（accepted）；同末态同 epoch 中段替换
  `hand→trash→hand`（给真实完整 attestation）**拒**；epoch0 交换 genesis hand/deck 且同步当前区域 **拒**；raw JSON
  clone 不可 admit。**PASS 仅限此冻结切片**，不含 131 token / Main / archive。
- **131 / 141 —— 仍在写，未发布 Main**：`duel-token-lifecycle-v2`（`core-v2.ts` / `permanent-state.ts`，pid 45849）
  与 `duel-v2-turn-executor`（`turn-executor-v2.ts` / `phase-source-authority-v2.ts` / `canonical-session-v2.ts`，
  pid 46629）**进程仍在跑**，源码文件由 worker 独占写入。**不得以其 artifact 存在 / 编译成功当作验收**；
  **未接 publicMain / fullmatch**。
- **Root 真实 GUI（新包 / 新服务）**：144 server `8795` + 143 双 preview `4175`/`4176`，room `fd898da7`，
  bundle `index-ByPJLsZc.js`（= 143）——**真实编辑 39 Main + 12 Rune + 1 Legend + 1 Champion + 3 Battlefield（56）**、
  catalog HTTP 校验、submit → Ready、**刷新后 OwnConfirm 无重提交恢复**、第二 client 空 draft **不继承** owner 确认、
  dirty（55 张）刷新 Ready 保持 disabled、graceful server stop/restart（同私有存储）+ 双 reload 后 dirty 仍 blocked /
  对方仍未确认、**本地 revert 回原样 + fresh reload 自动恢复 own confirm**；`archive.log` **0600**（regular，33311 B）。
  **只覆盖 waiting-room owner 私有确认 / 隐私面**，**非 Main、非整局、非新版 Tauri/Windows**。
- **整体目标仍不 complete**：131 Gold token 生命周期与 141 真实 turn 内核仍在写；146 续执行去重待 141 释放；
  真实 Main / CostResolver / source provider / V2 公共投影 / private cursor-token-nonce journal 与 replay/CAS /
  真实完整双 client 对局 / 当前原生-Tauri-Windows 包 / clean-checkout 全 CI —— **均未完成**（见第四节、第七之二）。

证据来源（只作证据，不构成新的任务授权）：

- 本轮基线汇总：`outputs/coordination/full-product-20261012/baseline-results.json`
  及同目录 `baseline-*.log`；goal-state / work-queue：`…/goal-state.json`、`…/work-queue.json`
- engine 内核推广与计数：`…/task-artifacts/duel-printed-cost-promotion/report.md`、
  `…/duel-standard-move-promotion/shortreport.md`、`…/standard-move-priority-contract-fix/test.log`、
  `…/duel-constructor-formal-promotion/{report.md,test.log}`、`…/duel-setup-fixes-scoring-promotion/`
- 隐私：`…/task-artifacts/legacy-prompt-target-promotion/report.md`（F-1 推广闭合）
- 构筑身份 / 目录：`…/task-artifacts/champion-unit-family-guard/report.md`、
  `…/corrected-catalog-identity-acceptance/{report.md,verification.json}`、
  `…/karma-catalog-regeneration/report.md`
- card-dsl：`…/task-artifacts/duel-fixed-ability-source-promotion/report.md`、
  `…/duel-ganking-ready-ability-binding/report.md`
- **第五次刷新新增**：`…/task-artifacts/duel-draw-burnout-formal-promotion/{report.md,logs/}`
  （Draw 推广 182）、`…/task-artifacts/shared-battlefields-tabletop-layout/{summary.md,frontend-test.log}`
  （桌布 198）、`…/task-artifacts/connection-address-restoration-fix/{report.md,logs/}`
  （地址修复 210 + build）、`…/gui-room-proof/{verification.json,service-address-verification.json,*.jpg}`
  （真实 GUI 13+5 checks）、`…/task-artifacts/duel-core-integration-independent-review/{integration-contract.md,evidence.json,review.md}`
  （review 56 FR1–FR4）、`…/task-artifacts/duel-turn-start-sequence-v1/contract.md`
  （wave 59 begin-turn only）、`…/task-artifacts/duel-canonical-lifecycle-integration-v1/contract.md`
- **第六次刷新新增**：`…/task-artifacts/duel-turn-core-formal-build-verification/{report.md,core-full-tests.tap,core-full-tests.summary.txt,typecheck-noemit.log,build.log,perfile-*.tap,exports-smoke.log}`
  （engine-core 245 / build+typecheck 0）、`…/task-artifacts/duel-turn-flow-raw-verification/{report.md,logs/}`
  （83/88 raw）、`…/task-artifacts/duel-ending-expiration-executor/{report.md,focused-test.log}`（Ending 12）、
  `…/task-artifacts/duel-start-through-main-executor/{report.md,API-CHECKPOINT.md}`（Start 7）、
  `…/task-artifacts/duel-room-archive-integration-fix/{report.md,raw/full.log,raw/typecheck.log}`（server 213）、
  `…/task-artifacts/duel-server-production-build/report.md`（protocol+server build 0）、
  `…/task-artifacts/duel-local-card-images-build/{REPORT.md,build.log,disthash-*.txt}`（本地图 + 正式 dist）、
  `…/task-artifacts/duel-local-image-route-test-fix/{report.md,full-frontend.log,typecheck.log}`（frontend 294）、
  `…/task-artifacts/duel-live-room-metadata-ui-fix/report.md`（94 metadata）、
  `…/task-artifacts/duel-app-container-layout-fix/{report.md,raw-verification.log}`（95 父容器布局）、
  `…/task-artifacts/duel-private-room-boundary-review/{review.md,probes.log}`（93 PASS 8）、
  `…/task-artifacts/duel-turn-flow-ending-independent-review/{review.md,raw-probe.jsonl}`（97 集中复审 FAIL）、
  `…/task-artifacts/duel-permanent-provider-evidence/{report.md,provider-input-map.json,catalog-permanent-stats.json}`
  （90 canonical 永久物 authority 缺口）、`…/gui-room-proof/{actual-duel-05715086-verification.json,actual-duel-layout-3-viewports.json,actual-duel-metadata-rulemode-verification.json,*.png}`
  （真实 Duel App GUI）、`…/task-artifacts/duel-protocol-evidence-doc-count-fix/{report.md,rawlogs/}`
  （protocol 47/47 + typecheck 0，纯包 fixture）
- **第七次刷新新增**：`…/task-artifacts/duel-ending-cross-turn-cursor-fix/{report.md,focused-tap.log,after-probe.mjs,after-probe.jsonl,reviewer-reprobe.jsonl}`
  （99 跨回合 Ending 修复）、`…/task-artifacts/duel-cross-turn-formal-verification/{core-full-tests.tap,core-full-tests.summary.txt,report.md,build.log,typecheck-noemit.log,dist-hash.diff,source-hash-pre.txt,source-hash-post.txt,exit-codes.txt}`
  （103 正式核心套件 actual 248/248 + build/typecheck 0）、
  `…/task-artifacts/duel-cross-turn-targeted-independent-review/{report.md,raw.jsonl,probe.mjs}`
  （103 定点独立复核 4 PASS，真实 Ctor→End1→Start2→End2→Start3）、
  `…/task-artifacts/duel-permanent-canonical-contract/{contract.md,change-map.json,minimum-acceptance.json}` 与
  `…/contracts/permanent-v2-root-decisions.md`（98 V2 设计 + Root 决定，**design not implemented**）、
  `…/task-artifacts/duel-creation-provenance-storage-evidence/{report.md,rawprobe.json,API-INPUT.md}`
  （105 只读 journal 取证，未签收）、`…/task-artifacts/legacy-prompt-authority-repair-evidence/report.md`
  （101 F1 边界取证；104 修复进行中，未签收）
- **第八次刷新新增**：`…/task-artifacts/private-room-archive-history-reader/{report.md,raw.json,rawprobe.json,probe.ts,server-typecheck.log,focused-vitest.log,history-vitest-verbose.log}`
  （108 只读 `readArchives` API + 31 tests **已验收**；全 server 套件/typecheck 当前 snapshot exit 2 限 `room.ts` 102 protocol types、待 102 稳定后验收）、
  `…/task-artifacts/live-duel-creation-provenance-verification/{report.md,rawprobe.sanitized.json,probe.ts,explore.cjs}`
  （109 live `05715086` genesis=seq6/tail=seq70 只读溯源 PASS，仅证明“具备迁移输入”）、
  `…/task-artifacts/duel-permanent-authority-module/{isolated-results.log,isolated-tap.log}`
  （106 permanent-state internal candidate 14/14，未接线）、
  `…/gui-room-proof/actual-archive-permissions.json`（Root 对自己实际 regular 文件 fd-verified chmod 600，不读令牌）
- **第九次刷新新增**：`…/task-artifacts/duel-official-basic-rune-programs/{report.md,api-checkpoint.md,census.json,tap/,logs/}`（145 Basic Rune IR，91/91）、
  `…/task-artifacts/official-program-existing-expectations/{report.md,minimal.diff,tap/,frozen/}`（147 机械适配旧测试）、
  `…/task-artifacts/basic-rune-dsl-formal-build/{report.md,compare/,smoke/,dist-manifest.sha256}`（154 正式 card-dsl build + 16 files cmp）、
  `…/task-artifacts/unknown-whole-ability-family-inventory/{report.md,whole-program-unknown-inventory.csv,exclusion-52.json}`（153 unknown 清单）、
  `…/task-artifacts/current-client-build-verification/{summary.json,report.md,dist/,logs/}`（143 前端 313）、
  `…/task-artifacts/deck-editor-total-count-label/{report.md,logs/minimal-diff.txt}`（152 文案 1 行）、
  `…/task-artifacts/current-server-build-verification/{summary.json,report.md}`（144 server 226/3）、
  `…/task-artifacts/synthetic-default-target-regression-fix/{report.md,evidence/}`（150）、
  `…/task-artifacts/private-ignored-directory-cache-fix/{report.md,logs/}`（151）、
  `…/task-artifacts/server-regression-fixes-integrated-check/{summary.json,report.md,logs/}`（155 合并 229/229）、
  `…/task-artifacts/v2-session-gold-ir-independent-review/{report.md}`（137 BLOCKED + continuation 重用）、
  `…/task-artifacts/core-v2-final-history-verification/{report.md,logs/}`（140 CoreV2 历史 50/50）、
  `…/contracts/{server-regressions-root-decision.md,v2-continuation-reuse-root-decision.md}`（Root 决定）、
  `…/gui-room-proof/{owner-echo-actual-gui-20261013.json,resource-bank-gold-payment-20261013.json,*.png}`（Root 真实 GUI）。
- **第十一次刷新新增**：`…/task-artifacts/v2-catalog-card-type-role-fix/{verification.md,engine-full.tap,engine-focused.tap}`（engine-core 434/434）、
  `…/task-artifacts/engine-v2-public-projector/report.md`（430 + `projection-v2.ts`）、
  `…/task-artifacts/protocol-v2-compatibility-fix/report.md`（protocol 64/64 + desktop 335/28 files）、
  `…/task-artifacts/desktop-duel-v2-union-adaptation/report.md`（desktop 334）、
  `…/task-artifacts/source-program-scope-hardening/report.md`（card-dsl 130/130）、
  `…/task-artifacts/room-v2-cutover-impact/{room-v2-cutover-impact.md,cutover-symbols.json}`（V2 facade 零接入）、
  `…/task-artifacts/public-v2-runtime-seam-refresh/{report.md,runtime-seam-contract.json}`（V2 接线断点）、
  `…/task-artifacts/resource-small-block-review/findings.md`（资源折叠小块 F1–F8）、
  `…/gui-room-proof/resource-pool-small-block-verification.json`（折叠/展开实测）、
  `…/task-artifacts/native-packaging-audit/{report.md,audit.json}`（当前 dist `index-jtpbai2r.js`/`index-KqGUXhFw.css`）、
  `…/task-artifacts/docs-current-facts-audit/{findings.json,report.md}`（本轮 docs 事实审计）
- desktop / 原生：`…/task-artifacts/room-deck-confirmation-witness-fix/report.md`、
  `…/shared-battlefield-controller-display-fix/evidence/summary.md`、
  `…/desktop-native-check/report.md`、`…/desktop-delivery-preflight/{preflight.json,delivery-steps.md}`
- 官方数据同步：`…/task-artifacts/official-card-sync/summary.json`
  及 `packages/card-data/data/{catalog,deck-catalog,effect-coverage,images-manifest}.json`
- 原型与截图：`outputs/prototypes/duel-tabletop/resource-gui-evidence.json` 及同目录 `*.png`
- 公开 foundation 双浏览器 fixture：`outputs/verification/action-smoke-20261012/`
- 仓库既有状态文档：`docs/full-product/{vertical-slice,persistence,rules-coverage}.md`

## 一、基线 `8d3929d` 模块完成度表

基线 HEAD 为 `8d3929d`（“docs: record full-product progress and agent guidance”），
其父提交 `b488d73`（“Build multiplayer full-product foundation”）已提交整套
full-product 基础代码；`8d3929d` 本身只改文档。下表为**代码在树内的事实**，
测试数为**当前已落 src 后的观察结果**（来源见上文 artifact，非本文预填）。

| 模块 | 状态 | 说明 |
| --- | --- | --- |
| `packages/protocol` | 已实现（契约） | 含 `full-product-contract.ts`、`duel-contract.ts`（Duel 命令面 + opt-in DuelRuleset whitelist）、`actionOptions` 契约 `riftbound.action-options.v1`、`PROTOCOL_VERSION=0.2.1`。`FULL_PRODUCT_RULESET_ID` 仍别名到 `FOUNDATION_RULESET_ID`（见第三节风险）。当前 `pnpm --filter @riftbound/protocol test` **64/64（含 build）+ strict typecheck 0**（纯包 fixture，无 engine 依赖；**第十一次刷新主控复验**，旧 47 为第十次前快照；见一之十二）。协议已双向支持 V2 投影（`DUEL_PROJECTION_SCHEMA_V2`），但 DTO/guard 只验形状。 |
| `apps/game-server` | 部分 | 公开 `/ws` 房间、HTTP catalog/image/deck API、内存房间、`file-room-store` / `persistent-room-store` 已提交；full-product orchestrator / runtime-adapter **未接入公开路径**。构造校验含 namedChampionTag / Domain Identity / Signature 结构约束；duel room archive 导入修复（92）后曾 **213 tests / 25 files**；143/144 时点实现 **229 / 27 files**，144 实测 **226 pass/3 fail**，已审 150/151 修复经 **155 冻结合并 229/229 pass + typecheck 0**；**第十一次刷新当前为 251（29 files，主控实测；支撑 artifact 由主控补落）**，且 V2 facade 已在 `src/duel/runtime-v2.ts` 落地但公开 room **零接入**（`room.ts`/`server.ts`/`file-room-store.ts` 对 V2 零命中）。以上均为组件/冻结合并快照，非 full workspace，**live 整包以主控实测 251 为准**。 |
| `packages/engine-core` | 部分（实验）+ 内部 Duel 内核已落 src | 公开 foundation 是 CR v1.4 1v1 Duel 的**窄切片**；`src/full-product/*` 为实验运行时（life/health/attack、`score≈life`）。`src/duel/` 内部内核现有 `battlefields / setup / resources / scoring / printed-costs / movement / match-state / draw-burnout / turn-start / turn-flow / ending`（经 `./duel` 出口，barrel 84 导出）；**无 `DuelGame` factory、未接公开 ruleset/server**。核心套件对正式 dist 现为 **434/434**（第十一次刷新 `v2-catalog-card-type-role-fix/engine-full.tap`；推移链 248 → 425 → 430 `projection-v2.ts` → 434 card-type/role 修）+ `build` exit 0 + strict `typecheck --noEmit` exit 0。新增 `src/duel/projection-v2.ts`（`projectCanonicalDuelMatchV2`，V2 投影器）。**（V2 能力已落，但生产 source registry / provider 仍缺；`phase-source-closure-v2.ts` 仍未从 barrel 导出。434 为已验收组件/包快照，非当前 full-workspace / public Main。）** |
| `packages/card-dsl` | 部分（已有正式 `./duel` 出口） | synthetic-demo DSL 与 EffectIR 校验之外，新增 `./duel` 出口的 **Ganking / enter-ready 固定能力文本 source-bound 绑定**内核（`src/duel/ability-bindings.ts`）。**130/130 tests + typecheck exit 0**（第十一次刷新主控复验；原 91、旧 45）；`./duel` official-programs registry **52 resolved / 1329 unknown（1381）**（原 22 + 新 30）。绑定计数（`fullyBound=3 / partial=10 / unknown=1368`）与 IR 计数均只是**绑定/IR**，**不等于**卡牌可执行（见第二节第 4 条）。 |
| `packages/replay-core` | 已实现（基础） | 回放信封与事件日志校验。 |
| `packages/card-data` | 已实现（数据） | 生成目录与图片清单脚本齐全；`data/{catalog,deck-catalog,effect-coverage,images-manifest}.json` 被 `.gitignore` 忽略但已落盘，计数**可核验**：1381 printings / 1080 canonical / executable 0 / judge-required 1348 / no-ability 33，image 1381 无缺失。Karma 精确 source 修正后 deck-catalog digest `sha256:53b974c8…a504d10`（见第一节之五）。 |
| `apps/desktop-client` | 已实现（三页 UI + 动作消费）/ 真实 App 的 Duel setup→mulligan→await-turn-start 面 GUI 已验证；officialDuel 完整对局与双 Tauri 未验收 | 三入口 App（房间/卡组/对局）、**真实房间 deck selector + 命名卡组库**、`requestId` + session/socket tracking、只读 `activeServerUrl` 地址恢复、Duel 只读卡图 catalog hook（本地图优先、stamp 绑定）；`GameClient` 核心 API 已有 partial。当前全量前端 **335 tests / 28 files + typecheck 0 + build 0**（第十一次刷新；原 313/294）；当前 fresh dist `index-jtpbai2r.js`（419659 B）/`index-KqGUXhFw.css`（56669 B），`2026-10-13 13:20:09` 构建、晚于 `src/` 最新 mtime（12:53:53）；旧 `index-ByPJLsZc.js`/`index-Dn_nryXp.css`/`index-mKmMabGy.js`/`index-FccGea0j.js` 均已过时。root 本轮跑 **真实 App（非 harness）Duel room `05715086`：两个独立浏览器客户端对 compiled `:8794`，创建/加入/两卡组/双准备/双方 mulligan/两块共享战场/重启后可见状态一致**（setup→mulligan→awaiting-turn-start，非完整对局）+ 三档视口布局 ≈ 10 张本地图；**两个 Tauri 进程完整对局未跑**。 |
| `packages/judge-tools` | 已实现（基础） | 裁决策略、评审与决定元数据。 |
| `packages/integration-tests` | 已实现 | 协议级多客户端流程测试（走公开 foundation 路径，非 GUI）。 |

## 一之二、本轮实测证据（2026-10-12 / 10-13）

来源：`outputs/coordination/full-product-20261012/task-artifacts/verify-action-loop/summary.json`
（早期动作链路采集）与各内核推广 artifact。逐条命令与日志见对应 artifact 目录。
下表数字为**第十一次刷新时的组件/包快照**（非 full workspace / 远程 CI）——其中 protocol/engine/server/desktop/card-dsl
已由本轮新证据覆盖旧值（见一之十二），其余条目为对应任务当时快照。

| # | 命令 | 退出码 | 结果 |
| --- | --- | --- | --- |
| 1 | `pnpm --filter @riftbound/protocol test` | 0 | 通过（**64**，含 `pnpm build`；纯包 fixture，无 engine 依赖；第十一次刷新主控复验，旧 47/21 为该轮前 snapshot；见一之十二） |
| 2 | engine-core 核心套件（对**正式 dist**，`node --test test/*.test.mjs test/full-product/*.test.mjs`） | 0 | 通过（**434**，第十一次刷新；推移链 248 → 425 → 430 → 434；见一之十二） |
| 3 | `pnpm --filter @riftbound/game-server test` | 0 | 通过（**251**，第十一次刷新主控实测；旧 213 为 92 快照、229 为 155 冻结合并快照） |
| 4 | `pnpm --filter @riftbound/desktop-client test` | 0 | 通过（最新 **335 / 28 files**，第十一次刷新；旧 313/294/210 为前序快照，见一之十二） |
| 5 | `pnpm --filter @riftbound/card-dsl test` | 0 | 通过（**130**，第十一次刷新主控复验；旧 91/45 为前序快照） |
| 6 | `pnpm typecheck`（逐包，`--noEmit`） | 0 | engine-core / game-server / card-dsl / desktop-client 均 exit 0 |

说明：这是**局部证据**，不构成完整官方 Riftbound 交付证据：官方
setup/回合/双共享战场/效果覆盖等 P0 仍未完成（见第四节）。

- **F-1（legacy/restored target prompt 泄漏）已正式关闭**：修复由
  `legacy-prompt-target-promotion` 逐 hunk 应用到 `packages/engine-core/src/index.ts`
  （8 hunk 与 patch.diff 一一对应；推广后 source 与 artifact snapshot 逐字节一致，
  编译产物 `cmp` byte-identical）。F-1 的 **15 条隐私 regression 已进 src 并全通过**
  （before 13 失败 → after 15/15）。高优先级“动作授权绕过”修复（wave-15）随该
  index.ts 一并保留（`projection.actionOptions = foundationActionOptions(...)`、
  `passTurn`/`playCard` 策略重查）。**均仍在工作树、未 commit、未由主控最终验收。**
- **仍未做的部分**：完全失去合法目标（全 invalid）的 **restored 状态 authority
  repair / migration 未做**——该 patch 无 fake option、无 silent skip，玩家仅可
  concede；这属独立的“失效 prompt authority 修复”，不在 F-1 范围内。
- 旧 broad 复审 `engine-action-authority-review`（wave-17）被主控取消，report 仅一行
  “主控取消了本批任务”，无结论，不得冒充通过。

## 一之三、三页原型（prototype，已验收其原型层；不等于正式客户端）

本轮交付并验收了**三页可点击原型**（`outputs/prototypes/duel-tabletop/`）：

1. **牌桌（match-table）**：2 块共享战场视觉布局、基地/手牌/牌堆/计分轨；
2. **卡组编辑（deck-editor）**：六分区组卡与卡图预览；
3. **房间页（room-entry）**：创建/加入房间、等待席位、**切换卡组**（切换后清空提交/
   准备并禁用进入对局，同一 id 重选不清状态）。

资源池交互（同批原型）按**6 域 + 任意（any）**：Rune/Gold 获取、手动输入、连续支付与
余额保留。已实测的支付序列：先存 `6 Energy / 2 Calm` → 打出魅惑妖术（Charm，Calm 1）
→ 剩 `5/1` → 再付 `2 Energy` → 剩 `3/1`；取消/不足均不扣减；**回合结束清空资源池但
保留物件**；等待/重连场景门禁。

证据（`outputs/prototypes/duel-tabletop/resource-gui-evidence.json`，`prototypeOnly=true`）：
`functionalChecks` 14 项全部通过；`geometryChecks` 三档视口 1920×1080 / 1440×900 /
1280×720 均 `brokenImages=0`、`pilesInside=true`、`plusInside=true`、
`allCardImagesLoaded=true`；截图含 `match-table.png`、`resource-payment.png`、
`deck-editor.png`、`room-entry.png`、`room-deck-picker.png`、`match-contested.png`。

**边界（必须保留）**：这些是 **prototype**，其数字**不是正式 engine 测试**：

- `135` payment smoke、`145` legacy DOM smoke、`41` static audit、`55` 图片/小修自检
  均为**原型静态/桩 DOM smoke**，**不得**当作正式引擎/规则测试。
- 原型**未接入正式 app/server**：桌面 `PlayableMatchBoard` 与 `apps/game-server` 的正式
  Duel/资源池投影与动作契约仍需正式接线（见第四节、第七节）。
- 原型 ≠ 正式客户端：本轮 Room/deck 的**真实 Runtime GUI** 由 root 另行测试；
  在取得 root 的 GUI 证据前只能列 `待验/await`，**不得**提前标 `passed`。

## 一之四、Duel 内部内核推广与独立验收（2026-10-12 晚）

来源：`task-artifacts/duel-*/report.md`（board/setup/resources/scoring/printed-cost/
standard-move/constructor）。

**已推广进源码（`packages/engine-core/src/duel/`，经 `./duel` 出口）**：

| 内核 | 源/依据 | 计数 |
| --- | --- | --- |
| board（battlefields） | staged → src，仅加 per-seat printing 唯一校验 | `duel-battlefields` 16 |
| setup | staged 逐字提升（含 wave34 2 回归） | `duel-setup` 15 |
| resources | 冻结快照逐字复制 | `duel-resources` 13 |
| resources（独立 oracle） | 独立 DFS 穷举 oracle | `duel-resource-allocation`：**1161 cases、0 mismatch** |
| scoring | staged 逐字提升 | `duel-scoring` 14 |
| printed base cost | staged 提升，仅改 import/备注 | `duel-printed-costs` 8 |
| StandardMove（movement） | staged 提升（CR 143.4/144/447/810） | `duel-standard-move` **17**（含 wave-50 契约修正：CR 420.3 Discretionary，且 **Main / Turn / Priority 门禁**） |
| constructor（match-state） | staged 提升（4 条 `_deps` 改真模块） | `duel-match-state` **7**（两 mulligan 唯一转换、resource 唯一 RuneDeck、frame `awaiting-turn-start`、public Trash `{uid,cardId}` 按 CR 108） |
| Draw / Burn Out（原 43 checkpoint） | staged 机械推广（仅 3 行 import 改真模块；无算法/规则/断言变更） | `duel-draw-burnout` **12**（`startDuelDraw`/`resumeDuelDraw`；first point trusted replacement、subsequent 单点 +1） |
| turn-start（原 59 拆分件） | staged → src（CR 315.1–315.4 / 316.1–316.4 / 430–431） | `duel-turn-start` **7**（Awaken/readiness、beginning、Hold/Channel/Draw、缺 provider→pending，**绝不 no-op skip**） |
| turn-flow（Start-through-Main，83） | staged → src（`beginDuelScoreTurn` 与 phase entry 同 mutation） | `duel-turn-flow` **8**（trusted/resumable flow cursor、首 Channel 按 player 身份持久化、Main 清双方池后才给 Priority） |
| ending（Ending/Expiration，88） | staged → src（CR 323.1/323.2 / 467–472 / 485.7） | `duel-ending` **15**（历史 88 落地 12 → 99 修复后当前 15；special cleanup 次序：pre-kill snapshot→Kill→Heal→同时「本回合」expiration→清双方池→FEPR；缺 provider→pending） |

- **engine-core 包内测试**：Draw 推广 snapshot 为 **182 tests / 182 pass / 0 fail**、
  exit 0；`typecheck` exit 0（`duel-draw-burnout-formal-promotion/logs/{fulltest.log,draw-burnout-tap.log,typecheck.log}`、
  `duel-constructor-formal-promotion/test.log`、`standard-move-priority-contract-fix/test.log`）。
  计数链：123 →（F-1 +15）138 →（printed-cost +8）146 →（StandardMove +15）161 →
  （constructor +7）168 →（StandardMove 契约 +2）170 →（Draw 推广 +12）**182**。**无缩减
  compiler flag 换绿**；resources 的 26 处改动为纯类型 non-null 适配（`tsconfig.base`
  开 `noUncheckedIndexedAccess`）。**注意**：182 是 Draw 推广当时的整包快照；当前 root
  仍在把 turnStart / CombatDamage / canonicalIntegration 三内核与 review 56 统一，**不是**
  “当前核心已全面通过”的证据（见一之六）。
- **engine-core 最新核心套件快照（2026-10-13，103；取代 97 的 245）**：对**正式 dist** 跑
  `node --test --test-reporter=tap test/*.test.mjs test/full-product/*.test.mjs` → **actual 248 / 248 pass / 0 fail**，
  `build` exit 0、strict `typecheck --noEmit` exit 0（`duel-cross-turn-formal-verification/core-full-tests.tap`）。
  97 的 **245** 为该时点旧快照；跨回合 trio `duel-ending` 15 + `duel-turn-flow` 8 + `duel-turn-start` 7 = 30。
  此为当前核心 **包快照**，**不是** full-workspace/远程 CI/native 证明；97 的跨回合 FAIL 已由 99 修复、
  103 独立复核 4 PASS（见一之七）。
- **仍未完成的接线**：turnStart / CombatDamage / canonicalIntegration 与 review 56 的
  FR1–FR4 仍待主控统一；82 前的 182 只是 Draw 推广当时快照（见一之六）。
- **constructor 公开 Trash 投影**：按 CR v1.4 108.2（Trash 为 Public Information）新增
  `PublicDuelMatchPlayer.trash`（仅 `{uid,cardId}`；不 spread 私密注解）。内联泄漏探针
  对双方/观战均为空，证明手牌（仅 owner）/Main/RuneDeck（仅 count）/removedBF/retiredGold/
  unitMeta 不泄。
- **StandardMove 契约修正**：按 CR 420.3 明确 Discretionary，并要求 Main / Turn /
  Priority 门禁（wave-50）。
- **边界（务必保留）**：以上均为**内部内核**（纯函数/可信状态），**无 `DuelGame` factory、
  未接公开 ruleset/server/protocol**，未做 Move/Combat 官方全链/官方 turn 执行/胜负结束。
  推广进 src ≠ 公共可玩 Duel 完成。scoring 内核**不跑阶段机、不结束对局**；constructor
  **无 commands、无完整 turn、无 archive/catalog validate，未包装成公开 `GameDuel`**。

### 核心 checkpoint（**未正式推广/未最终验证，不计入完成项**）

以下零散内核本轮只有 **source checkpoint artifact**，**未进正式 src、未做最终验收**，
故**不列入完成项**（不得以“process/models 活着”或“部分测试通过”替代完成）：

- `canonical-resource-command-session-v1`（48：resource 命令 session 幂等 / receipts，producer 原 closure）
- `duel-unit-lifecycle-kernel`（49：unit lifecycle，producer 原 closure）
- `duel-official-turn-executor-v1`（53：**已 cancelled**——实际 runner/worker absent，46min 只有 copies、无执行器 source，**不得记 running/succeeded**）
- `duel-turn-start-sequence-v1`（**59** 拆分后的 `begin-turn only`）：已由 **83**
  （`turn-start.ts` 7 + `turn-flow.ts` 8）扩展为 `awaiting-turn-start → awaken → beginning →
  Hold → Channel → Draw → Main` 内部执行器，**已进 src**；88 Ending 与 83 的**跨回合链路
  97 复审曾 FAIL，已由 99 修复、103 独立复核 4 PASS**（一之八，限 fixture-certified-no-effect
  4 回合），但**非 public 可玩**，仍不得据此标公开回合流程完成。
- **CombatDamage**：进行中，**未验收**（`duel-turn-combat-formal-promotion` 仅 artifact）。

**说明**：原 43（Draw/Burnout）已从 checkpoint **升级为正式推广**（见上表与一之六）；
48/49 仍为 checkpoint；53 已取消；59（begin-turn only）经 83 扩展进 src，End→次回合链路
97 复审 FAIL 已由 99 修复、103 独立复核 **4 PASS**（限 fixture-certified-no-effect 4 回合，非 public）。
**checkpoint / staged / 源落地 ≠ 完成。**

## 一之五、构筑身份 / 桌面原生 / room-deck / 权限（2026-10-12 晚）

来源：`task-artifacts/{champion-unit-family-guard,corrected-catalog-identity-acceptance,
karma-catalog-regeneration,desktop-native-check,desktop-delivery-preflight,
room-deck-confirmation-witness-fix,shared-battlefield-controller-display-fix}/…`。

- **构筑身份（source 已入 src，未 commit）**：`constructed-policy.ts` /
  `deck-validation.ts` / `card-catalog.ts` 实施 Domain Identity、Chosen Champion tag、
  Legend、Signature ≤ 3（跨全部区含 sideboard）等结构约束；`collectChampionIssues`
  对 named champion 名集改为 **fail-closed**（`identity_metadata_unavailable` /
  `champion_tag_mismatch`，不再回落 raw tag 放行）。game-server **168 tests + typecheck
  exit 0**（原 165 + 新 3，未改其它 tests 凑绿）。
- **实际目录与 digest**：`data/deck-catalog.json` 由官方 builder 正式重生成，唯一
  字段级变化为 `ogn-235-298.tags Vi→Karma`（其余 1381 卡/1080 group/imageUrl/源快照
  字节均未变）；内部 digest `sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10`。
  真实目录 **1381 printings / 143 Legends / 1080 groups**；按实际 catalog + 104
  knownChampionTags，**Legends 143/143 可解析（unresolved 0）、Signatures 60/60 可解析
  （unresolved 0）**。**实际 catalog 中不存在 Karma Legend**，故“全 Karma 合法 deck”
  无法由真实数据组成；只读验收用的合成 Karma Legend 探针**是 in-memory 合成、不落盘**，
  **不能算作真实 deck**。**未决（待主控裁定、不得自造）**：Colorless 战场域、sideboard
  是否适用 CR 103 域口径、独立核验的区域可用性限制。`tournamentComplete` 仍 **false**；
  2026-10-12 现行 TR 全文（`601.1.c.*`/`403.4`）**仍未核验**，**sideboard 0..10 本次未改动**。
- **桌面原生（仅历史局部证据）**：`desktop-native-check` 曾在 macOS arm64 真实
  `cargo check` / `cargo build` exit 0、0 warning/error，链接出 Mach-O arm64 可执行
  文件（root file/hash 已核）——但内嵌的是**旧 `dist`**，且**GUI 从未启动、二进制从未执行**。
  另有 `desktop-delivery-preflight` 对**当前 host fresh 复核**：cargo/rustc/rustup
  **不在 PATH**、`bundle.targets=["nsis"]` 为 **Windows-only**。故：**无 fresh Tauri GUI、
  无 Windows NSIS、桌面包（Tauri/安装包）未 build**。**但前端已 fresh build**：
  `connection-address-restoration-fix` 实测 `pnpm --filter @riftbound/desktop-client build`
  成功、dist 刷新为 `index-Bx6ry0KG.js`（该时点值；当前可核 dist 见第十一次快照 `index-jtpbai2r.js`；故旧“前端未 fresh build”陈述作废）；此为
  **web 前端构建**，不等于桌面安装包。`desktop-current-build-proof`（build-54）状态以
  其自身日志为准。不得据此声称桌面交付项（验收项 20）完成。
- **room/deck 正式 React UI**：三入口 App、命名卡组库、房间提交/准备门禁；`GameClient`
  提供版本化命令、幂等重试、session resume、事件游标与替换 socket 安全。
  `room-deck-confirmation-witness-fix`（witness 51）修复 `set-ready` 回执在
  `roomVersion === undefined` / failure / disconnect 时**误清 pending 导致错误切换卡组**：
  新增纯函数 `src/decks/room-confirmation.ts`，`ackmissingversion / failure / disconnect`
  一律**不能**完成切换（`evaluateDeckSwitch` 需 receipt+context+version catchup 全部命中
  才 witness，并用**捕获的 snapshot**应用）。desktop-client 当前 **210 tests（19 files）**
  + typecheck 0 + build 0；其中 witness 51 新增 **23** 例、地址恢复新增 **12** 例。
- **服务地址恢复（`connection-address-restoration-fix`）**：只读 `activeServerUrl`
  getter（`serverUrl || session.serverUrl`，不含凭据）+ hook/App/Panel 初值 + 仅未编辑时
  后台同步；`initialConnectionServerUrl` / `backgroundServerUrlUpdate` 为可独立验证纯函数。
  输入框迟到挂载显示真实 8793 而非 8787；用户编辑中不被后台覆盖。**未触碰卡组确认逻辑**。
- **SharedBattlefields（shared 52 → 布局 58）**：`resolvePublicUnit` 由私有 zone 黑名单改为
  `ON_BOARD_ZONES` **白名单**（board/base/battlefield，仍要求 faceUp；hand/deck/rune-deck
  即使 faceUp 也不泄，discard/legend/champion/rune/banish/chain 降级为 MISSING_UNIT_NOTICE）；
  `renderUnits` 分组 key/heading 改用 **当前控制者 `object.controllerId`**（`ownerPlayerId`
  仅作数据属性）。隔离快照 **13 scoped（原 8 + 新 5）**，反向语义快照恰 3 个新断言失败。
  `shared-battlefields-tabletop-layout`（58）再按 **上对手基地 / 中央两 field / 下自己基地**
  布局，`resolveBasePlacement` 由 `ownerPlayerId` 解析（非 `board.bases` 输入序）、
  spectator 用稳定 seat 序且 fail-closed；原 13 例保留、**+3**，该时点整个 frontend
  **198**。**仍未接入 App 的正式 Duel 组件。**
- **原 wave-27（`room-deck-receipt-core`）**：**已被主控取消**（source 保留，
  `GameClientAPI` 核心已有 partial）。此前 v3 依据的 163/165 为**旧快照**，不是当前最新。

## 一之六、第五次刷新新增实测证据（2026-10-12 深夜）

来源见上文证据列表“第五次刷新新增”。**除真实 GUI 的 room/deck 与地址复验外，均为
内部/组件级证据，不是完整对局。**

| # | 事实 | 证据 | 状态 |
| --- | --- | --- | --- |
| 1 | Draw/Burn Out（43）正式推广：`duel-draw-burnout` **12**、整包 **182**、typecheck 0；root 核对仅 import 差异 | `duel-draw-burnout-formal-promotion/report.md` + `logs/` | 已入 src（未 commit）；**该时点整包快照，非当前统一核心最终证明** |
| 2 | SharedBattlefields 桌布布局（58）：上对手基地/中央两 field/下自己基地，+3、原 13 保留 | `shared-battlefields-tabletop-layout/summary.md` + `frontend-test.log`（当时 **198**） | 已入 src（未 commit）；**未接 App** |
| 3 | 服务地址恢复：只读 `activeServerUrl` + Panel 初值/后台同步；前端 **210/19 files + typecheck 0 + build 0** | `connection-address-restoration-fix/report.md` + `logs/` | 已入 src（未 commit）；fresh dist `index-Bx6ry0KG.js` |
| 4 | **真实 GUI**：Foundation room room/deck **13 checks** | `gui-room-proof/verification.json` + JPG | 真实 room/deck GUI；**非 officialDuel、非完整对局** |
| 5 | **真实 GUI 地址复验 5 checks**：旧 8787 / reload 实连 8793/ws / 手输 9000 不被覆盖 / 恢复 8793 + A 确认 submit | `gui-room-proof/service-address-verification.json` + JPG | 同上；owner-deck confirmation reload gap 仍在 |
| 6 | review 56：`integration-contract.md` + `evidence.json` FR1（429.3 required-cost 无 ordinary Priority）/ FR2（nullable Champion）/ FR3（单一 stateVersion/eventSeq）/ FR4（Draw retry identity） | `duel-core-integration-independent-review/`（含 `review.md`） | **checkpoint 审查，非完成**；`review.md` 已可用，结论 **integration NOT PASS（FR1–FR5）**，wave 60 正在修、**未验**（审查任务 `succeeded` ≠ review passed） |
| 7 | turn 53 cancelled；新 59 拆 `begin-turn only` + CombatDamage | `duel-turn-start-sequence-v1/contract.md`、`duel-official-turn-executor-v1/`（空 src/test） | 53 **不得记 running/succeeded**；59/CombatDamage **未验收** |

**边界（务必保留）**：

- 上述 Draw 182 / frontend 198→210 均为**对应任务当时的整包快照**，**不能**据此宣称
  “当前核心已全面通过”：root 仍有 **3 个核心（turnStart / CombatDamage /
  canonicalIntegration）与 review 56 收尾仅待验收**。
- 真实 GUI 只覆盖 **Foundation room 的 room/deck + 地址**，**不含** public Duel、官方
  turn、卡牌 abilities、双 Tauri；**完整对局尚无**。
- review 56 的 FR1–FR4 是**接线闸门**（未满足前不得把 producer “succeeded/compiled”
  写成 full integration passed），**不是修复证据**。

## 一之七、第六次刷新新增实测证据（2026-10-13；其中 245/97-FAIL 已被一之八取代）

来源见上文证据列表“第六次刷新新增”。**除真实 App 的 Duel room GUI 外均为内部/组件级证据。**
数字均为**组件/包快照**。本节的 **245** 与 **97 跨回合 FAIL** 均为**第六次时点历史**，当前状态见一之八。

| # | 事实 | 证据 | 状态 |
| --- | --- | --- | --- |
| 1 | 83 Start-through-Main（`duel-turn-flow` 8 + `duel-turn-start` 7）+ 88 Ending（`duel-ending` 12）正式进 src；对正式 dist 核心套件 **245/245**（**第六次时点；103 复核已升为 248，见一之八**），build + strict typecheck 0 | `duel-turn-core-formal-build-verification/{core-full-tests.tap,report.md,typecheck-noemit.log,perfile-*.tap}` | 已入 src（未 commit）；**内部执行器 seam，非公开可玩对局** |
| 2 | game-server room archive 导入修复 + legacy 0-seat 兼容：full server **213/25 + typecheck 0**（原 14 failed/199） | `duel-room-archive-integration-fix/{report.md,raw/full.log}` | 单文件 `room.ts` 3 处；Duel 分支校验未放宽 |
| 3 | 正式生产构建：protocol build 0、game-server tsc 0（`apps/game-server/dist` 20 js） | `duel-server-production-build/{report.md,rawlogs/}` | 仅写 dist；未 commit |
| 4 | Duel 本地卡图优先（显示层）+ desktop 正式 build 0：dist `index-FccGea0j.js`/`index-Dn_nryXp.css` | `duel-local-card-images-build/{REPORT.md,build.log,disthash-*.txt}` | 仅显示顺序；96 初跑 293/294（1 过时 SSR 断言） |
| 5 | 97 修正过时 SSR 期望后：full frontend **294/25 + typecheck 0** | `duel-local-image-route-test-fix/{report.md,full-frontend.log}` | 只改 1 行 expect（+反向断言）；非源码回归 |
| 6 | **真实 App（非 harness）Duel room** `05715086`：两客户端对 compiled `:8794`，创建/加入/两卡组/双准备/B2 A0 调度/双共享战场/各自 4 手牌/对手仅数量/重启后可见状态一致 | `gui-room-proof/actual-duel-05715086-verification.json`（+png） | setup→mulligan→`awaiting-turn-start`；**非 Main / 非资源支付 / 非完整对局** |
| 7 | 三档视口布局（真正 App）：1440×900/1280×720/1920×1080 均 pagefit、手牌+计数器可见、10 张本地图 loaded | `gui-room-proof/actual-duel-layout-3-viewports.json` | 布局/可见性；不含轮次/支付 |
| 8 | Duel live-room metadata：编辑器 8787 无连接，Duel 卡图/中文名走 `:8794`、reload 后仍加载、模式显示 `1v1 对局（开发预览）`、偏好保留 | `gui-room-proof/actual-duel-metadata-rulemode-verification.json` | 94 显示层修复；未改 authority |
| 9 | 93 private-room 边界审查 **PASS（8/2 files）** | `duel-private-room-boundary-review/{review.md,probes.log}` | **仅** setup→双 mulligan→await；**不为** full turn/CardPlay/IR/native 背书 |
| 10 | （**第六次时点历史**）97 集中复审（complex-engine）跨回合链路 **FAIL**：`runDuelEndOfTurn` 恒 `task-conflict`，第二回合 End 被拒，无法进第三回合 | `duel-turn-flow-ending-independent-review/{review.md,raw-probe.jsonl}` | 当时代码 FAIL；**已由 99 修复、103 独立复核 4 PASS（见一之八）**，不得再作当前状态引用 |
| 11 | 90 canonical 永久物 authority 缺口取证：Legend/Champion 仅 `{uid,cardId}`；**Gear / attachedGear 完全无对象**；readiness 只认 unit/rune/gold | `duel-permanent-provider-evidence/{report.md,provider-input-map.json}` | 只读取证；**最关键缺口**（见第四节第 12/13 条） |
| 12 | protocol 全包实测：`pnpm --filter @riftbound/protocol test` **47/47**（含 build）、strict typecheck 0；纯包 fixture（仅 import 本包 `../dist` + `node:*`，无 `engine-core` 依赖），两次 build dist 6 文件 sha256 一致 | `duel-protocol-evidence-doc-count-fix/{report.md,rawlogs/}` | 校正旧 21 snapshot；**纯包快照，不代表 full-workspace CI** |

**边界（务必保留）**：

- 83/88 是**内部 trusted 执行器 seam**：完整 effect IR / 公共 wire 持久化 / 完整 Legend/Battlefield/
  Gear 注册**均缺**；缺 provider **一律 pending，绝不 no-op skip**。
- 真实 App GUI 只到 **setup→双 mulligan→`awaiting-turn-start`**，**不含** Main、资源支付、卡牌
  abilities、双 Tauri；**完整对局尚无**。
- 所有 `248 / 213 / 294 / 47` 均为**组件/包快照**，**不是** full-workspace / 远程 CI / native 证明。

## 一之八、第七次刷新新增实测证据（2026-10-13）

来源见上文证据列表“第七次刷新新增”。**99 修复 + 103 正式实测/定点复核；数字均为组件/包快照。**

| # | 事实 | 证据 | 状态 |
| --- | --- | --- | --- |
| 1 | 99 `duel-ending-cross-turn-cursor-fix`：`ending.ts` 严格 `parsedCursor` + 私有 `priorEndingTurns` sidecar；仅在上一回合真实 terminal + 当前真实 Main 就绪时创建新 Ending cursor；旧 task ID 只 `duplicate`、不重放 provider/RNG/资源 | `duel-ending-cross-turn-cursor-fix/{report.md,focused-tap.log,after-probe.mjs,after-probe.jsonl,reviewer-reprobe.jsonl}` | **已入 src（未 commit）**；修复 97 的历史 FAIL；`ending.ts` sha `bb8293aa…` |
| 2 | 103 正式核心套件（对正式 dist）：`node --test --test-reporter=tap …` → **actual 248 / 248 pass / 0 fail**，build exit 0、strict typecheck 0；source pre==post、build 幂等、dist 仅 `.tsbuildinfo`+`duel/ending.{js,d.ts}` 变化 | `duel-cross-turn-formal-verification/{core-full-tests.tap,core-full-tests.summary.txt,report.md,build.log,typecheck-noemit.log,dist-hash.diff,exit-codes.txt}` | 取代第六次 245；**组件/包快照** |
| 3 | 103 定点独立复核 **4 PASS**：真实 `createDuelMatch`→双方 mulligan→Main1→**End1→Start2→End2→Start3→End3→Start4** 全 `awaiting-turn-start`；次玩家 Start2 首 Channel=3 后 2，累计 Base rune 3→5，首 Channel fact 保留；三个 Ending 双池清空、双 clock 成对；旧未完成/未知 ID `wrong-task`、已消费 ID（turn1/2/3）latest `duplicate`；16 项篡改原子拒绝；缺 provider 仍 pending | `duel-cross-turn-targeted-independent-review/{report.md,raw.jsonl,probe.mjs}` | **PASS 限定 fixture-certified-no-effect 4 回合**；**非** 生产 IR/provider |
| 4 | 98 V2 设计 + Root 决定：`physicalCardsByUID`/`legendStates`/`gears`/`retiredPhysicalUIDs` 最小共享契约 + CR124 全域/journal 创建证明/BF readiness override 决定 | `duel-permanent-canonical-contract/{contract.md,change-map.json,minimum-acceptance.json}`、`contracts/permanent-v2-root-decisions.md` | **design not implemented** |
| 5 | 105 只读 journal 取证：底层 `FileEventStore.readEvents` 可读 genesis（含原始 UID/deck），但 `PersistentRoomArchiveStore` 只暴露 tail；未在真实 live v1 归档验证 | `duel-creation-provenance-storage-evidence/{report.md,rawprobe.json,API-INPUT.md}` | **只读证据，未签收** |
| 6 | 101 F1 边界取证 + 104 修复：全失效目标 → public `prompt=null` 而 authority 仍 pending（残留可达）；104 `legacy-prompt-authority-repair` 开发中 | `legacy-prompt-authority-repair-evidence/{report.md,raw-stuck.json,…}` | **未签收**；106 `duel-permanent-authority-module` 新 authority 模块**开发中**（非 V2 已切换） |

**边界（务必保留）**：

- 103 的 **4 PASS 严格限定为已修复的 fixture-certified-no-effect 普通 Duel 4 回合链路**：
  **不**等于生产 effect IR/provider 完整、source attestation 已接，**不**背书 extra/queued turn、
  card IR、完整 FEPR、生产 source/服务端恢复或 GUI/native 集成。
- **公开 realRoom 仍停 setup→双方 mulligan→`awaiting-turn-start`**；**Main 银行资源交互、CardPlay、
  移动/战斗、完整 replay / native / Windows 均未接**。
- **47 protocol / 213 server / 294 front 为过去已验收的组件/包快照，不是当前 Source**：102
  owner-deck-confirmation（新私人 owner 消息）源改动进行中、未完成。

## 一之九、第八次刷新新增实测证据（2026-10-13）

来源见上文证据列表“第八次刷新新增”。**108/109 为只读存储 / 取证；106 为未接线内部 candidate。数字均为组件/包快照。**

| # | 事实 | 证据 | 状态 |
| --- | --- | --- | --- |
| 1 | 108 新增只读 `PersistentRoomArchiveStore.readArchives(roomId, afterArchiveSeq=0, limit=1000)`：按 `FileEventStore` seq 顺序返回 detached `{archiveSeq,archive}[]` + `hasMore`/`nextCursor`；fail-closed 校验；不追加 / 不 mutation / 不外露 HTTP-ws | `private-room-archive-history-reader/{report.md,raw.json,rawprobe.json,probe.ts}` | **已落 src（未 commit）**；只读 API + 31 针对测试**已验收**，全 server 套件/typecheck 待 102 稳定后验收；source SHA `0fa682cc…` |
| 2 | 108 定向：新测试 7 cases + 旧 24 = **3 files / 31 tests 全通过**；定向 strict `tsc` exit 0 | `private-room-archive-history-reader/{focused-vitest.log,history-vitest-verbose.log}` | 组件/包快照 |
| 3 | 108 **全 server typecheck exit=2**，错误**全部在 `src/room.ts`**（File102 新 protocol types 缺失），本文件 0 错误 | `private-room-archive-history-reader/server-typecheck.log`；`raw.json.serverSourceTypecheck={exitCode:2,errorFiles:["apps/game-server/src/room.ts"],targetFileErrorLines:0}` | **全 server 套件不能报 PASS**（108 只读 API 本身已验收）；按契约未修改 `room.ts` |
| 4 | 109 live `05715086` `archive.log` 只读核对 **PASS**：`bytes=1107677`、**`mode=644`**、70 条完整记录、逐条 checksum 一致、seq 1..70、全 roomBound；genesis=seq 6（setup/v0/mulligan）、tail=seq 70（playing/v2）；strict decoder genesis+tail 均 ok；catalog digest/dataVersion==当前；roster==seats；提交卡组拷贝数一致；每玩家 53 UID、genesis↔tail digest 相等、跨玩家互异 | `live-duel-creation-provenance-verification/{report.md,rawprobe.sanitized.json,probe.ts}` | **仅证明“具备迁移输入”**；未做任何迁移/state 变更；未读旧 `gui-room-state` |
| 5 | private journal 权限风险修正：真实 regular `archive.log` **`mode=644`**（含私有恢复令牌）；105 fixture 0600 **非通用保证**；Root 对自己实际 regular 文件 fd-verified `chmod 600`（0o644→0o600、`sameInode`、`contentsRead=false`、不读取令牌） | `gui-room-proof/actual-archive-permissions.json` | 已就地修正该实际文件；**源码默认/既有权限修复（110）尚未验收**（110 已非 prepared、running 中，见第 7 行） |
| 6 | 106 `duel-permanent-authority-module`（`src/duel/permanent-state.ts`）自身 isolated-results **14/14 通过**，进程未退出 / 未源码验收 | `duel-permanent-authority-module/{isolated-results.log,isolated-tap.log}` | **仅 internal candidate**；未接构造器/canonical/V2 archive/wire/Main；**14 不计入旧核心 248** |
| 7 | 102 `owner-deck-confirmation-restore`、104 `legacy-prompt-authority-repair` 仍在开发；110 `private-file-store-permissions` **已非 prepared**：`runs/private-file-permissions-wave110/status.json` 记 `2026-10-12T20:47:21.918Z` 起 running、pid `99355`、assistant-model `gpt-6-sol`，producer 尚未签收 | `…/work-queue.json` `readyDispatched`；`…/runs/private-file-permissions-wave110/status.json` | 有 writers 的当前源码**不得冒认 whole pass** |

**边界（务必保留）**：

- 108 `readArchives` 是 **opaque 私有历史流**：**不认证 owner/CardIR**、**不判断迁移合法性**、**不是游戏 event replay**；
  整文件重写 + 重算校验和仍可绕过（corruption/shape 检查，**非 MAC**）；全 server 套件/typecheck 因 102 未完成 `room.ts` 而 exit 2，
  **故全 server 套件不得报 PASS（108 只读 API 本身已验收）**。
- 109 **仅证明 live v1 具备迁移输入**，未做任何自动迁移/state 变更；未验证 RNG 可外部复算或多进程/跨进程并发写语义。
- **旧稳定快照 Core 248 / proto 47 / server 213 / frontend 294 与过去跨 turn 99/103 的 4 PASS 接受事实保持**；
  **有 writers 的当前源码不能冒认 whole pass**。**整体目标仍不 complete。**

## 一之十、第九次刷新新增实测证据（2026-10-13）

来源见上文证据列表“第九次刷新新增”。**145/147/154 为 DSL/IR 绑定 + 正式 build；143/152 为前端；144/150/151/155 为 server 回归；
137/140 为独立审查；131/141 为仍在写的内核。数字均为组件/包/冻结合并快照。**

| # | 事实 | 证据 | 状态 |
| --- | --- | --- | --- |
| 1 | 145 Basic Rune 官方 IR（CR-v1.4:164.2 两条 Reaction：`exhaust-source`→+1 Energy；`recycle-source`→source-owner Rune Deck→+1 精确单域 Power），精确 30 printing 白名单；registry **52 resolved / 1329 unknown（1381）** | `duel-official-basic-rune-programs/{report.md,api-checkpoint.md,census.json}` | 已入 src（未 commit）；**IR 自动执行仍 0** |
| 2 | 147 旧测试纯机械适配 3 处（22→52、空文本非 Unit→Basic Rune 必须 resolved、1359→1329），适配后 30/30、旧预期恰好 `#2/#12/#27` 失败 | `official-program-existing-expectations/{report.md,minimal.diff,tap/}` | 只改 1 个测试文件；未弱化 source gate |
| 3 | 154 正式 `packages/card-dsl/dist`：build/typecheck/smoke exit 0，与 145 私有 `compiled/` **16/16 逐字节 `cmp` 相同**，source `d2af6d51…` | `basic-rune-dsl-formal-build/{report.md,compare/,smoke/}` | 正式产物；**未重启 Root 服务** |
| 4 | 153 unknown 只读清单：unique 完整文本 **1131**（canonical 1057、模板组 143），unknown 空文本/`[NO TEXT]` = 0；词匹配仅排期 | `unknown-whole-ability-family-inventory/{report.md,*.csv}` | **不赋 keyword 规则能力** |
| 5 | 143 前端：`tsc --noEmit` 0、**313/313（26 files）**、build 0 → `index-ByPJLsZc.js`（418711 B, `68026d1d…`） | `current-client-build-verification/{summary.json,report.md,logs/}` | 组件快照；**未链 131/141 liveCore** |
| 6 | 152 卡组计数文案 1 行 `卡组总计 N 张 · 当前区域：X`；与 143 冻结副本仅差该行；typecheck/build 0 | `deck-editor-total-count-label/{report.md,logs/minimal-diff.txt}` | 已入 src（未 commit）；不改计数/逻辑 |
| 7 | 144 原 server **229 中 226 pass / 3 fail**（目录缓存恢复 + 两例 Bob life 20 vs 19） | `current-server-build-verification/{summary.json,report.md}` | **PARTIAL，非 full pass** |
| 8 | 150 `defaultTargets` 第二分支 `SYNTHETIC_RULESET_ID` 短路；Root 核 **34 case + 18 行为 probe 全 PASS** | `synthetic-default-target-regression-fix/{report.md,evidence/}` | 局部 guard；Foundation/legacy 仍全校验 |
| 9 | 151 ignored 模式真实目录缓存跳过 + 回退已验证私有日志；Root 核 **59 原 + 18 新 = 77** 及原 store **9/9** | `private-ignored-directory-cache-fix/{report.md,logs/}` | 局部安全兼容；symlink/FIFO 仍拒 |
| 10 | 155 独立机械合并（4 已审文件覆 144 冻结基线）：**server 27 files / 229/229 pass / 0 fail**、typecheck 0、build 0、smoke 0；3 项回归全关 | `server-regression-fixes-integrated-check/{summary.json,report.md,logs/}` | **冻结合并快照**，非 live worktree 整包 |
| 11 | 137 独立审查：冻结切片 14 框架 probe PASS，但 **probe 12 复现 P1 continuationId 重用**（换 task/payment 仍 `applied`）→ **release BLOCKED** | `v2-session-gold-ir-independent-review/report.md` | **不得写“机制全正确”**；146 待 141 释放 |
| 12 | 140 CoreV2 最终历史：原测试 **50/50**、strict 0、emit 19；真实独立 genesis/有序历史下合法 restore 可继续 commit，两同 epoch 攻击 **拒** | `core-v2-final-history-verification/{report.md,logs/}` | PASS 仅限冻结切片 |
| 13 | Root 真实 GUI：8795 + 双 preview 4175/4176，room `fd898da7`，编辑 39Main+12Rune+1Legend+1Champion+3BF、submit→Ready、刷新 OwnConfirm 恢复、dirty55 blocked、graceful restart+双 reload、revert 后恢复；`archive.log` 0600 | `gui-room-proof/owner-echo-actual-gui-20261013.json`（+png） | **仅 waiting-room 恢复/隐私面**，非整局/Tauri/Win |

**边界（务必保留）**：

- **131 / 141 仍在写**（`core-v2.ts`/`permanent-state.ts`、`turn-executor-v2.ts`/`phase-source-authority-v2.ts`/
  `canonical-session-v2.ts`），进程仍在跑；**未发布 Main、未接 publicMain/fullmatch**。**143/144/152/155 均未使用 131/141 liveCore**。
  **（第十次刷新更新：131/141 已 terminal，160 冻结基线 346/57，见置顶要点与一之十一。）**
- **155 的 229 与 143 的 313 均为组件/冻结合并快照**，不是 full-workspace / 远程 CI / native / 完整对局证明；
  144 自身为 **226/3 PARTIAL**，修复经 150/151 已审、155 合并验证，但 **live 整包未重跑**。
- **145/154 的 Rune IR 只是绑定/编译**：用户卡能力可执行数仍为 **0**；不声称 public 资源支付 / Main 已接。
- **137 的 14/14 是框架探针在确认缺陷**，不是机制正确 PASS。**140 的 PASS 仅限冻结 130+129 切片**。

## 一之十一、第十次刷新新增实测证据（2026-10-13）

来源：`contracts/root-acceptance-wave157-164.json`；`runs/<wave>/status.json`；
`task-artifacts/{core-token-turn-current-baseline-verification,token-lifecycle-independent-review,ignored-cache-replay-formal-build,v2-gold-command-scoped-finish,resource-pool-product-gap-evidence,ability-source-zones-evidence}/report.md`。
数字均为**组件/包/冻结快照**，非 full-workspace / 远程 CI / native / 完整对局。

| 波次 | 事实（读自 report / TAP / status） | 判定 |
| --- | --- | --- |
| 160 core-token-turn 冻结基线 | protocol strict noEmit + compile、engine-core strict noEmit + compile 全 exit 0；engine-core 全量 **346/346**、protocol **57/57**；84/84 冻结 hash 相符；首次失败仅文件级缺 `card-data/deck-catalog.json`（复制未改，sha `06d99a58…`）；phase-source-authority 7 例被 turn test import **重复注册** | **accepted-test-baseline-only**（**第十次时点冻结基线**；当前已升至 engine **434** / protocol **64**，见一之十二）；无 prod source registry / 无 public Main / fullmatch |
| 158 token-lifecycle 独立审 | 原 35（11 token + 14 S1a + 10 V2）+ 独立 **27 probes** 全执行 PASS；**#17–22 为“证明不安全接受”的 PASS**；P1 #20 ready 改写造资源、#21/#22 Recruit 本源；P2 #17/#18/#19 history 非独立认证 | **findings → 已派 165**；不得签收 token 恢复 / release |
| 164 Gold 命令 + continuation | 自有 build Gold **15/15**（8 distinct）、continuation **13/13**（6 distinct）、combined regression **83/83**；pre-159 neg control 11/2 fail（= completed-continuation 重用）；159 两处编辑保留（源 sha `f3b0f3b9…`） | **accepted-scoped-internal-command**；factory/oracle 为内部 fixture |
| 163 replay-core 正式产物 | build + typecheck 0；`file-event-store.js` → `802fc017…` 与 151/155 逐字节一致；正式 replay **77/77**；12 发布文件 `cmp` 相同 | **accepted-scoped**；**8795 仍 144 旧 cached imports** |
| 162 zone 只读取证 | CR/卡面 zone 关键词机械命中（battlefield 299 / hand 83 / trash 71 …）；141 `current()` 只含 board+legendBF 六类 kind | **不赋 IR/keyword 能力**；binding 52/1329 不变 |
| 166 资源产品缺口 | 正式 UI 计数存在；来源动作被 `awaiting-turn-start` 阻断；`counterActions`/`+/-` 仅组件级、无生产 caller；`paymentSummary` 未传面板 | **gap evidence → 已派 167**（仍非真实 Main 验收） |
| 159 违规 terminal | 未经授权 emit 共享 `engine-core/dist`；Root SIGINT；**source 保留**；由 164 取代 | **terminal-failed** |
| 161 phase/source 独立审 | **running**（pid 67966，gpt-6-sol xhigh）；暂复现 P03 cost 支付被拒、P13 pending 被 runStart 跳过；report 未落盘 | **在途待验** |
| 165/167/168/169/170 | 165（pid 72216）、167（pid 72631）、168（pid 72805）、169（pid 73230）、170（pid 73767）**源码在各自独占写域内写入中** | **在途待验，不得当 pass** |

**边界（务必保留）**：

- **131 / 141 已 terminal**（不再“仍在写”）；**160 的 346/57 是冻结 130→131-141 测试基线，不是生产源**：
  仍**无 production source registry、无 public Main/fullmatch**。**计数为 executions，含 7 例重复注册**。
- **158 的 27/35 不构成“机制全正确”**：其中 **#17–22 是确认不安全接受的 PASS**；token 恢复与整体 release 仍 BLOCKED。
- **164 的 15/13/83 含 import 重复注册**（8 / 6 distinct）；**137 的 continuationId 重用 P1 仅在此 slice 关闭**，
  其余 P1（外部 CAS / 串行持久化后 ACK）仍未处置；**real sourceIR 与 public Main 未接**。
- **163 的 77 是正式 replay 产物在**私有编译同源**下重跑**；**8795 仍是 144 旧 cached imports**，未 claim 实机新修复。
- **162 词匹配只是排期证据**；**166 只证明 UI 缺口**。**自动执行仍 0**。

## 一之十二、第十一次刷新新增实测证据（2026-10-13；wave196）

来源：`task-artifacts/{v2-catalog-card-type-role-fix,engine-v2-public-projector,protocol-v2-compatibility-fix,source-program-scope-hardening,desktop-duel-v2-union-adaptation,room-v2-cutover-impact,resource-small-block-review,public-v2-runtime-seam-refresh,native-packaging-audit}/` 与 `gui-room-proof/resource-pool-small-block-verification.json`。
数字均为**组件/包快照**，非 full-workspace / 远程 CI / native / 完整对局。

| # | 事实 | 证据 | 状态 |
| --- | --- | --- | --- |
| 1 | engine-core 核心套件 **434/434**（推移链 425 → 430 → 434）；`v2-catalog-card-type-role-fix/engine-full.tap`（`# tests 434 / # pass 434 / # fail 0`，隔离 `engine-dist/`） | `v2-catalog-card-type-role-fix/{engine-full.tap,verification.md,engine-focused.tap}`、`v2-handler-identity-fix/checkpoint.md`（425）、`engine-v2-public-projector/report.md`（430 + `projection-v2.ts`） | **组件/包快照**；无 production source registry / 无 public Main |
| 2 | protocol **64/64** | `protocol-v2-compatibility-fix/report.md`（中间快照 `duel-public-v2-projection-contract` 63） | 纯包 fixture；DTO/guard 只验形状，不代表 server 已接 V2 |
| 3 | card-dsl **130/130**（主控复验；隔离 outDir + `DUEL_OFFICIAL_PROGRAMS_MODULE` 指向 artifact dist） | `source-program-scope-hardening/report.md`；registry 仍 **52 resolved / 1329 unknown** | **主控已复验**；效果可执行数仍 0 |
| 4 | desktop **335/335（28 files）** | `protocol-v2-compatibility-fix/report.md`（335）、`desktop-duel-v2-union-adaptation/report.md`（334） | 组件/包快照；V1/V2 投影路由未验、双 Tauri 未跑 |
| 5 | game-server **251（29 files）** | **主控实测**（支撑 artifact 由主控补落）；最接近为 `v2-catalog-card-type-role-fix/server-focused.log`（focused `25/25`） | **主控实测值**；V2 facade **零接入** |
| 6 | V2 能力落地：protocol V2 schema+guard、`engine-core/src/duel/projection-v2.ts`（`projectCanonicalDuelMatchV2`）、`apps/game-server/src/duel/runtime-v2.ts`（facade + turn 转发，自含测试 9/9） | `room-v2-cutover-impact/room-v2-cutover-impact.md`、`public-v2-runtime-seam-refresh/report.md`；树内三文件 mtime 2026-10-13 | **能力已落**；**room/server/store 零接入**（`room.ts`/`server.ts`/`file-room-store.ts` 对 V2 零命中） |
| 7 | V2 断点：缺生产 phase provider（`sources` 缺 → turn-start 恒 pending）；`session-archive.ts` 仍 V1 schema1、无 V2 codec（`"unadmitted V2 session; JSON is not restore"`）；wire 仍 5 命令、无 CardPlay/Move/Combat 执行器；`phase-source-closure-v2.ts` 未导出 | `public-v2-runtime-seam-refresh/report.md`、`room-v2-cutover-impact/…`、`production-phase-provider-evidence/report.md` | **仍缺**；不得因能力落地标高 |
| 8 | 资源折叠小块：折叠态真实小块（1280×720 实测 resourcePool 512×34，`detailsOpen=false`）；只读/chip/支付/来源/计数全在 `<details>` 内；`counterActions` 生产永不传；F1–F8 均低危无阻断 | `resource-small-block-review/findings.md`、`gui-room-proof/resource-pool-small-block-verification.json`（`63 passed / 5 files`；build → `index-vCEFtKWK.js`/`index-KqGUXhFw.css`） | 组件/布局证据；**非 public Main/支付端到端** |
| 9 | 当前桌面 dist：`index-jtpbai2r.js`（419659 B, sha256 `5540cd1e…`）/`index-KqGUXhFw.css`（56669 B, sha256 `b55f3579…`），`2026-10-13 13:20:09`，晚于 `src/` 最新 mtime 12:53:53 | `native-packaging-audit/{report.md,audit.json}` | 当前可核 bundle；旧 `index-ByPJLsZc.js`/`index-FccGea0j.js`/`index-mKmMabGy.js`/`index-3Ow5BSsp.js`/`index-Dn_nryXp.css` 均过时 |

**边界（务必保留）**：

- 上表新数字（434 / 64 / 130 / 335 / 251）均为**组件/包快照**，非 full-workspace / 远程 CI / native / 完整对局；
  **server 251（29 files）为主控实测**，其支撑 artifact 由主控补落。
- **V2 能力落地 ≠ 已接入**：公开 room 仍构造 V1 `DuelCommandSession`；**无 production source registry、无 public Main/fullmatch**。
- **资源折叠小块**只证明组件布局与权威保持，**非真实双端 Main/支付**；效果可执行数仍 **0**。
- **整体目标仍 active / 不 complete**：provider / archive / cardplay / combat、真实双端完整对局、
  当前原生 / Tauri / Windows 包、clean-checkout 全 CI **均未完成**。

## 二、旧文档冲突（必须纠正）

以下说法在基线文档中**不成立**，本轮不改动其“历史记录”价值，但不得再作为当前状态引用：

1. **“存在大量未提交工作”不成立**：基线 `git status` 为空，full-product 代码已在
   `b488d73` 提交；`8d3929d` 仅为文档提交。（本轮其它并行任务会再次产生工作区改动，
   属“实施中”，与本条指的历史快照无关。）
2. **HEAD 记录错误**：旧 `PROJECT.md` 写“committed HEAD is `b488d73`”且引用
   `C:\Users\...` 本地根；实际 HEAD 为 `8d3929d`，且该路径与本仓库无关。
3. **“runtime-contracts 测试已删除”不成立**：
   `packages/engine-core/test/full-product/runtime-contracts.test.mjs` 存在且被包 test glob 覆盖。
4. **效果覆盖计数**：旧文 `1,346 + 33 = 1,379 ≠ 1,381` 属**历史冲突数字**，作废。
   直接读取**当前文件**核对：printings `1381`、canonical `1080`、`executableCount=0`、
   `judgeRequiredCount=1348`、`noAbilityCount=33`。card-dsl 的
   `fullyBound=3 / partial=10 / unknown=1368` **只是绑定 Census**，**不是**可执行卡数；
   官方能力可执行数仍为 **0**。全文其余覆盖率旧值一律以本节为准。
5. **测试总数分叉**：`docs/implementation-status.md` 的旧 301 与
   `vertical-slice.md` / `persistence.md` 的 server 139 / integration 37 / desktop 98
   均为 **pre-full-product 旧基线**；**第十一次刷新当前观察（组件/包快照）**为 engine-core 核心套件
   **434**（card-type/role 修后；旧 248 为 103 快照）/ server **251**（主控实测；旧 213/229 为历史快照）/ card-dsl **130**（主控复验；旧 91/45）/
   desktop **335**（28 files；旧 313/294/210）/ protocol **64**（主控复验；旧 47）/ replay-core **77**（163 正式 dist）。
   另有历史冻结基线：engine-core **346**（160 冻结 130→131-141，含 7 例重复注册）、protocol **57**（160 冻结）。
   详见第一节之二、一之七/一之八/一之十/一之十一/一之十二。
6. **“构建/typecheck 失败”“37/37、104/109”** 均为历史报告值，本轮**未复现**，不得
   当作当前证据（见第六节）。
7. **“no GUI / no pnpm build / 前端未 fresh build”已作废**：root 本轮已跑
   **真实 App（非 harness）Duel room `05715086`**（两客户端对 compiled `:8794`，setup→双
   mulligan→await）+ Foundation room room/deck 13 checks + 服务地址 5 checks，并实测
   desktop-client `build` exit 0（fresh dist `index-jtpbai2r.js`）。**但仍无完整对局、
   无双 Tauri、无桌面 NSIS 安装包**——不得把 web 前端 build 或真实 Duel room 的
   setup/mulligan GUI 当作验收项 19/20 完成。

## 三、本轮动作链路设计（服务端动作与目标 options → 客户端选择 → 权威命令/恢复闭环）

里程碑：让**公开 foundation 对局**具备“服务端给出合法动作与目标 options → 客户端
据此选择 → 权威命令下发 → 重连/恢复”的闭环。契约由主控定义，本执行者不改契约。

### 3.1 服务端投影新增字段

`GameProjection` 增加可选 `actionOptions`（`packages/protocol/src/index.ts`）：

```text
actionOptions?: {
  contract: "riftbound.action-options.v1"
  stateVersion: number
  viewerPlayerId: string
  actions: Array<{
    id: string
    command: <该动作对应的权威命令>
    targetPolicy: { minTargets: number; maxTargets: number; options: <目标候选> }
    enabled: boolean
    blockedReason?: string
  }>
}
```

`PROTOCOL_VERSION` 提升为 `0.2.1`。校验器 `isProjectionActionOptions` 强制
`actions[]` 精确键、`targetPolicy` 精确键与整数约束。

### 3.2 链路职责

- **服务端（engine-core / game-server）**：在投影中产出 `actionOptions`，使客户端无需
  自行推断合法动作与目标；`enabled=false` 时必须给出 `blockedReason`。
- **客户端（desktop-client）**：消费该 metadata 渲染可点动作与目标选择，经既有权威命令
  信封下发，并在重连后依据 `stateVersion` 恢复一致视图。
- **契约（主控拥有）**：本执行者只记录、不修改。

**本轮状态（局部）**：服务端已产出 `actionOptions`，desktop-client 已消费该 metadata，
经既有权威命令信封下发；UI 基础 class 已存在。原动作契约 review 的 **high** 风险（UI
禁用可被直接命令绕过）修复**已入 src（未 commit，随 `legacy-prompt-target-promotion`
落到 `packages/engine-core/src/index.ts`）**；F-1 legacy/restored 泄漏**已关闭**（见
第一节之二）。但公开 foundation ≠ 未接入的实验引擎，且完全失去合法目标的 restored
authority repair 尚未做，故**不得**标为“动作/目标闭环已完成”。

**双浏览器 fixture 实测（公开 foundation，非官方完整 match）**：见
`outputs/verification/action-smoke-20261012/`。已跑通 **出牌 / 切回合 / 刷新恢复 /
续玩 / 认输**。但它走的是公开 foundation 窄切片，**不是**官方完整 match，**也不是**
两个 Tauri 桌面进程对局。

**协议 Duel 命令入口（已正式）**：`packages/protocol/src/duel-contract.ts` 正式定义 Duel 命令面——
`mulligan` / `rune-energy` / `rune-power` / `gold-power` / `pay-pending`（5 类原始指令，
`duel-command` 信封含 `requestId`/`commandId`/`expectedVersion`），命令**不得由客户端指定
actor/phase/cost/source**；server 端 `apps/game-server/src/duel/runtime.ts` 只处理
`createDuelMatch` + `applyDuelResourceCommand`（mulligan/rune/gold/pay-pending），对
`awaiting-turn-start|ended` 直接返回空 actions——**没有 `beginAwaken`/`runDuelStartOfTurn`
调用**；且缺 provider 时**一律 pending，绝不 no-op skip**（见一之七、90 取证）。
**（第十一次刷新补充）** V2 facade `apps/game-server/src/duel/runtime-v2.ts` 已落地（含 turn 转发），
但 `room.ts`/`server.ts`/`file-room-store.ts` **对 V2 零命中**，公开 room 仍走上述 V1 路径；
wire 仍仅 5 条命令，CardPlay/Move/Combat 无执行器（见一之十二）。

### 3.3 边界红线（务必保留区分）

**公开 foundation ≠ 未接入的实验引擎。** 当前公开 `/ws` 只接受 `synthetic-demo` 与
`riftbound-foundation` 两个 ruleset；实验 `FullProductRoomOrchestrator` / `RuntimeAdapter`
自述“intentionally not registered with the public server's room lifecycle”。因此：

- 不得把“实验 orchestrator 接到公开路径”当作“完整 product 完成”。那只是把实验
  引擎暴露出去，官方规则仍缺失。
- `FULL_PRODUCT_RULESET_ID` 目前**别名**到 `FOUNDATION_RULESET_ID`，桌面端
  `isFullProductRuleset` 在公开 foundation 房间即为 true，会渲染 full-product 板，
  但驱动它的仍是旧 `GameRoom` + 窄 foundation 引擎。接与未接难以区分，是主要误判
  风险；应有独立 rulesetId 或显式 experimental 标记（契约改动属主控）。
- 实验运行时保持 life/health/attack 边界，**不称官方完整 Riftbound 规则**。

## 四、P0（本轮应关闭或明确边界）

1. **官方 setup**：官方洗牌、起手/调度（mulligan）、先手选择、Battlefield 选择、
   rune channeling、sideboard —— **内部 setup 内核（`src/duel/setup.ts`）已建模
   seat/洗牌/2 张 mulligan/首手选择/battlefield 选择并推广进 src**，但**未接入公开
   ruleset/server**；rune channeling 与 sideboard 仍未接。**整体仍属 P0 未完成。**
2. **Location / Base / Battlefield**：zone 模型与 Location 语义未实现；**内部 board
   内核（`src/duel/battlefields.ts`）已建模 2 base + 2 shared battlefield + location 投影，
   但未接线公开路径、未验收官方语义**。
3. **Contested / Control**：据点争夺与掌控判定未实现；**board 内核已含 contested/
   controller 关系校验（含 P2 修复）**，仍是内部内核。
4. **Conquer / Hold**：征服/固守计分未实现；**scoring 内核（`src/duel/scoring.ts`）已建模
   Conquer/Hold/Final Point 触发与亚军边界**，未接 turn/事件。
5. **Showdown**：对决流程未实现；**board 内核含 `begin/endDuelNonCombatShowdown` 与
   Open cleanup**，仍为内部内核、未接阶段机。
6. **Move / Priority**：标准移动 kernel 与 420.3 Discretionary / Main/Turn/Priority
   门禁已入 `src/duel/movement.ts`（StandardMove 17）；但**未接公开 Move 命令面/
   trigger/cleanup**，Move/Combat 官方全链未做。
7. **Combat / Combat Damage、Deathknell**：战斗与伤害分配、死亡钟声未实现
   （**无正式内核**；board 内核仅含 `applyOpenDuelCleanup`）。**CombatDamage 拆分件
   仍进行中、未验收**（`duel-turn-combat-formal-promotion` 仅 artifact）。
   Deathknell 仍待 unit lifecycle + outer 接线。
8. **8 分胜负 / Battlefield Count 2**：未实现官方胜负条件；**scoring 内核含 8 分/唯一
   领先者判定**，但不结束对局、未接投影/结束流程。
9. **官方 turn / Draw / Burnout / Unit lifecycle**：**Draw/Burnout（43）已正式推广进
   src**（`src/duel/draw-burnout.ts`，见第一节之四/一之六）；**59 `begin-turn only` 经
   `duel-start-through-main-executor`（83）扩展为 `awaiting-turn-start → … → Main` 内部
   executor 并进 src**（`turn-start.ts` 7 + `turn-flow.ts` 8），**88 Ending/Expiration
   （`ending.ts` 历史 12 → 当前 15）亦进 src**——但缺 provider **一律 pending，绝不 no-op skip**；97 的
   **83/88 跨回合链路 FAIL 已由 99 修复、103 独立复核 4 PASS（一之八）**，但**仅限
   fixture-certified-no-effect 4 回合、非 public 可玩**；**48 resource 命令 session、
   49 unitLifecycle 仍为未推广 checkpoint**；**53 turn executor 已 cancelled**。
   **整体仍属 P0 未完成**（见第一节之四）。
10. **效果 Coverage**：EffectIR 仅少量 opcode + card-dsl `./duel` 的 Ganking/enter-ready
    固定文本绑定；官方卡池同步已落盘，当前文件计数为 `executable=0 / judge-required=1348 /
    no-ability=33`（printings 1381 / canonical 1080）。即**官方卡效果可执行数为 0**；
    全部未实现效果保持 `judge-required`，不得近似/臆造语义。**canonical 永久物 authority
    仍缺**（Legend/Champion 仅 `{uid,cardId}`；**Gear/attachedGear 无对象**），见第 12 条。
11. **动作/目标闭环**：见第三节；公开 foundation 局部证据成立，high 修复在 src（未 commit），
    F-1 已关闭；但完全失效 prompt 的 authority repair 与公开 Duel 接线未做，故不标完成。
12. **公开 Duel / room factory / protocol / 完整卡牌 IR / MoveCombat 集成 / 双真实 GUI /
    桌面包**：**未做**。关键缺口还包括——(a) **canonical Legend/Gear/ownership/attachments
    authority**（90 取证：Legend/Champion 仅 `{uid,cardId}`，Gear/attachedGear 完全无对象，
    readiness 只认 unit/rune/gold）；(b) **trusted production readiness / 可执行 effect IR /
    CostResolver 与 source attestation**；(c) **private 83/88 turn/ending cursor 的 archive
    注册/恢复**（server src 未引用 turn-flow/ending）；(d) **真实 CardPlay/Move/Combat/EndTurn
    公开命令 & 完整 gameEvents replay**；(e) 真实 full match / 双 Tauri / 当前 native /
    Windows NSIS / clean-checkout 全 CI。范围整体保留（见第七之二·下一关键路径）。

## 五、P1（后续项）

1. **双真实 GUI E2E**：桌面 full-product 组件测试仍为 SSR 渲染；**两 Tauri 窗口完整对局
   仍未验证**。root 本轮已跑 **真实 App（非 harness）Duel room `05715086`**（两客户端，
   setup→双 mulligan→await，重启后可见状态一致）+ **Foundation room room/deck GUI 13
   checks + 服务地址 5 checks**（`gui-room-proof/`），以及公开 foundation 的**双浏览器
   fixture** 与 SharedBattlefields 隔离快照——**均为局部证据，非完整对局**。仓库无
   Playwright/Puppeteer/WebDriver 等 GUI E2E 工具。resume token 存 `sessionStorage`，
   为单标签页会话。
2. **打包/CI**：仅 `.github/workflows/desktop-build.yml`（Windows NSIS，`windows-latest`），
   触发为 `push: main` / PR / 手动；当前分支的 push 不触发。fresh 复核
   （`desktop-delivery-preflight`）确认本机 **cargo/rustc/rustup 不在 PATH**，且
   `bundle.targets=["nsis"]` 为 **Windows-only**；`Cargo.lock` / `src-tauri/gen` 按预期不存在。
   macOS 侧的 `cargo check`/`cargo build` 为**历史局部证据**（内嵌**旧 dist** `index-3Ow5BSsp.js`，
   二进制 sha `b608ab60…`）；**web 前端已 fresh build**（desktop-client `build` exit 0，
   fresh dist `index-jtpbai2r.js`/`index-KqGUXhFw.css`），但**无 fresh Tauri GUI、无
   Windows NSIS、无桌面安装包**；桌面包/安装项（验收项 20）**仍未验收**。
3. **域身份限制**：Domains/Champion/Signature 约束已入 src（server 251，第十一次刷新）；**仍未闭合**：
   Colorless 战场域、sideboard 的 CR 103 口径、独立核验的区域可用性限制、2026-10-12
   现行 TR 全文核验 —— 均待主控裁定（见第一节之五）。实际 catalog 无 Karma Legend。
4. **持久化与隐私**：`RIFTBOUND_STORAGE_DIRECTORY` 下的重启/隐私全流程未跑；多条
   restore 风险（restore 未深度校验、payload hash 基于原始 payload、坏目录可中止
   `list()`）未处置。

## 六、可复现验证命令（主控最终统一执行）

下表旧数据为**基线**参考，非本轮最终验收；本轮各内核任务已实测过一次（见第一节）。

| 检查 | 基线退出码 | 命令 |
| --- | --- | --- |
| frozen-install | 0 | `pnpm install --frozen-lockfile --offline` |
| build | 0 | `pnpm build` |
| typecheck | 0 | `pnpm typecheck` |
| test（全量） | 1 | `pnpm test` |
| protocol | 0 | `pnpm --filter @riftbound/protocol test`（第十一次刷新 **64/64**；历史 160 冻结 **57/57**；含 build；纯包 fixture） |
| engine-core | 0 | 核心套件对正式 dist：`node --test test/*.test.mjs test/full-product/*.test.mjs`（第十一次刷新 **434**；历史 160 冻结 130→131-141 **346/346**，含 7 例 import 重复注册；`pnpm --filter @riftbound/engine-core test` 会先 build protocol） |
| game-server | 0 | `pnpm --filter @riftbound/game-server test`（第十一次刷新 **251**，主控实测；历史 229 / 213 为旧快照） |
| card-dsl | 0 | `pnpm --filter @riftbound/card-dsl test`（第十一次刷新 **130**，主控复验；旧 91 / 45 为旧快照） |
| replay-core | 0 | 163 正式 dist 跑 `node --test replay-core.test.mjs full-product.test.mjs private-file-permissions.test.mjs ignored-directory-cache.test.mjs`（**77/77**，12 发布文件与 151/155 `cmp` 相同） |
| desktop-client | 0 | `pnpm --filter @riftbound/desktop-client test`（第十一次刷新 **335**，28 files；旧 313 / 294 为旧快照） |
| full-product 双协议客户端集成 | 0（3/3 passed） | `pnpm --filter @riftbound/integration-tests exec vitest run --config test/full-product/vitest.config.ts` |

说明：

- 旧 `pnpm test` 全量退出 1 的失败来自 `packages/card-data` 两个测试依赖被忽略的数据
  文件；该缓存已由 `official-card-sync` 落盘。是否转绿需主控在全量回归中确认。
  **全量 `pnpm test` 在其他改动稳定前不作最终通过结论。**
- 上述均为**基线/局部**数字；本轮改动后的最终结果由主控统一运行并填写，本文不预填。

## 七、本轮实现状态（待主控验收）

| 项 | 状态 |
| --- | --- |
| 本进度文档 + `delivery-goal.md` / `implementation-status.md` 事实校正 | 本轮已完成（本文，待主控审查） |
| Duel 内部内核 board/setup/resources/scoring/printed-cost/StandardMove/constructor/draw-burnout/turn-start/turn-flow/ending | **已入 src（未 commit）**；engine-core 核心套件对正式 dist **434/434**（第十一次刷新；旧 248 为 103 快照）+ build/typecheck exit 0；DFS oracle 1161 cases 0 mismatch |
| 隐私 F-1（legacy/restored target prompt 泄漏） | **已关闭**（15 regression 已进 src、全通过）；*完全失效 prompt 的 authority repair 仍未做* |
| 高优先级动作授权绕过修复（high） | **已入 src（未 commit）**；focused 复审 fresh 命令无绕过 |
| 构筑身份 / 目录修正（Domain/Champion/Signature ≤3 + Karma 精确 source） | **source 已入 src（未 commit）**；server **251**（第十一次刷新）；实际 143 Legends / 60 Signatures 全部唯一定 family；digest `53b974c8…`；`tournamentComplete=false` |
| card-dsl `./duel`（Ganking / enter-ready fixed binding） | **已入 src（未 commit）**；**130** tests（第十一次刷新；旧 45/91）；`fullyBound 3 / partial 10 / unknown 1368` 仅 binding，可执行数仍 0 |
| room/deck 正式 React UI + witness 51 + shared 52 + 桌布 58 + 地址恢复 + Duel metadata/布局/本地图 | desktop **335**（28 files，第十一次刷新）+ typecheck 0 + build 0（当前 fresh dist `index-jtpbai2r.js`/`index-KqGUXhFw.css`，2026-10-13 13:20:09；旧 313/294 `index-ByPJLsZc.js`/`index-mKmMabGy.js` 已过时）；**真实 App Duel room `05715086`（setup→mulligan→await）+ Foundation room GUI 已跑；未跑双 Tauri 完整对局** |
| 原 wave-27（room-deck-receipt-core） | **主控已取消**（source 保留；GameClientAPI 核心已有 partial） |
| 原 wave-53（official turn executor） | **已 cancelled**（runner/worker absent，只有 copies）；**59 begin-turn only 经 83 扩展进 src；CombatDamage 仍未验收** |
| 核心 checkpoint（48 resource 幂等、49 unitLifecycle、59 begin-turn、CombatDamage） | **48/49 仅 source checkpoint；59 经 83 进 src（turn-start 7 + turn-flow 8）；88 Ending 12→15 进 src（历史 88 落地 12、99 修复后当前 15）；97 跨回合 FAIL 已由 99 修复、103 独立复核 4 PASS（限 fixture-certified-no-effect 4 回合，非 public）** |
| 真实 GUI（真实 App Duel room `05715086` + Foundation room room/deck 13 checks + 服务地址 5 checks） | **已实测（root 本轮）**；Duel 面止于 setup→双 mulligan→await；**非 Main/资源支付、非完整对局**；owner-deck confirmation reload gap 仍在 |
| review 56（FR1–FR4） + 97/99/103 跨回合复核（83/88） | review 56 为**接线闸门（checkpoint 审查）**、wave 60 未验收；**97 跨回合链路 FAIL 已由 99 修复、103 独立复核 4 PASS（一之八，限 fixture 4 回合；review 56 仍非 PASS）** |
| 公开 foundation 双浏览器 fixture（出牌/切回合/刷新/续玩/认输） | **局部已实测**（非官方完整 match、非两 Tauri） |
| 三页原型（牌桌/卡组编辑/房间+资源池） | **原型层已验收**（135+145+41+55 原型 smoke，非正式 engine 测试） |
| 桌面原生（macOS 本地 cargo 编译） | **历史局部证据**（Mach-O arm64 `b608ab60…`，内嵌**旧 dist** `index-3Ow5BSsp.js`）；**未重建 / 未 GUI 验 fresh native 包、未 Windows NSIS**；**Web fresh build 已过**（当前 `index-jtpbai2r.js`/`index-KqGUXhFw.css`，desktop 335 passed，2026-10-13 13:20:09；旧 `index-FccGea0j.js`/294 已过时） |
| 官方 setup/回合/Move/Combat/Control/Conquer-Hold/Showdown/效果 Coverage | 未完成（P0，见第四节；部分有内部内核但不接线；效果可执行数 0；canonical 永久物 authority 仍缺） |
| 公开 Duel / room factory / protocol / 卡牌 IR / 真实 CardPlay-Move-Combat-EndTurn / 双真实 GUI / 桌面包 | 未完成（P0，见第四节第 12 条） |
| 108 只读 archive 历史流 / 109 live 建档溯源 / 106 permanent-state candidate | **108** API 已落 src（只读 API + 31 针对测试**已验收**；全 server 套件/typecheck 因 102 `room.ts` exit 2、待 102 稳定后验收）；**109 PASS 仅证明 migration input**；**106 仅 14/14 internal candidate、未接线、不计入核心套件（旧 248 / 现 434）**（见一之九） |
| 145/147/154 Basic Rune 官方 IR（CR 164.2）+ 正式 build | **145 已入 src（未 commit）**：30 Rune、registry **52 resolved / 1329 unknown**、91/91 TAP（145 时点）；147 机械适配旧测试 3 处；154 正式 `card-dsl/dist` build/typecheck/smoke 0 + 与私有 compiled 16 files `cmp` 相同。**card-dsl 当前 130**（第十一次刷新）；**IR 自动执行仍 0**（见一之十/一之十二） |
| 143/152 前端 fresh build + 卡组计数文案 | **143**：typecheck 0、**313/313（26 files）**、build 0（`index-ByPJLsZc.js`）——该时点值；**当前 desktop 335/28 files、dist `index-jtpbai2r.js`**；**152**：App.tsx **1 行**文案澄清、typecheck/build 0。**未链 131/141 liveCore** |
| 144/150/151/155 server 回归 | 144 原 **226 pass/3 fail（PARTIAL）**；150/151 局部修复 Root 核 **34+18 / 59+18=77 / 原 store 9/9**；**155 冻结合并 229/229 + typecheck 0 + smoke 0**（非 live 整包，见一之十） |
| 137/140 独立审查 | 137：129×134 冻结切片 14 probe PASS 但 **continuationId 重用 P1 → BLOCKED**（**不得写机制全正确**）；**164 已在此 slice 关闭该 continuationId 重用 P1**；140：130+129 冻结 **50/50**、真实独立 genesis/有序历史下两同 epoch 攻击**拒**、合法 restore 可继续 commit |
| 131 Gold token / 141 V2 turn executor | **已 terminal**（不再“仍在写”）；**160 冻结 130→131-141 实测 engine-core 346/346 + protocol 57/57 + compile/noEmit 全 0**，84/84 hash 相符；**但无 production source registry、无 public Main/fullmatch，非验收**（见一之十一） |
| 146 continuation 去重 | Root 已定（拒已签发 continuationId，issued/active/completed 全覆盖）；**164 已在此 slice 实施并局部验收**（Gold 15/13/83，pre-159 neg control 两例失败）；其余 P1（外部 CAS/串行持久化后 ACK）仍待 |
| 158 / 160 / 163 / 164 / 166（第十次刷新） | 158 token 独立审 **27 probes**（#17–22 为“证明不安全接受”PASS，P1/P2 findings **→ 165**）；160 冻结基线 **346/57**；163 replay 正式 **77/77**（**8795 仍 144 旧**）；164 Gold 局部 **15/13/83**；166 资源产品缺口（来源动作被 `awaiting-turn-start` 阻断，**→ 167**） |
| 161 / 165 / 167 / 168 / 169 / 170（在途） | **源码在各自独占写域内写入中，未验收**：161 pid 67966、165 pid 72216、167 pid 72631、168 pid 72805、169 pid 73230、170 pid 73767 |
| Root 真实 waiting-room GUI（新包/新服务） | server `8795` + 双 preview `4175`/`4176`，room `fd898da7`：编辑 39Main+12Rune+1Legend+1Champion+3BF、submit→Ready、刷新 OwnConfirm 恢复、dirty55 blocked、graceful restart+双 reload、revert 后恢复；`archive.log` 0600。**仅 waiting-room 恢复/隐私面**，非整局/Tauri/Win |
| **第十一次刷新组件/包快照（本轮当前值）** | engine-core **434/434**（`v2-catalog-card-type-role-fix/engine-full.tap`）、protocol **64/64**、card-dsl **130/130**（主控复验）、desktop **335/335（28 files）**、game-server **251（29 files）**（主控实测）。**均为组件/包快照**，非 full-workspace/远程 CI/native/完整对局 |
| **V2 facade / public 投影（本轮落地，未接入）** | `packages/protocol` V2 schema+guard、`engine-core/src/duel/projection-v2.ts`、`apps/game-server/src/duel/runtime-v2.ts`（自含测试 9/9）**已落地**；**但 room/server/store 零接入**（公开 room 仍 V1）。缺生产 phase provider、V2 archive codec、CardPlay/Move/Combat 命令 |
| **资源折叠小块（本轮已审查）** | compact `ResourcePoolPanel` 折叠态为真实小块（1280×720 实测 512×34）；只读/支付/来源/计数全在 `<details>` 内；`counterActions` 生产永不传；findings F1–F8 **均低危、无阻断项**（见一之十二） |
| 最终全量 `pnpm test` / `typecheck` / `build` | 见第六节；整体验收待主控 |

## 七之二、完整交付验收清单入口与下一关键路径

完整交付的验收标准、每项可观察验收与所需证据见
[`delivery-goal.md`](./delivery-goal.md)（2026-10-12 建立，基线 `8d3929d`）。
**完整原目标与 completion gate 保持不变**（见 delivery-goal 验收项 1–23）。

- 规则版本基线以 **Core Rules 1.4** 为当前生效基线（该 PDF LastUpdated 为
  2026-07-16，并非 2026-10-12 才生效；`work/rules/CR-v1.4.pdf`
  sha256=`9c5fb8b8...a5a30b`）。Core 1.5 官方 2026-10-09 公告、**2026-10-16 生效**，截至
  本轮尚未生效，不得混入。
- Duel 485.4/485.5 为各带 3 随机选 1、共 2（shared 2）；BO3 Match 486.5 是不同格式的
  后续边界，**用户当前明确要求真实 1v1 Duel，不要求 BO3**。
- 清单条目可**各自独立**达成；只有全部必要项达标整体才 complete。里程碑只是实施顺序。
- **当前整体目标仍不 complete**：1v1 共享战场 / 官方 setup / 回合 / Move / 战斗 /
  Control / 计分 / 能力覆盖 / 隐私（部分）/ 恢复 / 双 Tauri GUI / 桌面安装包等正式需求
  一律未完成或仅有局部证据。**83/88 虽进 src，97 跨回合 FAIL 已由 99 修复、103 独立复核 4 PASS
  （限 fixture-certified-no-effect 4 回合），但仍非 public 可玩。**
- **下一关键路径（剩余队列，含验收门槛与依赖）**（从“内部内核”到“公开可玩”）：
  1. ~~修复 83/88 跨回合链路 FAIL~~ **（已由 99 修复、103 复核 4 PASS，一之八）**；继续接线
     **48/49 checkpoint、CombatDamage** 及 review 56 的 FR1–FR4。
  2. **单点 trust 关口（146）**：签发必付任务须拒绝此前已签发的 `continuationId`（覆盖 issued/active/completed，
     在调用 source attestor/生成能力/改账本前）；**依赖 141 释放 `canonical-session-v2.ts`**，验收门槛：
     同一 `continuationId` 跨 task/payment 不得二次 `applied`，且现有同任务幂等重试仍正常。
  3. **131 Gold token 生命周期 + 129 Gold adapter**：真实创建/消耗/退休 proof 原子事务 + 内在 Reaction 两成本 +
     V2 production executor；**依赖 131 真实 terminal + 原始 compile/tests/source hash**；门槛：`gold-power` 在 V2
     factory session 对**真实 proof UID** 正向通过，而非 detached kernel fixture。
  4. **141 V2 turn executor / phase-source authority**：真实 trusted source registry（catalog-bound whole-program +
     完整 event/replacement 覆盖证据），unknown/unsupported 一律 pending，**绝不 no-op**；**依赖 141 释放 + 141 原始
     terminal**；门槛：真实 admitted phase / CostResolver / source provenance 接线并行验证，**不以 fixture oracle 代替**。
  5. **canonical 永久物 authority + trusted readiness/effect IR/CostResolver/source attestation**（90 取证），
     把 private cursor 纳入 archive 注册/恢复（108 只读 `readArchives` 作**输入**、109 已证 live `05715086`**具备
     migration input**；迁移合法性判定/重放接线**未做**）。
  6. →**真正 publicDuel / server 接线**：2 shared battlefield + counter UI + 真实 CardPlay/Move/Combat/EndTurn 命令 &
     gameEvents replay + V2 公共投影/renderer + source provider；**依赖 2–5**。
  7. →**private cursor/token/nonce journals 与 replay/CAS**：串行/持久化成功后 ACK（复用现有全局
     `runRoomMutation`/buffer transaction，须在新 V2 适配上实测，**不以纯内存 receipt 代替**）。
  8. →**real dual match / recovery** 与**当前原生 / fresh Tauri GUI / Windows NSIS** 桌面包、**clean-checkout 全 CI**
     （`source`/`DataVersion` 目录的完整 CardAsset 引导需 fresh checkout；**package typecheck ≠ 真实业务验收**）。
  9. →**适合 MR 的粒度**（最终由主控在功能完成且 source writer 全部释放后统一验证、提交）。
  本清单**不新增任何 user approval 或 gate**；**原完整目标与未实现范围一律保留、不删减**（两个共享 battlefield 官方
  turn、移动/争夺/战斗/计分、全部卡能力/CostResolver/事件来源、V2 DTO+renderer/sourceprovider、私有
  cursor/token/nonce journals 与 replay/CAS、真实完整双 client 对局、当前原生/Tauri/Windows 包/clean-checkout）。

## 八、残余风险

- foundation（公开）与 full-product（实验）在协议层被**别名**，后续“接了却没生效”
  极易被误判为完成；需要独立 rulesetId 或显式 experimental 边界。
- 官方卡池同步已落盘，当前 **executable=0 / judge-required=1348 / no-ability=33**；
  card-dsl 的 `fullyBound=3 / partial=10 / unknown=1368` 只证明**绑定**，不代表可执行。
  一切与此不符的旧覆盖率数字只作历史记录。
- 三页原型（含 135/145/41/55 smoke）与公开 foundation 双浏览器 fixture **均非正式**
  engine/规则测试；正式 app/server 与 Duel/资源池契约**仍需正式接线**。
- `engine-core/src/duel/*` 是**内部内核**（无 `DuelGame`、未接 server/protocol）；
  **推广进 src ≠ 公开 Duel 可用**。接线前不得声称公开 Duel 完成。核心套件 **434**（第十一次刷新）与
  server **251** / desktop **335** 均为**组件/包快照**，不代表 full-workspace/远程 CI/native。
- **checkpoint / 源落地 ≠ 完成**：48/49 只有 artifact source checkpoint，53 已 cancelled；
  59 经 83 进 src、88 Ending 进 src，**97 跨回合 FAIL 已由 99 修复、103 独立复核 4 PASS
  （限 fixture-certified-no-effect 4 回合）**，但**非 public 可玩**；
  不得以“process/models 活着”或“部分测试通过”替代完成。
- **canonical 永久物 authority 仍缺**（90）：Legend/Champion 仅 `{uid,cardId}`，
  **Gear/attachedGear 无对象**，readiness 只认 unit/rune/gold；trusted readiness/effect IR/
  CostResolver 与 **source attestation** 未接（缺 provider **一律 pending，绝不 no-op skip**）。
- **review 56 的 FR1–FR4 是接线闸门**：未满足前不得把 producer “succeeded/compiled”
  写成 full integration passed；wave 60 正在 formal 统一、未验收。**97 集中复审跨回合 FAIL 已由 99/103 修复复核，但它只是 fixture 级、非生产 IR/provider。**
- 完全失去合法目标的 restored 状态 **authority repair 未做**；F-1 已关闭但该另案未处置。
- Windows-only CI 且当前分支不触发，缺少自动回归；macOS 侧 `cargo check`/`cargo build`
  为历史局部证据（内嵌**旧 dist** `index-3Ow5BSsp.js`，二进制 sha `b608ab60…`）；
  **web 前端已 fresh build（当前 `index-jtpbai2r.js`），但无 fresh Tauri GUI、无 Windows NSIS、
  无桌面安装包**。
- 桌面 full-product 组件测试为 SSR 静态渲染；root 本轮已跑 **真实 App Duel room
  `05715086`（setup→双 mulligan→await）+ Foundation room room/deck GUI + 地址复验**，
  但**不是完整对局、不是双 Tauri**，不得据此标记验收项 19/20。
- **private journal 权限风险（第八次刷新）**：真实 regular `archive.log` 曾为 **`mode=644`**（含私有恢复令牌），
  105 fixture 的 0600 **不是通用保证**；Root 已对自己实际 regular 文件 fd-verified `chmod 600`（不读取任何令牌，
  `gui-room-proof/actual-archive-permissions.json`），但**源码级默认/既有权限修复（110）尚未验收**（110 已非 prepared、`status.json` 记 running、pid 99355）。108 只读
  `readArchives`（只读 API + 31 针对测试已验收）是 **opaque 私有历史流**（不认证 owner/CardIR、非 MAC、非 event replay）；全 server 套件/typecheck 因
  102 `room.ts` 未完成而 **exit 2**，**故全 server 套件不得报 PASS**；109 仅证明 live v1 **具备 migration input**、**未迁移**。
- **131/141 已 terminal（第十次刷新更新；原“仍在写”作废）**：`duel-token-lifecycle-v2` / `duel-v2-turn-executor`
  **已停止写入**；**160 冻结 130→131-141** 实测 engine-core **346/346**、protocol **57/57**、compile/noEmit 全 0，
  84/84 hash 相符——但这是**测试框架基线，不是生产源**：**无 production source registry、无 public Main/fullmatch**；
  **346 为 executions（phase-source-authority 7 例被 turn test import 重复注册），不得当唯一场景**，
  也不得并入其它包冒认全绿。
- **在途内核（第十次刷新）**：**165/167/168/169/170 源码在各自独占写域内写入中，161 review 仍在跑**
  （real pid 67966/72216/72631/72805/73230/73767）——**不得以 artifact 存在 / CLI succeeded / 部分测试通过当作验收**。
- **158 token 独立审 findings（第十次刷新）**：原 35 + **27 probes** 全执行 PASS，但 **#17–22 是“证明不安全接受”的 PASS**，
  非机制正确；P1（ready 改写造资源、Recruit 本源不变式）/P2（history 非独立认证）**已派 165**；**不得签收 token 恢复/release**。
- **163 replay / 164 Gold（第十次刷新）**：163 正式 replay **77/77**（**8795 仍 144 旧 cached imports**，未 claim 实机新修）；
  164 Gold **15/15（8 distinct）**/continuation **13/13（6 distinct）**/regression **83/83**，**内部 fixture、real sourceIR 与 public Main 未接**；
  **137 的 continuationId 重用 P1 仅在此 slice 关闭**，其余 P1（外部 CAS/串行持久化后 ACK）仍待。
- **166 资源产品缺口（第十次刷新）**：正式资源 UI 计数存在，但**来源动作被 `awaiting-turn-start` 阻断、任意 `+/-` 未接**；
  167 只做**来源按钮/支付摘要可见性**局部 UI 修，**仍非真实 Main 验收**。
- **144/150/151/155（第九次刷新）**：144 原 server 为 **226 pass/3 fail（PARTIAL）**；150/151 为**局部** guard / ignored-cache
  修复（Root 核 34+18、59+18=77、原 store 9/9）；**155 的 229/229 是冻结合并快照**，**非 live worktree 整包**，
  未自启常驻服务、未触真实 room/token。
- **145/153/154（第九次刷新）**：Basic Rune IR（CR 164.2）**只是绑定 + 正式编译**（52 resolved/1329 unknown），
  用户卡能力可执行数仍 **0**；153 词匹配**只是排期证据**，**不赋 keyword 规则能力**。
- 证据命令凡属 **本地 ignored 输出 / 冻结快照**者均为**本地记录**，**不是 fresh checkout 验证命令**；本文未复制任何
  secret / resumeToken 或大段工具日志。**package typecheck / 组件快照 ≠ 真实业务验收**。
- **第十一次刷新（组件/包快照 + V2/资源）**：engine-core **434/434**、protocol **64/64**、card-dsl **130/130**、
  desktop **335/335（28 files）**、game-server **251（29 files）**（主控实测）均为**组件/包快照**，非 full-workspace/远程 CI/native/完整对局；
  **V2 protocol schema+guard / `projection-v2.ts` / `runtime-v2.ts` 能力已落地但 room/server/store 零接入**（公开 room 仍 V1），
  **生产 phase provider、V2 archive codec、CardPlay/Move/Combat 命令仍缺**；资源为**折叠小块**（`counterActions` 生产永不传，
  findings F1–F8 低危无阻断）；当前桌面 dist `index-jtpbai2r.js`/`index-KqGUXhFw.css`（2026-10-13 13:20:09）为唯一可核值，
  其余 `index-*.js`/`index-*.css` 引用均过时。**整体目标仍 active / 不 complete。**
- 未实现的官方规则与卡牌效果必须保持 `judge-required` / `blocked`，不得近似实现。
