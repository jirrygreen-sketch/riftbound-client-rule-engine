# RIFT-1104 战斗伤害等待期间可无限 Pass 调查

## 结论

Mac beta 中的现象已在当前 `integration@c83d8b47` 的**真实 `createEngineRuntime` 生产装配路径**复现：攻方提交伤害分配后，投影仍把攻方列为 `priority.playerId`，`pendingChoice.status` 为 `none`；Pass 第一次和第二、第三次都被接受，回执中的 `stateVersion` 每次递增，但同一战斗仍等待守方分配，`eventSeq` 不变。服务端没有仅凭版本变化而误报成功；它先执行了真实的 `TurnFlow.pass()`，后者再把并没有发生规则推进的结果包装成 accepted 回执。

根因不是一个输入校验分支，而是同一规则事实在三层出现了不一致：

1. `ChainEngine` 的通用 Priority/Focus tracker 在伤害分配窗口仍为攻方保留旧 Priority。
2. `TurnFlow.pass()` 在战斗活动时不结束回合，只调用 `ChainEngine.pass()`；当 Chain 无档且没有 Showdown 时，后者只留下 `phase-complete` trace，不改变战斗。
3. `canPassForViewer` 对活动 Combat 直接使用 `ChainEngine.canPass(viewer)`，没有先要求 `combat.damage.expectedPlayerId === viewer`；于是投影发送 `canPass: true`，客户端显示 Pass。
4. engine-runtime 随后用现成的 `match.flow.pass(playerId)` 接受并递增 `stateVersion`，room 把同一个 accepted 结果原样转为公开回执。room 层没有独立制造异常，但它也没有拦截语义 no-op；真正的范围边界应在 engine-runtime/engine-core。

现有 `apps/game-server/tests/engine-runtime/v2-can-pass.test.ts` 已把这一错误结果写成预期：伤害等待时断言 `canPass=true` 并断言额外 Pass 被接受。修复时应重写这两个断言，而不是新增一个只记录“功能缺失”的测试。

官方 CR v1.5 只明确说明：Combat Damage Step 从攻方开始，**每个玩家依次分配伤害**；伤害分配完成前尚未 Deal Damage，双方都分配后才同时造成伤害。CR 没有为这一分配窗口定义可供 Discretionary Action 使用的通用 Priority 或 Focus，也没有允许玩家在此跳过强制分配。因此“此窗口不应显示通用 Pass、Pass 不得改变或推进战斗”可由适用规则及 fail-closed 原则确定；“应把该窗口建模成什么样的 non-Priority 选择/责任游标”属于产品模型选择，官方文本未显式命名，标记为 **judge-required / contract review**，不能自行新增一条近似规则。

## 官方规则依据

规则版本为 Core Rules v1.5，2026-10-09 发布，Radiance 生效日 2026-10-16。缓存原文是仓库内校验的 `/root/swarm-rift/shared/rules/CR-v1.5.txt`；官方 PDF 地址为 `https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf`，生效公告为 `https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/`。本条为通用规则，`canonicalCardId = general`，不涉及具体卡文或旧 FAQ。

| 规则 | 对本案的作用 |
| --- | --- |
| CR 303.1–303.2 | Game Action 一次完整执行；不能用没有规则效果的重复 Pass 冒充进展。 |
| CR 312 / 312.1 | 至多一名玩家持有 Priority，Priority 是执行适格 Discretionary Action 的排他权利；没有适格动作时不能据此把任意命令视为合法。 |
| CR 312.2.a–d | 列明 Priority 何时授予：Neutral Open Main、Showdown Focus、Chain Pending Finalize、Closed State 中按序传递。 Combat Damage Step 的强制分配不在这些通用 Pass 窗口内。 |
| CR 333 | Task 是继续其他动作前必须完成的程序，明确包括 Combat 各步骤。 |
| CR 347.2 / 348–348.1 | Showdown Open 中 Focus holder 的 Pass 可以结束 Showdown；Combat Showdown 结束后转入剩余 Combat 步骤。它约束的是 Showdown，不是后续 Damage Step 中玩家的强制分配。 |
| CR 466.2.c.1.a、466.2.c.2 | Combat 开始时由施压方成为 Attacker 并在 Combat Showdown 获得 Focus；对方是 Defender。此 Focus 属于 Showdown，不能无限沿用为 Damage Step 的 Pass 许可。 |
| CR 467.1–467.2.b | 双方单位仍在战场时，按顺序汇总 Attacker/Defender Might。 |
| CR 467.2.c | **Starting with the Attacker, each player assigns an amount of damage equal to their summed Might among the other's Units.** 这是按序分配，不是可选择跳过。 |
| CR 467.2.c.1 / 467.2.c.1.a / 467.2.d | Assign 与 Deal 不同；所有分配齐全后才同时 Deal 对应伤害。 |
| CR 467.2.c.2–467.2.c.10 | 只调整分配顺序/金额及 lethal、Tank、Backline、阻止/替代等约束，未定义 Pass 可替代或跳过分配。 |
| CR 467.3 / 468.1 | 伤害完成后才跳过剩余 FEPR并进入 Combat Resolution。 |

据以上条目，真实期望时间线是：

1. Damage Step 开始时，攻方成为当前分配者；可执行的 Limited Action 是为其总 Might 选择合法目标与金额，并非通用 Pass。
2. 攻方提交合法分配后，当前责任转到守方；攻方此时只能在投影中观察到“等待守方”，不能再次行动。
3. 守方提交全部合法分配后，系统一次性 Deal 两侧已分配伤害，再进入 Cleanup/Result。

CR 没有规定 V2 投影必须新增一种 `damage-assignment` pending choice，也没有说明责任切换是否必须借用 `priorityPlayerId`。所以推荐的 fail-closed 行为可由现有字段表达：Damage Step 中 `actionOptions.canPass=false`；非当前分配者不得提交 `combat-damage`；现有 `combat.damage.expectedPlayerId` 作为唯一当前分配者提示保留。若要增加专用 choice/priority 语义，需由父级规则 owner 与协议 owner 决定，当前不请求协议改动。

## 真实复现

复现使用 `createEngineRuntime(...).start()`：它走真实 `createMatch`、`TurnFlow`、`ChainEngine`、`createProgramBinding` 与 `attachLifecycle`，再用正常的 play/pass/end-turn/move/advance/combat-damage 命令进入 Combat Damage Step。没有改写 frame、zone、health、damage、Priority 或事件。

临时 Vitest 文件放在 `apps/game-server/tests/engine-runtime/__rift1104-repro.test.ts` 执行后立即删除，没有进入提交。为同时记录攻守双方视角，第二个临时变体 `__rift1104-before.test.ts` 也只用于采样并在运行后删除。核心装配与执行内容如下；日志保留在 `/tmp/RIFT-1104-pass-during-damage-wait/repro-before.log`：

```ts
const runtime = createEngineRuntime({
  matchId: "RIFT-1104-live", roomId: "RIFT-1104-live",
  decks: [deck("A"), deck("B")], seed: "RIFT-1104-live-seed",
  firstPlayer: "A", battlefieldChoice: [0, 0], programs: programs(),
}).start();

// A、B 各用零费真实 Program play 一个 Unit；正常结束回合并移动至同一战场，
// 双方按真实 Showdown Focus 规则 Pass，Turn Player 用 advance 打开 Damage Step。
const before = runtime.projectFor("B");
runtime.submit("B", command("advance", "advance-to-damage", before.stateVersion, {}));

const damage = runtime.projectFor("A");
runtime.submit("B", command("combat-damage", "attacker-assignment", damage.stateVersion, {
  combatId: damage.combat.combatId,
  assignments: [{ unitObjectId: aUnit, amount: damage.combat.damage.attackerMight }],
}));

// 以下为观察，不修改任何投影或命令。
const waitingDefender = runtime.projectFor("A");
const waiting = runtime.projectFor("B"); // 攻方视角，Pass 前
const pass1 = runtime.submit("B",
  command("pass", "attacker-pass-waiting-1", waiting.stateVersion, {}));
const pass2 = runtime.submit("B",
  command("pass", "attacker-pass-waiting-2", runtime.projectFor("B").stateVersion, {}));
```

执行命令：

```sh
pnpm --filter @riftbound/game-server exec vitest run \
  --config vitest.config.ts tests/engine-runtime/__rift1104-before.test.ts --reporter=verbose
```

关键原始回执与投影：

```json
{"stateVersion":13,"priority":{"playerId":"B","focusPlayerId":null,"window":"open"},"pendingChoice":{"status":"none"},"actionOptions":{"canEndTurn":false,"canAdvance":false,"canPass":false,"moves":[],"plays":[]},"combat":{"status":"active","battlefieldId":"token:5","step":"damage","combatId":"combat:token:5:1","attackerPlayerId":"B","defenderPlayerId":"A","damage":{"attackerMight":3,"defenderMight":3,"attackerSubmitted":true,"expectedPlayerId":"A"}}}

{"stateVersion":13,"priority":{"playerId":"B","focusPlayerId":null,"window":"open"},"pendingChoice":{"status":"none"},"actionOptions":{"canEndTurn":false,"canAdvance":false,"canPass":true,"moves":[],"plays":[]},"combat":{"status":"active","battlefieldId":"token:5","step":"damage","combatId":"combat:token:5:1","attackerPlayerId":"B","defenderPlayerId":"A","damage":{"attackerMight":3,"defenderMight":3,"attackerSubmitted":true,"expectedPlayerId":"A"}},"eventSeq":295}

{"before":{"stateVersion":13,"eventSeq":295},"receipt":{"commandId":"attacker-pass-waiting-1","status":"accepted","stateVersion":14,"eventSeq":295,"result":{"accepted":true}},"after":{"stateVersion":14,"priority":{"playerId":"B","focusPlayerId":null,"window":"open"},"pendingChoice":{"status":"none"},"actionOptions":{"canEndTurn":false,"canAdvance":false,"canPass":true,"moves":[],"plays":[]},"combat":{"status":"active","battlefieldId":"token:5","step":"damage","combatId":"combat:token:5:1","attackerPlayerId":"B","defenderPlayerId":"A","damage":{"attackerMight":3,"defenderMight":3,"attackerSubmitted":true,"expectedPlayerId":"A"}}}}

{"before":{"stateVersion":14},"receipt":{"commandId":"attacker-pass-waiting-2","status":"accepted","stateVersion":15,"eventSeq":295,"result":{"accepted":true}},"after":{"stateVersion":15,"combat":{"status":"active","battlefieldId":"token:5","step":"damage","combatId":"combat:token:5:1","attackerPlayerId":"B","defenderPlayerId":"A","damage":{"attackerMight":3,"defenderMight":3,"attackerSubmitted":true,"expectedPlayerId":"A"}},"priority":{"playerId":"B","focusPlayerId":null,"window":"open"},"actionOptions":{"canEndTurn":false,"canAdvance":false,"canPass":true,"moves":[],"plays":[]}}
```

第一个 JSON 是第一次 Pass 之前从 `A`（守方）视角取得的投影；第二个是同一 head 上从 `B`（攻方）视角取得的投影。两者冻结的 Combat 与 `expectedPlayerId=A` 相同，但攻方视角错误显示 `canPass:true`，这直接对应 Mac UI 中可点的 Pass。第二次 Pass 再次 accepted，`stateVersion 14→15`，战斗与 `eventSeq 295` 完全不变。

真实物理伤害会被随机对局中的牌或 Unit 数量等因素夸大，但本例只使用双方各一个 3 Might Unit，进入 Damage 后攻方先分配 3，随后 `expectedPlayerId=A`。等待窗口不包含临时 fixture 结算，复现最强的判据是“同一 expectedPlayerId、同一 `eventSeq`、stateVersion 可无限增长”。

现有生产测试同样先写错了预期，随后确实变绿：

```sh
pnpm --filter @riftbound/game-server exec vitest run \
  --config vitest.config.ts tests/engine-runtime/v2-can-pass.test.ts --reporter=verbose
```

结果：3/3 passed。其中 `v2-can-pass.test.ts:208-209` 明确断言 waiting 视图 `canPass=true`，并断言攻方额外 Pass 为 accepted。日志在 `/tmp/RIFT-1104-pass-during-damage-wait/v2-can-pass-baseline.log`。

## 根因定位

### 1. 投影错误放行

`apps/game-server/src/engine-runtime/projection.ts:131-145` 的 `canPassForViewer`：

- `:134` 对任意 Pending Chain item 直接返回 `true`；
- `:135-140` 只在 Chain 空且战斗不活动时特殊处理 Neutral Main；
- `:144` 对活动 Combat 直接调用私有 `ChainEngine.canPass(viewer)`。

该分支没有先检查 `match.flow.combat.current.step === "damage"` 和 `expectedPlayerId`，也没有把“当前分配者”视为唯一可执行 `combat-damage` 的角色。于是 Damage Step 中攻方旧 Priority 被误当成可 Pass Priority。

`apps/desktop-client/src/full-product/v2/V2MatchBoard.tsx:452-456, 679` 忠实消费服务端 `actionOptions.canPass`；因此客户端按钮本身没有独立规则错误。`waitingForOpponentDamage` 在 `:484-486, 665` 已正确提示等待，但它没有覆盖 Pass 按钮判据，导致“等待对方分配伤害”和可点 Pass 同时出现。

### 2. 命令入口把语义 no-op 当作成功

`apps/game-server/src/engine-runtime/runtime.ts:847-858` 的 `executeValidatedCommand` 对非 Pending Chain 的 `pass` 无条件调用 `match.flow.pass(playerId)`，随后 `:963-974` 令 `stateVersion += 1` 并写 accepted 回执/journal。这里虽然抓住了错误命令，但缺少“该 pass 是否实际消耗了可用 Priority/Focus 并产生合法转移”的后置标准，违反了同文件 `packages/engine-core/src/game/commands/index.ts:81-85` 的既有约定：blocked/errors 不得变为 accepted/no-op receipt。

`packages/engine-core/src/turn/flow.ts:307-312`：

- 只有 Chain 空且 Combat 不活动时才把 Pass 解释为 `endTurn`；
- Combat 活动时直接执行 `ChainEngine.pass(playerId)`，再 `advance()`；
- `CombatFlow.advance()` 位于 `packages/engine-core/src/combat/flow.ts:594-610, 694-702`，对伤害步骤不会消费通用 Pass；
- `ChainEngine.pass()` 位于 `packages/engine-core/src/chain/engine.ts:2096-2115`，无 entries、无 showdown 时仅执行 `record({ step: 'phase-complete', player })` 并清空 holder，没有真实规则转移。

`ChainEngine.canPass` 只验 `busy/cleanup/outstanding/pending item/priorityHolder === player`（`:2115`），不知道 Combat Damage Step 的分配责任。故修复不应通过放宽 or 另造 engine-runtime 规则判断；应让 engine-core 的 `TurnFlow.pass` 在该战斗步骤明确拒绝，或者由 Damage Step 设置一个能够使旧 Priority 失效的权威状态。后者涉及 V2/engine schema，现不擅自设计。

### 3. 投影沿用旧 Priority

`projection.ts:473, 560-563` 把 `match.flow.chain.priority` 与 `focus` 直接暴露为 `priority`，并在 `:552` 只把 `events.length` 暴露成 `eventSeq`。`projection.ts:551-552` 的 stateVersion 来自 engine-runtime，而非事件进展；所以 `stateVersion` 递增不能证明战斗有进展。

### 4. room 层是可信转发，不是原发点

`apps/game-server/src/room.ts:1913-1925` 调用 engine runtime submit，并把 `accepted|duplicate|pending` 映射为公开 accepted，再广播投影。room 没有重算 `canPass`，也没有制造规则状态。它可以增加“accepted 但 state digest/eventSeq 无进展就视为内部错误”的防御，但仅把 room 做后置过滤会掩盖 engine-runtime 已写 journal/version 的语义错误，不能作为首选修复。

### 5. 现有 V3 路径显示了正确边界

同一仓库的 `apps/game-server/src/duel/authoritative-runtime-p4.ts:1029-1037` 在 engagement damage/focus 窗口将公开 actions 缩成当前 expected actor 的唯一 `assign-combat-damage` 或 `pass-focus`，其他视角为空；`:1156-1157` 也阻止不相关命令。`apps/game-server/src/duel/engagement-executor-v2.ts` 的 cursor 以 `expectedActorPlayerId` 表示责任。可作为 V2 修复的行为参照，但两套运行时不得互相嫁接状态或 callback。

## 建议修复

### 最小、可验证的 V2 修复

1. **engine-core owner**：在 `TurnFlow.pass` 进入 `ChainEngine.pass` 前，检查 `combat.current`。当 `step === "damage"` 且存在 `attacker/defender` 时抛显式 `TurnCombatBlockedError`，例如 `combat-damage-choice` / `Combat Damage Step requires the expected player's allocation`。不可用“no-op success”，也不可让 Pass 自动代提交分配。合法 Showdown Focus Pass 必须在 `step === "showdown"` 时保持原行为。
2. **engine-runtime owner**：在 `runtime.ts` 的 Pass 分支执行前调用同一 engine-core 校验；若暂不能修改 TurnFlow，则至少证明该 pass 确实改变了 Chain/Combat 的 authoritative state，否则拒绝并且在 `atomicCommand` 回滚后不递增 stateVersion、不 append accepted journal。不要复制一张 `expectedPlayerId` 规则表到 room。
3. **projection owner**：`canPassForViewer` 应在活动 Combat 的 Damage Step 返回 `false`，其中也包括当前 expected player。当前玩家合法动作只是 `combat-damage`，而非 Pass。活动 Showdown 的 `chain.canPass(viewer)` 路径可保留，以服务 CR 347.2；Pending Finalize 的既有返回 true 只用于真实 Chain continuation，不要与 Damage 混为一谈。
4. **可选后置不变量**：engine-runtime 对成功命令要求 `stateVersion` 外还必须满足“eventSeq 增长、pending choice 迁移、或文档化且可由引擎证明的无事件状态转移”。当前 `eventSeq` 在 accepted 后与 `receipt.eventSeq` 有既有语义；不要把每次版本增长自动等价为状态进展。此不变量属父级 owner，需确认现有 journal/void 转移后再做。

### 必需回归

修改 engine-core 时需要真实 `TurnFlow` / Combat fixture，不只 mock：

- Damage Step 初态（attacker 未提交）和攻方提交后（`expectedPlayerId=defender`）分别断言 attacker/defender 的 `canPass=false`。
- 两状态分别发送 Pass，断言 `rejected`、`stateVersion`/`eventSeq`/Combat/frame/Priority 均不变、journal 不新增 accepted entry；连发两次也必须拒绝。
- 当前 expected player 的合法 `combat-damage` 仍 accepted；错误 actor 仍拒绝且不推进。
- Showdown Focus 的 Pass、双方 Focus Pass、Neutral Main 的空链 `endTurn`、真实 Pending Chain 的 Pass 与 Resolve 均不得回归。
- 若新增 pending damage choice，必须由 Combat 产生真实的 stable choice、owner 和 answer 路径，不得用测试 callback、手工 `frame` 或假事件。

`apps/game-server/tests/engine-runtime/v2-can-pass.test.ts` 应把 `:195-196`, `:208-209` 改为 `canPass=false` 且两次 Pass rejected、projection 不变；同时保留 opening pass、Showdown pass 和真实 client signal 测试。`V2MatchBoard.can-pass.test.tsx` 仍覆盖服务器字段驱动按钮；修复后等待态自然禁用，不应允许客户端自行推断。

### 对百局 headless 的影响

当前 `packages/integration-tests/src/v2-duel/bot.ts:167-203` 在 `combat.status=active` 且 `step=damage` 时有独立 allocation 生成分支；若 expected actor 不匹配，`botCommand` 返回 null 而不是 Pass。其非 damage Combat Showdown 才在 `:202-203` 产生 Pass。因此修复不会改变正常 bot 已进入的两侧合法 `combat-damage` 命令，但会让任何残留“伤害窗口 Pass”从 accepted/no-progress 变成 rejected/fail-closed。

`loadBotCommand` 在 `apps/game-server/scripts/load-test.ts:1068-1073` 先尝试 generated allocation，然后回退 `botCommand`；真实 Load 报告中的 `RIFT-1092` 早期 blocked 样本是在 `main/turn-1/state-4`，其最后命令是攻方 Pass、守方 Pass，并非本报告的 `combat.damage.expectedPlayerId` 等待态（见同仓报告的 seed `RIFT-1082-1`）。因此本修复不是那枚 turn-1 headless 覆盖缺口的完整解释，不能承诺百局自然胜场数提升。

预期影响面：合法 100 局轨迹不应改变；若已有 bot/测试曾把抢占伤害步骤的 Pass 当成合法推进，会从“状态版本涨、无规则进展”变为明确的 rejected/blocked，这是期望的 fail-closed 差异。旧 replay/profile/schema 不应重写：旧日志中的 accepted Pass 必须按原规则版本严格重放；新规则拒绝只作用于新的运行命令，不修改历史日志。

## 风险与未决

- 官方 CR 清楚规定“伤害由双方按序分配，并在全部分配后同时造成”，但没有单独命名 Damage Step 的 Priority/choice。将责任映射到现有通用 `priority` 字段可能是误导，产品应保持 `canPass=false` 并在 UI 以 `combat.damage.expectedPlayerId` 展示当前分配者；专用 `damage-assignment` choice/状态是否存在属于 **judge-required**/protocol owner 决策。
- 若只改 projection，绕过 UI 直接发送的 Pass 仍可被接受并写入新 version；若只改 runtime，客户端仍显示可点；若只改客户端，服务端仍接受滥用。必须同时修 engine-core 的合法性与 projection 的可操作提示，并保留 room/engine-runtime 回执原子性。
- 现有测试把 bug 当预期，不能作为修复后的回归基线。修复任务必须改写该断言并增加真实两阶段测试。
- 本任务是只读调查，**未修改代码、契约、卡牌状态或历史回放**。建议由父级分配给 engine-core 与 game-server 的既有唯一 owner；不新增近似规则或 judge-required 的卡牌语义。

## 验证与证据

| 命令 | 结果 | 证据 |
| --- | --- | --- |
| `pnpm --filter @riftbound/game-server exec vitest run --config vitest.config.ts tests/engine-runtime/__rift1104-before.test.ts --reporter=verbose` | 1 passed；同一 head 上攻方 `canPass=true`，两次 Pass accepted/no-progress | `/tmp/RIFT-1104-pass-during-damage-wait/repro-before.log`（SHA-256 `8d2bc9c8…e268930`） |
| `pnpm --filter @riftbound/game-server exec vitest run --config vitest.config.ts tests/engine-runtime/v2-can-pass.test.ts --reporter=verbose` | 3 passed；等待态 bug 被现有断言固化 | `/tmp/RIFT-1104-pass-during-damage-wait/v2-can-pass-baseline.log`（SHA-256 `f1d3f6bd…5d321`） |
| `git diff --check` | exit 0 | 报告变更 |
| `heavy pnpm --filter @riftbound/desktop-client test` | 84 files / 982 tests passed，0 fail | `/tmp/RIFT-1104-pass-during-damage-wait/desktop-client-test.log`（SHA-256 `3d27b8dc…6e0efe`） |
| `pnpm --filter @riftbound/desktop-client typecheck` | exit 0（`tsc --noEmit`） | `/tmp/RIFT-1104-pass-during-damage-wait/desktop-client-typecheck.log`（SHA-256 `83662072…6cc92`） |

证据目录仅包含临时测试、配置和日志，位于 `/tmp/RIFT-1104-pass-during-damage-wait/`；没有把脚本、截图、构建产物或日志提交到仓库。最终 HEAD、测试终态和任何未完成项由调度者从任务分支确认。
