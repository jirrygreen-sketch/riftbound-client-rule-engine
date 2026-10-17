# RIFT-342：optional Unit 服务退役证据

核查日期：2026-10-16 至 2026-10-17（UTC）；任务起点：`ff1b8c3`，分支
`task/RIFT-342-server-batch-e-parity-optional-unit`。适用契约：
`docs/plans/2026-10-15-p0-contract.md` 3.1–3.9、4、5、7.1(6)。

**结论：不能删除旧服务。** 两张实际受理的卡牌在新 CardProgram 注册体系里
均为 `judge-required`。本次新增旧命令轨迹基线、纯投影的局部对照，以及
26 个具名新内核 TODO；TODO 不是通过证据，也没有使用手填费用、手工入场或
把程序临时改为 executable 的办法替代缺失接线。

## 1. 卡牌与旧服务边界

| 印刷 / 卡名 | canonicalCardId | 印刷值 | optional pay 的总费用 | decline 的总费用 |
| --- | --- | --- | --- | --- |
| `ogn-001-298` / Blazing Scorcher | `card.hash-0da93712208ccce43badde9998369ec8b785af649c804e812feb2bb580f2908c` | Energy 5、Power null、Might 5、Fury | 6 Energy + 1 Fury Power | 5 Energy |
| `ogn-010-298` / Legion Rearguard | `card.hash-a276ed720995bb4d684f3f838182e4271ea398c1cac8f48837c9e7c292cd0497` | Energy 2、Power null、Might 2、Fury | 3 Energy + 1 Fury Power | 2 Energy |

数据来自当前本地 catalog、旧 `setup-adapter-catalog.ts` 中的原始印刷元组，
以及 `packages/card-dsl/src/cards/ogn/{blazing-scorcher,legion-rearguard}.ts`。
`power: null` 保留其“没有印刷 Power 值”的含义；上表的“无 Power 支付要求”
与将印刷值写成 0 是两回事。本任务未修改目录、卡牌程序或生成文件。

| 旧文件（均在 `apps/game-server/src/duel/`） | 责任与不可省略的外部行为 |
| --- | --- |
| `optional-unit-services-p4.ts` | 只识别完整纯 Accelerate Unit 元组；绑定真实 Hand UID/epoch/catalog/program；审计全量 cost source census；仅当前所打出来源贡献可选附加费用；冻结总费用；无法证明时停止 |
| `optional-unit-entry-boundary-v1.ts` | 证明完整进场边界和所有候选来源，不代替选择、支付或移动；未知/活跃来源不能伪报 clear |
| `optional-unit-native-source-p6.ts` | 将当前 admitted head、真实 journal 身份、census、source epoch 与当前进程 choice receipt 绑定；缺失/多余/重复/复制/过期/异源对象不获准 |
| `optional-unit-payment-entry-v3.ts` | 支付前的 receipt 与支付后的真实 session/task/continuation、已完成 payment 和当前 journal 对接；跨版本资源命令后仍按原选择入场；重复支付不再扣费/入场 |
| `optional-unit-choice-projection-p6.ts` | 无 choice 时 null；owner 可见两枚 opaque option；对手/旁观者仅 `{active:true}`；不投影 UID/program fingerprint/epoch/receipt |

上述 closure/identity 约束是旧实现的安全机制，不要求新内核复制其私有 callback
形状；新内核必须保留相同的原子性、权限、隐私和一次性语义。

## 2. 测试组织与证据范围

新文件位于 `apps/game-server/tests/parity/optional-unit/`：

| 文件 | 执行内容 | 能支持的结论 |
| --- | --- | --- |
| `scenarios.ts` | 两张卡的元数据、E01–E13 迁移场景 | 审计清单，不执行游戏逻辑 |
| `legacy-flow.ts` | 真实 catalog 合法牌组；seeded 发牌；两个 mulligan；正常 End 到 Main；真实 play/answer/rune/pay；严格 replay | 可重用旧路径输入，不直接写 frame/zone/resource/health |
| `legacy-observations.test.ts` | 2 卡 × 2 决策 × 当前 clock / physical Chain，共 8 条完整旧轨迹 | 旧服务的费用、区域、进场朝向、计分不变、ACK 幂等与恢复基线；不是新 CardProgram 执行证据 |
| `projection.test.ts` | 从真实 issued choice 只读翻译为新 `projectFor` 输入；对比 owner 选项顺序/数量/上下界和非 owner 不得见 token；对照旧纯投影 adapter 与真实 runtime 输出 | 2 条纯投影局部 parity；不能证明新游戏打出、收费、入场或完整 wire DTO 一致 |
| `new-kernel.todo.test.ts` | E01–E13 × 两张卡；每条标题包括卡名、印刷、命令行为与具体缺口 | 26 个未满足的退役条件；不写“断言功能不存在”的通过测试 |

旧 facade 的 `DuelAuthoritativeRuntimeP4Result` 只给 ACK 和 viewer projection，
没有 `PipelineEvent[]`。本次基线锁定实际接受的 wire command 顺序、
choice 打开的 stateVersion/eventSeq 增量、每一检查点的 zones/resources/scoring，
不会把命令名或 journal 的 `legacy-dispatch` 伪装成游戏事件种类。
新内核逐个时点/事件的完整顺序对照仍属于 E04/E05/E12 TODO。
新 `Match.events()` 已能读取 Chain pipeline 的事件；这里缺少的是两端真实打出路径
以及与同一已提交命令关联的对照窗口，并非新内核完全没有事件观察能力。

纯 projector 对照只翻译已经由旧 owner 发行的 token，不生成 receipt、不传入费用、
不调用替身 entry、也不让 judge-required 卡牌进入新打出路径。新 `ProjectionV2`
仅向 chooser 输出 choice；旧 wire 还对非 owner 输出 `{active:true}`。测试仅证明
共同的选项与隐私语义。完整 active 标记、wire 格式和 pending-payment 包装仍属 E01/E07。

## 3. 场景清单：相同输入与期望观察

共同前置：使用原有 `fury77-real-decks.ts` 的真实合法牌组，randomIndex 恒为 0，
按实际 owner 顺序提交两个 `mulligan([])`。Legion Rearguard 正常 End 两次到
Alice Main 3；Blazing Scorcher 正常 End 六次到 Alice Main 7，确保真实可支付。
每次选择、费用、支付 ID 和 Rune UID 都从当前合法投影读取，不猜测私有 token。

| ID | 命令序列 → 可观察结果 | 旧证据（`tests/duel/`） | 本次新内核状态 |
| --- | --- | --- | --- |
| E01 | play → 只开放 answer；owner 两选项；其他 viewer 只知 active；此时不扣资源、不入场、不计分 | choice-projection-p6、choice-clock-p4、runtime-p4 | 局部投影对照；卡牌打出与 wire bridge TODO |
| E02 | pay 选择 → 冻结上表额外费用；其他 Hand/Deck 的同卡或另一 Accelerate 不叠加 | services-p4、cost-source-applicability-v1 | 两卡 TODO；无 keyword → optionalAdditional 消费方 |
| E03 | decline 选择 → 冻结印刷 Energy，Power 支付要求为空 | cost-source-applicability-v1、runtime-p4 | 两卡 TODO；明确拒绝选择及冻结计划未接入 |
| E04 | pay → Rune Energy × N → ready Fury Rune Power → pay-pending → 一次 Base ready 入场；无 become-ready 触发、无得分 | payment-entry-v3、runtime-p4、physical-chain-p8 | 两卡 TODO；paid receipt → 延迟入场替代未接入 |
| E05 | decline → Rune Energy × N → pay-pending → 一次 Base exhausted 入场；无得分 | payment-entry-v3、runtime-p4、physical-chain-p8 | 两卡 TODO；真实程序/Chain/entry 路径未接入 |
| E06 | 等 choice 时 Rune 命令 blocked；wrong actor / stale version / foreign option / foreign prompt 拒绝且状态不变 | choice-clock-p4、runtime-p4、physical-chain-p8 | 两卡 TODO；新 command/choice 认证桥未接入 |
| E07 | 余额不足或非 owner pay 拒绝；随后逐次真实 funding；原决定和费用不变；支付完成前无 Unit | runtime-p4、payment-entry-v3、physical-chain-p8 | 两卡 TODO；pending payment + continuation 未接入 |
| E08 | 重送相同 choice / resource / pay packet → duplicate ACK；无重复 debit、Unit、eventSeq | runtime-p4、payment-entry-v3、physical-chain-p8 | 两卡 TODO；新 command/journal 幂等桥未接入 |
| E09 | 第一 Unit 完成后按正常回合补资源 → 第二 Unit play/decline → 独立 choice/payment/entry | runtime-p4 | 两卡 TODO；每次入区的选择与费用生命周期未接入 |
| E10 | 非纯/mixed text、未知程序、缺失/额外/重复/stale candidate、cloned receipt/session/journal、foreign head、读取中 reentry → 停止且不消耗资源/不入场 | services-p4、native-source-p6、entry-boundary-v1、payment-entry-v3、cost-source-applicability-v1 | 两卡 TODO；新全量来源与 incarnation 绑定未形成同等执行证据 |
| E11 | choice/payment/已 funding 时严格重放或房间恢复 → 原 token/费用/view 恢复 → 只入场一次 | room-p4、choice-clock-p4、physical-chain-recovery-p8、runtime-p4 | 两卡 TODO；新 game + journal/recovery 未接入 |
| E12 | play → Hand 离区/Pending Chain/Closed → choice → total cost → payment → legality → finalize/entry；所有 viewer 的区域与事件顺序一致 | physical-chain-p8、physical-chain-recovery-p8 | 两卡 TODO；v1.5 物理 Chain 新卡牌打出与事件对照未接入 |
| E13 | 历史实际战斗结束后的 Main5 → 新 play/decline/pay → exhausted Unit；既有 score 保留；旧 journal 严格回放 | resolved-history-p9（当前已标 historical skipped） | 两卡 TODO；未重跑或改写旧历史记录，缺新 resolved-history 执行轨迹 |

表中旧文件名均带 `optional-unit-` 前缀与 `.test.ts` 后缀。
“旧证据”列指场景来源和现存断言，不代表这些文件本轮全部通过；实际执行结果见第 7 节。
历史 schema 6、8/9 专用测试的既有 skip 分类保持不变；本次只对新建的
current clock 与 physical 路径轨迹做严格重放，不能据此声称 profiles 1–9 全部验证。

## 4. CR v1.5 判定与已知差异

规则来源只读自 `/root/swarm-rift/shared/rules/CR-v1.5.txt`，通过定位后按段读取；
未下载 PDF。

| 项目 | v1.5 依据 | 本次判断 |
| --- | --- | --- |
| pay 与 decline、费用与顺序 | 355.1.a、355.15、356.2.b.1、805.1–805.2.a | 先明确选择是否附加支付，再算总费用；拒绝只收 base，接受增加 1 Energy + 1 匹配域 Power。不能按余额自动拒绝/接受，也不能在场上补付 |
| 额外费用只属于本次来源 | 805.3、805.4 | 其他牌/已在场 Accelerate 不为本次打出额外收费；同一 Unit 的多个 Accelerate 冗余 |
| ready/exhausted 入场 | 143.4、805.2.b、805.6、805.6.a | pay 后的延迟替代产生直接 ready 进场；不得先 exhausted 入场再 ready；付费后失去关键词仍须 ready。decline 没有该替代 |
| 当前 clock 的先后顺序缺陷 | 354、354.1–354.2、355.1.a | 当前旧路径先发行 Hand choice，clock 只加一个版本而不移动载体；实体 Chain 路径先移动 Hand → Pending Chain 后发行 choice。以 CR 为准，新路径必须采用后者。新基线只对 physical 路径断言正确离手/入链，不把当前缺陷写成通过预期 |
| 支付与实体入场的先后 | 357.1.a、358.1–358.5、359.1–359.2.c | 可在支付步骤使用产资源的 Reaction ability；先付费并检查合法性，再结束 Pending 并实体入场。失败须撤销整个打出；不能为通过对照而手移 Unit 或绕过 Chain |
| 旧 Rune Power 测试曾回收 exhausted Rune | 164.2.b–164.2.b.1 | v1.5 的 Power ability 有 exhaust 与 recycle 两项 cost。本次真实轨迹预留一枚 ready Fury Rune，再由其他 ready Rune 支付 Energy；不把旧“可从 exhausted Rune 产 Power”的行为当作目标 |
| 信息公开 | 141.1.a.2、354、契约第 4 节与 projection/v2 README | 上场 Unit 与 Chain 为公开状态；选择详情只给 owner，不能附带隐藏 UID/program/receipt。公共 active 标记是 wire 兼容问题，不是虚构 CR 的理由 |

尚无可执行的新 CardProgram 全轨迹，因此没有“旧收费/新收费不同但已裁定新实现正确”
这样的运行结论。上表的顺序差异来自实际旧代码/现存测试与 CR 对照，而不是
伪造一次新内核运行来制造差异。

## 5. 新内核准确阻塞点

1. 两张真实卡牌的 `status` 都是 `judge-required`；`judgeReason` 指向
   Accelerate keyword 的费用和替代接线。`src/programs/registry.ts` 会拒绝该状态，
   正常 `describePlay` 无法产生可执行 ChainDraft。不能在测试里覆盖 status。
2. `effects/keywords/Accelerate.ts` 已能展开 `accelerate.cost` 与 replacement；
   `cost/cost-plan.ts` 已能处理调用方提供的 optionalAdditional；
   `chain/engine.ts` 可读取 selectedAdditional 的 accelerate 来决定入场朝向；
   `replacement/` 也已有 entry 绑定。缺的是**从真实卡牌声明产生、选择、支付、保存
   receipt 并安装对应延迟替代**的整条连接，不能把已有单个模块误报为完整覆盖。
3. `src/programs/play.ts` 目前读取 play ability 的普通 cost，没有把展开后的
   `accelerate.cost` 生成 optionalAdditional；`src/game/lifecycle.ts` 携带的 programs
   依赖仍是 opaque，不能把旧服务接进其中便称为新内核覆盖。
4. 新 `projectFor` 是纯内核 projector，没有旧 pendingChoice/public-active 与
   pendingPayment 的 wire wrapper；本任务的只读投影对照没有补生产接线。

## 6. 服务可删除的前置条件清单

- [ ] 真实两卡在保留原文、canonicalId、null 印刷值的前提下，经完整执行证明后转为 executable。
- [ ] 新 game/programs 从真实 Accelerate keyword 自动形成选择与附加费用，正确冻结 pay/decline 和 Fury 域要求；不用测试手填 optionalAdditional。
- [ ] receipt 绑定本次物理来源与入区序号；费用为 0 时仍保留选择事实；失去关键词后付费替代仍生效；另加相应 CR 场景。
- [ ] 真正的 paid-entry delayed replacement 只在已支付时安装；进入 ready 没有 Board 上的 become-ready 事件/触发。
- [ ] E01–E13 两卡 TODO 全部转成真实新旧轨迹对照；区域、费用、scoring 以及事件种类/顺序逐项比较；v1.5 的有意差分写明条目。
- [ ] 覆盖全量费用/进场来源、unknown/mixed 程序、错 actor/版本/epoch、重复 packet、异源/复制 receipt 和原子失败；不绕过 ACK guard。
- [ ] 新 wire 投影保留 owner 选项与 opaque token、公共 activity、pending-payment 隐私和字段权限；双玩家及旁观者检查一致。
- [ ] choice/payment/funding/entry 各检查点经新 journal 严格恢复且只结算一次；E09 第二次打出与 E13 历史退役后的新打出有真实执行轨迹。
- [ ] 旧 profiles 1–9 的只读 replay 兼容路径独立保留，旧日志/default profile/schema 不升级；退役由协调者审查所有调用方后执行。
- [ ] server typecheck、全 workspace typecheck、server 全量测试、integration-tests 全量测试通过；历史失败与未满足项不得计入完成。

## 7. 契约变更请求与验证

请求协调者提供稳定的“新 game 命令 → programs → Chain/Cost/Replacement → viewer
projection/journal”接线接口，明确 suspended choice/payment 的恢复点与 receipt 身份，
并让两端事件与同一已提交命令关联（新内核已有 `Match.events()`），形成可比窗口，
才能在不伪造 callback、不替换状态、不移植旧
手写服务的情况下完成 E01–E13。纯投影的 public activity/payment wire 映射也须由
协议/服务端协调者确定。本任务不修改冻结契约或范围外生产代码。

日志统一保存到 `/tmp/RIFT-342-server-batch-e-parity-optional-unit/`。

| 命令 | 当前结果 | 日志 |
| --- | --- | --- |
| `pnpm --filter @riftbound/game-server typecheck` | 退出 0 | `server-typecheck.log` |
| `heavy pnpm typecheck` | 退出 0；包含 packages build 和全部 workspace typecheck | `workspace-typecheck.log` |
| `pnpm --filter @riftbound/game-server exec vitest run --config vitest.config.ts tests/parity/optional-unit` | 首轮 9 通过、1 超时、26 TODO；超时场景修正时限后单独重跑通过（见下文） | `parity-focused.log` |
| `heavy pnpm --filter @riftbound/game-server test` | 退出 1；632 通过、15 失败、37 skipped、26 TODO；8 失败 / 87 通过 / 7 skipped 文件。新增 10 项检查全部通过 | `game-server-full.log` |
| `heavy pnpm --filter @riftbound/integration-tests test` | 退出 1；主套件 39/39 通过；default-path 组 1 通过、9 失败 | `integration-tests.log` |

首轮仅 Scorcher physical Chain/pay 的七回合、四检查点重放超过 120 秒，
未出现状态断言失败。为七回合的 Scorcher 轨迹单独设置 180 秒限额，
没有删检查点或改断言；以下单场景重跑退出 0，1 通过、7 个因 `-t` 未选择，
耗时 83.41 秒：

```sh
pnpm --filter @riftbound/game-server exec vitest run --config vitest.config.ts tests/parity/optional-unit/legacy-observations.test.ts -t 'ogn-001-298 physical Chain: pay'
```

日志为 `scorcher-physical-pay-retry.log`。结合首轮其余 9 项通过，新增 10 项检查
均有通过执行记录；随后整包运行中新增 10 项全部通过，26 TODO 保留。

server 整包耗时 1262.72 秒，15 项失败均在未修改的既有文件：

| 文件（相对 `apps/game-server/tests/`） | 失败数 | 关键结果 |
| --- | --- | --- |
| `constructed-regional-room.test.ts` | 4 | 旧 duelProfile、journal 与 schema 4/5 预期得到 undefined |
| `duel/optional-unit-room-p4.test.ts` | 1 | 旧 runtime profile 归档字段得到 undefined |
| `duel/optional-unit-physical-chain-recovery-p8.test.ts` | 1 | 旧 journal schema 8 得到 undefined |
| `duel/persistent-room.test.ts` | 2 | 旧命令被 P4 guard 拒绝；旧 duelSession 字段缺失 |
| `duel/public-room-p4.test.ts` | 1 | 旧 duelProfile 字段缺失 |
| `duel/public-room.test.ts` | 2 | 旧命令被 P4 guard 拒绝 |
| `duel/public-websocket-p4.test.ts` | 1 | durable ACK 后校验的旧归档字段为 undefined |
| `duel/public-websocket.test.ts` | 3 | 旧动作收到 command-rejected，测试等待 request-result 超时 |

因此 server 全量验收未通过。这里没有修改生产 room/runtime、放宽既有 ACK guard、
删除断言或改写日志来消除失败；这些失败须由对应归档/默认路径协调任务处理。

integration-tests 的 9 项失败均在未修改的 `test/default-path/snapshots.test.ts`：
一项固定 CLI 回退源码模式的断言不匹配；其余八项在 `DefaultPathDriver.create`
校验既有 room archive 的 schema 7 时停止，尚未执行场景命令。它们不是新增
optional-unit 测试的失败。本任务没有修改默认 profile、日志 schema 或旧快照；
该集成门禁仍未满足，应由拥有默认路径/room 接线的协调任务处理。

另以 `pnpm --filter @riftbound/game-server exec vitest run --config vitest.config.ts tests/constructed-regional-room.test.ts`
隔离运行既有测试，复现 4 失败、4 通过：旧 `duelProfile`、`duelJournal` 和
schema 4/5 预期读到 `undefined`。该命令不加载本次新增测试，详见
`existing-regional-isolation.log`；本任务未修改 room 或这些断言。

补充检查：用 `/tmp` 下临时配置将新增测试纳入 `tsc --noEmit`，唯一诊断是原有
`tests/duel/fixtures/fury77-real-decks.ts:2` 引用 protocol 未导出的 `DeckSubmission`
（TS2724）。正常 server/workspace typecheck 不包含这份旧测试 fixture；本任务
没有为消除诊断修改契约或该范围外文件，详见 `parity-typecheck.log`。
