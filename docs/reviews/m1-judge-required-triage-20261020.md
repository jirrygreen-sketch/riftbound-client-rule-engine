# RIFT-875：两预组 M1 judge-required 卡分诊与逐卡派发计划

日期：2026-10-20
实际 integration / 当前分支 HEAD：[`6bd463e330afe7a6fa4ddbb556b987c89a4e4815`](https://github.com/jirrygreen-sketch/riftbound-client-rule-engine/commit/6bd463e330afe7a6fa4ddbb556b987c89a4e4815)，提交 `Merge task/RIFT-846-eg-layers-modifier-consumers`。任务分支与 `integration` 指向同一 SHA；工作区在开始分析时为干净状态。

本报告只做只读分析。未修改任何卡牌源码、测试、卡牌状态、生成数据、协议、回放/profile、依赖或 lockfile。

## 结论与验收口径

- 白名单共 **51** 个 distinct canonicalCardId；JSON 中 51 项与 `docs/plans/m1-two-precons-manifest.json` 一一对应、无重复。
- 最新实际重算为 **22 executable / 25 judge-required / 4 no-ability**。任务卡写的是 23 / 24 / 4；manifest 与生成 registry 在 HEAD 及其 merge parent 都显示 22 / 25 / 4，因此本报告采用实际快照，并把偏差作为风险记录，未为迎合旧计数改写状态。
- 其中 judge-required 的 **2 张已解锁可写**：Show of Strength、Fiora, Peerless；**其余 22 张仍依赖共享缺口，其中 Frigid Touch 同时命中契约阻断**，另以 `contract-blocked` 标出。
- 22 张 executable 的独立 golden 不能被当作整卡生产验收：`wholeCardStatus` 仍为 `unproven`，所以统一标为 `executable-production-golden-missing`。4 张 Basic Rune 是明确的 `verified-no-ability`。
- “可写”只表示可在该卡自己的 **src + test 两个文件**内完成语义、状态和真实主线回归；仍必须跑卡包全量、类型检查和下游验收。本任务不执行这些修复。
- `energy: null` / `power: null` 保持无印刷费用；未改成 0。未知或未裁定的官方能力仍 fail-closed，不把部分 IR、primitive golden、改写后的 executable view 或 `test.todo` 当作整卡可执行证明。

## 官方依据和顺序边界

目标规则为 **Core Rules v1.5**（2026-10-09 发布，2026-10-16 生效）：[官方 PDF](https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf)。并行核对官方 [Radiance Patch Notes](https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/)（2026-10-16 生效）和 [Spiritforged errata](https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/)。旧 FAQ、社区资料或旧现行 CR 与 v1.5 冲突时不采用为裁定；历史回放/profile 不升级。

| 交互层 | 官方依据 | 已证明的时间线 / 响应窗 | 真实契约证据 |
|---|---|---|---|
| Priority / Focus | CR312、312.1、312.2、313、313.2、313.4、346、346.1 | 同一时刻至多一名玩家有 Priority；Focus 还要同时有 Priority 才能作 discretionary action；Showdown Chain 正常关闭时 Focus 转给下一玩家，trigger/Add-opened chain 例外。对方只在合法时点且有 Priority 时可响应。 | `chain/346-340.2.a-*`、`chain/346.1-*`，合并探针 exit 0。 |
| Pending / Finalize / Execute / Pass / Resolve | CR329、334、337.1、337.2、340.1、340.4 | 新项 Pending；最老 Pending 先 Finalize；Unit/Gear/Add ability 在 Finalize 后立即结算；Execute/Pass 响应循环后，最新 Finalized 项先 Resolve。不能把整条链简化成统一 FIFO 或 LIFO。 | `chain/337.1-*`、`chain/340.1-*`，合并探针 exit 0。 |
| 可选费用 / 支付 / 响应 | CR355.1.a、356、356.2.b.1、356.4.f.1、357.2、358.5、820.1 | 出牌时选择可选额外费用与其他相关选择，按规则顺序计算总费用，再原子支付和合法性检查；失败回滚，对手的响应在 Finalize 后，而非支付进行中。 | `costs/356.4.f.1-*`、`costs/357.2-*`，合并探针 exit 0。 |
| 目标 / LKI / linked | CR355.5、355.7、355.10、359.3.e.5/.6/.12/.13/.14.a/.14.b | 目标在 Finalize 锁定，响应后在 Resolve 复检；失去目标为 Ignored，无关指令仍可执行；Ignored 的上游会抑制依赖链，Negated 只抑制直接引用；不得用当前卡 id 修回去。 | `targeting/359.3.e.14.a/b-*`，合并探针 exit 0。 |
| 持续效果 / 依赖 | CR478、478.1、478.1.b、479、480、482；CR706/708、740.2、433.1、468.7.c | 图层反复应用；对象依赖先求端点，循环依赖逐层同时求值；copy → trait → ability → arithmetic；算术变化可触发能力层重查；“this combat”在战斗结束同时到期；Mighty 是当前 Might ≥5。 | `layers/478.1.b-*`、`layers/479.4.e-*`、Fiora native probe，合并探针 exit 0。 |
| 同时触发 / 玩家选序 | CR303.2.a、383.3.d、383.3.d.1、340.1、466.2.d.1 | 同一控制者自行排列其同时触发；控制者组按 Turn Player 起的 Turn Order 追加；Combat 按 CR466.2.d.1 的 Attacker 优先，再 FEPR。303.2.a 不能推广为全链唯一优先级。 | `chain/303.2.a-*`、`chain/383.3.d-*`，合并探针 exit 0。 |
| Radiance 特例 | Radiance official ruling + CR303.2.a | 只按该 official example 的混合 immediate/permanent 条件应用；不以社区推测或统一 FIFO/LIFO 覆盖 CR337/340。 | `chain/303.2.a-chronobreak-*`、最终 Pending/Resolve 测试，合并探针 exit 0。 |

CR002 卡文特例、CR051 解释方法和 CR054.1 的禁止/允许比较均按具体适用条件记录；本报告不将其转换为统一数值 priority。每个具体 interactions 的 canonicalCardId、时间线、规则号和代码/测试入口在 JSON `effectfulOrderEvidence` 中。

## 当前 headless 与探针

`RIFT-857-m1-seed-001` 单局在 40-turn guard 结束：turn 41、winner null、`guardReason=turn-limit`、`judgeRequiredRejections=2630`、`replayMatches=true`、`privacySafe=true`。战斗、Conquer、Score 均为 0；play 275、idle 40，move/pass/advance/combat-damage 均为 0。这是当前标准移动/战斗/计分平台缺口的证据，不能把自然终局当已通过。

| 探针 | exit | 关键结果 |
|---|---:|---|
| `node --experimental-strip-types packages/integration-tests/src/headless/cli.ts --games=1 --decks=rumble-sfd,fiora-sfd --seeds=RIFT-857-m1-seed-001 --max-turns=40 --max-actions=10000` | `0` | `{"termination":"guard","guardReason":"turn-limit","turnNumber":41,"winner":null,"judgeRequiredRejections":2630,"replayMatches":true,"privacySafe":true}` |
| `node /tmp/RIFT-875-m1-judge-required-triage/probe-unlocked.mjs` | `0` | `{"showOfStrength":"status-only lift; real runCardScenario; weak Might 1 excluded; Might 5/6 counted; drew 2","fioraPeerless":"status-only lift; native CombatFlow attack/defense declarations; 2 triggers registered; chain resolved; Might 3 -> 6"}` |
| `pnpm --filter @riftbound/card-dsl build` | `0` | `{"purpose":"refresh ignored dist only before inspecting registry; no tracked source changes"}` |
| `node --test <24 per-card test paths>` | `1` | `{"tests":225,"pass":177,"fail":20,"todo":28,"interpretation":"test inventory, not proof of implementation or absence of a blocker"}` |
| `node --test <14 rule-focused test files>` | `0` | `{"tests":18,"pass":13,"fail":0,"todo":5,"scope":"general rule contracts; not a whole-card production acceptance"}` |

共享 parent 的旧 `guard-probe2.out` 仍有不同 seed 的频次，故每张卡同时保留 `headlessCurrent` 与 `sharedGuardProbe`。排序以当前实际频次为主，再把依赖共享度和自然终局影响作为 tie-breaker；频次是 seed-sensitive，不表示某张卡单独能关闭整局。

## 逐卡派发表（51/51）

`R`：派发序；`C/S`：当前 seed / 共享 guard-probe 的拒绝次数；`写域`：建议的单卡 src + test 两文件。所有 relative path 都以当前 worktree 为根。

| R | 名称 | canonicalCardId | status | 阻塞类别 | 依赖 / 缺口 | C | S | 写域 |
|---:|---|---|---|---|---|---:|---:|---|
| 1 | Strike Down | `card.hash-f7e9f4f53ed55ffc9e6b1d38d72324ad29bb9ebf5f25c356bcd7f723aa08b177` | `judge-required` | dependency | `EG-COSTCHOICE/EG-FINALIZE/EG-PICKS` | 528 | 356 | `packages/card-dsl/src/cards/sfd/strike-down.ts` · `packages/card-dsl/test/cards/sfd/strike-down.test.mjs` |
| 2 | Forecaster | `card.hash-cdeb1c4bb2202d43d0f4ccb7c3e0ddfa25caf4f81c41dde5c8bdaa6bbeddfe40` | `judge-required` | dependency | `EG-KEYWORDS/EG-TRIGGERS/EG-LIFECYCLE` | 339 | 129 | `packages/card-dsl/src/cards/sfd/forecaster.ts` · `packages/card-dsl/test/cards/sfd/forecaster.test.mjs` |
| 3 | Veteran Poro | `card.hash-77fdefa1bb982497df81cd6fd64fdde8c460c8cfb52aa2708aa568b849ca42e7` | `judge-required` | dependency | `EG-COSTCHOICE/EG-FINALIZE/EG-QUERY` | 189 | 330 | `packages/card-dsl/src/cards/sfd/veteran-poro.ts` · `packages/card-dsl/test/cards/sfd/veteran-poro.test.mjs` |
| 4 | Gem Jammer | `card.hash-f0ac9d90de705764ec57a50fb7483a35117949080af9f6a959eb42a7b887c9e9` | `judge-required` | dependency | `EG-KEYWORDS/EG-GRANTS/EG-PERMISSIONS/EG-LIFECYCLE` | 205 | 290 | `packages/card-dsl/src/cards/sfd/gem-jammer.ts` · `packages/card-dsl/test/cards/sfd/gem-jammer.test.mjs` |
| 5 | Plundering Poro | `card.hash-569dc9079a6d404c0d850d27b510585b856ab3def5e1e0bbafa30a3bf9d48e82` | `judge-required` | dependency | `EG-TOKEN/EG-PLAY/EG-LIFECYCLE/EG-COMBAT` | 122 | 267 | `packages/card-dsl/src/cards/sfd/plundering-poro.ts` · `packages/card-dsl/test/cards/sfd/plundering-poro.test.mjs` |
| 6 | Dangerous Duo | `card.hash-d4e849d845765608b07bf4af4aa19877f6303dfff539b541d0d070320dd05d91` | `judge-required` | dependency | `EG-TRIGGERS/EG-FINALIZE/EG-HISTORY` | 223 | 115 | `packages/card-dsl/src/cards/ogn/dangerous-duo.ts` · `packages/card-dsl/test/cards/ogn/dangerous-duo.test.mjs` |
| 7 | Show of Strength | `card.hash-7be9e4bed44d19de26a4a7a292ab8406e43694b33916fc5246d46347fa4ad85f` | `judge-required` | unlocked-writable | `none for card semantics; owner must refresh status and stale test` | 122 | 184 | `packages/card-dsl/src/cards/sfd/show-of-strength.ts` · `packages/card-dsl/test/cards/sfd/show-of-strength.test.mjs` |
| 8 | Lucian, Merciless | `card.hash-c403c2d9835df87cc0774a86145ef937226d5e7ebcfe75282053e23df744f5ef` | `judge-required` | dependency | `EG-COSTCHOICE/EG-FINALIZE/EG-EVENTS` | 183 | 72 | `packages/card-dsl/src/cards/sfd/lucian-merciless.ts` · `packages/card-dsl/test/cards/sfd/lucian-merciless.test.mjs` |
| 9 | Fiora, Worthy | `card.hash-261f97a75639fd51dc63b8c4b2a577b52d5bd6893227a1a3a13da5375880fe6f` | `judge-required` | dependency | `EG-POWER/EG-EVENTS/EG-LAYERS` | 42 | 176 | `packages/card-dsl/src/cards/sfd/fiora-worthy.ts` · `packages/card-dsl/test/cards/sfd/fiora-worthy.test.mjs` |
| 10 | Wages of Pain | `card.hash-431738fdce44471075e7d0f77a009dde71d56c7be7e2c9ef022d6b124a857a3c` | `judge-required` | dependency | `EG-TOKEN/EG-LIFECYCLE/EG-EVENTS` | 56 | 163 | `packages/card-dsl/src/cards/sfd/wages-of-pain.ts` · `packages/card-dsl/test/cards/sfd/wages-of-pain.test.mjs` |
| 11 | Fiora, Peerless | `card.hash-6bde2e2c542ff8fc1a7a2f9204df7e6c58a05a53ad98c0a31d69927be053b77f` | `judge-required` | unlocked-writable | `none for card semantics; owner must refresh source status and stale test` | 139 | 135 | `packages/card-dsl/src/cards/sfd/fiora-peerless.ts` · `packages/card-dsl/test/cards/sfd/fiora-peerless.test.mjs` |
| 12 | Ferrous Forerunner | `card.hash-057dababf241fe29f90a9a6c306d4463227bed0d80f3df33c8261f7f43f5fed3` | `judge-required` | dependency | `EG-TOKEN/EG-LIFECYCLE/EG-PLAY/EG-POWER` | 125 | 91 | `packages/card-dsl/src/cards/sfd/ferrous-forerunner.ts` · `packages/card-dsl/test/cards/sfd/ferrous-forerunner.test.mjs` |
| 13 | Breakneck Mech | `card.hash-cb2ea7576d42c76d8ecf8fa3cdb082f007639b144aecc69402230df6bcc131ab` | `judge-required` | dependency | `EG-GRANTS/EG-KEYWORDS/EG-LAYERS/EG-TAX` | 123 | 98 | `packages/card-dsl/src/cards/sfd/breakneck-mech.ts` · `packages/card-dsl/test/cards/sfd/breakneck-mech.test.mjs` |
| 14 | Rumble, Hotheaded | `card.hash-11c889b9d655c822e7ce3ec82c5a5f1e2d716ac6d3c2ed6fb9bb7b22c32ce870` | `judge-required` | dependency | `EG-GRANTS/EG-KEYWORDS/EG-LAYERS/EG-COSTCHOICE` | 0 | 111 | `packages/card-dsl/src/cards/sfd/rumble-hotheaded.ts` · `packages/card-dsl/test/cards/sfd/rumble-hotheaded.test.mjs` |
| 15 | Jaull-Fish | `card.hash-db90e8eaf24230cfbc3b68d99971c58f465f65465b5c52be37ae1564d6e86732` | `judge-required` | dependency | `EG-COSTCHOICE/EG-FINALIZE/EG-STATIC` | 92 | 0 | `packages/card-dsl/src/cards/sfd/jaull-fish.ts` · `packages/card-dsl/test/cards/sfd/jaull-fish.test.mjs` |
| 16 | Danger Zone | `card.hash-3c1c01b405853556e3e1c12bbd758e94d73f5ed474a5643bb068eaa7cb549c6e` | `judge-required` | dependency | `EG-COSTCHOICE/EG-FINALIZE/EG-STATIC` | 0 | 54 | `packages/card-dsl/src/cards/sfd/danger-zone.ts` · `packages/card-dsl/test/cards/sfd/danger-zone.test.mjs` |
| 17 | Laurent Duelist | `card.hash-7cbc2a92adfe5cf5c7126a8d72869cf933d006002fe1f46b4804c2040a51c9c6` | `judge-required` | dependency | `EG-LAYERS/EG-EXPR/EG-COMBAT` | 14 | 45 | `packages/card-dsl/src/cards/sfd/laurent-duelist.ts` · `packages/card-dsl/test/cards/sfd/laurent-duelist.test.mjs` |
| 18 | Rumble, Scrapper | `card.hash-01bd7d3ff52eabd0afc59248a33845b648d9f61db8b544052f51057f967ceb7c` | `judge-required` | dependency | `EG-COMBAT/EG-PAYLOAD/EG-LOCATIONS` | 128 | 0 | `packages/card-dsl/src/cards/sfd/rumble-scrapper.ts` · `packages/card-dsl/test/cards/sfd/rumble-scrapper.test.mjs` |
| 19 | Frigid Touch | `card.hash-153eb4df721b70662a63652ba1602985ceed08d81a0b23fc0d6b10349ee15ca9` | `judge-required` | contract-blocked | `EG-COSTCHOICE/EG-FINALIZE/EG-CONTRACT` | 0 | 0 | `packages/card-dsl/src/cards/sfd/frigid-touch.ts` · `packages/card-dsl/test/cards/sfd/frigid-touch.test.mjs` |
| 20 | Minefield | `card.hash-0c36f22df8ffa7bed49f59fd138d24b9b0a52a7b8ad4c720afcaa12ec816eee4` | `judge-required` | dependency | `EG-EVENTS/EG-PAYLOAD/EG-LOCATIONS/EG-MOVE` | 0 | 0 | `packages/card-dsl/src/cards/sfd/minefield.ts` · `packages/card-dsl/test/cards/sfd/minefield.test.mjs` |
| 21 | Ravenbloom Conservatory | `card.hash-5a86b358540e9ab2512400c77f3291739c2aa6ccb7b537449298a640b02b0e82` | `judge-required` | dependency | `EG-LOCATIONS/EG-EVENTS/EG-PAYLOAD` | 0 | 0 | `packages/card-dsl/src/cards/sfd/ravenbloom-conservatory.ts` · `packages/card-dsl/test/cards/sfd/ravenbloom-conservatory.test.mjs` |
| 22 | Veiled Temple | `card.hash-9daf60cdf4c82e4fba1f685af1c9b0d748003f7e9ad9c68f02f429bdd0cf85e5` | `judge-required` | dependency | `EG-TOKEN/EG-PAYLOAD/EG-LOCATIONS` | 0 | 0 | `packages/card-dsl/src/cards/sfd/veiled-temple.ts` · `packages/card-dsl/test/cards/sfd/veiled-temple.test.mjs` |
| 23 | Ornn's Forge | `card.hash-44e95dd0a87b7dfcd7565b73a33e204f85c97ac82e004a6127ff7ed649fb41ad` | `judge-required` | dependency | `EG-COSTCHOICE/EG-FINALIZE/EG-STATIC` | 0 | 0 | `packages/card-dsl/src/cards/sfd/ornns-forge.ts` · `packages/card-dsl/test/cards/sfd/ornns-forge.test.mjs` |
| 24 | Treasure Hoard | `card.hash-77763eae5320de558954776a37677e8638b6d4af73399e5a7c4f5d5321a2b564` | `judge-required` | dependency | `EG-TOKEN/EG-LIFECYCLE/EG-LOCATIONS` | 0 | 0 | `packages/card-dsl/src/cards/sfd/treasure-hoard.ts` · `packages/card-dsl/test/cards/sfd/treasure-hoard.test.mjs` |
| 25 | Sunken Temple | `card.hash-c225141f743b61c67ddf269932c6bbdef739f37888f62163906faa7fa1e6dc2b` | `judge-required` | dependency | `EG-EVENTS/EG-PAYLOAD/EG-LOCATIONS/EG-MOVE` | 0 | 0 | `packages/card-dsl/src/cards/sfd/sunken-temple.ts` · `packages/card-dsl/test/cards/sfd/sunken-temple.test.mjs` |
| — | Assembly Rig | `card.hash-d490b51d08bdd7f97b1708aabfa6309995106f10de815b6fd927368e4a630569` | `executable` | executable-production-golden-missing | `production-golden` | 0 | 0 | `packages/card-dsl/src/cards/sfd/assembly-rig.ts` · `packages/card-dsl/test/cards/sfd/assembly-rig.test.mjs` |
| — | B.F. Sword | `card.hash-959c19d68f06f8f929625bfde93a1132701da5a5d0b49e91583db341384f0bfe` | `executable` | executable-production-golden-missing | `production-golden` | 0 | 0 | `packages/card-dsl/src/cards/sfd/bf-sword.ts` · `packages/card-dsl/test/cards/sfd/bf-sword.test.mjs` |
| — | Body Rune | `card.hash-a2227b03e9e13c8e2ddae7a973c746cc4243ff631dfaf462dc9823e687bbbf17` | `no-ability` | verified-no-ability | `none` | 0 | 0 | `packages/card-dsl/src/cards/ogn/body-rune.ts` · `packages/card-dsl/test/cards/ogn/body-rune.test.mjs` |
| — | Bubble Bot | `card.hash-34880fcae16bd9461e4c318dfb455365ff9e353db357f948b4a15dea7e01b389` | `executable` | executable-production-golden-missing | `production-golden` | 0 | 0 | `packages/card-dsl/src/cards/sfd/bubble-bot.ts` · `packages/card-dsl/test/cards/sfd/bubble-bot.test.mjs` |
| — | Consult the Past | `card.hash-2ebf1fe6e5ed7bb875f1c112b3e0ed1635b557c0c0ad550d752b8dd376243007` | `executable` | executable-production-golden-missing | `production-golden` | 0 | 0 | `packages/card-dsl/src/cards/ogn/consult-the-past.ts` · `packages/card-dsl/test/cards/ogn/consult-the-past.test.mjs` |
| — | Dauntless Vanguard | `card.hash-cf0b322a78010676e3d8b287830194a3bdc8970e65a141578ae8a3074ebd956f` | `executable` | executable-production-golden-missing | `production-golden` | 0 | 0 | `packages/card-dsl/src/cards/sfd/dauntless-vanguard.ts` · `packages/card-dsl/test/cards/sfd/dauntless-vanguard.test.mjs` |
| — | Doran's Blade | `card.hash-a1ee07f71d453092ab7d54f9491684e972b735b22bb1f3fda73f2641bcedbfe1` | `executable` | executable-production-golden-missing | `production-golden` | 0 | 0 | `packages/card-dsl/src/cards/sfd/dorans-blade.ts` · `packages/card-dsl/test/cards/sfd/dorans-blade.test.mjs` |
| — | Fury Rune | `card.hash-30497c69657abd1d3abf17f9b3766e7d064817473a88828ca2ef4ab9b51f7902` | `no-ability` | verified-no-ability | `none` | 0 | 0 | `packages/card-dsl/src/cards/ogn/fury-rune.ts` · `packages/card-dsl/test/cards/ogn/fury-rune.test.mjs` |
| — | Grand Duelist | `card.hash-ccfc067dad8a1bf92c6ae1aa5f7110e9d211a1842a9254bb9320705c2f96c6c4` | `executable` | executable-production-golden-missing | `production-golden` | 0 | 0 | `packages/card-dsl/src/cards/sfd/grand-duelist.ts` · `packages/card-dsl/test/cards/sfd/grand-duelist.test.mjs` |
| — | Long Sword | `card.hash-cab923a670e4baa826aa3de381c8b992bf33987fcb0d65feb75ca538a8681010` | `executable` | executable-production-golden-missing | `production-golden` | 0 | 0 | `packages/card-dsl/src/cards/sfd/long-sword.ts` · `packages/card-dsl/test/cards/sfd/long-sword.test.mjs` |
| — | Mechanized Menace | `card.hash-fadaa09c681d3d967954f99504cd9d3d749242dc99dbc40d60adfa60bf53cca7` | `executable` | executable-production-golden-missing | `production-golden` | 0 | 0 | `packages/card-dsl/src/cards/sfd/mechanized-menace.ts` · `packages/card-dsl/test/cards/sfd/mechanized-menace.test.mjs` |
| — | Mind Rune | `card.hash-a8a4cb783649a0339782e2d3808d6144661c621634da7c9f79b4f87981fac97b` | `no-ability` | verified-no-ability | `none` | 0 | 0 | `packages/card-dsl/src/cards/ogn/mind-rune.ts` · `packages/card-dsl/test/cards/ogn/mind-rune.test.mjs` |
| — | Order Rune | `card.hash-e0efe08be77e60ed68f2e43ba425b763efd364eb44b0c760d26ef1fcc1b6df67` | `no-ability` | verified-no-ability | `none` | 0 | 0 | `packages/card-dsl/src/cards/ogn/order-rune.ts` · `packages/card-dsl/test/cards/ogn/order-rune.test.mjs` |
| — | Pit Rookie | `card.hash-e2638655ff5ed3a1e60a501be3c23d74e46ef7f1900bed31b436f1a579b316ed` | `executable` | executable-production-golden-missing | `production-golden` | 0 | 0 | `packages/card-dsl/src/cards/ogn/pit-rookie.ts` · `packages/card-dsl/test/cards/ogn/pit-rookie.test.mjs` |
| — | Production Surge | `card.hash-1504d8f14af5ce1b9f7a3663c23e6ef7cb57d59a6274dc921cd9296ee8e2494b` | `executable` | executable-production-golden-missing | `production-golden` | 0 | 0 | `packages/card-dsl/src/cards/sfd/production-surge.ts` · `packages/card-dsl/test/cards/sfd/production-surge.test.mjs` |
| — | Punch First | `card.hash-8d49727ab9ae782b8a21802c9ae0b51e5d712a37a072d991629bfbf3645535b3` | `executable` | executable-production-golden-missing | `production-golden` | 0 | 0 | `packages/card-dsl/src/cards/sfd/punch-first.ts` · `packages/card-dsl/test/cards/sfd/punch-first.test.mjs` |
| — | Riposte | `card.hash-6e1bdc294002f23d867897b239a644801a07effca16fc07c31ab55c7f41ff26d` | `executable` | executable-production-golden-missing | `source-evidence-review` | 0 | 0 | `packages/card-dsl/src/cards/sfd/riposte.ts` · `packages/card-dsl/test/cards/sfd/riposte.test.mjs` |
| — | Royal Guard | `card.hash-0ba141b975db96cac65aab56bfd7dbb63904c538cc3d9c32bdfb3b2d98e486de` | `executable` | executable-production-golden-missing | `production-golden` | 0 | 0 | `packages/card-dsl/src/cards/sfd/royal-guard.ts` · `packages/card-dsl/test/cards/sfd/royal-guard.test.mjs` |
| — | Sacred Shears | `card.hash-d3579e6825470471f5ce05c53533806a5244c5e84364fe57b2aab0b7cc0f14e0` | `executable` | executable-production-golden-missing | `production-golden` | 0 | 0 | `packages/card-dsl/src/cards/sfd/sacred-shears.ts` · `packages/card-dsl/test/cards/sfd/sacred-shears.test.mjs` |
| — | Singularity | `card.hash-10b7d5be25093a4d318efd8639b6e34583bad10bf38adbf93b4c3733ea54221b` | `executable` | executable-production-golden-missing | `production-golden` | 0 | 0 | `packages/card-dsl/src/cards/ogn/singularity.ts` · `packages/card-dsl/test/cards/ogn/singularity.test.mjs` |
| — | Stupefy | `card.hash-5b08b5b8648e8c5c057d15279d1b4e677457eb0b43fcf2810e2ec4f4c4d1b7cf` | `executable` | executable-production-golden-missing | `production-golden` | 0 | 0 | `packages/card-dsl/src/cards/ogn/stupefy.ts` · `packages/card-dsl/test/cards/ogn/stupefy.test.mjs` |
| — | Unsung Hero | `card.hash-afc40c373a9fb4e48492323d7af26d3a58b824c385707dd3c269e97fee236103` | `executable` | executable-production-golden-missing | `production-golden` | 0 | 0 | `packages/card-dsl/src/cards/sfd/unsung-hero.ts` · `packages/card-dsl/test/cards/sfd/unsung-hero.test.mjs` |
| — | Vengeance | `card.hash-f67321dac096b3ad1e49b55231663e26f3f9d96efafe79d75719a6eb72fc5caa` | `executable` | executable-production-golden-missing | `production-golden` | 0 | 0 | `packages/card-dsl/src/cards/ogn/vengeance.ts` · `packages/card-dsl/test/cards/ogn/vengeance.test.mjs` |
| — | Void Seeker | `card.hash-600e0796e82099284b213e87b112b1c5df42777ef72b70a3b4cd49a84d27dd10` | `executable` | executable-production-golden-missing | `production-golden` | 0 | 0 | `packages/card-dsl/src/cards/ogn/void-seeker.ts` · `packages/card-dsl/test/cards/ogn/void-seeker.test.mjs` |
| — | Warmog's Armor | `card.hash-902c6a1366a1a0e653ccb65102ff621b109af3b0b40f5bbeb7d8d3a5aeae2322` | `executable` | executable-production-golden-missing | `production-golden` | 0 | 0 | `packages/card-dsl/src/cards/sfd/warmogs-armor.ts` · `packages/card-dsl/test/cards/sfd/warmogs-armor.test.mjs` |
| — | Yone, Blademaster | `card.hash-292f685c7578235f29f2c362a52c7975eafab592cc437e2445ca68309b294c56` | `executable` | executable-production-golden-missing | `production-golden` | 0 | 0 | `packages/card-dsl/src/cards/rad/yone-blademaster.ts` · `packages/card-dsl/test/cards/rad/yone-blademaster.test.mjs` |

## judge-required 派发顺序

1. **Strike Down** — `card.hash-f7e9f4f53ed55ffc9e6b1d38d72324ad29bb9ebf5f25c356bcd7f723aa08b177`
2. **Forecaster** — `card.hash-cdeb1c4bb2202d43d0f4ccb7c3e0ddfa25caf4f81c41dde5c8bdaa6bbeddfe40`
3. **Veteran Poro** — `card.hash-77fdefa1bb982497df81cd6fd64fdde8c460c8cfb52aa2708aa568b849ca42e7`
4. **Gem Jammer** — `card.hash-f0ac9d90de705764ec57a50fb7483a35117949080af9f6a959eb42a7b887c9e9`
5. **Plundering Poro** — `card.hash-569dc9079a6d404c0d850d27b510585b856ab3def5e1e0bbafa30a3bf9d48e82`
6. **Dangerous Duo** — `card.hash-d4e849d845765608b07bf4af4aa19877f6303dfff539b541d0d070320dd05d91`
7. **Show of Strength** — `card.hash-7be9e4bed44d19de26a4a7a292ab8406e43694b33916fc5246d46347fa4ad85f`
8. **Lucian, Merciless** — `card.hash-c403c2d9835df87cc0774a86145ef937226d5e7ebcfe75282053e23df744f5ef`
9. **Fiora, Worthy** — `card.hash-261f97a75639fd51dc63b8c4b2a577b52d5bd6893227a1a3a13da5375880fe6f`
10. **Wages of Pain** — `card.hash-431738fdce44471075e7d0f77a009dde71d56c7be7e2c9ef022d6b124a857a3c`
11. **Fiora, Peerless** — `card.hash-6bde2e2c542ff8fc1a7a2f9204df7e6c58a05a53ad98c0a31d69927be053b77f`
12. **Ferrous Forerunner** — `card.hash-057dababf241fe29f90a9a6c306d4463227bed0d80f3df33c8261f7f43f5fed3`
13. **Breakneck Mech** — `card.hash-cb2ea7576d42c76d8ecf8fa3cdb082f007639b144aecc69402230df6bcc131ab`
14. **Rumble, Hotheaded** — `card.hash-11c889b9d655c822e7ce3ec82c5a5f1e2d716ac6d3c2ed6fb9bb7b22c32ce870`
15. **Jaull-Fish** — `card.hash-db90e8eaf24230cfbc3b68d99971c58f465f65465b5c52be37ae1564d6e86732`
16. **Danger Zone** — `card.hash-3c1c01b405853556e3e1c12bbd758e94d73f5ed474a5643bb068eaa7cb549c6e`
17. **Laurent Duelist** — `card.hash-7cbc2a92adfe5cf5c7126a8d72869cf933d006002fe1f46b4804c2040a51c9c6`
18. **Rumble, Scrapper** — `card.hash-01bd7d3ff52eabd0afc59248a33845b648d9f61db8b544052f51057f967ceb7c`
19. **Frigid Touch** — `card.hash-153eb4df721b70662a63652ba1602985ceed08d81a0b23fc0d6b10349ee15ca9`
20. **Minefield** — `card.hash-0c36f22df8ffa7bed49f59fd138d24b9b0a52a7b8ad4c720afcaa12ec816eee4`
21. **Ravenbloom Conservatory** — `card.hash-5a86b358540e9ab2512400c77f3291739c2aa6ccb7b537449298a640b02b0e82`
22. **Veiled Temple** — `card.hash-9daf60cdf4c82e4fba1f685af1c9b0d748003f7e9ad9c68f02f429bdd0cf85e5`
23. **Ornn's Forge** — `card.hash-44e95dd0a87b7dfcd7565b73a33e204f85c97ac82e004a6127ff7ed649fb41ad`
24. **Treasure Hoard** — `card.hash-77763eae5320de558954776a37677e8638b6d4af73399e5a7c4f5d5321a2b564`
25. **Sunken Temple** — `card.hash-c225141f743b61c67ddf269932c6bbdef739f37888f62163906faa7fa1e6dc2b`

## 已解锁可写的两张卡

### Show of Strength

- 当前真实路径：`mightGte` 已进入 `packages/engine-core/src/programs/filters.ts` 的 scalar filter 集，`packages/engine-core/src/effects/filters/predicates.ts` 的 numeric predicate 消费当前 Might；没有只凭 `judgeReason` 推断。
- 真实 `runCardScenario` 探针在内存里只移除 status gate：Might 1 的友方单位被排除，Might 5/6 的单位被计数，实际手牌从 0 到 2，`draw-per-mighty.drawn=2`。shuffle/order 不参与谓词判断。
- 卡测试仍有三条过期断言：把 `mightGte` 当成必须拒绝、把 `condition.value` static binder 当成缺失、把 merged matcher 当成忽略 threshold。旧测试 exit 1（5 pass / 3 fail / 1 todo），所以 owner 必须在**该卡 test**中改写为真实负/正/边界 golden，并刷新卡面 state/judgeReason；不得继续保留假断层。
- 写域：`packages/card-dsl/src/cards/sfd/show-of-strength.ts`、`packages/card-dsl/test/cards/sfd/show-of-strength.test.mjs`。

### Fiora, Peerless

- 当前真实路径：`CombatFlow.openCombat` 发出 `attack-declared` / `defense-declared`，`createActionPipelineHost({testTrigger})` 求值 one-on-one，`triggerRegistrations` 注册两条触发，Finalize/Resolve 真实执行 `continuous.might`；探针把 Might 3 升到 6。
- 对应 CR740.2.a/b（one-on-one）、466.2.c.3（战斗 designation）、383.2（触发条件）、433.1（double = current value）和 468.7.c（this combat 同期到期）。
- 卡测试 exit 0（17 pass / 0 fail / 1 todo），但 todo 仍声称 combat-start producer 不存在；该 todo 已过期。owner 要删掉该 stale TODO、加 native CombatFlow production golden（含非 one-on-one 拒绝及到期），再更新状态。
- 写域：`packages/card-dsl/src/cards/sfd/fiora-peerless.ts`、`packages/card-dsl/test/cards/sfd/fiora-peerless.test.mjs`。

## 其余 judge-required 卡的共享边界

- **Strike Down / Veteran Poro**：equipped/Equipment filter、non-target pick、authoritative Equip-cost binding 和 Finalize lock 仍由 pick/target/gear pipeline 共同缺失。Strike Down 与 Veteran Poro 的当前测试分别有 1/2 个失败；不能在各卡内部伪造一个 TargetSpec。
- **Gem Jammer / Forecaster / Breakneck Mech / Rumble, Hotheaded / Laurent Duelist**：关键词 grant/expansion、Ganking/Vision/Assault/Deflect、layer consumer、permission/tax 须由生产 lifecycle 统一重展开。Gem Jammer 的 7/7 测试和 Breakneck 的 9 pass 只证明 grant body，不能证明默认 lifecycle。
- **Ferrous Forerunner / Plundering Poro / Treasure Hoard / Wages of Pain / Rumble, Scrapper**：token definition/print body、exhausted entry、controller-base、Deathknell, conquer/hold payload 等是跨卡共享路径。Ferrous 的 isolated body 新探针曾证明控制器-base 子效果可执行，但完整 production lifecycle 仍 fail closed；不能把它升级成“单卡 src+test 可解锁”。
- **Frigid Touch / Danger Zone / Ornn's Forge / Jaull-Fish**：Repeat/Accelerate/discount/static cost 的 Finalize 收集、原子支付和付费计数没有接通。Frigid Touch 另需一个能重复执行 Might 修改的契约/原语动作；这是本报告唯一的契约变更请求。
- **Wages of Pain / Strike Down 的 LKI/Deathknell**：通路要在 Pending 仍可观察时捕获 event identity，不可用结算时当前对象反弹成别的同 id 对象。
- **Fiora, Worthy**：同卡测试虽 17 pass，仍要由 authoritative host 证明精确 Order Power 支付、触发与 event.it ready；Universal Power 路径继续 fail-closed，不能在本卡私自放宽。
- **Dangerous Duo / Sunken Temple / Minefield / Ravenbloom / Veiled Temple**：combat、conquer/defend/hold 的载荷（单位 + battlefieldId + here anchor）以及 Legion/目标单位集合须由 events/turn/combat 共享所有者提供。
- **Lucian, Merciless**：Weaponmaster Equip-cost provenance 和首次 Conquer ready 的 per-turn history/event 消费仍缺；不能被 6 pass / 2 todo 误读为整卡通过。

## executable 与 no-ability 的验收缺口

22 张 executable 卡（Royal Guard、Singularity、Production Surge、Yone、Consult the Past、Bubble Bot、Stupefy、Void Seeker、Riposte、Punch First、Warmog's Armor、B.F. Sword、Doran's Blade、Unsung Hero、Long Sword、Grand Duelist、Dauntless Vanguard、Sacred Shears、Assembly Rig、Pit Rookie、Vengeance、Mechanized Menace）仍有 `wholeCardStatus=unproven`。其中 Riposte 的独立 test 在清单哈希时 exit 1，且需 source-evidence review；当前单测为 9 pass / 1 fail，不能用 executable metadata 关掉生产 golden gate。

4 张 Basic Rune（Fury/Body/Mind/Order）没有要从 CardProgram 执行的能力正文；它们仍是合法印刷费用/规则资源，`energy:null` 和 `power:null` 保留。

## 完整 evidence 与可复现产物

- JSON：[`docs/reviews/m1-judge-required-triage-20261020.json`](/root/swarm-rift/wt/RIFT-875-m1-judge-required-triage/docs/reviews/m1-judge-required-triage-20261020.json) 保存 51 项、原文摘要、共享依赖、R/C/S、两文件写域、官方 sources/时间线/production evidence、未声明事项。
- headless：`/tmp/RIFT-875-m1-judge-required-triage/headless-canonical-001-rerun.json`（exit 文件同前缀 `.exit`）。
- 两张解锁卡真实探针：`/tmp/RIFT-875-m1-judge-required-triage/probe-unlocked.mjs`、`.out`、`.err`、`.exit`。
- 24 张 origin tests 汇总：`/tmp/RIFT-875-m1-judge-required-triage/judge-required-tests.out`；逐卡输出在 `/tmp/RIFT-875-m1-judge-required-triage/card-tests/`。
- 规则契约合并运行：`/tmp/RIFT-875-m1-judge-required-triage/order-evidence-tests.out`（13 pass / 0 fail / 5 todo，exit 0）。

## 验证

- `python3 -m json.tool docs/reviews/m1-judge-required-triage-20261020.json >/dev/null`：pass。
- `git diff --check`：pass。
- Python verification：51 cards、51 unique IDs、与 manifest whitelist set equality、paths all exist、status Counter = `{executable:22, judge-required:25, no-ability:4}`。

## 风险、剩余与契约变更请求

- 当前 headless 仍是由 turn-limit guard 停下，0 次 move/pass/advance/combat/scoring；不能因某张卡探针通过就宣称两预组可自然终局。没有连接或修改生产数据库，没有运行共享库 integration/e2e。
- 任务卡的旧 23/24/4 与当前 22/25/4 有 1 张偏差；保留实际结果，请父级在接受时按此差异复核。
- **契约变更请求**：Frigid Touch 需要 repeat 的付费次数与 Might 修改动作（或等价的通用重复执行绑定）；当前 `effect.repeat` 的 closed GameAction 集不含 Might 修改，不能用 `effect.buff` 替代。请求父级/共享契约 owner评估。
- 未修改 `pnpm-lock.yaml`、依赖、官方卡牌生成数据、旧 replay/profile/schema；未 push/release。

## canonicalCardId 索引

- **Strike Down** — `card.hash-f7e9f4f53ed55ffc9e6b1d38d72324ad29bb9ebf5f25c356bcd7f723aa08b177` — `judge-required` — `packages/card-dsl/src/cards/sfd/strike-down.ts`
- **Forecaster** — `card.hash-cdeb1c4bb2202d43d0f4ccb7c3e0ddfa25caf4f81c41dde5c8bdaa6bbeddfe40` — `judge-required` — `packages/card-dsl/src/cards/sfd/forecaster.ts`
- **Veteran Poro** — `card.hash-77fdefa1bb982497df81cd6fd64fdde8c460c8cfb52aa2708aa568b849ca42e7` — `judge-required` — `packages/card-dsl/src/cards/sfd/veteran-poro.ts`
- **Gem Jammer** — `card.hash-f0ac9d90de705764ec57a50fb7483a35117949080af9f6a959eb42a7b887c9e9` — `judge-required` — `packages/card-dsl/src/cards/sfd/gem-jammer.ts`
- **Plundering Poro** — `card.hash-569dc9079a6d404c0d850d27b510585b856ab3def5e1e0bbafa30a3bf9d48e82` — `judge-required` — `packages/card-dsl/src/cards/sfd/plundering-poro.ts`
- **Dangerous Duo** — `card.hash-d4e849d845765608b07bf4af4aa19877f6303dfff539b541d0d070320dd05d91` — `judge-required` — `packages/card-dsl/src/cards/ogn/dangerous-duo.ts`
- **Show of Strength** — `card.hash-7be9e4bed44d19de26a4a7a292ab8406e43694b33916fc5246d46347fa4ad85f` — `judge-required` — `packages/card-dsl/src/cards/sfd/show-of-strength.ts`
- **Lucian, Merciless** — `card.hash-c403c2d9835df87cc0774a86145ef937226d5e7ebcfe75282053e23df744f5ef` — `judge-required` — `packages/card-dsl/src/cards/sfd/lucian-merciless.ts`
- **Fiora, Worthy** — `card.hash-261f97a75639fd51dc63b8c4b2a577b52d5bd6893227a1a3a13da5375880fe6f` — `judge-required` — `packages/card-dsl/src/cards/sfd/fiora-worthy.ts`
- **Wages of Pain** — `card.hash-431738fdce44471075e7d0f77a009dde71d56c7be7e2c9ef022d6b124a857a3c` — `judge-required` — `packages/card-dsl/src/cards/sfd/wages-of-pain.ts`
- **Fiora, Peerless** — `card.hash-6bde2e2c542ff8fc1a7a2f9204df7e6c58a05a53ad98c0a31d69927be053b77f` — `judge-required` — `packages/card-dsl/src/cards/sfd/fiora-peerless.ts`
- **Ferrous Forerunner** — `card.hash-057dababf241fe29f90a9a6c306d4463227bed0d80f3df33c8261f7f43f5fed3` — `judge-required` — `packages/card-dsl/src/cards/sfd/ferrous-forerunner.ts`
- **Breakneck Mech** — `card.hash-cb2ea7576d42c76d8ecf8fa3cdb082f007639b144aecc69402230df6bcc131ab` — `judge-required` — `packages/card-dsl/src/cards/sfd/breakneck-mech.ts`
- **Rumble, Hotheaded** — `card.hash-11c889b9d655c822e7ce3ec82c5a5f1e2d716ac6d3c2ed6fb9bb7b22c32ce870` — `judge-required` — `packages/card-dsl/src/cards/sfd/rumble-hotheaded.ts`
- **Jaull-Fish** — `card.hash-db90e8eaf24230cfbc3b68d99971c58f465f65465b5c52be37ae1564d6e86732` — `judge-required` — `packages/card-dsl/src/cards/sfd/jaull-fish.ts`
- **Danger Zone** — `card.hash-3c1c01b405853556e3e1c12bbd758e94d73f5ed474a5643bb068eaa7cb549c6e` — `judge-required` — `packages/card-dsl/src/cards/sfd/danger-zone.ts`
- **Laurent Duelist** — `card.hash-7cbc2a92adfe5cf5c7126a8d72869cf933d006002fe1f46b4804c2040a51c9c6` — `judge-required` — `packages/card-dsl/src/cards/sfd/laurent-duelist.ts`
- **Rumble, Scrapper** — `card.hash-01bd7d3ff52eabd0afc59248a33845b648d9f61db8b544052f51057f967ceb7c` — `judge-required` — `packages/card-dsl/src/cards/sfd/rumble-scrapper.ts`
- **Frigid Touch** — `card.hash-153eb4df721b70662a63652ba1602985ceed08d81a0b23fc0d6b10349ee15ca9` — `judge-required` — `packages/card-dsl/src/cards/sfd/frigid-touch.ts`
- **Minefield** — `card.hash-0c36f22df8ffa7bed49f59fd138d24b9b0a52a7b8ad4c720afcaa12ec816eee4` — `judge-required` — `packages/card-dsl/src/cards/sfd/minefield.ts`
- **Ravenbloom Conservatory** — `card.hash-5a86b358540e9ab2512400c77f3291739c2aa6ccb7b537449298a640b02b0e82` — `judge-required` — `packages/card-dsl/src/cards/sfd/ravenbloom-conservatory.ts`
- **Veiled Temple** — `card.hash-9daf60cdf4c82e4fba1f685af1c9b0d748003f7e9ad9c68f02f429bdd0cf85e5` — `judge-required` — `packages/card-dsl/src/cards/sfd/veiled-temple.ts`
- **Ornn's Forge** — `card.hash-44e95dd0a87b7dfcd7565b73a33e204f85c97ac82e004a6127ff7ed649fb41ad` — `judge-required` — `packages/card-dsl/src/cards/sfd/ornns-forge.ts`
- **Treasure Hoard** — `card.hash-77763eae5320de558954776a37677e8638b6d4af73399e5a7c4f5d5321a2b564` — `judge-required` — `packages/card-dsl/src/cards/sfd/treasure-hoard.ts`
- **Sunken Temple** — `card.hash-c225141f743b61c67ddf269932c6bbdef739f37888f62163906faa7fa1e6dc2b` — `judge-required` — `packages/card-dsl/src/cards/sfd/sunken-temple.ts`
- **Assembly Rig** — `card.hash-d490b51d08bdd7f97b1708aabfa6309995106f10de815b6fd927368e4a630569` — `executable` — `packages/card-dsl/src/cards/sfd/assembly-rig.ts`
- **B.F. Sword** — `card.hash-959c19d68f06f8f929625bfde93a1132701da5a5d0b49e91583db341384f0bfe` — `executable` — `packages/card-dsl/src/cards/sfd/bf-sword.ts`
- **Body Rune** — `card.hash-a2227b03e9e13c8e2ddae7a973c746cc4243ff631dfaf462dc9823e687bbbf17` — `no-ability` — `packages/card-dsl/src/cards/ogn/body-rune.ts`
- **Bubble Bot** — `card.hash-34880fcae16bd9461e4c318dfb455365ff9e353db357f948b4a15dea7e01b389` — `executable` — `packages/card-dsl/src/cards/sfd/bubble-bot.ts`
- **Consult the Past** — `card.hash-2ebf1fe6e5ed7bb875f1c112b3e0ed1635b557c0c0ad550d752b8dd376243007` — `executable` — `packages/card-dsl/src/cards/ogn/consult-the-past.ts`
- **Dauntless Vanguard** — `card.hash-cf0b322a78010676e3d8b287830194a3bdc8970e65a141578ae8a3074ebd956f` — `executable` — `packages/card-dsl/src/cards/sfd/dauntless-vanguard.ts`
- **Doran's Blade** — `card.hash-a1ee07f71d453092ab7d54f9491684e972b735b22bb1f3fda73f2641bcedbfe1` — `executable` — `packages/card-dsl/src/cards/sfd/dorans-blade.ts`
- **Fury Rune** — `card.hash-30497c69657abd1d3abf17f9b3766e7d064817473a88828ca2ef4ab9b51f7902` — `no-ability` — `packages/card-dsl/src/cards/ogn/fury-rune.ts`
- **Grand Duelist** — `card.hash-ccfc067dad8a1bf92c6ae1aa5f7110e9d211a1842a9254bb9320705c2f96c6c4` — `executable` — `packages/card-dsl/src/cards/sfd/grand-duelist.ts`
- **Long Sword** — `card.hash-cab923a670e4baa826aa3de381c8b992bf33987fcb0d65feb75ca538a8681010` — `executable` — `packages/card-dsl/src/cards/sfd/long-sword.ts`
- **Mechanized Menace** — `card.hash-fadaa09c681d3d967954f99504cd9d3d749242dc99dbc40d60adfa60bf53cca7` — `executable` — `packages/card-dsl/src/cards/sfd/mechanized-menace.ts`
- **Mind Rune** — `card.hash-a8a4cb783649a0339782e2d3808d6144661c621634da7c9f79b4f87981fac97b` — `no-ability` — `packages/card-dsl/src/cards/ogn/mind-rune.ts`
- **Order Rune** — `card.hash-e0efe08be77e60ed68f2e43ba425b763efd364eb44b0c760d26ef1fcc1b6df67` — `no-ability` — `packages/card-dsl/src/cards/ogn/order-rune.ts`
- **Pit Rookie** — `card.hash-e2638655ff5ed3a1e60a501be3c23d74e46ef7f1900bed31b436f1a579b316ed` — `executable` — `packages/card-dsl/src/cards/ogn/pit-rookie.ts`
- **Production Surge** — `card.hash-1504d8f14af5ce1b9f7a3663c23e6ef7cb57d59a6274dc921cd9296ee8e2494b` — `executable` — `packages/card-dsl/src/cards/sfd/production-surge.ts`
- **Punch First** — `card.hash-8d49727ab9ae782b8a21802c9ae0b51e5d712a37a072d991629bfbf3645535b3` — `executable` — `packages/card-dsl/src/cards/sfd/punch-first.ts`
- **Riposte** — `card.hash-6e1bdc294002f23d867897b239a644801a07effca16fc07c31ab55c7f41ff26d` — `executable` — `packages/card-dsl/src/cards/sfd/riposte.ts`
- **Royal Guard** — `card.hash-0ba141b975db96cac65aab56bfd7dbb63904c538cc3d9c32bdfb3b2d98e486de` — `executable` — `packages/card-dsl/src/cards/sfd/royal-guard.ts`
- **Sacred Shears** — `card.hash-d3579e6825470471f5ce05c53533806a5244c5e84364fe57b2aab0b7cc0f14e0` — `executable` — `packages/card-dsl/src/cards/sfd/sacred-shears.ts`
- **Singularity** — `card.hash-10b7d5be25093a4d318efd8639b6e34583bad10bf38adbf93b4c3733ea54221b` — `executable` — `packages/card-dsl/src/cards/ogn/singularity.ts`
- **Stupefy** — `card.hash-5b08b5b8648e8c5c057d15279d1b4e677457eb0b43fcf2810e2ec4f4c4d1b7cf` — `executable` — `packages/card-dsl/src/cards/ogn/stupefy.ts`
- **Unsung Hero** — `card.hash-afc40c373a9fb4e48492323d7af26d3a58b824c385707dd3c269e97fee236103` — `executable` — `packages/card-dsl/src/cards/sfd/unsung-hero.ts`
- **Vengeance** — `card.hash-f67321dac096b3ad1e49b55231663e26f3f9d96efafe79d75719a6eb72fc5caa` — `executable` — `packages/card-dsl/src/cards/ogn/vengeance.ts`
- **Void Seeker** — `card.hash-600e0796e82099284b213e87b112b1c5df42777ef72b70a3b4cd49a84d27dd10` — `executable` — `packages/card-dsl/src/cards/ogn/void-seeker.ts`
- **Warmog's Armor** — `card.hash-902c6a1366a1a0e653ccb65102ff621b109af3b0b40f5bbeb7d8d3a5aeae2322` — `executable` — `packages/card-dsl/src/cards/sfd/warmogs-armor.ts`
- **Yone, Blademaster** — `card.hash-292f685c7578235f29f2c362a52c7975eafab592cc437e2445ca68309b294c56` — `executable` — `packages/card-dsl/src/cards/rad/yone-blademaster.ts`
