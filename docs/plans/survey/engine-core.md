# engine-core 规则内核调研

> 调研日期：2026-10-15。范围是 `packages/engine-core/src/**` 的全部 TypeScript/JavaScript 源码；本文件只记录静态源码、导出、引用和测试盘点，不把静态可达性当作运行时执行证明。

## 结论先行

- `src` 共有 **64 个源码文件、33,596 行**；其中有 **13 对同名 `.js`/`.ts` 文件**。`.ts` 是类型检查和构建输入，源码中的 `.js` 相对导入按 TypeScript bundler 解析到对应实现；构建后只有一个同名 `dist/duel/*.js`，因此每一对不是两个独立运行时模块，而是同一概念的两份源码实现，必须在收敛时合并再删除 `.js`。
- `duel/index.ts:4-54` 把 V1、V2、V3、V4、旧 JS/TS 双份实现全部放进同一个公共桶；`src/index.ts:74-118` 又把 synthetic 与 foundation 两套规则集放进根入口。这是当前最大的耦合和冲突热点。
- CLI 默认配置是 `RIFTBOUND_DUEL_PROFILE` 未设置时取 `p4`（`apps/game-server/src/index.ts:5-9`）。在 p4 且未设置 `RIFTBOUND_DUEL_RUNTIME_PROFILE` 时，`apps/game-server/src/index.ts:19-24` 选择 `optional-unit-choice-clock-v4`；`room.ts:200-202` 将它传入 P4 构造，`room.ts:536-538` 走 `createDuelRecordedRuntimeP4`。因此当前 CLI 默认对局的实际路径是 **P4 + optional-unit-choice-clock-v4 + `canonical-session-v2` + `cardplay-unit-v2` + `optional-play-choice-v1` + `projection-v3`**。这是代码事实，不是根据文件名推断。
- “最新语义”与“默认语义”不同：`projection-v3`、`cardplay-unit-chain-v4`、`optional-play-choice-v2`、`token-play-v3` 是各自族中版本号最高的实现，但默认 P4 只启用其中的 V3 投影；默认 optional Unit 仍使用 V2 Unit executor 和 V1 choice authority。`cardplay-unit-chain-v4` 只有 physical-chain profile 才启用，`optional-play-choice-v2` 由 physical-chain 路径使用，`token-play-v2/v3` 目前没有 game-server 生产源码直接引用。
- 当前实现不是 HOT FEPR：有不少“阶段/继续执行/支付/来源证明”内核，但动作仍按卡型手写在 `cardplay-*.ts`，目标、触发、替代、事件和效果没有统一的 `Intent -> Replacement -> Prevention/Modification -> Commit -> Trigger -> Pending -> Cleanup` 管线。设计文档要求的单一引擎、单一管线、EffectIR、单 runtime/单 journal 尚未成立。

## 证据和口径

使用过的命令及关键输出：

```text
rg --files packages/engine-core/src -g '*.ts' -g '*.js' | wc -l
64

for f in $(rg --files packages/engine-core/src -g '*.ts' -g '*.js'); do wc -l < "$f"; done | awk '{s+=$1} END{print s}'
33596

rg --files packages/engine-core/test -g '*.mjs' -g '*.js' -g '*.ts' | wc -l
84

for f in $(rg --files packages/engine-core/test -g '*.mjs'); do rg -o '\b(?:test|it)\s*\(' "$f" | wc -l; done | awk '{s+=$1} END{print s}'
841

pnpm --filter @riftbound/engine-core build
$ tsc -p tsconfig.json
```

测试文件总行数是 **26,661**。测试用例数是按源码中的 `test(`/`it(` 声明计数，含少量参数化/嵌套声明口径；它不是一次运行报告。构建在本次工作树通过。完整逐文件计数证据保存在 `/tmp/RIFT-7-survey-engine-core/test-counts.txt`、`/tmp/RIFT-7-survey-engine-core/inventory2.jsonl` 和 `/tmp/RIFT-7-survey-engine-core/test-map-grouped.txt`。

引用规则：源码职责和导出引用 `文件:行号`；“被谁引用”分为直接源码导入、经 `duel/index.ts`/根入口的包导入、以及测试导入。静态扫描无法证明函数在运行时被调用；没有直接生产引用的模块在“死代码候选”中明确标为候选，而不直接宣称可删除。

## 默认路径和多版本

### 默认 runtime profile

| 决策点 | 代码证据 | 实际结果 |
| --- | --- | --- |
| 房间 profile 默认值 | `apps/game-server/src/index.ts:5-9` | `RIFTBOUND_DUEL_PROFILE` 缺省为 `p4` |
| runtime profile 缺省分支 | `apps/game-server/src/index.ts:11-24` | p4 且未设置环境变量时取 `optional-unit-choice-clock-v4`；显式 `public-chain-v1` 才让 profile 变成 `undefined`，随后由 P4 owner 默认 `public-chain-v1` |
| 房间传递 | `apps/game-server/src/server.ts:593-601`、`apps/game-server/src/room.ts:194-202` | trusted room 将 profile 送入 P4 options |
| P4 创建 | `apps/game-server/src/room.ts:521-538`、`apps/game-server/src/duel/command-journal-p4.ts:182-203` | P4 房间走 recorded runtime，再调用 authoritative P4 owner |
| P4 语义开关 | `apps/game-server/src/duel/authoritative-runtime-p4.ts:373-401` | clock profile 打开 optional Unit、public Chain、Spell；不打开 physical Unit chain |
| P4 投影 | `apps/game-server/src/duel/authoritative-runtime-p4.ts:25`、`:108`、`apps/game-server/src/duel/runtime-v3.ts:93-118` | 使用 `projectCanonicalDuelMatchV3`，动作计算复用 V2 inspector |

`createAuthoritativeDuelRuntimeP4` 自身若没有 profile 会默认 `public-chain-v1`（`apps/game-server/src/duel/authoritative-runtime-p4.ts:373-390`），但这不是 CLI 默认，因为 CLI 已在 `index.ts:19-24` 注入了 optional clock profile。V1 房间则在 `room.ts:536-539` 走旧 `runtime.ts`，其 session 是 `canonical-session.ts`/`.js` 的 V1 API。

### 多版本清单

| 概念 | 并存实现和静态差异 | 默认路径 | 最新语义/迁移判断 |
| --- | --- | --- | --- |
| Canonical session | `canonical-session.js:1-7` 与 `canonical-session.ts:1-11` 是同一 V1 staged session 的 JS/TS 双份；导出旧 `DuelCommandSession`、资源命令和 `projectCanonicalDuelMatch`（TS 入口见 `:17-104`、`:225-545`）。`canonical-session-v2.ts:1-21` 引入 V2 command envelope、state version、source attestation、required-cost task、turn cursor，并把旧 session 作为类型依赖。 | P4 用 `canonical-session-v2`；V1 room 用 JS/TS V1。 | V2 是当前 P4 语义；最终合并为唯一 session/command boundary，保留来源证明与幂等能力，删除 V1 双份。
| Token play | `token-play-v2.ts:1-3`、`:249-296` 是 Recruit token 的 V2 process-local Chain reservation；`token-play-v3.ts:1-3` 与其导出 `DuelRecruitTokenPlay*V3` 是 V3 同概念接口。V3 的测试是 `duel-recruit-canonical-chain-v3`；二者都依赖 `core-v2` 的 token reservation。 | 当前 game-server `src` 没有直接导入两者；P4 的实际 token primitives 在 `core-v2.ts:1524-1690`。 | V3 是最新高层 token API，但应先迁移为通用 Chain + `createToken` EffectIR，再删除 V2/V3 高层包装；不要把 V3 直接当目标架构。
| Unit play | `cardplay-unit-v2.ts` 是普通 Unit entry/turn/move/optional payment；`cardplay-unit-chain-v4.ts:1-3` 是 physical Unit 进入 Chain 后的 V4 attempt/choice/cost/attestation/resolved-history。 | CLI 默认 optional clock 走 `cardplay-unit-v2`，因为 P4 的 `physicalUnitEnabled` 只在 physical-chain/resolved-history profile 为真（`authoritative-runtime-p4.ts:379-383`）；physical profile 才走 V4。 | V4 是物理 Chain 语义最新版本；普通 Unit 的通用入口应合并为 `chain` + `cost` + `target` + `effects` 原语，不能保留一个“Unit V2”和一个“Unit chain V4”长期并列。
| Projection | `projection-v2.ts:1-9` 固定 V2 wire schema，忽略 private provenance/permanent fields，入口 `:181-208`；`projection-v3.ts:1-4`、`:30-31` 在 admitted V2 state 上增加 settled permanent/gear 等 playing-only fields，入口 `:185-213`。 | P4 authoritative owner 使用 V3（见上表）；`runtime-v2.ts:103-...` 的旧 adapter 使用 V2。 | V3 是最新投影语义，但目标应只有一个当前 projection；把 V2/V3 差异显式并入协议当前版本，不再由 engine 内维持两套 projector。
| Optional play choice | `optional-play-choice-v1.ts:1-3` 只做 process-local pay/decline receipt，明确不授权 payment/movement/effect（`:128-130`）；`optional-play-choice-v2.ts:1-4` 要求 physical Unit 已入 Chain 且 state 已关闭，prompt 绑定 chain head（`:144-158`）。 | 默认 optional clock 导入并创建 V1 authority（`authoritative-runtime-p4.ts:47-50`）；physical chain 使用 V2 prompt（`:84`）。 | V2 是较新的 physical Chain choice；目标是通用 `Prompt`/`TargetPlan`/`CostPlan`，保留 lineage guard，删除 V1/V2 名称分叉。
| Turn executor/flow | `turn-flow.js/ts` 和 `turn-start.js/ts` 是旧 awaken/beginning flow；`turn-executor-v2.ts:1-3` 是 admitted V2 turn cursor、checkpoint、start/end turn executor。 | P4 runtime-v2/authoritative owner 使用 V2 turn executor；V1 runtime 使用旧 flow。 | V2 是当前 P4 语义；最终迁移到 `turn/` 的统一 FEPR turn driver。
| State/engine | 根 `index.ts:153-155` 明确 foundation 是 narrow vertical slice；`state.ts:92-210` 同时定义 synthetic/foundation 两个 `RulesetId` 和两套 `GameState`。Duel 又有 `match-state`、`core-v2`、permanent state 三套状态载体。 | 默认根 `createConfiguredGame` 为 foundation（`index.ts:178-...`），P4 Duel 走 duel barrel。 | 设计目标只维护一个当前规则内核；synthetic compatibility 与 Duel/foundation 必须先定边界，再收敛为当前 state model。

## 死代码候选

以下模块没有被 `apps/game-server/src`、`apps/desktop-client/src` 或 `packages/integration-tests/src` 直接引用；它们可能仍经 `duel/index.ts` 被外部调用，或是未来拼装预留，因此是“只被自身测试/桶导出引用”的候选，不是本次直接删除清单：

- `cardplay-gear-v1.ts`：生产源码无直接引用，测试仅 `duel-gear-physical-chain-cardplay-v1.test.mjs`（8 个用例）。
- `conquer-v2.ts`：生产源码和其他 engine 源码无直接导入，只有 `duel-conquer-v2.test.mjs`（9 个用例）。
- `token-play-v2.ts`、`token-play-v3.ts`：生产源码无直接引用；分别由 `duel-recruit-token-play-v2.test.mjs`（12）和 `duel-recruit-canonical-chain-v3.test.mjs`（14，另共享 V2 测试）覆盖。
- `combat-choice-v2.ts`、`combat-damage-executor-v2.ts`：当前生产 owner 未直接导入；二者由 `engagement-executor-v2` 的 engine 内部组合和各自测试覆盖，需确认是否保留为 combat 原语后再删。
- `private-journals.ts` 与 `resource-readiness-journal-v2.ts`：仅 Node private-journals 子路径/自身测试；`package.json:12-16` 暴露 private-journals 子路径，但 game-server 当前没有生产源码导入。它们是持久化审计迁移前的候选保留件。
- `phase-closure-boundaries-v2.ts`：由 `phase-source-closure-v2.ts` 类型/逻辑引用，并由 `duel-phase-closure-boundaries-v2.test.mjs` 覆盖；没有 server 直接 import，但是 closure 内部依赖，不能按“无 server 直引”直接删除。
- `standard-move-executor-v2.ts`、`draw-effect-executor-v2.ts`、`kill-damage-effect-executor-v2.ts`、`point-damage-effect-executor-v1.ts`、`derived-might-v2.ts`、`base-combat-allocation.ts`：server 未直接导入，但分别由 `cardplay-unit-v2`、`cardplay-spell-v2`、`point-damage`、`engagement`、`core-v2` 的生产组合间接到达；不是死代码，只是 barrel/transitive 使用。
- 所有旧 `.js`/`.ts` 同名对：测试和 V1 生产路径仍能触达，不能仅凭 `.js` 后缀判死；重设计要求最终删除 `src` 下 `.js`（`/root/swarm-rift/shared/redesign.md:53-58`），前提是先把 TS 语义和测试迁移完成。

## 与 HOT FEPR 设计的偏差

设计的 HOT FEPR 是 `Handle Outstanding Tasks -> Finalize -> Execute -> Pass -> Resolve`（`docs/rule-engine-architecture.md:66-107`）。现实现的偏差如下：

1. **阶段模型不统一。** 根 engine 只返回 `HOT_FEPR_STEPS`（`src/index.ts:106-115`）；Duel V1 使用 `awaiting-turn-start/awaken/beginning/scoring/channel/draw/main/...`（`canonical-session.ts:17-20`），P4 又在 `core-v2` 中使用 admitted match、command session、turn cursor。它们没有一个统一的 `Item/Prompt/FEPR` 状态机。
2. **Finalize/Execute/Resolve 被卡型模块切开。** Spell、Unit、Gear、Token 各有自己的 begin/resume/finalize/cancel API，例如 `cardplay-spell-v2.ts`、`cardplay-unit-v2.ts`、`cardplay-gear-v1.ts`、`token-play-v2/v3.ts`；重设计要求这些迁移到统一原语和注册表（`redesign.md:60-73`）。
3. **EffectIR 缺失。** 当前根 state 只有 `DamageEffect | GainPointsEffect | JudgeRequiredEffect`（`state.ts:43-78`），而 HOT 设计要求 draw/damage/kill/move/createToken/sequence/conditional/repeat 及 `ExecutionOutcome`（`docs/rule-engine-architecture.md:160-180`）。
4. **TargetPlan 缺失。** 当前 prompt/choice 由每个 cardplay/optional 模块自行定义；设计要求 Finalize 锁定引用、Resolve 重测，并区分 `mistargeted/ignored/partial` 等结果（`docs/rule-engine-architecture.md:135-158`）。现有代码虽有 UID、zone epoch、source proof，但没有统一目标计划和效果 outcome。
5. **事件、触发、替代效果没有单管线。** 现有 closure/evidence/journal 主要证明来源和支付，设计要求所有 Intent 经过 replacement、prevention/modification、commit、trigger scan、pending ability、cleanup（`docs/rule-engine-architecture.md:182-214`）。当前没有对应统一事件 registry；效果由卡型 coordinator 分散执行。
6. **状态与投影多套并存。** 根 synthetic/foundation、Duel V1、Duel V2、permanent physical state 同时存在；projection-v2/v3 并存。设计要求一个当前 engine 和一个 player projection（`docs/rule-engine-architecture.md:216-230`）。
7. **服务端仍是 profile/journal 叠加。** P4 runtime profile 常量和 schema 分支在 `authoritative-runtime-p4.ts:131-152`，不同 profile 改变 spell、optional Unit、physical Unit chain 开关（`:376-390`）。重设计明确要求一个 runtime、一种 journal，旧日志由冻结 tag 回放（`redesign.md:75-81`）。
8. **卡牌逻辑仍是手写服务。** game-server 的 production-source、spell、optional Unit、printed Unit chain services 绑定 engine 内专用模块；重设计要求“EffectIR 数据 + 通用原语解释器”，并在迁移后删除这些按能力/卡型 service（`redesign.md:60-73`）。

## 目标分层映射

映射按“当前主要职责”给出；一个文件只指定一个主去向，跨层依赖在说明中列出。`保留`表示代码思想/测试应迁移，`合并`表示不保留当前文件边界，`删除`表示完成迁移后删除当前版本包装或重复实现。

| 现有文件 | 主去向 | 处置 | 依据与说明 |
| --- | --- | --- | --- |
| `base-combat-allocation.ts` | `combat/` | 保留后合并 | trusted facts、damage plan、assignment 由 `combat` 原语承接；当前 765 行、入口 `planDuelBaseCombatDamage`。 |
| `battlefields.js` | `zones/` + `combat/` | 删除 JS，合并 TS 语义 | JS 是旧运行实现；board/field 生命周期迁入 zones，showdown/combat 边界迁入 combat。 |
| `battlefields.ts` | `zones/` + `combat/` | 合并 | 保留 board、battlefield、engagement 与 public board 约束；拆成 zones 与 combat 两个无版本文件。 |
| `canonical-session-v2.ts` | `state/` + `turn/` + `cost/` | 合并 | 现有唯一 P4 command/session boundary；拆出 state version、receipt、task、payment、turn cursor。 |
| `canonical-session.js` | `state/`/`turn/` | 删除 JS | V1 staged session 的运行实现；先迁移 V1 room/旧测试，再删除。 |
| `canonical-session.ts` | `state/`/`turn/` | 删除 V1 | 与 `.js` 同概念；类型和旧 projection 迁入当前 session。 |
| `canonical-transaction.js` | `state/`/`events/` | 删除 JS | detached/commit 事务语义迁到唯一 commit API。 |
| `canonical-transaction.ts` | `state/`/`events/` | 合并 | 保留 clock/commit 原子边界；把 semantic event clock 变成事件提交的一部分。 |
| `cardplay-gear-v1.ts` | `effects/` + `cost/` + `zones/` | 删除版本包装 | Gear 进入 Chain、支付、装备关系都应由通用 move/equip/cost 原语承接；当前无生产直引。 |
| `cardplay-spell-v2.ts` | `chain/` + `cost/` + `target/` + `effects/` | 合并 | 拆出 chain lifecycle、target plan、cost plan、EffectIR resolve；删除 spell-specific coordinator。 |
| `cardplay-unit-chain-v4.ts` | `chain/` + `cost/` + `effects/` | 合并 | physical Unit 的最新 chain/attempt/proof 语义迁移为通用 Chain item；不保留 V4 名称。 |
| `cardplay-unit-v2.ts` | `chain/` + `turn/` + `effects/` | 合并 | 默认 P4 实际使用的 Unit entry/payment/turn/move coordinator；拆成原语和 turn driver。 |
| `chain-v2.ts` | `chain/` | 合并 | 当前 Chain item/status/priority/resolve 语义是目标层的核心，但去掉 V2 后缀并接入 FEPR。 |
| `combat-choice-v2.ts` | `combat/` + `target/` | 合并或删除包装 | damage allocation 的选择计划迁到统一 TargetPlan/CombatPlan；保留 proof guard。 |
| `combat-damage-executor-v2.ts` | `combat/` + `effects/` | 合并 | 将 plan validation/commit 变成 combat damage primitive 和 event。 |
| `command-executor-v2.ts` | `turn/` + `chain/` | 合并 | 当前是 Unit-chain command dispatch；改成统一 command dispatcher，不按 V2/Unit 命名。 |
| `conquer-v2.ts` | `scoring/` + `combat/` | 删除版本包装 | 当前只被自身测试和 barrel 暴露，先确认规则覆盖后把 conquer outcome 迁入 scoring/combat。 |
| `core-v2.ts` | `state/` + `zones/` + `events/` | 合并 | 现有 admitted capability、physical inventory、token reservation 是 P4 核心；拆成 state/inventory/event primitives。 |
| `cost-resolver-v2.ts` | `cost/` | 合并 | 直接迁移 cost stages/modifiers/verified sources；删除 V2 后缀。 |
| `derived-might-v2.ts` | `combat/` | 合并 | current might evaluator 归 combat derived values；保留 blocked/complete evidence。 |
| `draw-burnout.js` | `turn/` + `effects/` | 删除 JS | draw/burnout 旧实现；draw 是 EffectIR，burnout 是 turn checkpoint。 |
| `draw-burnout.ts` | `turn/` + `effects/` | 合并 | 将 draw effect 与 turn burnout 分离。 |
| `draw-effect-executor-v2.ts` | `effects/` | 合并 | `draw` 原语解释器的一部分；删除卡型/V2 命名。 |
| `ending.js` | `turn/` + `events/` | 删除 JS | ending/cleanup 的旧运行实现。 |
| `ending.ts` | `turn/` + `events/` | 合并 | cleanup request、game end、pending task 迁入 FEPR cleanup boundary。 |
| `engagement-executor-v2.ts` | `combat/` + `priority-focus/` | 合并 | engagement cursor、focus/priority、damage step 迁入 combat 与 priority-focus。 |
| `duel/index.ts` | 各分层 `index.ts` | 重写/拆分后删除热点 | 当前将 50 个 duel 文件全量 re-export（`:4-54`）；改为模块化入口，避免 barrel 冲突。 |
| `kill-damage-effect-executor-v2.ts` | `effects/` + `combat/` | 合并 | kill/damage effect 解释为通用 `kill`/`dealDamage` primitives，combat 只保留战斗来源。 |
| `match-state.js` | `state/` + `zones/` | 删除 JS | setup/playing state 旧实现。 |
| `match-state.ts` | `state/` + `zones/` | 合并 | 保留 match identity、frame、players、public state；与 core/permanent state 统一。 |
| `movement.js` | `zones/` | 删除 JS | zone transition 旧实现。 |
| `movement.ts` | `zones/` | 合并 | 统一 move primitive，增加 zoneEntryId/对象身份失效语义。 |
| `optional-play-choice-v1.ts` | `target/` + `cost/` + `priority-focus/` | 删除版本包装 | pay/decline prompt 迁到统一 Prompt/CostPlan；默认 P4 依赖它，需先迁移。 |
| `optional-play-choice-v2.ts` | `target/` + `cost/` + `chain/` | 合并 | physical Chain choice 的最新 lineage guard 迁到通用 choice。 |
| `permanent-state.ts` | `state/` + `zones/` | 合并 | physical card identity, zone transitions, gear attachment 是统一 object model 的基础。 |
| `phase-closure-boundaries-v2.ts` | `events-triggers/` | 合并 | closure boundary ordinal/event definitions 迁为统一 trigger/cleanup boundary。 |
| `phase-closure-evidence-v2.ts` | `events-triggers/` + `state/` | 合并 | source closure evidence 变为 Trigger/Effect source snapshot；去掉 V2 命名。 |
| `phase-source-authority-v2.ts` | `events-triggers/` | 合并 | phase source registry/native token source 迁为事件触发器注册表。 |
| `phase-source-closure-v2.ts` | `events-triggers/` + `cost/` | 合并 | whole-source closure、pending/verified proof 迁为 effect/trigger source authority。 |
| `point-damage-effect-executor-v1.ts` | `effects/` + `scoring/` | 删除版本包装 | Point damage 应拆为 score event/effect primitive；保留 judge-required 边界。 |
| `printed-costs.ts` | `cost/` | 合并 | printed cost 与 resolved/paid cost 分离，直接对应设计 `Base Cost -> Final Total -> Payment`。 |
| `private-journals.ts` | `events/`/持久化边界 | 删除子路径或迁移 | Node-only re-export；迁移到 server-owned journal adapter，不让 engine public barrel 携带 Node API。 |
| `projection-v2.ts` | `projection/` | 合并后删除 V2 | 作为投影字段/隐私基线迁入当前 projector。 |
| `projection-v3.ts` | `projection/` | 合并后删除 V3 | 作为当前 settled permanent fields 的输入，最后只留一个 projection。 |
| `resource-readiness-journal-v2.ts` | `events/` + `cost/` + server journal | 合并或移出 engine | 保留真实 commit/readiness/payment proof；journal codec 由服务端单一 journal owner 管理。 |
| `resources.js` | `cost/` + `state/` | 删除 JS | 旧资源运行实现。 |
| `resources.ts` | `cost/` + `state/` | 合并 | energy/power/rune/gold resource state 与 payment plan 迁入 cost/state。 |
| `scoring.js` | `scoring/` | 删除 JS | 旧 scoring 运行实现。 |
| `scoring.ts` | `scoring/` | 合并 | points/conquer/win checkpoint 归 scoring。 |
| `setup.js` | `state/` + `zones/` | 删除 JS | 旧 setup restore/seat implementation。 |
| `setup.ts` | `state/` + `zones/` | 合并 | deck/seat/setup identity 迁入 state/zones；保留 catalog validation seam。 |
| `standard-move-executor-v2.ts` | `zones/` + `turn/` | 合并 | move legality/trigger certification 变成 move primitive + event trigger。 |
| `token-play-v2.ts` | `chain/` + `effects/` | 删除版本包装 | token creation 应变成 `createToken` EffectIR；保留 source proof/cleanup。 |
| `token-play-v3.ts` | `chain/` + `effects/` | 删除版本包装 | 同上；V3 语义作为迁移输入，不作为目标模块。 |
| `turn-executor-v2.ts` | `turn/` + `priority-focus/` | 合并 | current P4 turn start/end/checkpoint driver；实现 FEPR turn loop。 |
| `turn-flow.js` | `turn/` | 删除 JS | 旧 flow implementation。 |
| `turn-flow.ts` | `turn/` | 合并 | 旧 flow 中仍有的 hook/pending semantics 迁到统一 turn。 |
| `turn-start.js` | `turn/` | 删除 JS | 旧 awaken/beginning implementation。 |
| `turn-start.ts` | `turn/` | 合并 | readiness/other permanent/beginning effect 变为 Handle Outstanding/Execute/Resolve。 |
| `unit-lifecycle.js` | `zones/` + `combat/` | 删除 JS | 旧 lifecycle runtime。 |
| `unit-lifecycle.ts` | `zones/` + `combat/` | 合并 | readiness/damage/lethal/kill/object projection 迁为 object lifecycle primitives。 |
| `full-product/runtime.ts` | `turn/` + `state/` + `projection/` | 移出/删除独立 runtime | 这是另一个 narrow full-product vertical runtime（`:1-423`），不应与 authoritative Duel engine 并存；迁移到当前 engine 的 fixture/adapter 后删除 experimental entry。 |
| `src/index.ts` | 分层 barrel + `state/`/`projection/` | 拆分 | 根入口目前同时实现 synthetic/foundation command/project（`:153-687`）；迁到分层 re-export，保留一个当前 ruleset。 |
| `state.ts` | `state/` | 合并 | 当前 `CardEffect` 只有 damage/gain-points/judge-required（`:43-78`）；改为 EffectIR-compatible state contracts。 |

## 并发最优迁移顺序

原则是先冻结契约和观察面，再拆没有共享写热点的叶子原语；任何删除都必须在对应测试迁移后进行。下面的“并行”只表示文件写集可拆开，公共 contract 和入口合并仍由父任务串行处理。

| 批次 | 工作 | 可并行项 | 必须串行的门槛 |
| --- | --- | --- | --- |
| 0：基线与契约 | 固定当前默认路径、导出快照、projection/privacy 快照、journal 头字段；建立 `state/turn/priority-focus/...` 目录和新契约。 | 调研、测试清单、EffectIR/TargetPlan/CostPlan 设计可并行起草。 | 先完成 protocol/card-dsl 契约确认；不得先删旧入口。 |
| 1：纯叶子内核 | 迁移 `printed-costs`、`resources`、`movement`、`scoring`、`base-combat-allocation`、`derived-might`、`unit-lifecycle` 的测试到无版本目标模块。 | cost、zones、scoring、combat 四组互相尽量不改入口，可四路并行。 | 依赖统一 `ObjectRef/zoneEntryId` 和 state identity；state contract 先落地。 |
| 2：EffectIR 原语 | 建立 draw/damage/kill/move/createToken/sequence/conditional/repeat、Outcome、judge-required 原语注册表；把 `draw-effect`、`kill-damage`、`point-damage` 和 token proof 迁入。 | 每个原语一个文件；卡牌 IR 可在此批同步起草。 | 先有 EffectIR/Outcome 和事件类型；完成后才能迁 cardplay coordinator。 |
| 3：目标/费用/选择 | 建 `CostPlan`、`TargetPlan`、Prompt/choice、payment/rollback；迁 `cost-resolver`、`optional-play-choice-v1/v2`、spell/unit cost。 | cost、target、prompt 可以分三个写集，但共享类型由父任务串行合入。 | 目标引用必须使用 object identity/zoneEntryId；费用支付/撤销测试先通过。 |
| 4：Chain 和事件 | 建唯一 Chain item/status/priority/focus；迁 `chain-v2`、canonical transaction、phase source closure/evidence/authority、command executor。 | chain core 与 event/trigger registry 可并行设计；实际接线串行。 | 先完成 replacement/prevention/modification/event commit 顺序。 |
| 5：Turn/Combat | 将 `turn-executor-v2`、turn-flow/start、engagement、combat choice/damage、standard move、ending 合并到 HOT FEPR。 | turn 与 combat 在稳定 state/chain/event 后可并行；combat 依赖 target/effect。 | 最后统一 priority/focus 与 cleanup，形成单一 turn driver。 |
| 6：Card program migration | 逐卡把 game-server production services 和手写 spell/unit/gear/token coordinators 换成 EffectIR + primitive registry；保留未知文本为 judge-required。 | 每张卡/每个 IR 文件可几十路并行，文件冲突最少；golden 用例跟随卡。 | 原语 registry、TargetPlan、CostPlan、事件/trigger 先可用。 |
| 7：Server/runtime 收敛 | P4/P8/P9 profile 合并成单 runtime；journal 统一头；room/session/archive/persistence 使用一个 adapter；默认路径切换到当前 engine。 | room、journal、projection adapter 可分开，但共享 runtime constructor 必须串行。 | 先迁完所有需要保留的行为 golden 和隐私/幂等门禁。 |
| 8：删除旧树 | 删除 `src` `.js`、V1/V2/V3/V4 包装、旧 `full-product` experimental runtime、旧 profile/schema 分支；拆 `index.ts`/`duel/index.ts`。 | 删除可按目录分批，但每批都要跑直接消费者测试。 | 最后一批才删除旧 exports 和 replay compatibility adapters；完整 typecheck/test/build 后集成。 |

## 逐文件盘点

下表覆盖 `src` 的 64 个文件。导出列列出主要类型和函数族；完整 `export` 扫描结果见 `/tmp/RIFT-7-survey-engine-core/exports-compact.txt`。消费者列按 `engine-core` 内部直接 import、game-server 的 package import、desktop/integration package import 和测试 import 归纳；测试文件的完整映射见下一节。

| 文件 | 行数 | 一句话职责 / 对外导出 | 被谁引用 |
| --- | ---: | --- | --- |
| `duel/base-combat-allocation.ts` | 765 | Combat damage plan、trusted facts、assignment validation/completion；导出 `createTrustedDuelBaseCombatFacts`、`planDuelBaseCombatDamage`、`validateDuelBaseCombatAllocation`、`completeDuelBaseCombatAllocation`。 | 内部：`combat-choice-v2`、`combat-damage-executor-v2`、`core-v2`、`engagement-executor-v2`；server：`authoritative-runtime-p4.ts`；测试：base-combat、combat-choice。 |
| `duel/battlefields.js` | 385 | JS board/field runtime；导出 board 创建、placement、showdown/combat、public board。 | 内部旧 JS 链：canonical/match/scoring/unit/turn 等；主要由 JS 测试间接导入。 |
| `duel/battlefields.ts` | 464 | TS board/field 类型、状态校验、移动、showdown/combat；导出 `DuelBoard`、`createDuelBoard`、`endDuelCombat` 等。 | 内部：core、cardplay、turn、projection 等；desktop 仅测试/回放类型侧接触；server 通过 duel barrel/transitive。 |
| `duel/canonical-session-v2.ts` | 920 | V2 admitted command session、receipt、required cost task、source attestation、resource command；导出 `createDuelCommandSessionV2`、`applyDuelResourceCommandV2`、`advanceDuelCommandSessionNativeV2`。 | 内部：core/transaction/match/setup/resources/permanent/turn；server：authoritative P4、runtime-v2/v3、journal/archive、spell/unit services；测试约 30 个 suite。 |
| `duel/canonical-session.js` | 425 | V1 session 的 JS 运行实现；导出旧 resource/payment/project API。 | 内部旧 JS canonical transaction、match、board、unit、scoring、resources；server：`runtime.ts`。 |
| `duel/canonical-session.ts` | 545 | V1 session 的 TS 类型与实现；导出 `DuelCommandSession`、`applyDuelResourceCommand`、`projectCanonicalDuelMatch`。 | 内部旧 JS/TS 状态 kernel；server：`runtime.ts`、room、session archives；测试：canonical integration/session。 |
| `duel/canonical-transaction.js` | 185 | V1 detached/commit mutation；导出 `detachedDuelPlaying`、`commitDuelPlayingMutation`。 | 内部旧 board/resources/scoring/unit；server：旧 `runtime.ts`/archives；测试：canonical/ending/turn。 |
| `duel/canonical-transaction.ts` | 260 | V1 + V2 semantic event clock/commit；导出 `allocateDuelPlayingV2Clock`、`withDuelPlayingV2SemanticEventClock`。 | 内部 canonical session/core/match；server：旧 runtime/archives；测试：canonical/turn/ending/permanent。 |
| `duel/cardplay-gear-v1.ts` | 582 | Gear physical Chain begin/resume/cancel and cost service；导出 `createDuelPrintedGearChainSessionV1`、`beginDuelGearCardPlayV1` 等。 | 内部：canonical V2/core/cost/closure/resources；game-server 无直接生产引用；测试：gear physical chain。 |
| `duel/cardplay-spell-v2.ts` | 1,755 | Spell play、chain-first、cost/payment、resolution/private state；导出 spell session、dispatch、resolve/finalize/resume API。 | 内部：canonical V2/core/cost/chain/draw/kill/point effect；server：authoritative P4、p4-spell-services、production-source；测试：spell、point、showdown、chain-first。 |
| `duel/cardplay-unit-chain-v4.ts` | 850 | Physical Unit chain attempt/choice/payment/resolved-history；导出 `createDuelPrintedUnitChainSessionV4`、`begin...V4`、`resume...V4`。 | 内部：canonical V2/command/core/cost/closure/optional choice/resources；server：authoritative P4、printed-unit-chain-services；测试：unit-physical-chain。 |
| `duel/cardplay-unit-v2.ts` | 1,747 | 普通 Unit entry、optional payment、turn、standard move；导出 `createDuelUnitPlaySessionV2`、`playDuelNoAbilityUnitToBaseV2`、turn/move/resume API。 | 内部：canonical/core/closure/cost/lifecycle/resources/battlefields/optional V1/turn executor/movement；server：authoritative P4、optional entry/native source；测试：unit/cardplay/point coordinator。 |
| `duel/chain-v2.ts` | 890 | Chain item/status/priority、finalize/resolve、committed proof；导出 `createDuelChainV2`、executor、resolution authority。 | 内部无 direct import except spell; server：operation/p4 spell/chain services；测试：chain storage/chain/spell/unit/gear/recruit。 |
| `duel/combat-choice-v2.ts` | 206 | Base combat damage choice/plan wrapper；导出 combat choice request/answer/receipt。 | 内部：base combat；server 无 direct import；测试：combat choice。 |
| `duel/combat-damage-executor-v2.ts` | 288 | 读取 combat choice 并完成 damage allocation；导出 executor/result。 | 内部：base combat/combat choice/core/unit lifecycle；server 无 direct import；测试：combat damage。 |
| `duel/command-executor-v2.ts` | 152 | Unit-chain command successor dispatcher；导出 command execution helpers。 | 内部：canonical V2/cardplay unit-chain/core/optional V2/resources；server 无 direct import；测试：unit attempt proof。 |
| `duel/conquer-v2.ts` | 330 | Conquer outcome authority；导出 conquer request/authority/receipt。 | 内部：board/scoring；无 server 生产直引；测试：conquer。 |
| `duel/core-v2.ts` | 2,029 | P4 admitted state/capability、physical inventory、token reservation、native commit guards；导出大量 V2 state/primitive/assert API。 | 内部：近乎所有 P4 kernels；server：authoritative P4、runtime-v2/v3、services/journals/archives；测试约 39 个 suite。 |
| `duel/cost-resolver-v2.ts` | 688 | Cost stages/modifiers/reductions/source proof/total cost；导出 `createDuelCostResolverAuthorityV2`、`resolveDuelTotalCostV2`。 | 内部：resources；server：P4、spell、optional Unit、printed chain services；测试约 16 个 suite。 |
| `duel/derived-might-v2.ts` | 395 | 从 closure/permanent state 推导 Unit current Might；导出 evaluator/result/proof。 | 内部：core/closure/permanent；server 无 direct import；测试：derived/shield might。 |
| `duel/draw-burnout.js` | 289 | 旧 draw/burnout runtime；导出 `startDuelDraw`/`resumeDuelDraw` 等。 | 内部：旧 board/scoring；仅旧测试直接触达。 |
| `duel/draw-burnout.ts` | 430 | TS draw/burnout 类型与流程；同名 JS 的 typed 实现。 | 内部：setup/board/scoring；P4 通过 turn executor 的旧依赖间接触达；测试：draw burnout。 |
| `duel/draw-effect-executor-v2.ts` | 413 | Draw effect executor 和 burnout continuation；导出 draw effect request/result。 | 内部：core/permanent/scoring/draw-burnout；server 经 spell 间接使用；测试：draw effect。 |
| `duel/ending.js` | 505 | 旧 ending/cleanup runtime。 | 内部旧 transaction/resources/scoring/unit；server 无 direct P4 import；测试：ending。 |
| `duel/ending.ts` | 641 | TS ending/cleanup/pending resolution。 | 内部 canonical/session/turn-flow/resources 等；server 无 direct import；测试：ending/pending payment。 |
| `duel/engagement-executor-v2.ts` | 654 | Engagement cursor、focus/priority、spell reaction、combat step；导出 start/advance/inspect engagement。 | 内部：core/canonical/spell/chain/source closure；server：authoritative P4；测试：engagement/showdown。 |
| `duel/index.ts` | 54 | Duel public barrel；`export *` 暴露旧 board/setup/resources/scoring、V2 core/session/turn/projection、spell/unit/chain/combat、V1/V2/V3/V4 wrappers（`:4-54`）。 | server 大量 `@riftbound/engine-core/duel` import；package public surface；desktop 无源码 import；测试所有 duel imports。 |
| `duel/kill-damage-effect-executor-v2.ts` | 791 | Kill/damage effect execution、lethal plan、cleanup proof；导出 executor/result。 | 内部：core/unit lifecycle；server 经 spell/point coordinator 间接；测试：kill damage。 |
| `duel/match-state.js` | 130 | 旧 setup/playing match state runtime。 | 内部旧 canonical/session/transaction/turn/ending/projection；旧 server archives/runtime；测试 match/canonical/turn。 |
| `duel/match-state.ts` | 240 | TS match state 类型、setup/playing restore/projection。 | 内部 V1/V2 projection/core/session/turn/permanent；server：setup/archive/engagement 等；测试 match/canonical/turn/permanent。 |
| `duel/movement.js` | 193 | 旧 zone movement helper。 | 内部 lifecycle；测试 standard move。 |
| `duel/movement.ts` | 268 | TS movement types/transition validation。 | 内部 lifecycle/standard move；server 经 Unit V2；测试 standard move。 |
| `duel/optional-play-choice-v1.ts` | 260 | Optional pay/decline process-local authority；导出 V1 prompt/receipt/authority。 | 内部 core；server：authoritative P4、optional services/entry/payment/choice projection/native source；测试 optional choice/payment。 |
| `duel/optional-play-choice-v2.ts` | 191 | Physical Chain choice authority；导出 V2 prompt/receipt/authority。 | 内部 core；server：authoritative P4、printed unit chain、command executor；测试名称仍有 optional choice，但 V2 无独立 production test。 |
| `duel/permanent-state.ts` | 670 | Physical card/object identity、zone epoch、gear attachment、public object view。 | 内部 board/transaction/session/core/turn/closure/source；server：operation journal/printed chain；测试 permanent state/v2。 |
| `duel/phase-closure-boundaries-v2.ts` | 263 | Phase closure step/boundary/event ordinal。 | 内部 permanent/source closure；server 无 direct import；测试 closure boundaries。 |
| `duel/phase-closure-evidence-v2.ts` | 569 | Closure request locator、registry/token/journal resolution、protected resolvers/evidence assembly。 | 内部 source closure；server：authoritative P4、hold recruit、operation journal、phase bridge、production services；测试 closure evidence。 |
| `duel/phase-source-authority-v2.ts` | 222 | Phase event/source registry/native token source、source inspection。 | 内部 core/permanent/source closure；server：P4、engagement/hold/phase bridge/production services/runtime turn；测试 source authority/turn/engagement。 |
| `duel/phase-source-closure-v2.ts` | 864 | Whole-source closure registry/journal/candidate enumeration/inspection。 | 内部 core/permanent/source authority/closure boundaries；server：P4、unit/spell/optional/production/phase bridge；测试 closure/recruit/might/physical chain。 |
| `duel/point-damage-effect-executor-v1.ts` | 100 | Point damage proposal/authority；导出 point damage effect service。 | 内部 kill-damage/core；server：point-effect production service；测试 point damage。 |
| `duel/printed-costs.ts` | 156 | Printed cost binding；导出 `bindDuelPrintedCost`。 | 内部 resources；server 多个 P4 services；测试 printed costs/audit/canonical。 |
| `duel/private-journals.ts` | 2 | Node-only re-export `resource-readiness-journal-v2`。 | 内部仅 resource journal；无 server/desktop/integration 生产直接引用；无独立测试。 |
| `duel/projection-v2.ts` | 208 | Fixed V2 public allowlist projection。 | 内部 core/match/setup/board/unit/resources/scoring/canonical；server runtime-v2；测试 projection-v2/v3 admission。 |
| `duel/projection-v3.ts` | 213 | V3 projection，增加 settled permanent/gear fields；入口 `projectCanonicalDuelMatchV3`。 | 内部 core/match/setup/board/unit/resources/scoring/canonical；server runtime-v3/authoritative P4；测试 projection suites。 |
| `duel/resource-readiness-journal-v2.ts` | 882 | Node crypto-backed resource readiness/payment journal、replay/proof。 | 内部 core/canonical/resources；仅 private-journals 子路径和自身测试；server 当前通过自己的 operation journal 体系，不直接 import。 |
| `duel/resources.js` | 457 | 旧 resources runtime；导出 domains、rune/gold activation/payment/projection。 | 内部旧 canonical/transaction/match/scoring/cost；server archives/旧路径；大量旧测试。 |
| `duel/resources.ts` | 473 | TS resources types/operations；同名 JS 的 typed 实现。 | 内部 cost/core/canonical/turn/printed costs；server P4 services/archives；大量测试。 |
| `duel/scoring.js` | 247 | 旧 scoring runtime。 | 内部旧 board/turn/draw；server engagement service 可经 barrel 使用；测试 scoring/turn/draw。 |
| `duel/scoring.ts` | 314 | TS scoring state/points/projection。 | 内部 canonical/turn/ending/engagement；server engagement service；测试 scoring/turn。 |
| `duel/setup.js` | 252 | 旧 setup/restore runtime。 | 内部无 direct import；server old archive/setup seats；测试 setup/match。 |
| `duel/setup.ts` | 347 | TS setup types/seat/card/rune/field restore。 | 内部 core/match/session/projection；server setup-seats/archive；测试 setup/match。 |
| `duel/standard-move-executor-v2.ts` | 361 | Standard move intent/cursor/trigger certification；导出 begin/resume/certify。 | 内部 board/lifecycle/movement；server 经 cardplay-unit-v2；测试 standard-move-executor。 |
| `duel/token-play-v2.ts` | 446 | V2 Recruit token chain play/cost/closure/resume。 | 内部 canonical/core/cost/closure；server 无 direct production import；测试 recruit token V2。 |
| `duel/token-play-v3.ts` | 312 | V3 Recruit token API，同一逻辑更高版本接口。 | 内部 canonical/core/cost/closure；server 无 direct production import；测试 canonical chain V3 和 token V2。 |
| `duel/turn-executor-v2.ts` | 767 | V2 turn cursor/services、start/end turn、checkpoint/resume。 | 内部 canonical/source/core/permanent/scoring/resources/draw/board/lifecycle；server runtime-v2/v3、P4、hold recruit、archives；测试 11 个 suite。 |
| `duel/turn-flow.js` | 496 | 旧 turn start flow runtime。 | 内部 turn-start/transaction/scoring/resources/draw；旧测试 ending/turn-flow。 |
| `duel/turn-flow.ts` | 490 | TS old turn flow context/provider/pending。 | 内部 turn-start/transaction/session/scoring/resources/draw；旧测试 ending/turn-flow。 |
| `duel/turn-start.js` | 491 | 旧 awaken/beginning runtime。 | 内部旧 scoring/resources/lifecycle/transaction；测试 turn-start。 |
| `duel/turn-start.ts` | 632 | TS turn-start readiness/pending/effects services。 | 内部 resources/lifecycle/transaction/session；测试 turn-start。 |
| `duel/unit-lifecycle.js` | 381 | 旧 Unit readiness/damage/kill/projection runtime。 | 内部旧 board/resources/movement；旧测试和 V1 路径。 |
| `duel/unit-lifecycle.ts` | 491 | TS Unit lifecycle state/meta、damage、lethal/kill、public objects。 | 内部 board/resources/movement/setup；server 经 P4 kernels；测试 lifecycle/ending/canonical/turn/kill。 |
| `full-product/runtime.ts` | 1,004 | 独立 full-product foundation runtime；导出 phases, events, prompts, `createFullProductGame`, `listLegalActions`, `submitFullProductCommand`。 | server：full-product adapter/orchestrator/types；desktop：full-product UI adapter；测试：`test/full-product/*`。 |
| `index.ts` | 2,340 | 根 synthetic/foundation state machine、command/project/room snapshot；导出 `createInitialGame`、`createConfiguredGame`、`submitCommand`、`projectGame`、`getHotFeprStep`。 | 内部仅 `state.ts`；server foundation-game/room/full-product；desktop 测试/客户端类型链；integration：dynamic import root；根 tests 7 个。 |
| `state.ts` | 226 | 根 GameObject/CardEffect/GameState/Ruleset contracts；导出 synthetic/foundation state types。 | 内部 `index.ts`；server foundation-game/deck-validation/room；root tests经 index；integration 经 root package。 |

## 导出面核对（直接声明扫描）

以下是对 64 个文件逐行扫描 `^export` 得到的直接声明导出名；`duel/index.ts:4-54` 的 `export *` 由其指向文件组成，根 `index.ts` 的显式导出见逐文件表。这个附录用于核对“对外导出”列，不把类型导出误当作运行时函数。

| 文件 | 行数 | 直接声明导出 |
| --- | ---: | --- |
| `duel/base-combat-allocation.ts` | 765 | `DuelBaseCombatBoardUnit,DuelBaseCombatBattlefield,DuelBaseCombatBoard,DuelBaseCombatDamageMark,DuelBaseCombatUnitMeta,DuelBaseCombatState,DuelBaseCombatMightInput,DuelBaseCombatSourceEffectProof,DuelBaseCombatSourceEffectService,TrustedDuelBaseCombatFacts,DuelBaseCombatBlockCode,DuelBaseCombatBlockedError,createTrustedDuelBaseCombatFacts,DuelBaseCombatUnitBasis,DuelBaseCombatSidePlan,DuelBaseCombatPlan,planDuelBaseCombatDamage,DuelBaseCombatOrderedUIDAmount,DuelBaseCombatAssignment,DuelBaseCombatAllocationResult,assertDuelBaseCombatPlan,validateDuelBaseCombatAllocation,DuelBaseCombatCompleteAllocation,completeDuelBaseCombatAllocation,inspectDuelBaseCombatCompletion` |
| `duel/battlefields.js` | 385 | `selectDuelBattlefields,createDuelBoard,assertDuelBoard,restoreDuelBoard,placeDuelUnit,relocateDuelUnit,removeDuelUnit,applyOpenDuelCleanup,beginDuelShowdown,beginDuelCombat,endDuelNonCombatShowdown,endDuelCombat,projectPublicDuelBoard` |
| `duel/battlefields.ts` | 464 | `DuelBattlefieldEntry,DuelBattlefieldSeat,SelectedDuelBattlefield,DuelBattlefieldSelection,Engagement,DuelBase,DuelBattlefield,DuelUnit,DuelBoard,PublicDuelBoard,selectDuelBattlefields,createDuelBoard,assertDuelBoard,restoreDuelBoard,placeDuelUnit,relocateDuelUnit,removeDuelUnit,applyOpenDuelCleanup,beginDuelShowdown,beginDuelCombat,endDuelNonCombatShowdown,DuelCombatResult,DuelCombatResolution,endDuelCombat,projectPublicDuelBoard` |
| `duel/canonical-session-v2.ts` | 920 | `DuelCommandV2,DuelCommandEnvelopeV2,DuelCommandRejectionV2,DuelPaymentCompletedV2,DuelCommandOutcomeV2,DuelCommandReceiptV2,DuelRequiredCostTaskV2,DuelSourceBindingV2,DuelSourceAttestationRequestV2,DuelSourceAttestorV2,DuelRequiredTaskLedgerEntryV2,DuelPaymentBindingEntryV2,DuelCommandSessionV2,DuelCommandResultV2,DuelRequiredCostAuthorityV2,inspectDuelNativeCommandSessionPathV2,createDuelCommandSessionV2,adoptAdmittedDuelPlayingSessionV2,commitDuelCommandMutationV2,DuelChoiceOpeningEventV2,commitDuelChoiceOpeningEventV2,advanceDuelCommandSessionNativeV2,checkpointDuelTurnCursorV2,commitDuelCommandFrameV2,issueDuelRequiredCostTaskV2,prepareDuelRequiredCostPaymentV2,commitDuelPriorityPaymentV2,DuelPayPendingInspectionV2,DuelResourceCommandV2,DuelResourceLegalityV2,inspectDuelResourceCommandV2,isDuelResourceCommandLegalV2,inspectDuelResourceLegalityV2,inspectDuelPendingPaymentV2,applyDuelResourceCommandV2` |
| `duel/canonical-session.js` | 425 | `issueDuelRequiredCostTask,prepareDuelRequiredCostPayment,applyDuelResourceCommand,commitDuelPriorityPayment,prepareDuelPayment,projectCanonicalDuelMatch` |
| `duel/canonical-session.ts` | 545 | `DuelPhase,DuelPaymentSourceReference,DuelPendingPayment,DuelCanonicalFrame,DuelCanonicalPlayingState,DuelCanonicalMatchState,DuelResourceCommand,DuelCommandEnvelope,DuelCommandRejection,DuelPaymentCompleted,DuelCommandOutcome,DuelCommandReceipt,DuelRequiredCostTask,DuelRequiredTaskLedgerEntry,DuelCommandSession,DuelCommandResult,DuelRequiredCostAuthority,issueDuelRequiredCostTask,prepareDuelRequiredCostPayment,applyDuelResourceCommand,commitDuelPriorityPayment,prepareDuelPayment,PublicDuelCanonicalPlayer,PublicDuelCanonicalFrame,PublicDuelCanonicalPlaying,PublicDuelCanonicalMatch,projectCanonicalDuelMatch` |
| `duel/canonical-transaction.js` | 185 | `detachedDuelPlaying,commitDuelPlayingMutation` |
| `duel/canonical-transaction.ts` | 260 | `detachedDuelPlaying,allocateDuelPlayingV2Clock,withDuelPlayingV2SemanticEventClock,commitDuelPlayingMutation` |
| `duel/cardplay-gear-v1.ts` | 582 | `DuelPrintedGearProgramRequestV1,DuelPrintedGearProgramBindingV1,DuelPrintedGearEntryRequestV1,DuelPrintedGearEntryFactsV1,DuelPrintedGearCostBindingV1,DuelPrintedGearChainCostFactoryRequestV1,DuelPrintedGearPlayServicesV1,DuelPrintedGearChainBeginEnvelopeV1,DuelPrintedGearChainResumeEnvelopeV1,DuelPrintedGearChainCancelEnvelopeV1,DuelPrintedGearChainOutcomeV1,DuelPrintedGearChainSessionV1,DuelPrintedGearChainResultV1,DuelPrintedGearChainInspectionV1,createDuelPrintedGearChainSessionV1,beginDuelPrintedGearPhysicalChainV1,applyDuelPrintedGearPhysicalChainResourceV1,resumeDuelPrintedGearPhysicalChainV1,cancelDuelPrintedGearPhysicalChainV1,inspectDuelPrintedGearPhysicalChainV1,createDuelGearCardPlaySessionV1,beginDuelGearCardPlayV1,applyDuelGearCardPlayResourceV1,finishDuelGearCardPlayV1,cancelDuelGearCardPlayV1,startDuelPrintedGearChainV1` |
| `duel/cardplay-spell-v2.ts` | 1755 | `DuelSpellCardPlayCommandV2,DuelSpellCardPlayEnvelopeV2,DuelSpellCardPlayOutcomeV2,DuelSpellCardPlayReceiptV2,DuelSpellCommandClaimV2,DuelSpellCommandClaimResultV2,DuelSpellCommittedEffectV2,DuelSpellCommandDispatcherV2,DuelSpellResolutionBindingV2,DuelSpellCostBindingV2,DuelSpellCostBindingServiceV2,DuelSpellChainFirstCostRequestV3,DuelSpellChainFirstCostAuthorityV3,DuelSpellChainFirstLifecycleProofV3,DuelSpellChainFirstResolvedProofV3,DuelSpellEffectClosureV2,DuelSpellCardPlayServicesV2,DuelSpellCardPlaySessionV2,DuelSpellCardPlayResultV2,inspectDuelSpellChainFirstLifecycleProofV3,inspectDuelSpellChainFirstResolvedProofV3,inspectDuelSpellResolutionBindingV2,assertDuelSpellShowdownClosureV2,createDuelSpellCardPlaySessionV2,playDuelSpellCardV2,applyDuelSpellResourceCommandV2,finalizeDuelSpellCardPlayV2,passDuelSpellPriorityV2,resolveDuelSpellCardPlayV2,resumeDuelSpellEffectV2,resumeDuelSpellChainFirstV3,resumeDuelSpellPaymentV2,submitDuelSpellTargetV2,inspectDuelSpellPrivateStateV2,createDuelSpellPlaySessionV2,playDuelSpellV2,applyDuelSpellResourceV2,finalizeDuelSpellV2,passDuelSpellV2,resolveDuelSpellV2` |
| `duel/cardplay-unit-chain-v4.ts` | 850 | `DuelPrintedUnitAttemptCapabilityV4,DuelPrintedUnitAttemptInspectionV4,DuelPrintedUnitChoiceProofV4,DuelPrintedUnitChoiceProofInspectionV4,DuelPrintedUnitProgramRequestV4,DuelPrintedUnitProgramBindingV4,DuelPrintedUnitEntryRequestV4,DuelPrintedUnitEntryFactsV4,DuelPrintedUnitCostBindingV4,DuelPrintedUnitChainCostFactoryRequestV4,DuelPrintedUnitSourceAttestationRequestV4,DuelPrintedUnitPlayServicesV4,DuelPrintedUnitChainBeginEnvelopeV4,DuelPrintedUnitChainAnswerEnvelopeV4,DuelPrintedUnitChainResumeEnvelopeV4,DuelPrintedUnitChainCancelEnvelopeV4,DuelPrintedUnitChainOutcomeV4,DuelPrintedUnitChainSessionV4,DuelPrintedUnitChainResultV4,DuelPrintedUnitChainInspectionV4,issueDuelPrintedUnitAttemptCapabilityV4,inspectDuelPrintedUnitAttemptCapabilityV4,issueDuelPrintedUnitChoiceProofV4,inspectDuelPrintedUnitChoiceProofV4,hasDuelPrintedUnitAttemptCapabilityV4,createDuelPrintedUnitChainSessionV4,beginDuelPrintedUnitPhysicalChainV4,answerDuelPrintedUnitPhysicalChainV4,applyDuelPrintedUnitPhysicalChainResourceV4,resumeDuelPrintedUnitPhysicalChainV4,cancelDuelPrintedUnitPhysicalChainV4,inspectDuelPrintedUnitPhysicalChainV4,startDuelPrintedUnitChainV4,answerDuelPrintedUnitChainV4,applyDuelPrintedUnitResourceCommandV4,finishDuelPrintedUnitChainV4` |
| `duel/cardplay-unit-v2.ts` | 1747 | `DuelUnitEntryRequestV2,DuelUnitEntryFactsV2,DuelUnitEntryServiceV2,DuelUnitCostBindingV2,DuelUnitCostBindingServiceV2,DuelUnitPlayCommandV2,DuelOptionalUnitPlayCommandV2,DuelUnitPlayEnvelopeV2,DuelOptionalUnitPlayEnvelopeV2,DuelUnitPlayOutcomeV2,DuelUnitPlayReceiptV2,DuelUnitPlaySessionV2,DuelUnitPlayResultV2,DuelUnitPlayServicesV2,DuelOptionalUnitProgramRequestV2,DuelOptionalUnitProgramBindingV2,DuelOptionalUnitCostRequestV2,DuelOptionalUnitPlayServicesV2,DuelOptionalUnitPaymentServicesV3,DuelOptionalUnitPaymentBeginEnvelopeV3,DuelOptionalUnitPaymentResumeEnvelopeV3,DuelOptionalUnitPaymentOutcomeV3,DuelOptionalUnitPaymentResultV3,DuelOptionalUnitPaymentPrivateStateV3,DuelUnitMoveServicesV2,DuelUnitResourceOptionsV2,DuelUnitResourceOutcomeV2,DuelUnitResourceResultV2,DuelUnitTurnEnvelopeV2,DuelUnitTurnOutcomeV2,DuelUnitTurnResultV2,DuelUnitMoveEnvelopeV2,DuelUnitMoveOutcomeV2,DuelUnitMoveResultV2,createDuelUnitPlaySessionV2,advanceDuelUnitCommandSessionV2,applyDuelUnitResourceCommandV2,playDuelNoAbilityUnitToBaseV2,playDuelOptionalUnitToBaseV2,beginDuelOptionalUnitPaymentV3,applyDuelOptionalUnitPaymentResourceCommandV3,inspectDuelOptionalUnitPaymentV3,resumeDuelOptionalUnitPaymentV3,startDuelOptionalUnitPaymentV3,applyDuelOptionalUnitResourceCommandV3,finishDuelOptionalUnitPaymentV3,startDuelUnitTurnV2,endDuelUnitTurnV2,resumeDuelUnitTurnV2,applyDuelUnitStandardMoveV2,resumeDuelUnitStandardMoveV2` |
| `duel/chain-v2.ts` | 890 | `DuelChainItemStatusV2,DuelChainResolutionModeV2,DuelChainPhaseV2,DuelChainContinuationStepV2,DuelChainItemV2,DuelChainItemDraftV2,DuelChainContinuationV2,DuelChainCloseContextV2,DuelChainV2,DuelChainConfigV2,DuelChainExecutorV2,DuelChainAppendRequestV2,DuelChainFinalizeRequestV2,DuelChainPassRequestV2,DuelChainRequestResolutionV2,DuelChainResolutionTicketV2,DuelChainProducedItemV2,DuelChainCommittedReceiptV2,DuelChainCommittedLookupV2,DuelChainResolutionAuthorityV2,DuelChainCommittedProofV2,DuelChainCommitRequestV2,DuelChainBlockCodeV2,DuelChainBlockedErrorV2,createDuelChainExecutorV2,createDuelChainItemExecutorV2,createDuelChainScopedExecutorV2,createDuelChainResolutionAuthorityV2,createDuelChainV2,chainIsEmptyV2,chainItemPendingV2,chainItemFinalizedV2,assertDuelChainV2,appendDuelChainItemV2,appendDuelChainItemV2,appendDuelChainItemV2,finalizeDuelChainItemV2,finalizeDuelChainItemV2,finalizeDuelChainItemV2,passDuelChainPriorityV2,passDuelChainPriorityV2,passDuelChainPriorityV2,requestDuelChainResolutionV2,queryDuelChainCommittedProofV2,inspectDuelChainCommittedProofV2,commitDuelChainResolutionV2,inspectDuelChainPrivateStateV2,resolveDuelChainItemV2,resolveDuelChainV2,passDuelChainV2,finalizeDuelChainV2,appendDuelChainV2` |
| `duel/combat-choice-v2.ts` | 206 | `DuelCombatChoiceV2Side,DuelCombatChoiceV2BlockCode,DuelCombatChoiceV2BlockedError,DuelCombatChoiceV2CommittedAllocation,DuelCombatChoiceCursorV2,createDuelCombatChoiceCursorV2,submitDuelCombatChoiceV2` |
| `duel/combat-damage-executor-v2.ts` | 288 | `DuelCombatDamageBlockCodeV2,DuelCombatDamageBlockedErrorV2,DuelCombatDamageChoiceV2,DuelCombatDamageAuthorityV2,DuelCombatDamageStepV2,createDuelCombatDamageAuthorityV2,submitDuelCombatDamageChoiceV2` |
| `duel/command-executor-v2.ts` | 152 | `issueDuelPrintedUnitAttemptCapabilityV4,issueDuelPrintedUnitRequiredCostTaskV4,prepareDuelPrintedUnitRequiredCostPaymentV4,applyDuelPrintedUnitResourceCommandV4` |
| `duel/conquer-v2.ts` | 330 | `DuelControlPositionV2,DuelControlResolutionV2,DuelConquerEventRequestV2,DuelConquerAuthorityRecordV2,DuelConquerResolverV2,DuelConquerAuthorityV2,DuelControlEstablishedEventV2,DuelControlConsumptionV2,DuelConquerScoreResultV2,createDuelConquerAuthorityV2,issueDuelControlEstablishedEventV2,scoreDuelConquerWithEventV2` |
| `duel/core-v2.ts` | 2029 | `DuelCreationProvenanceV2,DuelRestoreAttestationV2,DuelProtectedCreationHistoryV2,DuelRestoreSourceContextV2,DuelMatchSetupStateV2,DuelCanonicalPlayingStateV2,DuelMatchStateV2,DuelCatalogCardTypeV2,DuelTrustedCardTypeResolverV2,DuelCanonicalRecruitTokenChainEntryV3,DuelTokenKindV2,DuelTokenSourceModeV2,DuelTokenCreationRequestV2,DuelTokenSourceAttestationV2,DuelTokenSourceAttestorRequestV2,DuelTokenSourceAttestorV2,DuelTokenBirthJournalEntryV2,DuelTokenRetirementJournalEntryV2,DuelTokenLifecycleHistoryV2,DuelTokenLifecycleRestoreAttestationV2,DuelTokenCreationAuthorityV2,DuelRecruitTokenChainReservationV2,DuelNativeCommitV2,inspectDuelNativeCommitPathV2,inspectDuelNativeTokenHistoryV2,inspectDuelCanonicalRecruitTokenChainV3,assertAdmittedDuelMatchV2,inspectDuelNativeOriginV2,assertDuelNativeTokenInventoryCurrentV2,assertDuelPlayingStateV2,restoreDuelPlayingStateV2,createDuelMatchV2,resolveDuelMulliganV2,commitDuelPlayingMutationV2,moveDuelPhysicalCardToChainV2,finalizeDuelPhysicalUnitFromChainV2,cancelDuelPhysicalUnitChainToHandV2,finalizeDuelPhysicalGearFromChainV1,cancelDuelPhysicalGearChainToHandV1,finalizeDuelPhysicalGearFromChainV2,cancelDuelPhysicalGearChainToHandV2,moveDuelChainCardToOwnerTrashV2,projectDuelChainCardsV2,commitDuelCombatDealMutationV2,attestDuelTokenSourceV2,createDuelGoldTokenV2,createDuelGoldFromTrustedSourceV2,activateDuelGoldPowerV2,consumeDuelGoldV2,beginDuelRecruitTokenOnChainV2,inspectDuelRecruitTokenOnChainV2,cancelDuelRecruitTokenOnChainV2,createDuelRecruitUnitV2,finalizeDuelRecruitTokenFromChainV2,DuelRecruitTokenChainReservationV3,DuelRecruitTokenChainBeginV3,DuelRecruitTokenChainCancelV3,beginDuelRecruitTokenOnChainV3,cancelDuelRecruitTokenOnChainV3,finalizeDuelRecruitTokenFromChainV3,inspectDuelRecruitTokenOnChainV3,beginDuelRecruitTokenOnCanonicalChainV3,finalizeDuelRecruitTokenFromCanonicalChainV3,cancelDuelRecruitTokenOnCanonicalChainV3,createDuelRecruitV2,killRetireDuelUnitTokenV2,retireDuelRecruitUnitV2,channelDuelRunesV2,referenceDuelPhysicalCardV2,assertCurrentDuelPhysicalReferenceV2,enumerateDuelObjectsV2,attachDuelGearV2,moveDuelUnitV2,registerDuelGearFromTrustedSourceV2,removeDuelGearToOwnerTrashV2` |
| `duel/cost-resolver-v2.ts` | 688 | `DuelCostRequestV2,DuelCostStageV2,DuelCostTargetV2,DuelCostModifierV2,DuelCostReductionV2,DuelCostSourceProofV2,DuelCostDecisionV2,DuelCostVerifiedSourcesV2,DuelCostServiceV2,DuelCostVerifierV2,DuelCostResolverAuthorityV2,createDuelCostResolverAuthorityV2,DuelCostApplicationV2,DuelResolvedCostV2,fingerprintDuelCostModifierV2,fingerprintDuelCostCoverageV2,resolveDuelTotalCostV2` |
| `duel/derived-might-v2.ts` | 395 | `DUEL_SOUL_SHEPHERD_CARD_ID_V2,DuelDerivedMightSourceEvidenceV2,DuelDerivedMightTokenEvidenceV2,DuelDerivedMightCompleteV2,DuelDerivedMightBlockedV2,DuelDerivedMightResultV2,DuelDerivedMightRequestV2,DuelDerivedMightEvaluatorV2,deriveDuelCurrentMightV2,deriveDuelUnitCurrentMightV2,evaluateDuelCurrentMightV2,createDuelDerivedMightEvaluatorV2` |
| `duel/draw-burnout.js` | 289 | `startDuelDraw,resumeDuelDraw,drawDuelCards,continueDuelDraw` |
| `duel/draw-burnout.ts` | 430 | `DuelDrawZones,DuelBurnoutTask,DuelDrawCursorStep,DuelDrawCursor,DuelFirstBurnoutResolutionKind,DuelFirstBurnoutResolution,DuelFirstBurnoutResumeOptions,DuelInterventionResumeOptions,DuelDrawResumeOptions,DuelBurnoutIntervention,DuelDrawStatus,DuelDrawStepResult,startDuelDraw,resumeDuelDraw,drawDuelCards,continueDuelDraw` |
| `duel/draw-effect-executor-v2.ts` | 413 | `DuelDrawEffectPhaseV2,DuelDrawEffectSourceV2,DuelDrawEffectCursorV2,DuelDrawEffectPendingV2,DuelDrawEffectCompleteV2,DuelDrawEffectResultV2,DuelDrawEffectResolverContextV2,DuelDrawFirstResolverV2,DuelDrawInterventionResolverV2,DuelDrawEffectAuthorityOptionsV2,DuelDrawEffectAuthorityV2,DuelDrawEffectBlockedErrorV2,createDuelDrawEffectAuthorityV2,beginDuelDrawEffectV2,resumeDuelDrawEffectV2,createDuelDrawAuthorityV2,beginDuelDrawV2,resumeDuelDrawV2` |
| `duel/ending.js` | 505 | `runDuelEndOfTurn,resumeDuelEndOfTurn` |
| `duel/ending.ts` | 641 | `DuelEndingTaskKind,DuelEndingCursor,DuelEndingSession,DuelEndingContext,DuelEndingHookResolution,DuelEndingProviderResult,DuelLethalEvaluators,DuelLethalKillContext,DuelLethalKillResult,DuelFEPRResult,DuelEndingServices,DuelEndingPending,DuelEndingResult,runDuelEndOfTurn,resumeDuelEndOfTurn` |
| `duel/engagement-executor-v2.ts` | 654 | `DuelEngagementEffectsRequestV2,DuelEngagementDrawRequestV2,DuelEngagementDrawProofV2,DuelEngagementServicesV2,DuelEngagementCursorV2,DuelEngagementSpellSuspensionV2,DuelEngagementSpellStartV2,DuelEngagementCommandV2,DuelEngagementStepV2,DuelEngagementBlockCodeV2,DuelEngagementBlockedErrorV2,suspendDuelEngagementForSpellV2,resumeDuelEngagementAfterSpellV2,startDuelEngagementV2,advanceDuelEngagementV2` |
| `duel/index.ts` | 54 | `(barrel or JS exports)` |
| `duel/kill-damage-effect-executor-v2.ts` | 791 | `DuelKillUnitEffectV2,DuelDealDamageEffectV2,DuelPointDamageEffectV1,DuelKillDamageEffect,DuelKillDamagePhaseV2,DuelKillDamageEffectSourceV2,DuelKillDamageAuthorityProofV2,DuelKillDamageProofRequestV2,DuelKillProofRequestV2,DuelLethalProofRequestV2,DuelDamageProposalV2,DuelLethalCandidateProofV2,DuelKillDamageCostVerifierV2,DuelKillDamageChainVerifierV2,DuelKillResolverV2,DuelLethalResolverV2,DuelResolvedDamageMarkV2,DuelDamageResolverV2,DuelKillDamageEffectAuthorityOptionsV2,DuelKillDamageEffectAuthorityV2,DuelKillDamageEffectCursorV2,DuelKillDamageChoiceV2,DuelKillDamagePendingV2,DuelKillDamageNoChangeV2,DuelKillDamageCompleteV2,DuelKillDamageEffectResultV2,DuelKillDamageBlockCodeV2,DuelKillDamageEffectBlockedErrorV2,createDuelKillDamageEffectAuthorityV2,beginDuelKillDamageEffectV2,submitDuelKillDamageEffectChoiceV2,resumeDuelKillDamageEffectV2,resolveDuelKillDamageEffectV2` |
| `duel/match-state.js` | 130 | `createDuelMatch,resolveDuelMulligan,projectDuelMatch` |
| `duel/match-state.ts` | 240 | `DuelMatchPerson,DuelMatchMetadata,DuelMatchSetupState,DuelMatchPrivatePlayer,DuelAwaitingTurnStart,DuelMatchPlayingState,DuelMatchState,PublicDuelMatchSetup,PublicDuelMatchPlayer,PublicDuelMatchPlaying,PublicDuelMatch,createDuelMatch,resolveDuelMulligan,projectDuelMatch` |
| `duel/movement.js` | 193 | `assertDuelReadiness,restoreDuelReadiness,moveDuelUnitsStandard` |
| `duel/movement.ts` | 268 | `DuelReadinessRecord,DuelReadiness,DuelStandardMoveTiming,DuelStandardMoveRequest,DuelMoveEvent,DuelStandardMoveGroup,DuelStandardMoveResult,assertDuelReadiness,restoreDuelReadiness,moveDuelUnitsStandard` |
| `duel/optional-play-choice-v1.ts` | 260 | `DuelOptionalPlaySourceV1,DuelOptionalPlayChoiceRequestV1,DuelOptionalPlayAnswerV1,DuelOptionalPlayPromptV1,DuelOptionalPlayReceiptV1,DuelOptionalPlayReceiptDataV1,DuelOptionalPlayChoiceAuthorityV1,DuelOptionalPlayChoiceServicesV1,createDuelOptionalPlayChoiceAuthorityV1` |
| `duel/optional-play-choice-v2.ts` | 191 | `DuelOptionalPlaySourceV2,DuelOptionalPlayChoiceRequestV2,DuelOptionalPlayAnswerV2,DuelOptionalPlayPromptV2,DuelOptionalPlayReceiptV2,DuelOptionalPlayReceiptDataV2,DuelOptionalPlayChoiceAuthorityV2,DuelOptionalPlayChoiceServicesV2,createDuelOptionalPlayChoiceAuthorityV2` |
| `duel/permanent-state.ts` | 670 | `DuelPhysicalCardOrigin,DuelLegendAuthority,DuelGearAuthority,PhysicalCardOrigin,DuelLegendState,DuelGearOnBoard,DuelChainPhysicalCard,DuelPermanentFields,DuelPermanentCandidate,TrustedDuelOriginalCard,TrustedDuelPermanentInventory,DuelPhysicalZone,DuelPhysicalZoneTransition,DuelPhysicalReference,DuelObjectReadiness,DuelObjectView,assertDuelPermanentState,initializeDuelPermanentState,restoreDuelPermanentState,enumerateDuelObjects,referenceDuelPhysicalCard,assertCurrentDuelPhysicalReference,advanceDuelPhysicalZoneTransitions,attachDuelGear,followDuelAttachedHostMove,detachDuelGearsBeforeHostExit` |
| `duel/phase-closure-boundaries-v2.ts` | 263 | `DuelPhaseClosureStepV2,DuelPhaseClosureBoundaryOrdinalV2,DuelPhaseClosureBoundaryV2,DuelPhaseClosureBoundaryContextV2,DUEL_PHASE_CLOSURE_EVENTS_V2,DUEL_PHASE_CLOSURE_NON_PHASE_EVENTS_V2,duelPhaseClosureBoundariesForStepV2,mapDuelPhaseClosureBoundariesV2,getDuelPhaseClosureBoundariesV2,DUEL_PHASE_CLOSURE_STEPS_V2` |
| `duel/phase-closure-evidence-v2.ts` | 569 | `DuelPhaseClosureSourceLocalV2,DuelPhaseClosureReferenceKindV2,DuelPhaseClosureCoreRequestV2,DuelPhaseClosureRequestLocatorV2,DuelPhaseClosureRegistryResolutionV2,DuelPhaseClosureTokenResolutionV2,DuelPhaseClosureRequirementV2,DuelPhaseClosureJournalResolutionV2,DuelPhaseClosureProtectedResolversV2,DuelPhaseClosureAuthorityV2,DuelPhaseClosureRequestV2,DuelPhaseClosureEvidenceAssemblyV2,createDuelPhaseClosureAuthorityV2,issueDuelPhaseClosureRequestV2,assembleDuelPhaseClosureEvidenceV2` |
| `duel/phase-source-authority-v2.ts` | 222 | `DuelPhaseEventV2,DuelPhaseSourceV2,DuelPhaseSourceRequestV2,DuelPhaseProgramEvidenceV2,DuelPhaseSourceServiceV2,DuelNativeTokenSourceServiceV2,DuelPhaseRegistryV2,DuelPhaseProgramIndexV2,createDuelPhaseSourceRegistryV2,createDuelPhaseSourceRegistryWithNativeTokenSourceV2,createDuelNativeTokenPhaseSourceRegistryV2,DuelPhaseSourceInspectionV2,sameDuelPhaseSourceV2,inspectDuelPhaseSourcesV2` |
| `duel/phase-source-closure-v2.ts` | 864 | `DuelPhaseSourceClosurePhaseV2,DuelPhaseSourceClosureEventV2,DuelPhaseSourceClosureCandidateKindV2,DuelPhaseSourceClosureClockV2,DuelPhaseSourceClosureContextV2,DuelPhaseSourceClosureCandidateV2,DuelPhaseSourceClosureRequestV2,DuelPhaseSourceClosureCoverageV2,DuelPhaseSourceClosureProgramEvidenceV2,DuelPhaseSourceClosureUnknownEvidenceV2,DuelPhaseSourceClosureProgramResultV2,DuelPhaseSourceClosureProgramProducerV2,DuelPhaseSourceClosureProgramIndexV2,DuelPhaseSourceClosureRegistryV2,DuelPhaseSourceClosureTokenReferenceKindV2,DuelPhaseSourceClosureTokenReferenceV2,DuelPhaseSourceClosureRuntimeEntryV2,DuelPhaseSourceClosureLedgerV2,DuelPhaseSourceClosureTransitionV2,DuelPhaseSourceClosurePreExitV2,DuelPhaseSourceClosureDrawSubjectV2,DuelPhaseSourceClosureJournalInputV2,DuelPhaseSourceClosureJournalV2,DuelPhaseSourceClosureInspectionV2,createDuelPhaseSourceClosureRegistryV2,createDuelPhaseSourceClosureJournalV2,createDuelPhaseSourceClosureJournalV2,createDuelPhaseSourceClosureJournalV2,inspectDuelPhaseSourceClosureV2,inspectDuelPhaseSourceClosureV2,inspectDuelPhaseSourceClosureV2,inspectDuelPhaseSourceClosureV2,createDuelSourceClosureRegistryV2,createDuelSourceClosureJournalV2,inspectDuelSourceClosureV2,enumerateDuelPhaseSourceClosureCandidatesV2` |
| `duel/point-damage-effect-executor-v1.ts` | 100 | `DuelPointDamageEffectAuthorityOptionsV1,DuelPointDamageEffectAuthorityV1,DuelPointDamageEffectCursorV1,DuelPointDamageEffectChoiceV1,DuelPointDamageEffectResultV1,DuelPointDamageProposalV1,DuelPointLethalCandidateProofV1,DuelPointLethalProofRequestV1,createDuelPointDamageEffectAuthorityV1,beginDuelPointDamageEffectV1,submitDuelPointDamageEffectChoiceV1,resumeDuelPointDamageEffectV1,resolveDuelPointDamageEffectV1` |
| `duel/printed-costs.ts` | 156 | `DuelPrintedCostReason,DuelPrintedCostNumeric,DuelPrintedCostUnsupported,DuelPrintedCostBinding,DuelPrintedCostCatalogCard,bindDuelPrintedCost,bindDuelPrintedCostRegistry` |
| `duel/private-journals.ts` | 2 | `(barrel or JS exports)` |
| `duel/projection-v2.ts` | 208 | `projectCanonicalDuelMatchV2` |
| `duel/projection-v3.ts` | 213 | `projectCanonicalDuelMatchV3` |
| `duel/resource-readiness-journal-v2.ts` | 882 | `DuelResourceEventSourceV2,DuelResourceActionV2,DuelResourceReadinessEventV2,DuelResourceOuterCommitAuthorityV2,DuelResourceOuterCommitV2,DuelResourceSourceProofV2,DuelResourceOuterCommitProviderV2,DuelResourceReadinessGenesisV2,DuelResourceReadinessJournalV2,DuelResourceReadinessHeadV2,DuelResourceReadinessWriterV2,DuelResourceSourceAuthorityV2,DuelResourceSourceProviderV2,digestDuelResourcePaymentV2,createDuelResourceSourceAuthorityV2,createDuelResourceOuterCommitAuthorityV2,beginDuelResourceReadinessJournalFromSetupV2,beginDuelResourceReadinessJournalV2,appendDuelResourceReadinessEventV2,sealDuelResourceReadinessJournalV2,replayDuelResourceReadinessJournalV2,assertDuelResourceReadinessProofV2` |
| `duel/resources.js` | 457 | `DUEL_DOMAINS,restoreDuelResources,assertDuelResources,createDuelResources,channelDuelRunes,activateBasicRuneEnergy,activateBasicRunePower,createDuelGoldToken,activateDuelGoldPower,clearAllDuelRunePools,payDuelRuneCost,projectPublicDuelResources` |
| `duel/resources.ts` | 473 | `DUEL_DOMAINS,DuelDomain,DuelPowerSource,DuelRunePool,DuelDeckRune,DuelBaseRune,DuelGoldToken,DuelResourcePlayer,DuelResourceBase,DuelResources,DuelBaseLocation,DuelResourceTiming,DuelPowerRequirement,DuelRuneCost,DuelPowerAllocation,DuelPaymentPlan,DuelPaymentResult,PublicDuelResources,restoreDuelResources,assertDuelResources,createDuelResources,channelDuelRunes,activateBasicRuneEnergy,activateBasicRunePower,createDuelGoldToken,activateDuelGoldPower,clearAllDuelRunePools,payDuelRuneCost,projectPublicDuelResources` |
| `duel/scoring.js` | 247 | `createDuelScoring,restoreDuelScoring,beginDuelScoreTurn,scoreDuelBattlefield,gainDuelPoints,loseDuelPoints,setDuelVictoryScoreForEffect,getDuelWinnerAtCleanup,projectPublicDuelScoring` |
| `duel/scoring.ts` | 314 | `DuelScoringPlayer,DuelScoringState,DuelScoreMethod,DuelScoreTiming,DuelScoreOutcome,DuelScoreResult,DuelPointGain,DuelPointLoss,createDuelScoring,restoreDuelScoring,beginDuelScoreTurn,scoreDuelBattlefield,gainDuelPoints,loseDuelPoints,setDuelVictoryScoreForEffect,getDuelWinnerAtCleanup,projectPublicDuelScoring` |
| `duel/setup.js` | 252 | `DUEL_SETUP_DOMAINS,createDuelSetup,restoreDuelSetup,mulliganDuelSetup,projectPublicDuelSetup,completeDuelSetup` |
| `duel/setup.ts` | 347 | `DUEL_SETUP_DOMAINS,DuelSetupDomain,SetupCard,SetupRune,SetupField,DuelSetupSeat,SetupSelectedField,DuelSetupSelection,DuelSetupPlayer,DuelSetupState,PublicSetupPlayer,PublicDuelSetup,CompletedDuelSetup,createDuelSetup,restoreDuelSetup,mulliganDuelSetup,projectPublicDuelSetup,completeDuelSetup` |
| `duel/standard-move-executor-v2.ts` | 361 | `DuelStandardMoveIntentV2,DuelStandardMoveCursorV2,DuelStandardMoveTriggerObligationV2,DuelStandardMovePendingV2,DuelStandardMoveHandlerAnswerV2,DuelStandardMoveHandlerServiceV2,DuelStandardMoveSettlementProofV2,DuelStandardMoveCertificationV2,DuelStandardMoveCompletedV2,beginDuelStandardMoveV2,certifyDuelStandardMoveTriggersV2,resumeDuelStandardMoveV2` |
| `duel/token-play-v2.ts` | 446 | `DuelRecruitTokenPlayRequestV2,DuelRecruitTokenEffectHeadV2,DuelRecruitTokenCostBindingV2,DuelRecruitTokenLegalityV2,DuelRecruitTokenEntryProofV2,DuelRecruitTokenClosureEventV2,DuelRecruitTokenClosureAuthorityV2,DuelRecruitTokenPlayServicesV2,DuelRecruitTokenPlayV2,DuelRecruitTokenPlayStageV2,DuelRecruitTokenPlayInspectionV2,DuelRecruitTokenPlayProgressV2,createDuelRecruitTokenPlayV2,inspectDuelRecruitTokenPlayV2,beginDuelRecruitTokenPlayV2,cancelDuelRecruitTokenPlayV2,resumeDuelRecruitTokenPlayV2,applyDuelRecruitTokenResourceCommandV2` |
| `duel/token-play-v3.ts` | 312 | `DuelRecruitTokenPlayRequestV3,DuelRecruitTokenEffectHeadV3,DuelRecruitTokenCostBindingV3,DuelRecruitTokenLegalityV3,DuelRecruitTokenEntryProofV3,DuelRecruitTokenClosureEventV3,DuelRecruitTokenClosureAuthorityV3,DuelRecruitTokenPlayServicesV3,DuelRecruitTokenPlayV3,DuelRecruitTokenPlayStageV3,DuelRecruitTokenPlayProgressV3,DuelRecruitTokenPlayInspectionV3,createDuelRecruitTokenPlayV3,inspectDuelRecruitTokenPlayV3,beginDuelRecruitTokenPlayV3,cancelDuelRecruitTokenPlayV3,resumeDuelRecruitTokenPlayV3,applyDuelRecruitTokenResourceCommandV3` |
| `duel/turn-executor-v2.ts` | 767 | `DuelTurnCursorV2,DuelTurnServicesV2,DuelTurnCheckpointV2,DuelTurnResultV2,inheritDuelTurnCursorBondV2,runDuelStartOfTurnV2,resumeDuelStartOfTurnV2,runDuelEndOfTurnV2,resumeDuelEndOfTurnV2` |
| `duel/turn-flow.js` | 496 | `runDuelStartOfTurn,resumeDuelStartOfTurn` |
| `duel/turn-flow.ts` | 490 | `DuelTurnFlowCursor,DuelTurnFlowSession,DuelTurnFlowContext,DuelFlowHookResolution,DuelFirstPointResolution,DuelFlowProviderResult,DuelTurnFlowServices,DuelTurnFlowPending,DuelTurnFlowResult,runDuelStartOfTurn,resumeDuelStartOfTurn` |
| `duel/turn-start.js` | 491 | `beginAwaken,resumeAwakenBeginning` |
| `duel/turn-start.ts` | 632 | `DuelTurnStartStep,DuelTurnStartTaskKind,DuelTurnProgress,DuelAwakenBeginningSession,DuelTurnStartContext,DuelReadinessResolution,DuelPendingResolution,DuelReadinessProviderResult,DuelOtherPermanentResolution,DuelBeginningEffectsResolution,DuelRequiredHookResult,DuelAwakenBeginningServices,DuelPendingTurnTask,DuelTurnStartStatus,DuelTurnStartRejection,DuelTurnStartResult,beginAwaken,resumeAwakenBeginning` |
| `duel/unit-lifecycle.js` | 381 | `assertDuelUnitLifecycleState,materializeDuelUnitFromSettledSource,readyDuelUnits,exhaustDuelUnitsAsCost,exhaustDuelUnitsByEffect,recordResolvedDuelDamage,healAllDuelUnitDamage,projectPublicDuelUnitObjects,queryLethalDuelUnitCandidates,planDuelUnitKills,commitApprovedDuelUnitKills,deriveDuelReadinessFromUnitMeta,moveDuelUnitsWithMetadata` |
| `duel/unit-lifecycle.ts` | 491 | `DuelUnitPrivatePlayer,DuelDamageMark,DuelUnitTrait,DuelUnitMeta,DuelUnitLifecycleState,SettledDuelUnitSource,PublicDuelUnitObject,DuelKillSnapshot,DuelKillPlan,ApprovedDuelKillPlan,DuelKillNotice,assertDuelUnitLifecycleState,materializeDuelUnitFromSettledSource,readyDuelUnits,exhaustDuelUnitsAsCost,exhaustDuelUnitsByEffect,recordResolvedDuelDamage,healAllDuelUnitDamage,projectPublicDuelUnitObjects,queryLethalDuelUnitCandidates,planDuelUnitKills,commitApprovedDuelUnitKills,deriveDuelReadinessFromUnitMeta,moveDuelUnitsWithMetadata` |
| `full-product/runtime.ts` | 1004 | `FULL_PRODUCT_PHASES,FULL_PRODUCT_TURN_STEPS,FULL_PRODUCT_ERROR_CODES,FullProductPhase,FullProductTurnStep,FullProductErrorCode,FullProductPlayerId,FullProductCardDefinition,FullProductCardType,FullProductCardInstance,FullProductZone,FullProductPlayerState,FullProductLegalAction,FullProductPrompt,FullProductPromptOption,FullProductEvent,FullProductCommand,FullProductGameConfig,FullProductGameState,FullProductCommandResult,createFullProductGame,listLegalActions,submitFullProductCommand` |
| `index.ts` | 2340 | `HOT_FEPR_STEPS,HotFeprStep,RULESET_ID,SYNTHETIC_RULESET_ID,createInitialGame,createConfiguredGame,submitCommand,CommandResult,LegacyPromptReconcileStatus,LegacyPromptReconcileResult,reconcileLegacyPrompt,getHotFeprStep,projectGame,projectZones,projectObject,createRoomSnapshot` |
| `state.ts` | 226 | `Zone,GameObjectType,GameObject,EffectTarget,DamageEffect,GainPointsEffect,JudgeRequiredEffect,CardEffect,EngineCardDefinition,CreateGamePlayerOptions,RulesetId,CreateGameRulesOptions,CreateConfiguredGameOptions,GameRules,SyntheticGameRules,FoundationGameRules,ZoneProjection,FoundationPlayerState,SyntheticPlayerState,PlayerState,TaskDisposition,OutstandingTask,SyntheticGameState,FoundationGameState,GameState,GameStateShape` |

## 测试文件清单与用例数

下表按逻辑模块合并同名 `.js`/`.ts` 的测试映射；括号内是上文命令按 `test(`/`it(` 计数的用例数。一个测试可能同时覆盖多个模块，因此各行相加不会等于 841。

| 模块 | 测试文件（省略 `.test.mjs` 后缀） |
| --- | --- |
| `base-combat-allocation.ts` | `duel-base-combat-allocation`(15), `duel-combat-choice-v2`(19) |
| `battlefields.js/.ts` | `duel-base-combat-allocation`(15), `duel-battlefields`(16), `duel-cardplay-spell-v2`(32), `duel-combat-choice-v2`(19), `duel-combat-damage-executor-v2`(11), `duel-derived-might-v2`(4), `duel-draw-burnout`(12), `duel-engagement-executor-v2`(10), `duel-kill-damage-effect-executor-v2`(11), `duel-permanent-state`(14), `duel-permanent-v2`(11), `duel-point-damage-effect-v1`(14), `duel-point-production-target-proof-v1`(3), `duel-scoring`(14), `duel-shield-might-v1`(3), `duel-showdown-cardplay-focus-v1`(5), `duel-standard-move`(17), `duel-turn-executor-v2`(15), `duel-turn-flow`(8), `duel-turn-handler-identity-v2`(1), `duel-turn-payment-cursor-v2`(11), `duel-unit-lifecycle`(13) |
| `canonical-session-v2.ts` | `duel-canonical-session-v2`(15), `duel-canonical-session`(11), `duel-cardplay-spell-v2`(32), `duel-cardplay-unit-v2`(16), `duel-choice-opening-clock-v2`(4), `duel-continuation-reuse-v2`(6), `duel-engagement-executor-v2`(10), `duel-gear-physical-chain-cardplay-v1`(8), `duel-gold-command-v2`(8), `duel-hold-native-token-handler-v3`(7), `duel-native-command-successor-v2`(4), `duel-optional-play-choice-v1`(11), `duel-pending-payment-inspection-v2`(7), `duel-phase-source-authority-v2`(7), `duel-phase-source-closure-v2`(18), `duel-point-damage-cardplay-coordinator-v1`(9), `duel-point-production-source-proof-v1`(2), `duel-point-production-target-proof-v1`(3), `duel-projection-v2`(5), `duel-recruit-canonical-chain-v3`(14), `duel-recruit-token-play-v2`(12), `duel-resource-legality-v2`(1), `duel-showdown-cardplay-focus-v1`(5), `duel-spell-chain-first-order-v3`(11), `duel-turn-checkpoints-v2`(4), `duel-turn-executor-v2`(15), `duel-turn-handler-identity-v2`(1), `duel-turn-payment-cursor-v2`(11), `duel-unit-physical-chain-v4`(21), `duel-unit-v4-attempt-proof`(2) |
| `canonical-session.js/.ts` | `duel-canonical-integration`(4), `duel-canonical-session-v2`(15), `duel-canonical-session`(11) |
| `canonical-transaction.js/.ts` | `duel-canonical-integration`(4), `duel-canonical-session`(11), `duel-choice-opening-clock-v2`(4), `duel-ending`(15), `duel-permanent-v2`(11), `duel-turn-flow`(8), `duel-turn-start`(7) |
| `cardplay-gear-v1.ts` | `duel-gear-physical-chain-cardplay-v1`(8) |
| `cardplay-spell-v2.ts` | `duel-cardplay-spell-v2`(32), `duel-point-damage-cardplay-coordinator-v1`(9), `duel-point-production-source-proof-v1`(2), `duel-point-production-target-proof-v1`(3), `duel-showdown-cardplay-focus-v1`(5), `duel-spell-chain-first-order-v3`(11) |
| `cardplay-unit-chain-v4.ts` | `duel-unit-physical-chain-v4`(21) |
| `cardplay-unit-v2.ts` | `duel-cardplay-unit-v2`(16), `duel-point-damage-cardplay-coordinator-v1`(9) |
| `chain-v2.ts` | `duel-cardplay-spell-v2`(32), `duel-chain-card-storage-v2`(4), `duel-chain-v2`(28), `duel-gear-physical-chain-cardplay-v1`(8), `duel-recruit-canonical-chain-v3`(14), `duel-spell-chain-first-order-v3`(11), `duel-unit-physical-chain-v4`(21) |
| `combat-choice-v2.ts` | `duel-combat-choice-v2`(19) |
| `combat-damage-executor-v2.ts` | `duel-combat-damage-executor-v2`(11) |
| `command-executor-v2.ts` | `duel-unit-v4-attempt-proof`(2) |
| `conquer-v2.ts` | `duel-conquer-v2`(9) |
| `core-v2.ts` | `duel-canonical-session-v2`(15), `duel-card-type-role-v2`(4), `duel-cardplay-spell-v2`(32), `duel-cardplay-unit-v2`(16), `duel-chain-card-storage-v2`(4), `duel-choice-opening-clock-v2`(4), `duel-combat-damage-executor-v2`(11), `duel-derived-might-v2`(4), `duel-draw-effect-executor-v2`(5), `duel-engagement-executor-v2`(10), `duel-gear-physical-chain-cardplay-v1`(8), `duel-gold-command-v2`(8), `duel-hold-native-token-handler-v3`(7), `duel-kill-damage-effect-executor-v2`(11), `duel-native-command-successor-v2`(4), `duel-native-commit-path-v2`(4), `duel-optional-play-choice-v1`(11), `duel-pending-payment-inspection-v2`(7), `duel-permanent-v2`(11), `duel-phase-source-closure-v2`(18), `duel-point-damage-cardplay-coordinator-v1`(9), `duel-point-damage-effect-v1`(14), `duel-point-production-source-proof-v1`(2), `duel-point-production-target-proof-v1`(3), `duel-projection-v2`(5), `duel-recruit-canonical-chain-v3`(14), `duel-recruit-token-play-v2`(12), `duel-resource-legality-v2`(1), `duel-resource-readiness-journal-v2`(8), `duel-shield-might-v1`(3), `duel-showdown-cardplay-focus-v1`(5), `duel-spell-chain-first-order-v3`(11), `duel-token-invariants-v2`(21), `duel-token-lifecycle-v2`(11), `duel-turn-checkpoints-v2`(4), `duel-turn-executor-v2`(15), `duel-turn-payment-cursor-v2`(11), `duel-unit-physical-chain-v4`(21), `duel-unit-v4-attempt-proof`(2) |
| `cost-resolver-v2.ts` | `duel-cardplay-spell-v2`(32), `duel-cardplay-unit-v2`(16), `duel-cost-resolver-v2`(19), `duel-gear-physical-chain-cardplay-v1`(8), `duel-optional-cost-zero-v2`(5), `duel-optional-unit-cardplay-v1`(12), `duel-optional-unit-payment-retry-v3`(1), `duel-optional-unit-payment-v3`(9), `duel-point-damage-cardplay-coordinator-v1`(9), `duel-point-production-source-proof-v1`(2), `duel-point-production-target-proof-v1`(3), `duel-recruit-canonical-chain-v3`(14), `duel-recruit-token-play-v2`(12), `duel-showdown-cardplay-focus-v1`(5), `duel-spell-chain-first-order-v3`(11), `duel-unit-physical-chain-v4`(21) |
| `derived-might-v2.ts` | `duel-assault-might-v2`(2), `duel-derived-might-v2`(4), `duel-shield-might-v1`(3) |
| `draw-burnout.js/.ts` | `duel-draw-burnout`(12) |
| `draw-effect-executor-v2.ts` | `duel-draw-effect-executor-v2`(5) |
| `ending.js/.ts` | `duel-ending`(15), `duel-pending-payment-inspection-v2`(7) |
| `engagement-executor-v2.ts` | `duel-engagement-executor-v2`(10), `duel-showdown-cardplay-focus-v1`(5) |
| `duel/index.ts` | duel tests that import the barrel; high-signal suites include `duel-canonical-session-v2`(15), `duel-cardplay-spell-v2`(32), `duel-cardplay-unit-v2`(16), `duel-projection-v3`(10), `duel-unit-physical-chain-v4`(21) |
| `kill-damage-effect-executor-v2.ts` | `duel-kill-damage-effect-executor-v2`(11) |
| `match-state.js/.ts` | `duel-canonical-integration`(4), `duel-canonical-session-v2`(15), `duel-canonical-session`(11), `duel-ending`(15), `duel-match-state`(7), `duel-permanent-state`(14), `duel-permanent-v2`(11), `duel-turn-flow`(8), `duel-turn-start`(7) |
| `movement.js/.ts` | `duel-standard-move`(17) |
| `optional-play-choice-v1.ts` | `duel-optional-play-choice-v1`(11), `duel-optional-unit-payment-invariants-v3`(1), `duel-optional-unit-payment-retry-v3`(1), `duel-optional-unit-payment-v3`(9) |
| `optional-play-choice-v2.ts` | `duel-optional-play-choice-v1`(11) imports both authorities for comparison |
| `permanent-state.ts` | `duel-permanent-state`(14) |
| `phase-closure-boundaries-v2.ts` | `duel-phase-closure-boundaries-v2`(9) |
| `phase-closure-evidence-v2.ts` | `duel-phase-closure-evidence-v2`(20) |
| `phase-source-authority-v2.ts` | `duel-cardplay-unit-v2`(16), `duel-engagement-executor-v2`(10), `duel-hold-native-token-handler-v3`(7), `duel-phase-source-authority-v2`(7), `duel-point-damage-cardplay-coordinator-v1`(9), `duel-resource-legality-v2`(1), `duel-showdown-cardplay-focus-v1`(5), `duel-turn-checkpoints-v2`(4), `duel-turn-handler-identity-v2`(1), `duel-turn-payment-cursor-v2`(11) |
| `phase-source-closure-v2.ts` | `duel-derived-might-v2`(4), `duel-gear-physical-chain-cardplay-v1`(8), `duel-phase-source-closure-v2`(18), `duel-recruit-canonical-chain-v3`(14), `duel-recruit-token-play-v2`(12), `duel-shield-might-v1`(3), `duel-unit-physical-chain-v4`(21) |
| `point-damage-effect-executor-v1.ts` | `duel-point-damage-effect-v1`(14) |
| `printed-costs.ts` | `duel-canonical-session`(11), `duel-printed-costs.audit.mjs`(4), `duel-printed-costs`(9) |
| `private-journals.ts` | 无独立测试；由 `resource-readiness-journal-v2` 测试覆盖。 |
| `projection-v2.ts` | `duel-projection-v2-admission`(4), `duel-projection-v2`(5), `duel-projection-v3`(10) |
| `projection-v3.ts` | `duel-projection-v2-admission`(4), `duel-projection-v2`(5), `duel-projection-v3`(10) |
| `resource-readiness-journal-v2.ts` | `duel-resource-readiness-journal-v2`(8) |
| `resources.js/.ts` | `duel-canonical-integration`(4), `duel-canonical-session`(11), `duel-cost-resolver-v2`(19), `duel-ending`(15), `duel-match-state`(7), `duel-optional-unit-cardplay-v1`(12), `duel-optional-unit-payment-retry-v3`(1), `duel-optional-unit-payment-v3`(9), `duel-permanent-state`(14), `duel-printed-costs`(9), `duel-resource-allocation`(1), `duel-resource-readiness-journal-v2`(8), `duel-resources`(13), `duel-turn-flow`(8), `duel-turn-start`(7), `duel-unit-lifecycle`(13) |
| `scoring.js/.ts` | `duel-draw-burnout`(12), `duel-engagement-executor-v2`(10), `duel-scoring`(14), `duel-turn-flow`(8) |
| `setup.js/.ts` | `duel-match-state`(7), `duel-setup`(15) |
| `standard-move-executor-v2.ts` | `duel-standard-move-executor-v2`(20) |
| `token-play-v2.ts` | `duel-recruit-token-play-v2`(12) |
| `token-play-v3.ts` | `duel-recruit-canonical-chain-v3`(14), `duel-recruit-token-play-v2`(12) |
| `turn-executor-v2.ts` | `duel-continuation-reuse-v2`(6), `duel-engagement-executor-v2`(10), `duel-gold-command-v2`(8), `duel-hold-native-token-handler-v3`(7), `duel-native-command-successor-v2`(4), `duel-point-damage-cardplay-coordinator-v1`(9), `duel-resource-legality-v2`(1), `duel-turn-checkpoints-v2`(4), `duel-turn-executor-v2`(15), `duel-turn-handler-identity-v2`(1), `duel-turn-payment-cursor-v2`(11) |
| `turn-flow.js/.ts` | `duel-ending`(15), `duel-turn-flow`(8) |
| `turn-start.js/.ts` | `duel-turn-start`(7) |
| `unit-lifecycle.js/.ts` | `duel-canonical-integration`(4), `duel-ending`(15), `duel-kill-damage-effect-executor-v2`(11), `duel-turn-flow`(8), `duel-turn-start`(7), `duel-unit-lifecycle`(13) |
| `full-product/runtime.ts` | `packages/engine-core/test/full-product/runtime-contracts.test.mjs`(7), `packages/engine-core/test/full-product/runtime.test.mjs`(13) |
| `index.ts` | `action-options`(7), `command-action-policy`(6), `command-targets`(4), `engine`(27), `legacy-prompt-authority`(13), `legacy-prompt-target-policy`(15), `synthetic-default-target-regression`(6)；integration：`packages/integration-tests/src/engine.integration.test.ts`。 |
| `state.ts` | 通过 `index.ts` 间接覆盖；server：foundation/deck validation/room；无独立 `.mjs`。 |

## 风险、遗留和契约请求

- 这是静态 survey，不证明卡牌官方语义完整；仓库 README 也明确 foundation 是 narrow playable vertical slice，未知能力仍应保持 `judge-required`（`packages/engine-core/README.md:3-9`、`:69-76`、`packages/engine-core/src/index.ts:153-155`）。
- 默认 CLI profile 与 `createAuthoritativeDuelRuntimeP4` 的内部默认不同，迁移时必须先固定“默认路径”测试，否则会把 public-chain-v1、optional clock、physical chain 三种语义混在一起。
- `duel/index.ts` 是高冲突 barrel；迁移时父任务应先拆出口，再让各层任务只改自己的模块目录。
- `.js`/`.ts` 双份实现的真实构建解析应以 `pnpm --filter @riftbound/engine-core build` 和 dist 内容为准；本次 build 通过，但没有改源码去消除重复。
- 契约变更请求：**无**。本调研不修改契约、不修改源码/测试、不修改生成卡牌数据。
