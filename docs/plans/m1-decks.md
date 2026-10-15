# RIFT-52: M1 可玩 1v1 预组卡组选型与原语清单

本文件选定 M1（"可玩 1v1"）使用的官方预组卡组，并给出它们所需的 EffectIR v2 原语清单，作为 M1 原语实现的优先目标。

- 规则口径：Core Rules v1.5（构筑规则 §103，编号引用以 v1.5 为准）。
- 原语口径：RIFT-9 调研 docs/plans/survey/ability-templates.json（base commit e2cbcdf），卡 → 模板/原语为 lexical 工程推断，不是执行权威。
- 卡数据来源：packages/card-data/data/deck-catalog.json（dataVersion 2026-10-12-official-gallery，digest sha256:53b9…d10），共 1381 个印刷、1080 个身份。
- 预组卡表来源：Riftbound 官方站点 playriftbound.com 产品/公告页（只取卡表，不复制其他内容）。逐卡 URL 见 JSON。
- 机器可读明细见同目录 m1-decks.json（schema riftbound.m1-precon-decks.v1）。

## 口径与"合法性"说明

v1.5 §103.3 要求主牌组"至少 40 张"（§103.3.b.1 规定 Chosen Champion 计入此数），§103.4 要求 12 张 Rune，§103.5.a 战场数量由玩法模式决定（1v1 为 3，§103.5.c 同名战场至多 1 张）。但本仓库现有校验器 apps/game-server/src/constructed-policy.ts（createConstructedRules + validateConstructedDeck）的口径是 mainDeck + champion 恰好 40 张、champion 区恰好 1 张——比 v1.5 的"至少 40"更严格。本任务的合法性结论均以该现有校验器为准（满足校验器 ⇒ 满足 v1.5 的下限）。所有推荐卡组在此口径下 valid: true、issues: 0（含 Domain Identity、Champion tag、Signature 限制、战场唯一、Rune 域、禁牌、印刷可得性检查）。

另外，官方冠军卡组是"ready-to-tweak"产品，其公布清单有意未配满 40 张（留出改动空位），并且给玩家 2–3 个 Chosen Champion 选项。因此每副都需要一个"定稿"步骤才能达到校验器要求的恰好 40 张；各副的定稿方式见下文与 JSON 的 finalAdjustment。所有补充/移除的卡都在该产品的域内、且都是该产品已含卡的身份。

## 1. 候选官方预组 / 入门卡组

下表是 M1 时间窗内已上市（非预览）的官方预组产品。卡表按官方产品页录入。

| 卡组 | 产品 | 套系 | Champion Legend（域） | 卡表来源 | 备注 |
| --- | --- | --- | --- | --- | --- |
| Rumble | Spiritforged Champion Preconstructed Deck | SFD | Mechanized Menace（Fury/Mind） | playriftbound.com/news/announcements/spiritforged-precons-fiora-rumble/ | 含官方 40 张主牌组（含冠军）、3 战场、12 符文 |
| Fiora | Spiritforged Champion Preconstructed Deck | SFD | Grand Duelist（Body/Order） | 同上 | 同上 |
| Vex | Unleashed Champion Deck | UNL | Gloomist（Calm/Chaos） | playriftbound.com/news/announcements/vi--vex-champion-decks/ | 官方清单 36 张主牌组 + 冠军选项（未配满 40） |
| Vi | Unleashed Champion Deck | UNL | Piltover Enforcer（Fury/Order） | 同上 | 官方清单 35 张主牌组 + 冠军选项（未配满 40） |

未列为候选的官方新手产品（说明用，不在本次选型范围）：

- Origins: Proving Grounds（OGS，Annie / Garen / Lux / Master Yi）：2–4 人教学入门盒。官方未公布逐卡卡表，无法做精确的原语映射与合法性校验。
- Origins: Champions Decks（OGN，Jinx / Viktor / Lee Sin）：官方只有产品公告，未公布逐卡卡表，无法映射。

（另有 2026-10-23 才上市的 Radiance 预览产品；截至本任务 as-of 2026-10-15 未生效，校验器按 previewNotReleased 处理，不纳入。）

## 2. 各候选的原语需求与卡数口径

按 RIFT-9 映射统计每副卡组全部身份的 requiredPrimitives 并集；judgeRequired 是该卡组中 RIFT-9 判定为 judge-required 的身份数；unclassified 是 RIFT-9 classification=unclassified 的身份数（映射缺口，需人工归类/规则裁定）。

| 卡组 | 身份数 | 所需原语数 | judge-required | 未归类 | 未归类卡 |
| --- | --- | --- | --- | --- | --- |
| Fiora (SFD) | 24 | 36 | 24 | 2 | Yone, Blademaster；Riposte |
| Rumble (SFD) | 23 | 42 | 23 | 0 | — |
| Vi (UNL) | 26 | 47 | 26 | 2 | Hextech Gauntlets；Tactical Retreat |
| Vex (UNL) | 26 | 51 | 26 | 1 | Gardens of Becoming |

judgeRequired 高是全卡池的共性（RIFT-9 基线 identityExecutionStatus 中 1071/1080 为 judge-required，当前可执行身份为 0），不是某副卡组的特有问题；它反映"尚需按官方证据实现/裁定"，而非"无法实现"。

## 3. 推荐

M1 推荐 2 副：Rumble（Fury/Mind）与 Fiora（Body/Order）。备选（若 M1 要 4 副）：再加 Vex（Calm/Chaos）与 Vi（Fury/Order）。

理由：

- 原语需求最少：Fiora 36、Rumble 42，显著低于 Vex 51、Vi 47。两副合计所需原语并集为 47 个，全部落在 RIFT-9 累积曲线的前 66 步内，且不需要曲线最末端的高级原语（effect.heal、effect.control、effect.win、replacement.prevent、continuous.suppress、trigger.delayed、effect.mill、effect.copy、continuous.deck、effect.xp、effect.banish、cost.xp、cost.discard、effect.score、effect.inspect、effect.reveal、cost.reveal 等）。
- judge-required / 未归类最少：Rumble 的未归类卡为 0；Fiora 仅 2 张未归类。Vex/Vi 的未归类卡与高级原语更多。
- 领域互不相同：Rumble = Fury/Mind，Fiora = Body/Order，覆盖四个不同领域，互为合法对手。
- 官方清单即 40 张：SFD 两副官方公布的就是 40 张主牌组（含冠军），只需把选定冠军移入 Champion 区即定稿，最贴近官方产品；UNL 两副官方清单只有 35–36 张，需额外补卡，不够"开箱即玩"。

若 M1 需要 4 副以供轮换/测试，加上 Vex（Calm/Chaos）与 Vi（Fury/Order）后四副两两领域仍互不相同，且原语并集上升到 62 个。

## 4. 推荐卡组：卡表、合法性、原语与缺口

### 4.1 Rumble（Fury/Mind）— 推荐定稿

- Champion Legend：Mechanized Menace（canonicalCardId card.hash-fadaa09c681d3d967954f99504cd9d3d749242dc99dbc40d60adfa60bf53cca7，printing sfd-181-221）。
- Chosen Champion：Rumble, Hotheaded（sfd-026-221），1 张入 Champion 区；主牌组保留其另 1 张。
- 完整逐卡清单（zone / canonicalCardId / 数量 / 卡名 / 域）见 m1-decks.json 的 candidates[rumble-sfd].recommendedCardList。合计：Legend 1 + Champion 1 + 主牌组 39 + 战场 3 + 符文 12。

合法性结论：通过（详见 §5）。

所需原语（42，按 RIFT-9 顺序）：

cost.printed, cost.activated, cost.pay, target.query, target.filter, target.location, effect.attach, condition.predicate, continuous.duration, continuous.might, continuous.timing, effect.damage, target.many, choice.mode, condition.value, cost.modify, effect.zone, effect.draw, trigger.play, trigger.state, trigger.combat, effect.ready, replacement.enter, condition.history, continuous.movement, cost.exhaust, target.tax, choice.optional, effect.exhaust, effect.play, effect.token, trigger.score, cost.hidden, cost.additional, trigger.leave, effect.repeat, effect.inspect, effect.recycle, effect.reveal, cost.recycle, choice.order, effect.order

缺口（需要新原语或规则裁定的卡）：无未归类卡；全部 23 个身份均为 judge-required 的 lexical-candidate，需按官方证据实现/裁定（这是 M1 的既定工作，不是本卡组的额外缺口）。

### 4.2 Fiora（Body/Order）— 推荐定稿

- Champion Legend：Grand Duelist（canonicalCardId card.hash-ccfc067dad8a1bf92c6ae1aa5f7110e9d211a1842a9254bb9320705c2f96c6c4，printing sfd-205-221）。
- Chosen Champion：Fiora, Peerless（sfd-110-221），1 张入 Champion 区；主牌组保留其另 1 张。
- 完整逐卡清单见 m1-decks.json 的 candidates[fiora-sfd].recommendedCardList。合计：Legend 1 + Champion 1 + 主牌组 39 + 战场 3 + 符文 12。

合法性结论：通过（详见 §5）。

所需原语（36，按 RIFT-9 顺序）：

cost.printed, cost.activated, cost.pay, target.query, target.filter, target.location, effect.attach, condition.predicate, continuous.duration, continuous.might, continuous.timing, effect.damage, target.many, choice.mode, condition.value, cost.modify, effect.zone, effect.draw, trigger.play, trigger.state, trigger.combat, effect.ready, replacement.enter, condition.history, choice.optional, effect.exhaust, effect.play, effect.token, trigger.score, effect.buff, effect.kill, cost.additional, trigger.leave, effect.channel, effect.counter, effect.detach

缺口（需要规则裁定/归类的卡）：

| 卡 | 类型 | RIFT-9 状态 | 阻断原因 |
| --- | --- | --- | --- |
| Yone, Blademaster | Unit | unclassified | non-reminder-printing-difference（不同印刷能力文本有非提示性差异，需裁定以哪个为准） |
| Riposte | Spell | unclassified | unmatched-functional-clause（存在未被模板覆盖的功能性子句，需人工归类/新原语） |

### 4.3 Vex（Calm/Chaos）— 备选

官方清单 36 张主牌组（未配满 40）。推荐定稿：Mutated Mouser / Existential Dread / Soul Sword 各补到 3 张，主牌组 39 + Champion 区 1 张选定冠军（Vex, Mocking）= 40。原语需求 51 个（含 trigger.delayed 等高级原语）；未归类卡 1 张（Gardens of Becoming，unmatched-functional-clause）。完整清单见 JSON。

### 4.4 Vi（Fury/Order）— 备选

官方清单 35 张主牌组（未配满 40）。推荐定稿：Vault Breaker / Loyal Poro / Square Up / Carrion Dredger 各补到 3 张，主牌组 39 + Champion 区 1 张选定冠军（Vi, Peacekeeper）= 40。原语需求 47 个；未归类卡 2 张（Hextech Gauntlets、Tactical Retreat，均 unmatched-functional-clause）。完整清单见 JSON。

## 5. 合法性校验证据

校验器：apps/game-server/src/constructed-policy.ts 的 createConstructedRules(catalog, "standard", { asOf: "2026-10-15" }) + validateConstructedDeck，读取 packages/card-data/data/deck-catalog.json，as-of 2026-10-15（Radiance previewNotReleased，未生效）。

复现脚本（只读，存于 /tmp/RIFT-52-m1-precon-decks/verify-final.mts）：读取 docs/plans/m1-decks.json 的 recommendedCardList，映射到标准印刷后逐副调用校验器。

命令与输出：

    $ apps/game-server/node_modules/.bin/tsx /tmp/RIFT-52-m1-precon-decks/verify-final.mts
    PASS rumble-sfd   | main+champ=40 | legend=1 champ=1 bf=3 runes=12 | issues=0
    PASS fiora-sfd    | main+champ=40 | legend=1 champ=1 bf=3 runes=12 | issues=0
    PASS vex-unl      | main+champ=40 | legend=1 champ=1 bf=3 runes=12 | issues=0
    PASS vi-unl       | main+champ=40 | legend=1 champ=1 bf=3 runes=12 | issues=0
    ALL-RECOMMENDED-VALID

四副推荐定稿均 valid: true 且 issues: 0（通过域、Champion tag、Signature、战场唯一、Rune 域、禁牌与印刷可得性检查）。完整输出存于 /tmp/RIFT-52-m1-precon-decks/verify-final-output.txt。

## 契约变更请求

无（本任务为只读调研，未改任何源码/契约；合法性通过现有校验器完成）。
