# RIFT-990: Rumble SFD vs Fiora SFD 百局无头统计（2026-10-23）

## 结论

本轮固定 100 个 seed，Rumble/Fiora 各 50 局先手。全部对局均进入既有的
`runHeadlessGame` 生产路径；结果是 **0 自然胜负、0 setup blocker**。81 局
产生 journal 并执行独立严格重放，其中 78 局以 headless `no-progress` guard
结束，3 局 journal 重放不一致；另外 19 局达到每局 15 分钟墙钟上限，没有完成
journal。完成的 81 局没有记录命令超限、回合超限、显式异常、认输、已观测的
`judge-required` 或未处理 `AwaitChoice`。

这组结果不能证明 M1 已可玩或已验收。它表明 setup 已不再是首个阻断，同时暴露
了重复出现的中局 `advance`/combat-control 停滞、慢局，以及不返回的局。

## 范围与方法

- 任务分支：`task/RIFT-990-m1-hundred-game-stats`。执行时 HEAD 为
  `55b5ed97cc2747cb8622a82d418de90b77060436`，与当时本地 `integration`
  指向同一提交。
- 对局：`rumble-sfd` vs `fiora-sfd`；seed 为
  `RIFT-990-m1-seed-001` 至 `RIFT-990-m1-seed-100`。
- 先手：001-050 由 Rumble 坐 A；051-100 由 Fiora 坐 A。
- 引擎路径：只调用 `packages/integration-tests/src/headless/duel.ts` 已有的
  `runHeadlessGame`。统计工具不注入 match 状态、不手工结算卡牌，也不绕开
  `createMatch`、`TurnFlow`、`ChainEngine` 或 `attachLifecycle`。
- 每局限制：15 分钟墙钟、40 回合、10,000 条 Bot Starter command。每局在独立
  worker 中执行，4 个 worker 并发。
- journal：每局返回后再次调用 `replayHeadlessJournal(journal)`，并把该结果与
  driver 内建重放结果合并。
- 原始命令：

```sh
cd /root/swarm-rift/wt/RIFT-990-m1-hundred-game-stats
RIFT_990_EVIDENCE_DIR=/tmp/RIFT-990-m1-hundred-game-stats/hundred-20261023 \
  heavy node --experimental-strip-types packages/integration-tests/scripts/m1-hundred-games.mjs \
  --games=100 --max-turns=40 --max-actions=10000 --wall-ms=900000 --concurrency=4
```

证据目录为 `/tmp/RIFT-990-m1-hundred-game-stats/hundred-20261023/`，包含
`run.log`、`progress.log`、`journals/`、原始 `m1-stats-summary.json`，以及从
同一批 journal 生成的 `final-summary.json`、`final-summary.md`。

百局原始运行使用了统计工具的早期分类修订。其原 JSON 把 78 个
`guard/no-progress` 误标为 `exception`。本报告和 `final-summary.json` 从这些
不可变 journal 重新生成，最终分类把二者记为 `no-progress`；真正重放不一致的
3 局仍记为 `replay-mismatch`。

## 汇总

| 指标 | 结果 |
|---|---:|
| 对局数 | 100 |
| Rumble 在 A / Fiora 在 A | 50 / 50 |
| 自然胜负 | 0 |
| Setup blocked | 0 |
| 显式异常 | 0 |
| 完成 journal | 81 |
| `no-progress` guard | 78 |
| 重放不一致 | 3 |
| 墙钟超时、无完成 journal | 19 |
| 命令超限 / 回合超限 | 0 / 0 |
| 总墙钟耗时 | 3h 4m 3.383s |
| 每局耗时 p50 / p95 / max | 333.603s / 900.100s / 900.134s |
| 81 个完成局合计回合 / 命令 / 事件 | 334 / 2226 / 33923 |
| 81 个完成局平均回合 / 命令 | 4.12 / 27.48 |
| 已观测 `judge-required` / 未处理 `AwaitChoice` | 0 / 0 |

当前 journal **没有每命令耗时样本**，因此无法从这轮数据得出每命令
p50/p95/max。工具将证据标为 `commandTimingSource: unavailable`，不会把整局
耗时均摊后冒充每命令数据。精确的契约请求见文末。

## 结局分类

| 类别 | 数量 | 证据 |
|---|---:|---|
| 自然胜负 | 0 | 没有对局满足引擎的自然胜负条件。 |
| Blocked | 0 | 没有 setup blocker 残留到游戏循环。 |
| 命令数超限 | 0 | 没有 `guardReason=action-limit`。 |
| 回合数超限 | 0 | 没有 `guardReason=turn-limit`。 |
| `no-progress` | 78 | `guardReason=no-progress`，有完成 journal 且严格重放通过。 |
| 重放不一致 | 3 | `replayHeadlessJournal=false`；seed 046、058、060。 |
| 墙钟超时 | 19 | 每局约 900s 后终止 worker，没有完成 journal。 |

19 个超时局没有完成 journal，因此上述 `judge-required`、AwaitChoice 与异常
观测不适用于这些局。超时 result 中保留的是工具合成的 `TimeoutError` 栈；没有
可报告的引擎来源异常栈。

超时 seed：`RIFT-990-m1-seed-025`、037、038、059、066、068、070、073、074、
076、086、090、091、092、093、094、095、098、099。其中 Fiora 在 A 的 50 局
出现 16 次，Rumble 在 A 的 50 局出现 3 次；这个差异是后续调查线索，不构成因果
结论。

## 战斗与得分证据

81 个完成 journal 中累计观测到：

| 事件 | 数量 |
|---|---:|
| showdown | 113 |
| combat | 7 |
| attack | 7 |
| defense | 13 |
| conquer | 107 |
| score | 117 |
| points | 117 |

81 局全部在最后一条 `advance` 后停在
`final.combat.step=control`、`controlEstablished=true`、
`controlGateReleased=false`。其中 72 局最近一次被拒的 play 为
`cannot-pay-cost`，6 局为 `no-legal-targets`，3 个重放不一致局没有最后 play
拒绝。它们已经产生得分，所以不是“第一步行动之前失败”的旧 setup 场景。

## 代表性复现

### `RIFT-990-m1-seed-001`

- 座位：A=`rumble-sfd`，B=`fiora-sfd`。
- 结果：`no-progress`；3 回合、18 条命令、145.288s；严格重放通过。
- Journal：`/tmp/RIFT-990-m1-hundred-game-stats/hundred-20261023/journals/001-RIFT-990-m1-seed-001.journal.json`。
- 最后五条命令：

```text
play A token-49 (Long Sword) failure=cannot-pay-cost
pass A
play B token-89 (Show of Strength) failure=cannot-pay-cost
pass B
advance
```

### `RIFT-990-m1-seed-046`

- 座位：A=`rumble-sfd`，B=`fiora-sfd`。
- 结果：`replay-mismatch`；6 回合、47 条命令、305.289s。
- Journal：`/tmp/RIFT-990-m1-hundred-game-stats/hundred-20261023/journals/046-RIFT-990-m1-seed-046.journal.json`。
- 最后五条命令：

```text
pass B
play A token-36 failure=cannot-pay-cost
play A token-46 failure=cannot-pay-cost
pass A
advance
```

### `RIFT-990-m1-seed-058`

- 座位：A=`fiora-sfd`，B=`rumble-sfd`。
- 结果：`replay-mismatch`；5 回合、43 条命令、292.697s。
- Journal：`/tmp/RIFT-990-m1-hundred-game-stats/hundred-20261023/journals/058-RIFT-990-m1-seed-058.journal.json`。
- 最后五条命令：

```text
move A token-20 to token-8
pass A
play B token-84 failure=cannot-pay-cost
pass B
advance
```

### `RIFT-990-m1-seed-060`

- 座位：A=`fiora-sfd`，B=`rumble-sfd`。
- 结果：`replay-mismatch`；7 回合、55 条命令、428.649s。
- Journal：`/tmp/RIFT-990-m1-hundred-game-stats/hundred-20261023/journals/060-RIFT-990-m1-seed-060.journal.json`。
- 最后五条命令：

```text
play A token-39 failure=cannot-pay-cost
pass A
play B token-100 (Long Sword) failure=cannot-pay-cost
pass B
advance
```

### 墙钟超时

`RIFT-990-m1-seed-025`（A=`rumble-sfd`，B=`fiora-sfd`）在 900.101s 后以
`TimeoutError` 结束。同步 `runHeadlessGame` 未返回，因此没有完成 journal，也没有
可用的最后五条命令。结果里的回合、命令、卡牌与重放字段保持 `null`；工具没有
伪造空 journal。

## 命令拒绝观测

journal 记录了 fatal guard 之前的 Bot 意图拒绝。以下是观测计数，不是引擎规则
裁决。`objectId` 是当时精确的 candidate object；`canonicalCardId` 从固定 M1
预组名单按卡名解析。

| 卡牌 | canonicalCardId | 错误码 | 信息 | 次数 | 不同 seed 数 |
|---|---|---|---|---:|---:|
| Consult the Past | `card.hash-2ebf1fe6e5ed7bb875f1c112b3e0ed1635b557c0c0ad550d752b8dd376243007` | `cannot-pay-cost` | Duel resources: insufficient Energy | 51 | 32 |
| Void Seeker | `card.hash-600e0796e82099284b213e87b112b1c5df42777ef72b70a3b4cd49a84d27dd10` | `cannot-pay-cost` | Duel resources: insufficient Energy | 51 | 33 |
| Show of Strength | `card.hash-7be9e4bed44d19de26a4a7a292ab8406e43694b33916fc5246d46347fa4ad85f` | `cannot-pay-cost` | Duel resources: insufficient Energy | 42 | 26 |
| Wages of Pain | `card.hash-431738fdce44471075e7d0f77a009dde71d56c7be7e2c9ef022d6b124a857a3c` | `cannot-pay-cost` | Duel resources: insufficient Energy | 42 | 28 |
| Frigid Touch | `card.hash-153eb4df721b70662a63652ba1602985ceed08d81a0b23fc0d6b10349ee15ca9` | `cannot-pay-cost` | Duel resources: insufficient Energy | 32 | 24 |
| Punch First | `card.hash-8d49727ab9ae782b8a21802c9ae0b51e5d712a37a072d991629bfbf3645535b3` | `cannot-pay-cost` | Duel resources: insufficient Energy | 27 | 19 |
| Stupefy | `card.hash-5b08b5b8648e8c5c057d15279d1b4e677457eb0b43fcf2810e2ec4f4c4d1b7cf` | `no-legal-targets` | The required target count is not available | 23 | 17 |
| Long Sword | `card.hash-cab923a670e4baa826aa3de381c8b992bf33987fcb0d65feb75ca538a8681010` | `cannot-pay-cost` | Duel resources: insufficient Energy | 17 | 11 |
| Riposte | `card.hash-6e1bdc294002f23d867897b239a644801a07effca16fc07c31ab55c7f41ff26d` | `no-legal-targets` | The required target count is not available | 12 | 9 |
| Stupefy | `card.hash-5b08b5b8648e8c5c057d15279d1b4e677457eb0b43fcf2810e2ec4f4c4d1b7cf` | `cannot-pay-cost` | Duel resources: insufficient Energy | 11 | 10 |
| Danger Zone | `card.hash-3c1c01b405853556e3e1c12bbd758e94d73f5ed474a5643bb068eaa7cb549c6e` | `cannot-pay-cost` | Duel resources: insufficient Energy | 10 | 8 |
| Punch First | `card.hash-8d49727ab9ae782b8a21802c9ae0b51e5d712a37a072d991629bfbf3645535b3` | `cannot-pay-cost` | Duel resources: insufficient matching Power | 7 | 5 |
| Frigid Touch | `card.hash-153eb4df721b70662a63652ba1602985ceed08d81a0b23fc0d6b10349ee15ca9` | `no-legal-targets` | The required target count is not available | 5 | 4 |
| Wages of Pain | `card.hash-431738fdce44471075e7d0f77a009dde71d56c7be7e2c9ef022d6b124a857a3c` | `no-legal-targets` | The required target count is not available | 4 | 4 |
| Show of Strength | `card.hash-7be9e4bed44d19de26a4a7a292ab8406e43694b33916fc5246d46347fa4ad85f` | `cannot-pay-cost` | Duel resources: insufficient matching Power | 2 | 2 |
| Long Sword | `card.hash-cab923a670e4baa826aa3de381c8b992bf33987fcb0d65feb75ca538a8681010` | `cannot-pay-cost` | Duel resources: insufficient matching Power | 1 | 1 |
| Danger Zone | `card.hash-3c1c01b405853556e3e1c12bbd758e94d73f5ed474a5643bb068eaa7cb549c6e` | `cannot-pay-cost` | Duel resources: insufficient matching Power | 1 | 1 |
| Void Seeker | `card.hash-600e0796e82099284b213e87b112b1c5df42777ef72b70a3b4cd49a84d27dd10` | `cannot-pay-cost` | Duel resources: insufficient matching Power | 1 | 1 |

最后的 `advance` 之前，未因非法时机被拒绝的停滞候选分布为：

| 卡牌 | canonicalCardId | 局数 | 代表 seed |
|---|---|---:|---|
| Consult the Past | `card.hash-2ebf1fe6e5ed7bb875f1c112b3e0ed1635b557c0c0ad550d752b8dd376243007` | 25 | 003, 007, 008, 009, 010, 011, 012, 014, 018, 020, 034, 035, 040, 042, 043, 048, 050, 051, 062, 069, 078, 081, 084, 089, 100 |
| Frigid Touch | `card.hash-153eb4df721b70662a63652ba1602985ceed08d81a0b23fc0d6b10349ee15ca9` | 8 | 005, 013, 028, 044, 047, 082, 083, 097 |
| Stupefy | `card.hash-5b08b5b8648e8c5c057d15279d1b4e677457eb0b43fcf2810e2ec4f4c4d1b7cf` | 6 | 017, 024, 041, 061, 063, 096 |
| Long Sword | `card.hash-cab923a670e4baa826aa3de381c8b992bf33987fcb0d65feb75ca538a8681010` | 5 | 001, 006, 022, 033, 045 |
| Show of Strength | `card.hash-7be9e4bed44d19de26a4a7a292ab8406e43694b33916fc5246d46347fa4ad85f` | 5 | 015, 032, 049, 060, 071 |
| Danger Zone | `card.hash-3c1c01b405853556e3e1c12bbd758e94d73f5ed474a5643bb068eaa7cb549c6e` | 3 | 023, 075, 088 |

## 卡牌活动

计数只来自已提交 journal event：`card-drawn`、`card-played`，以及 item id 以
`trigger:` 开头的 `chain-item-pending`。它不是所有卡牌能力完整正确的断言。

| 卡牌 | canonicalCardId | 抽到 | 打出 | 触发 | judge-required |
|---|---|---:|---:|---:|---:|
| Warmog's Armor | `card.hash-902c6a1366a1a0e653ccb65102ff621b109af3b0b40f5bbeb7d8d3a5aeae2322` | 15 | 32 | 0 | 0 |
| Forecaster | `card.hash-cdeb1c4bb2202d43d0f4ccb7c3e0ddfa25caf4f81c41dde5c8bdaa6bbeddfe40` | 27 | 31 | 31 | 0 |
| Plundering Poro | `card.hash-569dc9079a6d404c0d850d27b510585b856ab3def5e1e0bbafa30a3bf9d48e82` | 11 | 23 | 17 | 0 |
| Stupefy | `card.hash-5b08b5b8648e8c5c057d15279d1b4e677457eb0b43fcf2810e2ec4f4c4d1b7cf` | 9 | 22 | 0 | 0 |
| Veteran Poro | `card.hash-77fdefa1bb982497df81cd6fd64fdde8c460c8cfb52aa2708aa568b849ca42e7` | 8 | 21 | 21 | 0 |
| Dangerous Duo | `card.hash-d4e849d845765608b07bf4af4aa19877f6303dfff539b541d0d070320dd05d91` | 17 | 19 | 14 | 0 |
| Gem Jammer | `card.hash-f0ac9d90de705764ec57a50fb7483a35117949080af9f6a959eb42a7b887c9e9` | 16 | 18 | 18 | 0 |
| Pit Rookie | `card.hash-e2638655ff5ed3a1e60a501be3c23d74e46ef7f1900bed31b436f1a579b316ed` | 9 | 18 | 18 | 0 |
| Unsung Hero | `card.hash-afc40c373a9fb4e48492323d7af26d3a58b824c385707dd3c269e97fee236103` | 10 | 14 | 0 | 0 |
| Doran's Blade | `card.hash-a1ee07f71d453092ab7d54f9491684e972b735b22bb1f3fda73f2641bcedbfe1` | 15 | 13 | 0 | 0 |
| Lucian | `card.hash-c403c2d9835df87cc0774a86145ef937226d5e7ebcfe75282053e23df744f5ef` | 9 | 9 | 14 | 0 |
| Bubble Bot | `card.hash-34880fcae16bd9461e4c318dfb455365ff9e353db357f948b4a15dea7e01b389` | 14 | 9 | 9 | 0 |
| Frigid Touch | `card.hash-153eb4df721b70662a63652ba1602985ceed08d81a0b23fc0d6b10349ee15ca9` | 8 | 8 | 0 | 0 |
| Royal Guard | `card.hash-0ba141b975db96cac65aab56bfd7dbb63904c538cc3d9c32bdfb3b2d98e486de` | 9 | 7 | 7 | 0 |
| Fiora, Worthy | `card.hash-261f97a75639fd51dc63b8c4b2a577b52d5bd6893227a1a3a13da5375880fe6f` | 1 | 7 | 0 | 0 |
| Wages of Pain | `card.hash-431738fdce44471075e7d0f77a009dde71d56c7be7e2c9ef022d6b124a857a3c` | 12 | 3 | 0 | 0 |
| Laurent Duelist | `card.hash-7cbc2a92adfe5cf5c7126a8d72869cf933d006002fe1f46b4804c2040a51c9c6` | 5 | 3 | 0 | 0 |
| Gold | `card.hash-6249df4367d0a2e088c8eb1117ef59430f0d7dad4bf0fcf8a01d7f0415f4d511` | 0 | 3 | 0 | 0 |
| Rumble, Hotheaded | `card.hash-11c889b9d655c822e7ce3ec82c5a5f1e2d716ac6d3c2ed6fb9bb7b22c32ce870` | 9 | 2 | 2 | 0 |
| B.F. Sword | `card.hash-959c19d68f06f8f929625bfde93a1132701da5a5d0b49e91583db341384f0bfe` | 9 | 1 | 0 | 0 |
| Minefield | `card.hash-0c36f22df8ffa7bed49f59fd138d24b9b0a52a7b8ad4c720afcaa12ec816eee4` | 0 | 0 | 69 | 0 |
| Production Surge | `card.hash-1504d8f14af5ce1b9f7a3663c23e6ef7cb57d59a6274dc921cd9296ee8e2494b` | 13 | 0 | 0 | 0 |
| Void Seeker | `card.hash-600e0796e82099284b213e87b112b1c5df42777ef72b70a3b4cd49a84d27dd10` | 13 | 0 | 0 | 0 |
| Strike Down | `card.hash-f7e9f4f53ed55ffc9e6b1d38d72324ad29bb9ebf5f25c356bcd7f723aa08b177` | 13 | 0 | 0 | 0 |
| Breakneck Mech | `card.hash-cb2ea7576d42c76d8ecf8fa3cdb082f007639b144aecc69402230df6bcc131ab` | 12 | 0 | 0 | 0 |
| Vengeance | `card.hash-f67321dac096b3ad1e49b55231663e26f3f9d96efafe79d75719a6eb72fc5caa` | 11 | 0 | 0 | 0 |
| Consult the Past | `card.hash-2ebf1fe6e5ed7bb875f1c112b3e0ed1635b557c0c0ad550d752b8dd376243007` | 9 | 0 | 0 | 0 |
| Danger Zone | `card.hash-3c1c01b405853556e3e1c12bbd758e94d73f5ed474a5643bb068eaa7cb549c6e` | 7 | 0 | 0 | 0 |
| Punch First | `card.hash-8d49727ab9ae782b8a21802c9ae0b51e5d712a37a072d991629bfbf3645535b3` | 7 | 0 | 0 | 0 |
| Dauntless Vanguard | `card.hash-cf0b322a78010676e3d8b287830194a3bdc8970e65a141578ae8a3074ebd956f` | 7 | 0 | 0 | 0 |
| Rumble, Scrapper | `card.hash-01bd7d3ff52eabd0afc59248a33845b648d9f61db8b544052f51057f967ceb7c` | 6 | 0 | 0 | 0 |
| Ferrous Forerunner | `card.hash-057dababf241fe29f90a9a6c306d4463227bed0d80f3df33c8261f7f43f5fed3` | 6 | 0 | 0 | 0 |
| Show of Strength | `card.hash-7be9e4bed44d19de26a4a7a292ab8406e43694b33916fc5246d46347fa4ad85f` | 6 | 0 | 0 | 0 |
| Long Sword | `card.hash-cab923a670e4baa826aa3de381c8b992bf33987fcb0d65feb75ca538a8681010` | 5 | 0 | 0 | 0 |
| Sacred Shears | `card.hash-d3579e6825470471f5ce05c53533806a5244c5e84364fe57b2aab0b7cc0f14e0` | 5 | 0 | 0 | 0 |
| Jaull-Fish | `card.hash-db90e8eaf24230cfbc3b68d99971c58f465f65465b5c52be37ae1564d6e86732` | 5 | 0 | 0 | 0 |
| Singularity | `card.hash-10b7d5be25093a4d318efd8639b6e34583bad10bf38adbf93b4c3733ea54221b` | 4 | 0 | 0 | 0 |
| Yone | `card.hash-292f685c7578235f29f2c362a52c7975eafab592cc437e2445ca68309b294c56` | 4 | 0 | 0 | 0 |
| Fiora, Peerless | `card.hash-6bde2e2c542ff8fc1a7a2f9204df7e6c58a05a53ad98c0a31d69927be053b77f` | 4 | 0 | 0 | 0 |
| Riposte | `card.hash-6e1bdc294002f23d867897b239a644801a07effca16fc07c31ab55c7f41ff26d` | 3 | 0 | 0 | 0 |
| Assembly Rig | `card.hash-d490b51d08bdd7f97b1708aabfa6309995106f10de815b6fd927368e4a630569` | 3 | 0 | 0 | 0 |

## 逐局结果

| # | seed | A | 结局 | 回合 | 命令 | 耗时 | 重放 | journal |
|---:|---|---|---|---:|---:|---:|---|---|
| 1 | `RIFT-990-m1-seed-001` | rumble-sfd | no-progress | 3 | 18 | 145.288s | true | `001-RIFT-990-m1-seed-001.journal.json` |
| 2 | `RIFT-990-m1-seed-002` | rumble-sfd | no-progress | 4 | 22 | 136.771s | true | `002-RIFT-990-m1-seed-002.journal.json` |
| 3 | `RIFT-990-m1-seed-003` | rumble-sfd | no-progress | 3 | 21 | 171.187s | true | `003-RIFT-990-m1-seed-003.journal.json` |
| 4 | `RIFT-990-m1-seed-004` | rumble-sfd | no-progress | 8 | 90 | 854.494s | true | `004-RIFT-990-m1-seed-004.journal.json` |
| 5 | `RIFT-990-m1-seed-005` | rumble-sfd | no-progress | 3 | 17 | 84.433s | true | `005-RIFT-990-m1-seed-005.journal.json` |
| 6 | `RIFT-990-m1-seed-006` | rumble-sfd | no-progress | 5 | 31 | 186.579s | true | `006-RIFT-990-m1-seed-006.journal.json` |
| 7 | `RIFT-990-m1-seed-007` | rumble-sfd | no-progress | 3 | 14 | 62.382s | true | `007-RIFT-990-m1-seed-007.journal.json` |
| 8 | `RIFT-990-m1-seed-008` | rumble-sfd | no-progress | 3 | 18 | 124.249s | true | `008-RIFT-990-m1-seed-008.journal.json` |
| 9 | `RIFT-990-m1-seed-009` | rumble-sfd | no-progress | 5 | 36 | 273.642s | true | `009-RIFT-990-m1-seed-009.journal.json` |
| 10 | `RIFT-990-m1-seed-010` | rumble-sfd | no-progress | 3 | 19 | 88.489s | true | `010-RIFT-990-m1-seed-010.journal.json` |
| 11 | `RIFT-990-m1-seed-011` | rumble-sfd | no-progress | 3 | 16 | 127.421s | true | `011-RIFT-990-m1-seed-011.journal.json` |
| 12 | `RIFT-990-m1-seed-012` | rumble-sfd | no-progress | 7 | 65 | 625.170s | true | `012-RIFT-990-m1-seed-012.journal.json` |
| 13 | `RIFT-990-m1-seed-013` | rumble-sfd | no-progress | 3 | 20 | 186.640s | true | `013-RIFT-990-m1-seed-013.journal.json` |
| 14 | `RIFT-990-m1-seed-014` | rumble-sfd | no-progress | 3 | 18 | 92.884s | true | `014-RIFT-990-m1-seed-014.journal.json` |
| 15 | `RIFT-990-m1-seed-015` | rumble-sfd | no-progress | 6 | 47 | 463.799s | true | `015-RIFT-990-m1-seed-015.journal.json` |
| 16 | `RIFT-990-m1-seed-016` | rumble-sfd | no-progress | 4 | 31 | 211.560s | true | `016-RIFT-990-m1-seed-016.journal.json` |
| 17 | `RIFT-990-m1-seed-017` | rumble-sfd | no-progress | 3 | 17 | 142.620s | true | `017-RIFT-990-m1-seed-017.journal.json` |
| 18 | `RIFT-990-m1-seed-018` | rumble-sfd | no-progress | 3 | 16 | 77.806s | true | `018-RIFT-990-m1-seed-018.journal.json` |
| 19 | `RIFT-990-m1-seed-019` | rumble-sfd | no-progress | 3 | 15 | 139.651s | true | `019-RIFT-990-m1-seed-019.journal.json` |
| 20 | `RIFT-990-m1-seed-020` | rumble-sfd | no-progress | 5 | 21 | 174.345s | true | `020-RIFT-990-m1-seed-020.journal.json` |
| 21 | `RIFT-990-m1-seed-021` | rumble-sfd | no-progress | 3 | 22 | 109.845s | true | `021-RIFT-990-m1-seed-021.journal.json` |
| 22 | `RIFT-990-m1-seed-022` | rumble-sfd | no-progress | 3 | 24 | 194.782s | true | `022-RIFT-990-m1-seed-022.journal.json` |
| 23 | `RIFT-990-m1-seed-023` | rumble-sfd | no-progress | 7 | 40 | 599.876s | true | `023-RIFT-990-m1-seed-023.journal.json` |
| 24 | `RIFT-990-m1-seed-024` | rumble-sfd | no-progress | 3 | 12 | 86.842s | true | `024-RIFT-990-m1-seed-024.journal.json` |
| 25 | `RIFT-990-m1-seed-025` | rumble-sfd | timeout | n/a | n/a | 900.101s | not-run | none |
| 26 | `RIFT-990-m1-seed-026` | rumble-sfd | no-progress | 3 | 20 | 259.863s | true | `026-RIFT-990-m1-seed-026.journal.json` |
| 27 | `RIFT-990-m1-seed-027` | rumble-sfd | no-progress | 3 | 13 | 152.281s | true | `027-RIFT-990-m1-seed-027.journal.json` |
| 28 | `RIFT-990-m1-seed-028` | rumble-sfd | no-progress | 5 | 21 | 346.262s | true | `028-RIFT-990-m1-seed-028.journal.json` |
| 29 | `RIFT-990-m1-seed-029` | rumble-sfd | no-progress | 5 | 37 | 648.450s | true | `029-RIFT-990-m1-seed-029.journal.json` |
| 30 | `RIFT-990-m1-seed-030` | rumble-sfd | no-progress | 4 | 27 | 244.784s | true | `030-RIFT-990-m1-seed-030.journal.json` |
| 31 | `RIFT-990-m1-seed-031` | rumble-sfd | no-progress | 6 | 54 | 692.559s | true | `031-RIFT-990-m1-seed-031.journal.json` |
| 32 | `RIFT-990-m1-seed-032` | rumble-sfd | no-progress | 4 | 23 | 238.113s | true | `032-RIFT-990-m1-seed-032.journal.json` |
| 33 | `RIFT-990-m1-seed-033` | rumble-sfd | no-progress | 3 | 17 | 136.510s | true | `033-RIFT-990-m1-seed-033.journal.json` |
| 34 | `RIFT-990-m1-seed-034` | rumble-sfd | no-progress | 3 | 18 | 304.151s | true | `034-RIFT-990-m1-seed-034.journal.json` |
| 35 | `RIFT-990-m1-seed-035` | rumble-sfd | no-progress | 3 | 27 | 376.572s | true | `035-RIFT-990-m1-seed-035.journal.json` |
| 36 | `RIFT-990-m1-seed-036` | rumble-sfd | no-progress | 4 | 28 | 400.959s | true | `036-RIFT-990-m1-seed-036.journal.json` |
| 37 | `RIFT-990-m1-seed-037` | rumble-sfd | timeout | n/a | n/a | 900.094s | not-run | none |
| 38 | `RIFT-990-m1-seed-038` | rumble-sfd | timeout | n/a | n/a | 900.022s | not-run | none |
| 39 | `RIFT-990-m1-seed-039` | rumble-sfd | no-progress | 4 | 23 | 134.396s | true | `039-RIFT-990-m1-seed-039.journal.json` |
| 40 | `RIFT-990-m1-seed-040` | rumble-sfd | no-progress | 3 | 15 | 121.371s | true | `040-RIFT-990-m1-seed-040.journal.json` |
| 41 | `RIFT-990-m1-seed-041` | rumble-sfd | no-progress | 3 | 15 | 192.262s | true | `041-RIFT-990-m1-seed-041.journal.json` |
| 42 | `RIFT-990-m1-seed-042` | rumble-sfd | no-progress | 3 | 20 | 260.485s | true | `042-RIFT-990-m1-seed-042.journal.json` |
| 43 | `RIFT-990-m1-seed-043` | rumble-sfd | no-progress | 3 | 15 | 118.695s | true | `043-RIFT-990-m1-seed-043.journal.json` |
| 44 | `RIFT-990-m1-seed-044` | rumble-sfd | no-progress | 3 | 25 | 239.873s | true | `044-RIFT-990-m1-seed-044.journal.json` |
| 45 | `RIFT-990-m1-seed-045` | rumble-sfd | no-progress | 3 | 19 | 187.016s | true | `045-RIFT-990-m1-seed-045.journal.json` |
| 46 | `RIFT-990-m1-seed-046` | rumble-sfd | replay-mismatch | 6 | 47 | 305.289s | false | `046-RIFT-990-m1-seed-046.journal.json` |
| 47 | `RIFT-990-m1-seed-047` | rumble-sfd | no-progress | 3 | 18 | 160.552s | true | `047-RIFT-990-m1-seed-047.journal.json` |
| 48 | `RIFT-990-m1-seed-048` | rumble-sfd | no-progress | 3 | 12 | 83.958s | true | `048-RIFT-990-m1-seed-048.journal.json` |
| 49 | `RIFT-990-m1-seed-049` | rumble-sfd | no-progress | 10 | 93 | 869.089s | true | `049-RIFT-990-m1-seed-049.journal.json` |
| 50 | `RIFT-990-m1-seed-050` | rumble-sfd | no-progress | 5 | 54 | 384.319s | true | `050-RIFT-990-m1-seed-050.journal.json` |
| 51 | `RIFT-990-m1-seed-051` | fiora-sfd | no-progress | 4 | 28 | 94.378s | true | `051-RIFT-990-m1-seed-051.journal.json` |
| 52 | `RIFT-990-m1-seed-052` | fiora-sfd | no-progress | 4 | 18 | 80.303s | true | `052-RIFT-990-m1-seed-052.journal.json` |
| 53 | `RIFT-990-m1-seed-053` | fiora-sfd | no-progress | 5 | 42 | 382.065s | true | `053-RIFT-990-m1-seed-053.journal.json` |
| 54 | `RIFT-990-m1-seed-054` | fiora-sfd | no-progress | 5 | 40 | 331.315s | true | `054-RIFT-990-m1-seed-054.journal.json` |
| 55 | `RIFT-990-m1-seed-055` | fiora-sfd | no-progress | 5 | 46 | 336.907s | true | `055-RIFT-990-m1-seed-055.journal.json` |
| 56 | `RIFT-990-m1-seed-056` | fiora-sfd | no-progress | 3 | 20 | 89.962s | true | `056-RIFT-990-m1-seed-056.journal.json` |
| 57 | `RIFT-990-m1-seed-057` | fiora-sfd | no-progress | 6 | 42 | 539.905s | true | `057-RIFT-990-m1-seed-057.journal.json` |
| 58 | `RIFT-990-m1-seed-058` | fiora-sfd | replay-mismatch | 5 | 43 | 292.697s | false | `058-RIFT-990-m1-seed-058.journal.json` |
| 59 | `RIFT-990-m1-seed-059` | fiora-sfd | timeout | n/a | n/a | 900.100s | not-run | none |
| 60 | `RIFT-990-m1-seed-060` | fiora-sfd | replay-mismatch | 7 | 55 | 428.649s | false | `060-RIFT-990-m1-seed-060.journal.json` |
| 61 | `RIFT-990-m1-seed-061` | fiora-sfd | no-progress | 4 | 16 | 110.526s | true | `061-RIFT-990-m1-seed-061.journal.json` |
| 62 | `RIFT-990-m1-seed-062` | fiora-sfd | no-progress | 4 | 32 | 471.215s | true | `062-RIFT-990-m1-seed-062.journal.json` |
| 63 | `RIFT-990-m1-seed-063` | fiora-sfd | no-progress | 4 | 23 | 590.180s | true | `063-RIFT-990-m1-seed-063.journal.json` |
| 64 | `RIFT-990-m1-seed-064` | fiora-sfd | no-progress | 6 | 30 | 690.401s | true | `064-RIFT-990-m1-seed-064.journal.json` |
| 65 | `RIFT-990-m1-seed-065` | fiora-sfd | no-progress | 3 | 22 | 529.217s | true | `065-RIFT-990-m1-seed-065.journal.json` |
| 66 | `RIFT-990-m1-seed-066` | fiora-sfd | timeout | n/a | n/a | 900.100s | not-run | none |
| 67 | `RIFT-990-m1-seed-067` | fiora-sfd | no-progress | 6 | 42 | 663.006s | true | `067-RIFT-990-m1-seed-067.journal.json` |
| 68 | `RIFT-990-m1-seed-068` | fiora-sfd | timeout | n/a | n/a | 900.100s | not-run | none |
| 69 | `RIFT-990-m1-seed-069` | fiora-sfd | no-progress | 4 | 13 | 156.788s | true | `069-RIFT-990-m1-seed-069.journal.json` |
| 70 | `RIFT-990-m1-seed-070` | fiora-sfd | timeout | n/a | n/a | 900.101s | not-run | none |
| 71 | `RIFT-990-m1-seed-071` | fiora-sfd | no-progress | 5 | 22 | 392.876s | true | `071-RIFT-990-m1-seed-071.journal.json` |
| 72 | `RIFT-990-m1-seed-072` | fiora-sfd | no-progress | 4 | 25 | 437.262s | true | `072-RIFT-990-m1-seed-072.journal.json` |
| 73 | `RIFT-990-m1-seed-073` | fiora-sfd | timeout | n/a | n/a | 900.096s | not-run | none |
| 74 | `RIFT-990-m1-seed-074` | fiora-sfd | timeout | n/a | n/a | 900.035s | not-run | none |
| 75 | `RIFT-990-m1-seed-075` | fiora-sfd | no-progress | 4 | 21 | 132.797s | true | `075-RIFT-990-m1-seed-075.journal.json` |
| 76 | `RIFT-990-m1-seed-076` | fiora-sfd | timeout | n/a | n/a | 900.086s | not-run | none |
| 77 | `RIFT-990-m1-seed-077` | fiora-sfd | no-progress | 3 | 24 | 451.887s | true | `077-RIFT-990-m1-seed-077.journal.json` |
| 78 | `RIFT-990-m1-seed-078` | fiora-sfd | no-progress | 4 | 22 | 199.906s | true | `078-RIFT-990-m1-seed-078.journal.json` |
| 79 | `RIFT-990-m1-seed-079` | fiora-sfd | no-progress | 3 | 20 | 332.845s | true | `079-RIFT-990-m1-seed-079.journal.json` |
| 80 | `RIFT-990-m1-seed-080` | fiora-sfd | no-progress | 4 | 18 | 357.015s | true | `080-RIFT-990-m1-seed-080.journal.json` |
| 81 | `RIFT-990-m1-seed-081` | fiora-sfd | no-progress | 4 | 25 | 549.459s | true | `081-RIFT-990-m1-seed-081.journal.json` |
| 82 | `RIFT-990-m1-seed-082` | fiora-sfd | no-progress | 4 | 26 | 634.382s | true | `082-RIFT-990-m1-seed-082.journal.json` |
| 83 | `RIFT-990-m1-seed-083` | fiora-sfd | no-progress | 4 | 25 | 309.971s | true | `083-RIFT-990-m1-seed-083.journal.json` |
| 84 | `RIFT-990-m1-seed-084` | fiora-sfd | no-progress | 4 | 20 | 240.315s | true | `084-RIFT-990-m1-seed-084.journal.json` |
| 85 | `RIFT-990-m1-seed-085` | fiora-sfd | no-progress | 3 | 15 | 331.683s | true | `085-RIFT-990-m1-seed-085.journal.json` |
| 86 | `RIFT-990-m1-seed-086` | fiora-sfd | timeout | n/a | n/a | 900.100s | not-run | none |
| 87 | `RIFT-990-m1-seed-087` | fiora-sfd | no-progress | 5 | 22 | 336.891s | true | `087-RIFT-990-m1-seed-087.journal.json` |
| 88 | `RIFT-990-m1-seed-088` | fiora-sfd | no-progress | 4 | 25 | 333.603s | true | `088-RIFT-990-m1-seed-088.journal.json` |
| 89 | `RIFT-990-m1-seed-089` | fiora-sfd | no-progress | 4 | 29 | 680.897s | true | `089-RIFT-990-m1-seed-089.journal.json` |
| 90 | `RIFT-990-m1-seed-090` | fiora-sfd | timeout | n/a | n/a | 900.134s | not-run | none |
| 91 | `RIFT-990-m1-seed-091` | fiora-sfd | timeout | n/a | n/a | 900.101s | not-run | none |
| 92 | `RIFT-990-m1-seed-092` | fiora-sfd | timeout | n/a | n/a | 900.100s | not-run | none |
| 93 | `RIFT-990-m1-seed-093` | fiora-sfd | timeout | n/a | n/a | 900.072s | not-run | none |
| 94 | `RIFT-990-m1-seed-094` | fiora-sfd | timeout | n/a | n/a | 900.101s | not-run | none |
| 95 | `RIFT-990-m1-seed-095` | fiora-sfd | timeout | n/a | n/a | 900.100s | not-run | none |
| 96 | `RIFT-990-m1-seed-096` | fiora-sfd | no-progress | 4 | 23 | 768.006s | true | `096-RIFT-990-m1-seed-096.journal.json` |
| 97 | `RIFT-990-m1-seed-097` | fiora-sfd | no-progress | 4 | 25 | 866.818s | true | `097-RIFT-990-m1-seed-097.journal.json` |
| 98 | `RIFT-990-m1-seed-098` | fiora-sfd | timeout | n/a | n/a | 900.075s | not-run | none |
| 99 | `RIFT-990-m1-seed-099` | fiora-sfd | timeout | n/a | n/a | 900.074s | not-run | none |
| 100 | `RIFT-990-m1-seed-100` | fiora-sfd | no-progress | 4 | 36 | 779.695s | true | `100-RIFT-990-m1-seed-100.journal.json` |

## 失败分类与后续建议

1. **`advance` 后没有 progress（78/81）**：完成 journal 均在
   `combat.step=control`、`controlEstablished=true`、
   `controlGateReleased=false` 处停下。代表复现：
   `RIFT-990-m1-seed-001`（Rumble A，3 回合，18 命令）。重点检查
   `packages/engine-core/src/combat/flow.ts:427`、`:444`、`:594`、`:999` 的
   control/settlement 路径，以及 `duel.ts:1429`-`:1463` 的 no-progress guard。
   本观察不能单独证明缺失了哪一个转移。
2. **重放不一致（3 局）**：seed 046、058、060。它们先落入同一
   `no-progress` 终态，但 `replayHeadlessJournal` 在严格比较中失败。先检查
   `duel.ts:399`-`:415` 的事件与 final-state 对比，定位第一处分歧；不要取消
   严格校验。
3. **不返回的局（19 局）**：Fiora 在 A 出现 16/50，Rumble 在 A 出现 3/50。
   都到 15 分钟墙钟上限且没有完成 journal/命令向量。应先检查 `duel.ts` 中同步
   command/checkpoint 路径与 `TurnFlow`/`ChainEngine`/layer 评估，建立可采样
   的性能复现；这个座位偏斜只是线索，不是因果证明。
4. **重复的不可支付候选**：Consult the Past 51、Void Seeker 51、Show of
   Strength 42、Wages of Pain 42、Frigid Touch 32、Punch First 27 次被
   `cannot-pay-cost` 拒绝。候选生成在 `duel.ts:1137`-`:1156`，rune 补费逻辑在
   `:1158`-`:1180`。应分别审查 Bot 的资源排序与真实 cost payment；本任务不改
   引擎。
5. **无合法目标**：`no-progress` 前的最后 play 有 6 局失败于
   `no-legal-targets`，主要候选是 Stupefy（累计 23 次）和 Riposte（12 次）。
   同样先检查 `duel.ts:1137`-`:1156` 是否把最终没有合法目标的卡加入了候选；
   保持 fail-closed。

## 契约变更请求

- **逐命令耗时**：`packages/integration-tests/src/headless/duel.ts:54` 的
  `HeadlessGameOptions` 和 `:1455` 附近命令记录点目前没有 completion callback，
  `HeadlessJournal` 也没有逐命令时长。请增加仅观察、不改变状态/重试/费用的
  `onCommand` 或 progress callback，或向新 journal 版本写入精确时长样本；旧
  profile 与旧 journal 保持原 schema。未合入前，统计工具只报告 timing
  unavailable，不计算伪 p50/p95/max。
- **超时前缀诊断**：对于永不返回的同步 command，请提供父进程可见的
  “command started” 记录，或 crash-safe journal sidecar。worker 可以终止卡死
  对局，但无法在挂起后序列化内存中的命令前缀；因此 19 个超时局无法给出最后
  命令。

## 验证入口

- `pnpm --filter @riftbound/integration-tests typecheck`
- `heavy pnpm --filter @riftbound/integration-tests exec vitest run --config vitest.config.ts test/headless`
- 定向 `test/headless/m1-stats.test.ts`

全量 headless 目录包含既有长局回归；它的最终结果以任务提交前的命令输出为准，
不能把本次 100 局的 `no-progress` 数据当作自然完局验收。
