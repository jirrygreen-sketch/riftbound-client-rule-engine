# Runtime Profiles：开发者运行配置说明（P4 / schema / 物理链）

记录日期：2026-10-15。本文记录已核对的源码行为。
每条断言都指向当前 checkout 源码行；历史快照见 [resume-20261014.md](resume-20261014.md)、
[rules-coverage.md](rules-coverage.md)、[progress.md](progress.md)。

> 本文取证在独立的远程源码快照中进行，该快照无 `.git`；它不能证明干净 Git 检出。主开发托管工作树和 macOS 原生验收另有记录。
> 本文执行环境为 Linux，未做 Windows NSIS 或 Windows 运行验收。
> 规则版本：现役 Core Rules 为 **v1.4**（2026-07-16）；v1.5 / Radiance 于 **2026-10-16** 生效，
> 生效前不得混入当前规则或来源。本文不读取任何旧 raw room 日志，也不联网查规则。

## 1. 默认值一览（当前源）

| 入口 | 默认房间 profile | 默认 runtime profile | 落盘 journal schema | 源码行 |
| --- | --- | --- | --- | --- |
| CLI（`apps/game-server` 可执行入口） | `p4` | `optional-unit-choice-clock-v4` | **7** | `apps/game-server/src/index.ts:8`, `apps/game-server/src/index.ts:18` |
| SDK / replay-core 工厂（`createAuthoritativeDuelRuntimeP4`、`createDuelRecordedRuntimeP4`） | 由调用方传入 | `public-chain-v1` | **4** | `apps/game-server/src/duel/authoritative-runtime-p4.ts:373`, `apps/game-server/src/duel/command-journal-p4.ts:178` |
| 显式 opt-in P8（本任务关注） | `p4` | `optional-unit-physical-chain-v4` | **8** | `apps/game-server/src/index.ts:14`, `apps/game-server/src/index.ts:18` |

关键点：

- **CLI 默认 7**：`RIFTBOUND_DUEL_PROFILE` 缺省为 `"p4"`（`index.ts:8`），
  且未显式给 `RIFTBOUND_DUEL_RUNTIME_PROFILE` 时映射到 `DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK`
  （`index.ts:20-21`，只有 `public-chain-v1` 才是例外）。
- **SDK 默认 4**：工厂层 `options.runtimeProfile ?? DUEL_RUNTIME_PROFILE_P4_PUBLIC_CHAIN`
  （`authoritative-runtime-p4.ts:373`），recorded 层 `options.runtimeProfile ?? DUEL_REPLAY_PROFILE_P4_PUBLIC_CHAIN`
  （`command-journal-p4.ts:178`）。`public-chain-v1` 落盘为 `schemaVersion: 4`（`command-journal-p4.ts:255`）。
- **P8 是显式选择**：只有把 `RIFTBOUND_DUEL_RUNTIME_PROFILE` 显式设成 `optional-unit-physical-chain-v4`
  才进入物理链（`index.ts:11-15`），并映射到 `DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN`
  （`index.ts:18-19`）。CLI 与 SDK 默认都**未改**为 8。

## 2. CLI 运行配置

入口 `apps/game-server/src/index.ts` 读取以下环境变量（均在本机内存/managed 进程内，无脱管后台）：

| 变量 | 默认 | 取值 | 源码行 |
| --- | --- | --- | --- |
| `PORT` | `8787` | 端口 | `apps/game-server/src/index.ts:5` |
| `HOST` | `127.0.0.1` | 绑定主机 | `apps/game-server/src/index.ts:6` |
| `RIFTBOUND_STORAGE_DIRECTORY` | 未设 → 内存房 | 设值 → `FileRoomStore` | `apps/game-server/src/index.ts:7` |
| `RIFTBOUND_DUEL_PROFILE` | `p4` | `v1` \| `p4` | `apps/game-server/src/index.ts:8-9` |
| `RIFTBOUND_DUEL_RUNTIME_PROFILE` | 未设 → `optional-unit-choice-clock-v4` | `public-chain-v1` \| `optional-unit-choice-clock-v4` \| `optional-unit-physical-chain-v4` | `apps/game-server/src/index.ts:11-15` |

约束（源码强制）：

- `RIFTBOUND_DUEL_RUNTIME_PROFILE` 只允许上面三个值（`index.ts:12-15`）。
- 非 `p4` 房间传该变量会抛 `TypeError`（`index.ts:16-17`）。
- room 层把可选 runtime profile 收窄为三种：`optional-unit-payment-v3` / `optional-unit-choice-clock-v4` / `optional-unit-physical-chain-v4`
  （`apps/game-server/src/room.ts:71`, `room.ts:170`），并透传到 `createDuelRecordedRuntimeP4`（`room.ts:200`, `room.ts:532`）。
- server 层仅当 `rulesetId === DUEL_RULESET_ID` 才把 `duelRuntimeProfile` 交给房间（`apps/game-server/src/server.ts:90-91`, `server.ts:600`）。

### 可执行查询命令（远程静态核对）

```bash
# 0) 环境
/usr/local/bin/node -v                 # v22.22.2
pnpm -v                                # 11.9.0（见第 4 节 shim）

# 1) CLI 默认：p4 + optional-unit-choice-clock-v4（schema 7）
sed -n '8p;11p;18,21p' apps/game-server/src/index.ts

# 2) SDK 工厂默认：public-chain-v1（schema 4）
sed -n '373p' apps/game-server/src/duel/authoritative-runtime-p4.ts
sed -n '176,178p' apps/game-server/src/duel/command-journal-p4.ts

# 3) schema 落盘分支表（3→spell, 4→public-chain, 5→regional, 6→optional-unit, 7→clock, 8→physical-chain）
sed -n '237p;242p;247p;251p;255p;259p;262p' apps/game-server/src/duel/command-journal-p4.ts

# 4) profile 常量字面量
sed -n '142,148p' apps/game-server/src/duel/authoritative-runtime-p4.ts
```

远程任务的实际输出已存档：`outputs/coordination/resume-20261013/artifacts/runtime-profile8-user-developer-map/static-default-check.txt`（生成命令见文件首行 ex 命令；exit `0`）。

## 3. 旧 schema 1–7 的执行语义（不得升级）

`DuelCommandArchiveP4.schemaVersion` 联合类型为 `1 | 2 | 3 | 4 | 5 | 6 | 7 | 8`
（`apps/game-server/src/duel/command-journal-p4.ts:40`）。回放时逐 schema 固定绑定到固定 profile：

| schema | 绑定 profile | 语义 |
| --- | --- | --- |
| 1 / 2 | `legacy-unit-v1` | 旧 unit 会话 |
| 3 | `spell-v1` | 旧 spell |
| 4 | `public-chain-v1` | 公开 chain |
| 5 | `regional-public-chain-v1` | 地区公开 chain |
| 6 | `optional-unit-payment-v3` | 可选单位付款 |
| 7 | `optional-unit-choice-clock-v4` | 可选选择 + 时钟（CLI 默认） |
| 8 | `optional-unit-physical-chain-v4` | 物理单位链（本期 opt-in） |

证据：`command-journal-p4.ts:303-315`（逐 schema 断言 profile 与 semanticVersion）。
room 恢复也按 schema 逐条映射，且要求 `duelRuntimeProfile` 与 archive 一致
（`apps/game-server/src/room.ts:416-420`）；持久 CAS 恢复同理（`apps/game-server/src/duel/persistent-command-runtime-p4.ts:37-41`）。

**边界（务必遵守）**：

- 旧 schema 1–7 是**固定执行契约**，恢复时按字节选择原 profile；**不能声称默认升级**，也**不能把旧存档改写成 8**。
- `replayDuelCommandArchiveP4` 要求 schema ∈ {1..8}（`command-journal-p4.ts:299`），且 `createDuelReplayGateP4`
  缺省 `selectedProfile` 时回落到 `options.runtimeProfile ?? DUEL_REPLAY_PROFILE_P4_PUBLIC_CHAIN`
  （`command-journal-p4.ts:289`）——也就是 **legacy 字节不带 profile 时，缺省仍是 4**，不会隐式升到 8。
- 显式 replay gate 的 profile 注释明确：“legacy archives still require an explicit third argument because their
  bytes do not carry a profile and must never select a downgrade implicitly”（`command-journal-p4.ts:293`，注释见 `:289-291`）。

## 4. 远程取证任务的复现环境

本快照无 `.git`，且禁止链接他人安装；本任务用自建 shim 调用父提供的精确 pnpm：

```bash
mkdir -p outputs/coordination/resume-20261013/artifacts/runtime-profile8-user-developer-map/bin
cat > outputs/coordination/resume-20261013/artifacts/runtime-profile8-user-developer-map/bin/pnpm <<'SH'
#!/bin/sh
exec /usr/local/bin/node /home/zeron/projects/riftbound-resume-20261013-01a13560-tooling/node_modules/pnpm/bin/pnpm.mjs "$@"
SH
chmod +x outputs/coordination/resume-20261013/artifacts/runtime-profile8-user-developer-map/bin/pnpm
export PATH="$PWD/outputs/coordination/resume-20261013/artifacts/runtime-profile8-user-developer-map/bin:$PATH"
pnpm install --offline --frozen-lockfile   # exit 0，Scope: all 10 workspace projects
```

实测：`node v22.22.2`、`pnpm 11.9.0`，`pnpm install --offline --frozen-lockfile` **exit 0**
（本任务自带 `node_modules`，未链接其他安装）。未使用裸 `pnpm`，也未使用 `/usr/local/bin/python3`。

## 5. 物理链路径：physicalHand → ChainClose → choices → 费用/requiredTask → payer 资源 → pay → finalize

仅当 runtime profile = `optional-unit-physical-chain-v4`（schema 8）时启用。判定为
`physicalUnitEnabled`（`apps/game-server/src/duel/authoritative-runtime-p4.ts:376`），
物理 session 状态变量见 `authoritative-runtime-p4.ts:397-400`。

按源码执行顺序：

1. **physicalHand（源头仍在 Hand）**：`play-card` 且是纯 accelerate 单位时进入物理链分支
   （`authoritative-runtime-p4.ts:1242`），调用
   `beginDuelPrintedUnitPhysicalChainV4(createDuelPrintedUnitChainSessionV4(...), ...)`
   （`authoritative-runtime-p4.ts:1248-1252`）。Core 端 `beginDuelPrintedUnitPhysicalChainV4`
   见 `packages/engine-core/src/duel/cardplay-unit-chain-v4.ts:541`。
2. **ChainClose**：begin 内先 `moveDuelPhysicalCardToChainV2` 移入 Chain，再用
   `commitDuelCommandFrameV2(..., { stateOpen: false }, ...)` 关闭 State
   （`cardplay-unit-chain-v4.ts:583`, `cardplay-unit-chain-v4.ts:585`）。Core 原语：
   `packages/engine-core/src/duel/core-v2.ts:1151`（move）。
3. **choices**：begin 成功后 `value.phase = 'choice'` 并签发 prompt
   （`cardplay-unit-chain-v4.ts:607-608`）。server 侧把 prompt 放进 `physicalChoice`
   （`authoritative-runtime-p4.ts:1254-1255`），投影经 `projectOptionalUnitChoiceP6`
   （`authoritative-runtime-p4.ts:929`）。玩家回答走 `answer-pending-choice`
   （`authoritative-runtime-p4.ts:1092-1102`）→ `answerDuelPrintedUnitPhysicalChainV4`
   （`cardplay-unit-chain-v4.ts:628`）。
4. **全费用 / requiredTask**：answer 内解析全费用 `resolveDuelTotalCostV2`
   （`cardplay-unit-chain-v4.ts:689`），生成本次 task
   （`cardplay-unit-chain-v4.ts:706-711`），签发
   `issueDuelPrintedUnitRequiredCostTaskV4` 并
   `prepareDuelPrintedUnitRequiredCostPaymentV4`
   （`cardplay-unit-chain-v4.ts:712-714`），`phase` 转 `'payment'`（`cardplay-unit-chain-v4.ts:717`）。
   cost/source 证明由 `apps/game-server/src/duel/printed-unit-chain-services-p8.ts`
   提供：`costForChain`（`:538`）与 `sourceAttestorV4`（`:496`，要求当前 Chain epoch、
   Native commit/session 血缘、Core task 一致）。
5. **payer 资源**：`rune-energy` / `rune-power` / `pay-pending` 且 `physicalUnit` 存在时，先按投影动作鉴权
   （`authoritative-runtime-p4.ts:1153-1156`），再 `applyDuelPrintedUnitPhysicalChainResourceV4`
   （`authoritative-runtime-p4.ts:1157`；Core 见 `cardplay-unit-chain-v4.ts:725`）。
   不足额是**非持久 Core 拒绝**，不消耗 V4 wrapper，可同证明重试
   （`cardplay-unit-chain-v4.ts:737-739`）。
6. **pay**：资源命令为 `pay-pending` 且成功时 `phase` 转 `'paid'`
   （`cardplay-unit-chain-v4.ts:752-753`）。server 在 `'paid'` 后立即
   `resumeDuelPrintedUnitPhysicalChainV4` 收尾（`authoritative-runtime-p4.ts:1161-1168`）。
7. **Unit finalize**：`resumeDuelPrintedUnitPhysicalChainV4` 内
   `finalizeDuelPhysicalUnitFromChainV2`（`cardplay-unit-chain-v4.ts:793`；
   Core 原语 `packages/engine-core/src/duel/core-v2.ts:1179`），随后
   `advanceDuelCommandSessionNativeV2`。server 侧 `syncPhysical` 在 `'applied'` 时把
   物理 session 交回 unit owner 并清空 `physicalUnit`/`physicalChoice`
   （`authoritative-runtime-p4.ts:682-690`）。
8. **pending 恢复**：`resumePending` 在 `phase === 'paid'` 时走真实 fork + resume
   （`authoritative-runtime-p4.ts:1385-1396`）。

### 当前支持 / 未接路径（不得夸大）

- **支持**：上述纯 accelerate 打印单位的完整 physical-chain（choice → 定费 → payer 付费 → ready/exhaust 入场），
  严格回放经 FileRoomStore/P8 测试验证（见第 6 节）。
- **未接 / 隔离**：
  - **Gear Core**：`packages/engine-core/src/duel/cardplay-gear-v1.ts` 已有 physical Gear chain
    （`createDuelPrintedGearChainSessionV1:387`、`beginDuelPrintedGearPhysicalChainV1:403`、
    `resumeDuelPrintedGearPhysicalChainV1:504`）与 `finalizeDuelPhysicalGearFromChainV1`
    （`core-v2.ts:1281`），但 **`apps/game-server/src/duel/authoritative-runtime-p4.ts` 内没有任何 Gear 接线**
    （该文件对 `Gear` 命中数为 0）。Gear 链只是对应层，**不是已接线可执行路径**。
  - **source107 / Beginning86 / combined110**：为 DSL 与 Server 的**来源绑定**层
    （见 [resume-20261014.md](resume-20261014.md) “DSL source-only 新 Equip24/Beginning3 … 新 source 工厂 107/86/110，runtime 仍 pending”），
    runtime pending，**不等于可执行**。
  - **Point 生产 / TokenHold 候选**：仍**未验收**
    （见 [resume-20261014.md](resume-20261014.md) “Point 源/Core 仍隔离”“Point 81 候选待审，未公开执行”），
    **不得当作已可执行**。
- **IR counts ≠ 可执行**：持久化效果覆盖保持 `executable 0 / judge-required 1348 / no-ability 33`
  （`packages/card-data/data/effect-coverage.json`，1381 printings），见 [rules-coverage.md](rules-coverage.md)。
  “默认全 IR 识别 65 / 显式 77”是不同维度，**不能**据此说 77 项全部可执行，也不等于官方效果完整。
- 未接/未知路径一律保持在 `blocked`：如非 accelerate 单位在 P8 下返回
  `blocked(parsed, "此单位或法术来源尚未完成物理链规则证明")`（`authoritative-runtime-p4.ts:1261`）。

## 6. 本轮真实验证（可复跑）

命令与退出码：

```bash
export PATH="$PWD/outputs/coordination/resume-20261013/artifacts/runtime-profile8-user-developer-map/bin:$PATH"
pnpm --filter @riftbound/game-server exec vitest run \
  tests/duel/optional-unit-physical-chain-recovery-p8.test.ts \
  tests/duel/optional-unit-physical-chain-p8.test.ts \
  tests/duel/printed-unit-chain-services-p8.test.ts
```

结果：`Test Files 3 passed (3)`，`Tests 10 passed (10)`，**exit 0**（远程任务实测，主控另有实际原生与严格恢复证据）。
该恢复用例走真实 `FileRoomStore` + `GameRoom` + `DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN`
（`apps/game-server/tests/duel/optional-unit-physical-chain-recovery-p8.test.ts:1-12`），
覆盖“恢复原始 Chain choice 与 required payment，并完成一次真实入场”。

## 7. 边界声明（本轮非 Windows / 非干净 Git）

- 本文取证快照**无 `.git`**：“快照/哈希一致”仅指该快照文件内容，不代表 Git 干净或远程 CI。
- 本轮为 **Linux（non-Windows）**：未构建 Windows NSIS，未做 Windows 实际运行验收。
- 本轮未 commit / push / deploy；未改依赖与 lockfile；未改原 checkout。
- 本文成功回合仅是**待父验收**结果，不等于整体 profile8 或全工作区 2878 通过；
  上级父任务记录的 642 源快照全工作区 type/build/test0、2874/0skip，以及后续本地卡垫客户端 769/0skip、
  两 Mac 包构建与真实 GUI，均为父侧证据，**不得**在此冒充为本文验证。

## 8. 相关文档（相对链接）

- [rules-coverage.md](rules-coverage.md) — 当前可跑有限路径与效果覆盖边界
- [progress.md](progress.md) — 当前进度与剩余门
- [delivery-goal.md](delivery-goal.md) — 交付目标与 CLI7/SDK4 边界
- [strict-runtime-contracts.md](strict-runtime-contracts.md) — 严格 runtime 契约与 `durability: "in-memory"` 说明
- [public-chain-contract.md](public-chain-contract.md) — 公开 chain 契约
- [p4-spell-owner.md](p4-spell-owner.md) / [p4-noop-resume.md](p4-noop-resume.md) — P4 spell/noop 边界
- [persistence.md](persistence.md) — 持久化与 `RIFTBOUND_STORAGE_DIRECTORY`
- [vertical-slice.md](vertical-slice.md) — 垂直切片
- [resume-20261014.md](resume-20261014.md) — 接续记录（历史快照，按日期解读）
