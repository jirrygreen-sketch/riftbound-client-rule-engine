# RIFT-43：rad / sfd 未归类身份逐卡结论

日期：2026-10-15；任务分支：`task/RIFT-43-triage-rad-sfd`。本报告只处理 RIFT-9 的 `classification: unclassified` 且主印刷号前缀为 `rad` 或 `sfd` 的身份。筛选结果为 **36 个身份**，每个 canonicalCardId 恰好一条。

## 依据与口径

- RIFT-9 输入：`docs/plans/survey/ability-templates.json`、`docs/plans/survey/ability-templates.md` 第 3、4、7 节；目录能力文本来自 `packages/card-data/data/deck-catalog.json`。
- 官方规则：Rules Hub 的 Core Rules，下载文件的元数据为 2026-10-09 更新、142 页；本机临时证据在 `/tmp/RIFT-43-triage-rad-sfd/rules-pdf-1.pdf`。2026-10-15 仍早于 Radiance patch notes 的 2026-10-16 生效日，因此文中把它标为 v1.5 待生效规则证据。
- 官方补充：Radiance Patch Notes（2026-10-09 发布，2026-10-16 生效）和 Radiance Errata（2026-10-09）。它们用于确认 Show Off、Restrictions、Empower、end-of-turn 文本以及 Neeko / Last Caress 的文字更新。
- 官方入口：Rules Hub（https://playriftbound.com/en-us/rules-hub/）；Core Rules PDF（https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf）；Radiance Patch Notes（https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/）；Radiance Errata（https://playriftbound.com/en-us/news/announcements/radiance-errata-updates）。
- `mappable` 表示现有 RIFT-9 模板/原语可以表达整张卡；`needs-new-primitive` 表示已有效果块可复用但缺一个不能安全近似的语义边界；`data-issue` 表示先修正目录文本；`judge-required` 只用于同一身份的印刷文本产生实质冲突、且现有官方资料没有给出统一裁决的情况。

## 汇总

| 结论 | 身份数 |
| --- | ---: |
| `mappable` | 20 |
| `needs-new-primitive` | 9 |
| `data-issue` | 5 |
| `judge-required` | 2 |

覆盖核对：`36/36`，无重复 `canonicalCardId`，四类合计 36。

### 建议新增原语（按目标卡数降序）

| 原语 | 当前目标卡数 | 目标卡 | 语义边界 | v1.5 依据 |
| --- | ---: | --- | --- | --- |
| `continuous.grant-ability` | 4 | `sfd-208-221`、`rad-139-167`、`rad-040-167`、`sfd-184-221` | 把完整的触发式或激活式能力附加给目标对象，保留来源、支付、触发、目标和持续时间；离开指定区域或持续期结束时移除。 | CR 1.5 135.4.b；CR 1.5 801.3.a |
| `choice.exclusive-once-per-turn` | 2 | `rad-179-167`、`rad-043-167` | 把多个模式分支绑定到同一回合历史收据，并限制每个分支在该回合最多被选择一次；换区或新回合按规则清理收据。 | CR 1.5 135.2.b.4；CR 1.5 303；CR 1.5 319 |
| `choice.hidden-guess` | 1 | `rad-064-167` | 让指定玩家在私密信息约束下声明一个卡类猜测，随后记录猜测并与公开揭示对象的特征比较，分流到匹配和不匹配效果。 | CR 1.5 128.3；CR 1.5 425；CR 1.5 135.2.b.7 |
| `continuous.hide-capacity` | 1 | `rad-108-167` | 在指定战场和持续期内改变 Facedown Zone 的可容纳卡数，并把额外容量归属于指定玩家或控制者。 | CR 1.5 107.3.b；CR 1.5 422.1；CR 1.5 422.2 |
| `deck.additional-legend-choice` | 1 | `rad-167-167` | 在构筑阶段记录至多三个名称互异的额外 Legend 选择，并把这些选择作为该套牌的持久 deck-build 决策。 | CR 1.5 103.1；CR 1.5 103.2.a |
| `effect.legend-zone-add` | 1 | `rad-167-167` | 从 Neeko 预先记录的额外 Legend 选择中选择一个，在 Neeko 位于场上期间把它加入 Legend Zone，并处理重复选择和离场清理。 | CR 1.5 103.1；CR 1.5 107.4；CR 1.5 124.1 |
| `effect.spend-buff` | 1 | `rad-043-167` | 把目标单位上的一个 Buff counter 作为支付/消耗，消费成功后才执行后续分支；不得把 Might 数值变化近似成消耗。 | CR 1.5 202；CR 1.5 203；CR 1.5 427.1 |
| `effect.swap-might` | 1 | `sfd-145-221` | 原子地读取两个单位当前 Might，并在指定持续期内交换两个值；必须保留两个目标身份，不能降级为两个独立设值效果。 | CR 1.5 137；CR 1.5 142；CR 1.5 303.1 |

这些复用数只统计本任务 36 个身份；预计复用关系：`continuous.grant-ability` 可复用于 `sfd-208-221`、`rad-139-167`、`rad-040-167`、`sfd-184-221`；`choice.exclusive-once-per-turn` 可复用于 `rad-179-167`、`rad-043-167`；`choice.hidden-guess` 可复用于 `rad-064-167`；`continuous.hide-capacity` 可复用于 `rad-108-167`；`deck.additional-legend-choice` 可复用于 `rad-167-167`；`effect.legend-zone-add` 可复用于 `rad-167-167`；`effect.spend-buff` 可复用于 `rad-043-167`；`effect.swap-might` 可复用于 `sfd-145-221`。

## 逐卡结论

### 1. `card.hash-0aa655446cb6202a49e06ffc288e4168bfbedf9b8c922547654f678c148c63d4` — sfd-011-221 · Angle Shot

- **主印刷号 / 卡名**：`sfd-011-221` / Angle Shot（Spell）；目录位置：`packages/card-data/data/deck-catalog.json:13014`。
- **能力摘要**：反应时选择同一操控者的单位与装备，二选一装上或拆下装备，然后抽一张。
- **RIFT-9 未归类原因**：`unmatched-functional-clause`。
- **结论与映射**：**mappable**；模板：`attach`、`detach`、`draw`、`filter`、`implicit-printed-cost`、`kw-reaction`、`mode`、`target`；原语：`choice.mode`、`continuous.timing`、`cost.printed`、`effect.attach`、`effect.detach`、`effect.draw`、`effect.zone`、`target.filter`、`target.location`、`target.query`。
- **判断理由**：RIFT-9 的 unmatched-functional-clause 只漏了“同一操控者”的联合目标约束；现有 target.filter/target.query 可表达关系，attach、detach、draw 均已有原语。
- **v1.5 / 官方依据**：`CR 1.5 135.2.b.4`、`CR 1.5 355`、`CR 1.5 716`、`CR 1.5 414`。

### 2. `card.hash-11c2deae61a7e5098515aef9a7b5595b0b6430fc0efebc22147404611ccebbc9` — sfd-025-221 · Rengar, Pouncing

- **主印刷号 / 卡名**：`sfd-025-221` / Rengar, Pouncing（Unit）；目录位置：`packages/card-data/data/deck-catalog.json:13359`。
- **能力摘要**：具备 Reaction 和 Assault 2，并允许在自己正在攻击的战场上打出。
- **RIFT-9 未归类原因**：`unmatched-functional-clause`。
- **结论与映射**：**mappable**；模板：`implicit-printed-cost`、`kw-assault`、`kw-reaction`、`location`；原语：`condition.predicate`、`continuous.duration`、`continuous.might`、`continuous.timing`、`cost.printed`、`target.location`、`target.query`。
- **判断理由**：RIFT-9 未识别的是打出地点限制；这是已有 target.location 加 continuous.restrict 的限制组合，不需要新动作语义。
- **v1.5 / 官方依据**：`CR 1.5 806`、`CR 1.5 807`、`CR 1.5 197`、`Radiance Patch Notes: Restrictions`。

### 3. `card.hash-14ade9eb01b57e1602425dda41e17e436ad9e8e9e597748e0d5d0fd42ac1cb66` — rad-007-167 · Rally for War

- **主印刷号 / 卡名**：`rad-007-167` / Rally for War（Gear）；目录位置：`packages/card-data/data/deck-catalog.json:8651`。
- **能力摘要**：选择一个有敌方单位占据的战场，并在那里放置三个 1 Might 的 Recruit 单位 Token。
- **RIFT-9 未归类原因**：`unmatched-functional-clause`。
- **结论与映射**：**mappable**；模板：`filter`、`implicit-printed-cost`、`location`、`many`、`target`、`token`；原语：`cost.printed`、`effect.token`、`effect.zone`、`target.filter`、`target.location`、`target.many`、`target.query`。
- **判断理由**：RIFT-9 未识别占据状态与敌方控制者的联合目标过滤；现有 target.filter、target.location、target.many 和 effect.token 足够。
- **v1.5 / 官方依据**：`CR 1.5 107.2`、`CR 1.5 135.2.b.4`、`CR 1.5 420`、`CR 1.5 123`。

### 4. `card.hash-265aafa041fadfb8711bb9cb71cfbe3b22843b0d19b59642dd156252990e13e0` — rad-143-167 · Iron Revenant

- **主印刷号 / 卡名**：`rad-143-167` / Iron Revenant（Legend）；目录位置：`packages/card-data/data/deck-catalog.json:11511`。
- **能力摘要**：反应式激活能力以放逐己方弃牌区的单位或装备并横置自身为成本，增加彩虹 Power，且该 Power 只能用于打出单位或装备。
- **RIFT-9 未归类原因**：`non-reminder-printing-difference`。 同身份印刷：`rad-170-167`。
- **结论与映射**：**judge-required**；模板：`activated`、`banish`、`cost-exhaust`、`filter`、`kw-add`、`kw-reaction`、`mode`、`resources`、`restrict`、`special-play`、`target`；原语：`choice.mode`、`condition.predicate`、`continuous.restrict`、`continuous.timing`、`cost.activated`、`cost.exhaust`、`cost.printed`、`effect.banish`、`effect.play`、`effect.resources`、`effect.zone`、`target.filter`、`target.query`。
- **判断理由**：同一 canonical identity 的两个印刷文本存在实质限制差异：rad-143-167 写明“仅用于”，rad-170-167 删除了 only。两种文本都能编译，但身份级数据尚未说明应按印刷号分别执行还是由官方勘误统一；不能替这两个语义选择一个。
- **v1.5 / 官方依据**：`CR 1.5 002`、`CR 1.5 054.2`、`CR 1.5 203`、`CR 1.5 428`、`CR 1.5 430`。

### 5. `card.hash-289ad4d681c7cb59dd55bae00863be7516f68dff172a97e886f4ff7920625b0c` — sfd-187-221 · Void Burrower

- **主印刷号 / 卡名**：`sfd-187-221` / Void Burrower（Legend）；目录位置：`packages/card-data/data/deck-catalog.json:17636`。
- **能力摘要**：征服时可横置自身，查看牌库顶两张，选择一张打出并回收其余；另一个印刷还写明先放逐所选牌。
- **RIFT-9 未归类原因**：`non-reminder-printing-difference`。 同身份印刷：`sfd-243-221`。
- **结论与映射**：**judge-required**；模板：`exhaust`、`optional`、`recycle`、`reveal`、`special-play`、`trigger-score`、`trigger-state`；原语：`choice.optional`、`continuous.timing`、`cost.printed`、`effect.exhaust`、`effect.play`、`effect.recycle`、`effect.reveal`、`effect.zone`、`target.query`、`trigger.score`、`trigger.state`。
- **判断理由**：同一 identity 的 sfd-187-221 是“play one”，sfd-243-221 是“banish one, then play it”。这改变对象先进入放逐区还是直接打出的区域路径，影响触发、可见性和来源；没有找到官方 Radiance 勘误替两种旧印刷做统一解释。
- **v1.5 / 官方依据**：`CR 1.5 002`、`CR 1.5 055`、`CR 1.5 420`、`CR 1.5 417`、`CR 1.5 428`。

### 6. `card.hash-292f685c7578235f29f2c362a52c7975eafab592cc437e2445ca68309b294c56` — rad-181-167 · Yone, Blademaster

- **主印刷号 / 卡名**：`rad-181-167` / Yone, Blademaster（Unit）；目录位置：`packages/card-data/data/deck-catalog.json:12313`。
- **能力摘要**：征服原先未被控制的战场时，按自身 Might 对基地中的敌方单位造成伤害；后续印刷把 uncontrolled 改成 open 并补充 Weaponmaster 提醒。
- **RIFT-9 未归类原因**：`non-reminder-printing-difference`。 同身份印刷：`sfd-116-221`、`sfd-233-221`、`sfd-233-star-221`。
- **结论与映射**：**mappable**；模板：`damage`、`filter`、`implicit-printed-cost`、`kw-weaponmaster`、`location`、`target`、`trigger-score`、`trigger-state`、`value`；原语：`choice.optional`、`condition.value`、`cost.modify`、`cost.printed`、`effect.attach`、`effect.damage`、`target.filter`、`target.location`、`target.query`、`trigger.play`、`trigger.score`、`trigger.state`。
- **判断理由**：RIFT-9 的 printing difference 属于可解释的措辞/提醒差异：open 对应未控制的战场，Weaponmaster 提醒文本由关键词规则提供；触发、动态 Might 和基地目标已有原语。
- **v1.5 / 官方依据**：`CR 1.5 107.2`、`CR 1.5 418`、`CR 1.5 821`、`CR 1.5 206`。

### 7. `card.hash-322879459664911876c55f40be8e59ed07ad8e5c3f1a7cc3b296600b3a4b87a6` — rad-033-167 · Command: Attack

- **主印刷号 / 卡名**：`rad-033-167` / Command: Attack（Gear）；目录位置：`packages/card-data/data/deck-catalog.json:9173`。
- **能力摘要**：二选一：把带 Deploy 的友方装备移到战场，或查看牌库顶五张并可揭示其中一件装备来抽取，回收其余。
- **RIFT-9 未归类原因**：`unmatched-functional-clause`。
- **结论与映射**：**mappable**；模板：`draw`、`filter`、`implicit-printed-cost`、`inspect`、`kw-deploy`、`location`、`mode`、`move`、`optional`、`recycle`、`reveal`、`target`；原语：`choice.mode`、`choice.optional`、`continuous.location`、`cost.printed`、`effect.draw`、`effect.inspect`、`effect.move`、`effect.recycle`、`effect.reveal`、`effect.zone`、`target.filter`、`target.location`、`target.query`。
- **判断理由**：RIFT-9 只把 Choose one 模态头漏掉了；两条分支分别使用 move 或 inspect/reveal/draw/recycle，均有现成模板与原语。
- **v1.5 / 官方依据**：`CR 1.5 135.2.b.4`、`CR 1.5 830`、`CR 1.5 421`、`CR 1.5 425`、`CR 1.5 417`。

### 8. `card.hash-3812004b1ace905a5750f12683fd2ae066128769b8d39d3a460ea8a2bce04b99` — rad-152-167 · Encore

- **主印刷号 / 卡名**：`rad-152-167` / Encore（Spell）；目录位置：`packages/card-data/data/deck-catalog.json:11702`。
- **能力摘要**：四个效果中选择两个：造成伤害、放 Recruit Token、给最多两个单位临时加 Might，或查看顶两张后抽一张并回收另一张。
- **RIFT-9 未归类原因**：`unmatched-functional-clause`。
- **结论与映射**：**mappable**；模板：`damage`、`draw`、`duration`、`filter`、`implicit-printed-cost`、`inspect`、`many`、`might`、`mode`、`recycle`、`target`、`token`；原语：`choice.mode`、`continuous.duration`、`continuous.might`、`cost.printed`、`effect.damage`、`effect.draw`、`effect.inspect`、`effect.recycle`、`effect.token`、`effect.zone`、`target.filter`、`target.location`、`target.many`、`target.query`。
- **判断理由**：RIFT-9 未识别 Choose two，但 choice.mode/target.many 及四条效果原语已经覆盖多选和分支执行。
- **v1.5 / 官方依据**：`CR 1.5 135.2.b.4`、`CR 1.5 355`、`CR 1.5 418`、`CR 1.5 417`。

### 9. `card.hash-3f356b3b6d2a071862d185320450d863f378794fba0b10d4731b81a16bd21498` — sfd-208-221 · Forge of the Fluft

- **主印刷号 / 卡名**：`sfd-208-221` / Forge of the Fluft（Battlefield）；目录位置：`packages/card-data/data/deck-catalog.json:18127`。
- **能力摘要**：控制该战场期间，友方 Legends 获得一个横置装备并把它附着到友方单位的激活能力。
- **RIFT-9 未归类原因**：`unmatched-functional-clause`。
- **结论与映射**：**needs-new-primitive**；模板：`activated`、`attach`、`condition`、`cost-exhaust`、`filter`、`location`、`target`；原语：`condition.predicate`、`cost.activated`、`cost.exhaust`、`effect.attach`、`target.filter`、`target.location`、`target.query`。新原语：`continuous.grant-ability`。
- **判断理由**：RIFT-9 的 unmatched-functional-clause 是引号中的整段激活能力未被解析；现有 attach/cost/target 只能表达能力内容，缺少把完整激活能力授予一组对象的边界与来源。
- **新原语说明**：`continuous.grant-ability`：把完整的触发式或激活式能力附加给目标对象，保留来源、支付、触发、目标和持续时间；离开指定区域或持续期结束时移除。 预计复用 `sfd-208-221`、`rad-139-167`、`rad-040-167`、`sfd-184-221`。
- **v1.5 / 官方依据**：`CR 1.5 135.4.b`、`CR 1.5 145`、`CR 1.5 716`、`CR 1.5 801.3.a`。

### 10. `card.hash-415c30a2e32abfc05fc5c11072550f7685facb794af8fa368be192daa3dfd580` — rad-056-167 · Improvised Projectile

- **主印刷号 / 卡名**：`rad-056-167` / Improvised Projectile（Gear）；目录位置：`packages/card-data/data/deck-catalog.json:9617`。
- **能力摘要**：选择友方装备，再按该装备的 Energy 费用对一个战场上的单位造成等量伤害。
- **RIFT-9 未归类原因**：`unmatched-functional-clause`。
- **结论与映射**：**mappable**；模板：`damage`、`filter`、`implicit-printed-cost`、`kw-action`、`location`、`target`、`value`；原语：`condition.value`、`continuous.timing`、`cost.printed`、`effect.damage`、`target.filter`、`target.location`、`target.query`。
- **判断理由**：RIFT-9 漏掉了“选择友方装备”这一中间对象；现有 target.filter/query 与 condition.value 可先绑定装备，再读取其印刷 Energy。
- **v1.5 / 官方依据**：`CR 1.5 206`、`CR 1.5 418`、`CR 1.5 355`。

### 11. `card.hash-51aab7c27d79de8598bf1c63fd69200050369183a2f0e0d05edba616e72283a2` — rad-114-167 · Riven, Deserter

- **主印刷号 / 卡名**：`rad-114-167` / Riven, Deserter（Unit）；目录位置：`packages/card-data/data/deck-catalog.json:10859`。
- **能力摘要**：另一名友方单位横置时本回合获得 +1 Might；另有每回合一次的横置友方单位换取 ready 的激活能力。
- **RIFT-9 未归类原因**：`non-reminder-printing-difference`。 同身份印刷：`rad-114a-167`。
- **结论与映射**：**mappable**；模板：`activated`、`duration`、`exhaust`、`filter`、`history`、`implicit-printed-cost`、`many`、`might`、`ready`、`restrict`、`target`、`trigger-state`；原语：`condition.history`、`condition.predicate`、`continuous.duration`、`continuous.might`、`continuous.restrict`、`cost.activated`、`cost.printed`、`effect.exhaust`、`effect.ready`、`target.filter`、`target.many`、`target.query`、`trigger.state`。
- **判断理由**：RIFT-9 的 non-reminder-printing-difference 是 becomes/is exhausted 措辞差异；事件触发、临时 Buff、一次/回合历史和激活成本都有现成原语。
- **v1.5 / 官方依据**：`CR 1.5 145`、`CR 1.5 376`、`CR 1.5 415`、`CR 1.5 416`、`CR 1.5 427`、`CR 1.5 303`。

### 12. `card.hash-6249df4367d0a2e088c8eb1117ef59430f0d7dad4bf0fcf8a01d7f0415f4d511` — sfd-t03 · Gold

- **主印刷号 / 卡名**：`sfd-t03` / Gold（Gear）；目录位置：`packages/card-data/data/deck-catalog.json:19411`。
- **能力摘要**：以摧毁自身并横置为成本，反应式增加一个彩虹 Power；另一印刷补出 Reaction 与 [>] 标记。
- **RIFT-9 未归类原因**：`non-reminder-printing-difference`。 同身份印刷：`unl-t05`。
- **结论与映射**：**mappable**；模板：`activated`、`cost-exhaust`、`cost-sacrifice`、`implicit-printed-cost`、`kill`、`kw-add`、`kw-reaction`、`resources`；原语：`continuous.timing`、`cost.activated`、`cost.exhaust`、`cost.printed`、`cost.sacrifice`、`effect.kill`、`effect.resources`、`effect.zone`、`target.query`。
- **判断理由**：RIFT-9 记录的是 [>] 与 Reaction 的印刷格式差异；Core Rules 已规定 [>] 只是把关键词关联到后续能力，cost.sacrifice/cost.exhaust/effect.resources 已足够。
- **v1.5 / 官方依据**：`CR 1.5 135.2.d.3`、`CR 1.5 135.2.e.7`、`CR 1.5 203`、`CR 1.5 430`。

### 13. `card.hash-6e1bdc294002f23d867897b239a644801a07effca16fc07c31ab55c7f41ff26d` — sfd-206-221 · Riposte

- **主印刷号 / 卡名**：`sfd-206-221` / Riposte（Spell）；目录位置：`packages/card-data/data/deck-catalog.json:18087`。
- **能力摘要**：选择友方单位和一个法术，反制该法术，并让所选单位本回合获得等于该法术 Energy 费用的 Might。
- **RIFT-9 未归类原因**：`unmatched-functional-clause`。
- **结论与映射**：**mappable**；模板：`counter`、`duration`、`filter`、`implicit-printed-cost`、`kw-reaction`、`might`、`target`、`value`；原语：`condition.value`、`continuous.duration`、`continuous.might`、`continuous.timing`、`cost.printed`、`effect.counter`、`target.filter`、`target.query`。
- **判断理由**：RIFT-9 漏掉的是联合目标约束；counter 已有规则与原语，法术印刷费用读取由 condition.value/CR 206 覆盖。
- **v1.5 / 官方依据**：`CR 1.5 206`、`CR 1.5 426`、`CR 1.5 355`、`CR 1.5 427`。

### 14. `card.hash-7665f836ecbe39043d8dd42f110ad82560fe857373dbf87d7348d347e764617c` — sfd-114-221 · Marching Orders

- **主印刷号 / 卡名**：`sfd-114-221` / Marching Orders（Spell）；目录位置：`packages/card-data/data/deck-catalog.json:15720`。
- **能力摘要**：可支付额外费用来重复效果；选择任意位置的友方单位与战场上的敌方单位，让双方按各自 Might 互相造成伤害。
- **RIFT-9 未归类原因**：`unmatched-functional-clause`。
- **结论与映射**：**mappable**；模板：`damage`、`filter`、`implicit-printed-cost`、`kw-action`、`kw-repeat`、`location`、`many`、`repeat`、`target`、`value`；原语：`choice.mode`、`choice.optional`、`condition.value`、`continuous.timing`、`cost.additional`、`cost.pay`、`cost.printed`、`effect.damage`、`effect.repeat`、`target.filter`、`target.location`、`target.many`、`target.query`。
- **判断理由**：RIFT-9 未识别长联合目标句；Repeat 的额外费用和重选规则、两目标动态 Might 伤害均已有原语。
- **v1.5 / 官方依据**：`CR 1.5 820`、`CR 1.5 355`、`CR 1.5 418`、`CR 1.5 206`。

### 15. `card.hash-7dc2f2b5203681ffa7df7153d6be71e334c6fc0a355cb23adba138c9dd72e338` — rad-108-167 · Bushwhack Trap

- **主印刷号 / 卡名**：`rad-108-167` / Bushwhack Trap（Unit）；目录位置：`packages/card-data/data/deck-catalog.json:10683`。
- **能力摘要**：Deploy 装备在对手于此战场 Hold 时摧毁自身；控制此地期间，该玩家可在此额外隐藏一张牌。
- **RIFT-9 未归类原因**：`unmatched-functional-clause`。
- **结论与映射**：**needs-new-primitive**；模板：`condition`、`filter`、`implicit-printed-cost`、`kw-deploy`、`location`、`mode`、`optional`、`player`；原语：`choice.mode`、`choice.optional`、`condition.predicate`、`continuous.location`、`cost.printed`、`target.filter`、`target.location`、`target.player`、`target.query`。新原语：`continuous.hide-capacity`。
- **判断理由**：Deploy 触发和隐藏动作本身已有规则；缺口是修改 Facedown Zone 的最大占位数并把额外容量绑定到指定玩家，不能用 cost.hidden 近似。
- **新原语说明**：`continuous.hide-capacity`：在指定战场和持续期内改变 Facedown Zone 的可容纳卡数，并把额外容量归属于指定玩家或控制者。 预计复用 `rad-108-167`。
- **v1.5 / 官方依据**：`CR 1.5 830`、`CR 1.5 107.3.b`、`CR 1.5 422.1`、`CR 1.5 422.2`。

### 16. `card.hash-886b8c03b5b72474abc834112983d7b6adab55b1a3525aeddd44a39898736bb3` — rad-158-167 · Black Market

- **主印刷号 / 卡名**：`rad-158-167` / Black Market（Battlefield）；目录位置：`packages/card-data/data/deck-catalog.json:11837`。
- **能力摘要**：支付两个彩虹 Power 抽一张；每名玩家在自己的回合最多使用一次，即使不控制该战场。
- **RIFT-9 未归类原因**：`unmatched-functional-clause`。
- **结论与映射**：**mappable**；模板：`activated`、`draw`、`history`、`many`、`optional`、`player`；原语：`choice.optional`、`condition.history`、`cost.activated`、`effect.draw`、`effect.zone`、`target.many`、`target.player`、`target.query`。
- **判断理由**：RIFT-9 漏掉的是按玩家分域的使用次数条件；condition.history、target.player 和激活能力原语可以记录“每名玩家/每回合”，无需新的效果动作。
- **v1.5 / 官方依据**：`CR 1.5 145`、`CR 1.5 376`、`CR 1.5 303`、`CR 1.5 414`。

### 17. `card.hash-88b2b6a8fd884959d1de40824d4d5035cc609570087e598ecc6e808b8b3cc790` — rad-117-167 · For Demacia!

- **主印刷号 / 卡名**：`rad-117-167` / For Demacia!（Spell）；目录位置：`packages/card-data/data/deck-catalog.json:10946`。
- **能力摘要**：选择一个战场，本回合该处的友方单位获得 Shield 2；Shield 的防守增益由关键词规则提供。
- **RIFT-9 未归类原因**：`unmatched-functional-clause`。
- **结论与映射**：**mappable**；模板：`duration`、`filter`、`implicit-printed-cost`、`kw-reaction`、`kw-shield`、`location`、`target`；原语：`condition.predicate`、`continuous.duration`、`continuous.might`、`continuous.timing`、`cost.printed`、`target.filter`、`target.location`、`target.query`。
- **判断理由**：RIFT-9 未识别普通目标句；continuous.keyword 已作为现有原语保留，Shield 关键词、临时持续时间和地点目标可组合表达。
- **v1.5 / 官方依据**：`CR 1.5 814`、`CR 1.5 801.3.a`、`CR 1.5 355`、`CR 1.5 319`。

### 18. `card.hash-8ad41dd9ba742358d12656164c456e4f9cc43b4712fcb9c9f120661d5c208fac` — sfd-217-221 · Seat of Power

- **主印刷号 / 卡名**：`sfd-217-221` / Seat of Power（Battlefield）；目录位置：`packages/card-data/data/deck-catalog.json:18307`。
- **能力摘要**：征服此处时，按你或盟友控制的其他战场数量抽牌。
- **RIFT-9 未归类原因**：`unmatched-functional-clause`。
- **结论与映射**：**data-issue**；模板：`draw`、`filter`、`location`、`many`、`mode`、`trigger-score`、`trigger-state`、`value`；原语：`choice.mode`、`condition.value`、`effect.draw`、`effect.zone`、`target.filter`、`target.location`、`target.many`、`target.query`、`trigger.score`、`trigger.state`。
- **判断理由**：RIFT-9 的 unmatched-functional-clause 实际只命中了目录末尾的孤立句点；deck-catalog.json:18307 的文本有多余终止标点（control..），应清理为单个句点后按现有 count/filter/draw 路线实现。
- **v1.5 / 官方依据**：`CR 1.5 135.2.d.3`、`CR 1.5 414`、`CR 1.5 323.1`。

### 19. `card.hash-8beb5aeeb976500ce49a3d84121eaee83cbcc32357ee206dfdb2aefdcb2439f7` — rad-167-167 · Neeko, Blending In

- **主印刷号 / 卡名**：`rad-167-167` / Neeko, Blending In（Unit）；目录位置：`packages/card-data/data/deck-catalog.json:12023`。
- **能力摘要**：构筑时额外选择最多三个名称互异的 Legends；Neeko 在场上时，从这些选择中加入一个到 Legend Zone。
- **RIFT-9 未归类原因**：`unmatched-functional-clause`。
- **结论与映射**：**data-issue**；模板：`condition`、`duration`、`filter`、`implicit-printed-cost`、`kw-add`、`mode`、`target`、`trigger-play`、`trigger-state`；原语：`choice.mode`、`condition.predicate`、`continuous.duration`、`cost.printed`、`effect.resources`、`target.filter`、`target.query`、`trigger.play`、`trigger.state`。新原语：`deck.additional-legend-choice`、`effect.legend-zone-add`。
- **判断理由**：目录主印刷仍写“choose 3”，但 Radiance Errata 的 NEW TEXT 已改为“choose up to 3”；这是明确的官方文字陈旧问题。修正文本后仍需要构筑阶段选择和 Legend Zone 加入两个新边界。
- **新原语说明**：`deck.additional-legend-choice`：在构筑阶段记录至多三个名称互异的额外 Legend 选择，并把这些选择作为该套牌的持久 deck-build 决策。 预计复用 `rad-167-167`。
- **新原语说明**：`effect.legend-zone-add`：从 Neeko 预先记录的额外 Legend 选择中选择一个，在 Neeko 位于场上期间把它加入 Legend Zone，并处理重复选择和离场清理。 预计复用 `rad-167-167`。
- **v1.5 / 官方依据**：`CR 1.5 103.1`、`CR 1.5 103.2.a`、`CR 1.5 107.4`、`Radiance Errata (2026-10-09): Neeko, Blending In`。

### 20. `card.hash-8e991cc75af9556291dd53b72f5d4d31cf399f8ee8e457c8eb20631bc18ff2d1` — rad-179-167 · Aphelios, Exalted

- **主印刷号 / 卡名**：`rad-179-167` / Aphelios, Exalted（Unit）；目录位置：`packages/card-data/data/deck-catalog.json:12260`。
- **能力摘要**：附着装备于自身时，选择本回合尚未选过的分支：ready 两个符文、横置 channel 一个符文，或给友方单位加 Buff。
- **RIFT-9 未归类原因**：`non-reminder-printing-difference`。 同身份印刷：`sfd-049-221`、`sfd-224-221`、`sfd-224-star-221`。
- **结论与映射**：**needs-new-primitive**；模板：`attach`、`buff`、`channel`、`duration`、`exhaust`、`filter`、`implicit-printed-cost`、`kw-buff`、`mode`、`ready`、`target`、`trigger-state`；原语：`choice.mode`、`condition.predicate`、`continuous.duration`、`continuous.might`、`cost.printed`、`effect.attach`、`effect.buff`、`effect.channel`、`effect.exhaust`、`effect.ready`、`effect.zone`、`target.filter`、`target.location`、`target.query`、`trigger.state`。新原语：`choice.exclusive-once-per-turn`。
- **判断理由**：RIFT-9 仅因多印刷文本差异进入未归类，但整卡真正的实现缺口是“每个分支本回合只能选一次”的选择收据；普通 choice.mode 不能安全代替历史绑定。
- **新原语说明**：`choice.exclusive-once-per-turn`：把多个模式分支绑定到同一回合历史收据，并限制每个分支在该回合最多被选择一次；换区或新回合按规则清理收据。 预计复用 `rad-179-167`、`rad-043-167`。
- **v1.5 / 官方依据**：`CR 1.5 135.2.b.4`、`CR 1.5 303`、`CR 1.5 319`、`CR 1.5 416`、`CR 1.5 431`、`CR 1.5 427`。

### 21. `card.hash-92a8f107905f2dafc89ae0242541a797fd2b39c572e28a280cde2e6ef343444f` — rad-043-167 · Riven, Broken Blade

- **主印刷号 / 卡名**：`rad-043-167` / Riven, Broken Blade（Unit）；目录位置：`packages/card-data/data/deck-catalog.json:9362`。
- **能力摘要**：自身横置时从三个本回合未选分支中选一项：获得 Buff、消耗 Buff 使敌方单位 Stun，或消耗 Buff ready 自身。
- **RIFT-9 未归类原因**：`non-reminder-printing-difference`。 同身份印刷：`rad-043a-167`。
- **结论与映射**：**needs-new-primitive**；模板：`buff`、`duration`、`exhaust`、`filter`、`implicit-printed-cost`、`kw-buff`、`kw-stun`、`mode`、`ready`、`stun`、`target`、`trigger-state`；原语：`choice.mode`、`condition.predicate`、`continuous.combat`、`continuous.duration`、`continuous.might`、`cost.printed`、`effect.buff`、`effect.exhaust`、`effect.ready`、`effect.stun`、`target.filter`、`target.query`、`trigger.state`。新原语：`choice.exclusive-once-per-turn`、`effect.spend-buff`。
- **判断理由**：现有 stun/ready/buff 可表达结果，但缺少两个不可替代的语义：分支级“本回合未选过”记录，以及把 Buff counter 作为支付并消费。不能把 spend buff 降成普通 Might 修改。
- **新原语说明**：`choice.exclusive-once-per-turn`：把多个模式分支绑定到同一回合历史收据，并限制每个分支在该回合最多被选择一次；换区或新回合按规则清理收据。 预计复用 `rad-179-167`、`rad-043-167`。
- **新原语说明**：`effect.spend-buff`：把目标单位上的一个 Buff counter 作为支付/消耗，消费成功后才执行后续分支；不得把 Might 数值变化近似成消耗。 预计复用 `rad-043-167`。
- **v1.5 / 官方依据**：`CR 1.5 202`、`CR 1.5 203`、`CR 1.5 303`、`CR 1.5 424`、`CR 1.5 416`、`CR 1.5 427`。

### 22. `card.hash-956993968d114577bbdd0afa0d90d3d311a8e7b76415282b08d0cf69194c7dbf` — sfd-197-221 · Emperor of the Sands

- **主印刷号 / 卡名**：`sfd-197-221` / Emperor of the Sands（Legend）；目录位置：`packages/card-data/data/deck-catalog.json:17875`。
- **能力摘要**：让所打出的 Sand Soldier 具有 Weaponmaster；若本回合打出过装备，可支付 Energy 并横置来在基地生成一个 Sand Soldier Token。
- **RIFT-9 未归类原因**：`non-reminder-printing-difference`。 同身份印刷：`sfd-247-221`。
- **结论与映射**：**mappable**；模板：`activated`、`condition`、`cost-exhaust`、`duration`、`filter`、`history`、`kw-weaponmaster`、`location`、`restrict`、`token`、`value`；原语：`choice.optional`、`condition.history`、`condition.predicate`、`condition.value`、`continuous.duration`、`continuous.restrict`、`cost.activated`、`cost.exhaust`、`cost.modify`、`cost.printed`、`effect.attach`、`effect.token`、`effect.zone`、`target.filter`、`target.location`、`target.query`、`trigger.play`。
- **判断理由**：RIFT-9 的两个印刷把“Your Sand Soldiers”改成“Sand Soldiers you play”，都能由 continuous.keyword 加 trigger/history 表达；差异需保留在 printing 文本而不是猜测成新效果。
- **v1.5 / 官方依据**：`CR 1.5 801.3.a`、`CR 1.5 821`、`CR 1.5 145`、`CR 1.5 303`、`CR 1.5 123`。

### 23. `card.hash-9dec9472d1f77a1c3d9249566ca3fa89140e7b6a4efcb6fe375c4fab210d2e87` — rad-063-167 · Kai'Sa, Rebel

- **主印刷号 / 卡名**：`rad-063-167` / Kai'Sa, Rebel（Unit）；目录位置：`packages/card-data/data/deck-catalog.json:9799`。
- **能力摘要**：攻击时给同战场敌方单位 -1 Might；在 Showdown 中，你的法术获得 Reaction。
- **RIFT-9 未归类原因**：`non-reminder-printing-difference, printing-stat-type-or-tag-difference`。 同身份印刷：`rad-sp4-005`。
- **结论与映射**：**mappable**；模板：`condition`、`duration`、`filter`、`implicit-printed-cost`、`kw-disarm`、`kw-reaction`；原语：`condition.predicate`、`continuous.duration`、`continuous.might`、`continuous.timing`、`cost.printed`、`target.filter`、`target.query`、`trigger.combat`。
- **判断理由**：RIFT-9 的非提醒差异是 Disarm 解释文本和替代印刷的 Might 变化；Disarm 与 Reaction 的关键词规则、战斗触发和临时 Might 已覆盖。
- **v1.5 / 官方依据**：`CR 1.5 831`、`CR 1.5 813`、`CR 1.5 316.8`、`CR 1.5 427`。

### 24. `card.hash-ad1eab15fd49b5de8236cadaa8e7c053d23218fb204a265a51a5ae2311445f11` — rad-139-167 · Boy Who Shattered Time

- **主印刷号 / 卡名**：`rad-139-167` / Boy Who Shattered Time（Legend）；目录位置：`packages/card-data/data/deck-catalog.json:11416`。
- **能力摘要**：Empower 付 Energy 并横置；Disempower 后，下一名本回合打出的单位减费并获得本回合结束时摧毁自身的文本。
- **RIFT-9 未归类原因**：`unmatched-functional-clause`。 同身份印刷：`rad-168-167`。
- **结论与映射**：**needs-new-primitive**；模板：`activated`、`cost-exhaust`、`cost-modify`、`duration`、`empower`、`filter`、`kill`、`kw-empower`、`trigger-phase`；原语：`condition.predicate`、`condition.value`、`continuous.duration`、`cost.activated`、`cost.exhaust`、`cost.modify`、`cost.pay`、`cost.printed`、`effect.empower`、`effect.kill`、`effect.zone`、`target.filter`、`target.query`、`trigger.phase`。新原语：`continuous.grant-ability`。
- **判断理由**：Empower、减费和阶段触发已有原语；缺口是把带来源关联的“本回合结束时 Kill me”完整触发能力临时附加给下一名单位。Radiance patch notes 已明确该文本按本回合结束处理，不能用永久 kill 标记替代。
- **新原语说明**：`continuous.grant-ability`：把完整的触发式或激活式能力附加给目标对象，保留来源、支付、触发、目标和持续时间；离开指定区域或持续期结束时移除。 预计复用 `sfd-208-221`、`rad-139-167`、`rad-040-167`、`sfd-184-221`。
- **v1.5 / 官方依据**：`CR 1.5 827`、`CR 1.5 206`、`CR 1.5 317`、`CR 1.5 801.3.a`、`Radiance Patch Notes: Ekko / end-of-turn ruling`。

### 25. `card.hash-b08afbe6dc630f67287c7ab652b90f17c81abfd9d7f94bda47eae324899ce111` — rad-064-167 · Scrutinizing Scope

- **主印刷号 / 卡名**：`rad-064-167` / Scrutinizing Scope（Spell）；目录位置：`packages/card-data/data/deck-catalog.json:9819`。
- **能力摘要**：激活时选择对手，由对手猜牌类；揭示牌库顶牌，猜中则回收，猜错则抽走。
- **RIFT-9 未归类原因**：`unmatched-functional-clause`。
- **结论与映射**：**needs-new-primitive**；模板：`activated`、`condition`、`cost-exhaust`、`draw`、`implicit-printed-cost`、`player`、`recycle`、`reveal`、`target`；原语：`condition.predicate`、`cost.activated`、`cost.exhaust`、`cost.printed`、`effect.draw`、`effect.recycle`、`effect.reveal`、`effect.zone`、`target.player`、`target.query`。新原语：`choice.hidden-guess`。
- **判断理由**：已有 reveal、draw、recycle 和条件分支，但缺少对手作出的私密/声明式卡类猜测及其与揭示对象比较的收据；不能把猜测伪装成普通 choice.mode。
- **新原语说明**：`choice.hidden-guess`：让指定玩家在私密信息约束下声明一个卡类猜测，随后记录猜测并与公开揭示对象的特征比较，分流到匹配和不匹配效果。 预计复用 `rad-064-167`。
- **v1.5 / 官方依据**：`CR 1.5 128.3`、`CR 1.5 414`、`CR 1.5 417`、`CR 1.5 425`、`CR 1.5 135.2.b.7`。

### 26. `card.hash-b104ab4f2d5ede379d04e1002cd97a70d95148d73cddde15852f5dce8b204e9e` — sfd-077-221 · Rocket Barrage

- **主印刷号 / 卡名**：`sfd-077-221` / Rocket Barrage（Spell）；目录位置：`packages/card-data/data/deck-catalog.json:14721`。
- **能力摘要**：可支付额外 Energy 与 Mind Power 重复此法术效果；二选一造成 4 伤害或摧毁装备。
- **RIFT-9 未归类原因**：`unmatched-functional-clause`。
- **结论与映射**：**mappable**；模板：`activated`、`damage`、`filter`、`implicit-printed-cost`、`kill`、`kw-repeat`、`location`、`mode`、`repeat`、`target`、`value`；原语：`choice.mode`、`choice.optional`、`condition.value`、`cost.activated`、`cost.additional`、`cost.pay`、`cost.printed`、`effect.damage`、`effect.kill`、`effect.repeat`、`effect.zone`、`target.filter`、`target.location`、`target.query`。
- **判断理由**：RIFT-9 只漏了 Choose one；Repeat 的额外成本、重选规则、伤害和 Kill 均已有模板与原语。
- **v1.5 / 官方依据**：`CR 1.5 820`、`CR 1.5 355`、`CR 1.5 418`、`CR 1.5 429`。

### 27. `card.hash-b955ee21fd32d4a00aae0761a6d7f8f66eb03094edf676a34c3e87639045aae1` — rad-040-167 · Heartening Soul

- **主印刷号 / 卡名**：`rad-040-167` / Heartening Soul（Unit）；目录位置：`packages/card-data/data/deck-catalog.json:9319`。
- **能力摘要**：打出时 ready 一个友方 Legend；友方 Legends 获得横置后给单位 +3 Might 的激活能力。
- **RIFT-9 未归类原因**：`unmatched-functional-clause`。
- **结论与映射**：**needs-new-primitive**；模板：`activated`、`cost-exhaust`、`duration`、`filter`、`implicit-printed-cost`、`might`、`ready`、`target`、`trigger-play`、`trigger-state`；原语：`continuous.duration`、`continuous.might`、`cost.activated`、`cost.exhaust`、`cost.printed`、`effect.ready`、`target.filter`、`target.query`、`trigger.play`、`trigger.state`。新原语：`continuous.grant-ability`。
- **判断理由**：ready 和临时 Might 已有原语，但“友方 Legends have …”授予的是完整激活能力，需要和 Forge of the Fluft 共用 grant-ability 边界。
- **新原语说明**：`continuous.grant-ability`：把完整的触发式或激活式能力附加给目标对象，保留来源、支付、触发、目标和持续时间；离开指定区域或持续期结束时移除。 预计复用 `sfd-208-221`、`rad-139-167`、`rad-040-167`、`sfd-184-221`。
- **v1.5 / 官方依据**：`CR 1.5 145`、`CR 1.5 376`、`CR 1.5 801.3.a`、`CR 1.5 427`。

### 28. `card.hash-bc97ea8be41594b9d618dfc49882dc35b7da2291b707b6e49958c26e4ad49d0c` — sfd-145-221 · Switcheroo

- **主印刷号 / 卡名**：`sfd-145-221` / Switcheroo（Spell）；目录位置：`packages/card-data/data/deck-catalog.json:16521`。
- **能力摘要**：Hidden/Action 法术在本回合交换同一战场上两个单位的 Might。
- **RIFT-9 未归类原因**：`unmatched-functional-clause`。
- **结论与映射**：**needs-new-primitive**；模板：`duration`、`filter`、`implicit-printed-cost`、`kw-action`、`kw-hidden`、`location`、`many`；原语：`continuous.duration`、`continuous.timing`、`cost.hidden`、`cost.pay`、`cost.printed`、`effect.zone`、`target.filter`、`target.location`、`target.many`、`target.query`。新原语：`effect.swap-might`。
- **判断理由**：现有 continuous.might 只能分别施加数值；这里要求先同时读取两个当前 Might，再原子交换并持续到回合结束，两个独立 set 会错误处理相等/动态数值和中间状态。
- **新原语说明**：`effect.swap-might`：原子地读取两个单位当前 Might，并在指定持续期内交换两个值；必须保留两个目标身份，不能降级为两个独立设值效果。 预计复用 `sfd-145-221`。
- **v1.5 / 官方依据**：`CR 1.5 137`、`CR 1.5 142`、`CR 1.5 303.1`、`CR 1.5 811`。

### 29. `card.hash-c4b9b8b1ea96f69164e5303d652fe97e69e6f81ce7b8f455b1a108203dd67a45` — rad-102-167 · Demon Shade

- **主印刷号 / 卡名**：`rad-102-167` / Demon Shade（Spell）；目录位置：`packages/card-data/data/deck-catalog.json:10599`。
- **能力摘要**：Hidden 法术先选友方单位，再选择把它移到开放战场；若没有开放战场，则本回合赋予它 Ganking。
- **RIFT-9 未归类原因**：`unmatched-functional-clause`。
- **结论与映射**：**mappable**；模板：`condition`、`duration`、`filter`、`implicit-printed-cost`、`kw-ganking`、`kw-hidden`、`location`、`mode`、`move`、`target`；原语：`choice.mode`、`condition.predicate`、`continuous.duration`、`continuous.movement`、`continuous.timing`、`cost.hidden`、`cost.pay`、`cost.printed`、`effect.move`、`effect.zone`、`target.filter`、`target.location`、`target.query`。
- **判断理由**：RIFT-9 漏的是两阶段选择头；choice.mode、effect.move、continuous.movement 与 Ganking keyword grant 可表达成功和无开放战场分支。
- **v1.5 / 官方依据**：`CR 1.5 811`、`CR 1.5 810`、`CR 1.5 421`、`CR 1.5 135.2.b.5`。

### 30. `card.hash-c6634bd393cadc3a20eda81ee688c8d171d215f7dd6297a92a55a2491f3ec43a` — sfd-194-221 · Counter Strike

- **主印刷号 / 卡名**：`sfd-194-221` / Counter Strike（Spell）；目录位置：`packages/card-data/data/deck-catalog.json:17805`。
- **能力摘要**：反应时选择一个单位，本回合它下一次将受到的伤害被防止，然后抽一张。
- **RIFT-9 未归类原因**：`unmatched-functional-clause`。
- **结论与映射**：**mappable**；模板：`draw`、`duration`、`filter`、`implicit-printed-cost`、`kw-reaction`、`prevention`、`replacement`、`target`；原语：`condition.predicate`、`continuous.duration`、`continuous.timing`、`cost.printed`、`effect.draw`、`effect.zone`、`replacement.event`、`replacement.prevent`、`target.filter`、`target.query`。
- **判断理由**：RIFT-9 未识别普通目标句；replacement.prevent 加“下一次”持续条件、draw 和 Reaction 已有完整路线。
- **v1.5 / 官方依据**：`CR 1.5 813`、`CR 1.5 418`、`CR 1.5 359`、`CR 1.5 414`。

### 31. `card.hash-d07372b97e2617a79fd38c84519913156cea70c47ae9f230f3f51b6aab1a644d` — sfd-184-221 · Relentless Pursuit

- **主印刷号 / 卡名**：`sfd-184-221` / Relentless Pursuit（Spell）；目录位置：`packages/card-data/data/deck-catalog.json:17565`。
- **能力摘要**：移动友方单位，可把同操控者装备附着给它；本回合该单位获得征服时可移动回基地的触发能力。
- **RIFT-9 未归类原因**：`unmatched-functional-clause`。
- **结论与映射**：**needs-new-primitive**；模板：`attach`、`duration`、`filter`、`implicit-printed-cost`、`kw-action`、`location`、`move`、`movement`、`optional`、`target`、`trigger-move`、`trigger-score`、`trigger-state`、`value`；原语：`choice.optional`、`condition.value`、`continuous.duration`、`continuous.movement`、`continuous.timing`、`cost.printed`、`effect.attach`、`effect.move`、`target.filter`、`target.location`、`target.query`、`trigger.move`、`trigger.score`、`trigger.state`。新原语：`continuous.grant-ability`。
- **判断理由**：移动、附着和持续期都有现成原语；引号里的本回合临时触发能力仍需要完整能力授予与来源/离场清理边界。
- **新原语说明**：`continuous.grant-ability`：把完整的触发式或激活式能力附加给目标对象，保留来源、支付、触发、目标和持续时间；离开指定区域或持续期结束时移除。 预计复用 `sfd-208-221`、`rad-139-167`、`rad-040-167`、`sfd-184-221`。
- **v1.5 / 官方依据**：`CR 1.5 135.4.b`、`CR 1.5 421`、`CR 1.5 716`、`CR 1.5 801.3.a`、`CR 1.5 319`。

### 32. `card.hash-db953801bed05d82fb44e885fa9fb48eee8dd92368d3933f1b858ca4c05c67e5` — sfd-201-221 · Chem-Baroness

- **主印刷号 / 卡名**：`sfd-201-221` / Chem-Baroness（Legend）；目录位置：`packages/card-data/data/deck-catalog.json:17969`。
- **能力摘要**：你或盟友 Hold 时可横置自身生成一个横置 Gold Token；分数距 Victory Score 不超过 3 时，己方 Gold 每次 Add 多加一个 Energy。
- **RIFT-9 未归类原因**：`non-reminder-printing-difference`。 同身份印刷：`sfd-249-221`。
- **结论与映射**：**data-issue**；模板：`condition`、`exhaust`、`filter`、`kw-add`、`mode`、`optional`、`resources`、`score`、`special-play`、`token`、`trigger-play`、`trigger-score`、`trigger-state`；原语：`choice.mode`、`choice.optional`、`condition.predicate`、`continuous.timing`、`cost.printed`、`effect.exhaust`、`effect.play`、`effect.resources`、`effect.score`、`effect.token`、`effect.zone`、`target.filter`、`target.location`、`target.player`、`target.query`、`trigger.play`、`trigger.score`、`trigger.state`。
- **判断理由**：主印刷语义可由现有 trigger/score/token/resources 表达，但同 identity 的 sfd-249-221 把关键词写成 [ADD]；这是目录中的大小写错字，应统一为官方关键词 [Add] 后实现。
- **v1.5 / 官方依据**：`CR 1.5 135.2.c.1`、`CR 1.5 430`、`CR 1.5 323.1`、`CR 1.5 123`。

### 33. `card.hash-e1dc41d23789b8f4890d5cd59e5dc7e12c0c0d447b2f09fd7acf63729930c55d` — rad-127-167 · Rousing Display

- **主印刷号 / 卡名**：`rad-127-167` / Rousing Display（Spell）；目录位置：`packages/card-data/data/deck-catalog.json:11108`。
- **能力摘要**：Show Off 一个 Energy 至少 7 的牌后，在基地生成两个 Recruit；若成功 Show Off，则改为生成四个。
- **RIFT-9 未归类原因**：`unmatched-functional-clause, corrupt-source-tail`。
- **结论与映射**：**data-issue**；模板：`condition`、`cost-modify`、`filter`、`implicit-printed-cost`、`kw-show-off`、`location`、`many`、`mode`、`replacement`、`result`、`token`、`value`；原语：`choice.mode`、`condition.predicate`、`condition.result`、`condition.value`、`cost.modify`、`cost.printed`、`cost.reveal`、`effect.reveal`、`effect.token`、`effect.zone`、`replacement.event`、`target.filter`、`target.location`、`target.many`、`target.query`。
- **判断理由**：RIFT-9 同时报告 unmatched-functional-clause 与 corrupt-source-tail；deck-catalog.json:11108 在完整句末多出“disa”，属于明确截断/污染。清掉尾部后 Show Off、result、token、replacement 均可映射。
- **v1.5 / 官方依据**：`CR 1.5 832`、`CR 1.5 135.2.b.5`、`CR 1.5 123`、`Radiance Patch Notes: Show Off`。

### 34. `card.hash-ead599cc175549f33e7ce605d2fc97d6e65ce56a91ca97055d06554ed4cea1ae` — sfd-036-221 · Lonely Poro

- **主印刷号 / 卡名**：`sfd-036-221` / Lonely Poro（Unit）；目录位置：`packages/card-data/data/deck-catalog.json:13695`。
- **能力摘要**：Deathknell 检查自身是否独自死亡；若是则抽一张。另一印刷只改变 Deathknell 的 [>] 排版。
- **RIFT-9 未归类原因**：`non-reminder-printing-difference`。 同身份印刷：`unl-221-219`。
- **结论与映射**：**mappable**；模板：`condition`、`draw`、`implicit-printed-cost`、`kw-deathknell`；原语：`condition.predicate`、`cost.printed`、`effect.draw`、`effect.zone`、`target.query`、`trigger.leave`。
- **判断理由**：RIFT-9 的 non-reminder-printing-difference 是关键词关联标记/提醒文本差异；Deathknell 的触发和“死亡时”语义由关键词规则确定。
- **v1.5 / 官方依据**：`CR 1.5 808.1`、`CR 1.5 135.2.d.3`、`CR 1.5 135.2.e.7`、`CR 1.5 414`。

### 35. `card.hash-ebc16c621c62d012f80adc1a2faa4b87722a2ea924309743bafb7b413e043f1c` — rad-013-167 · Lost to the Sands

- **主印刷号 / 卡名**：`rad-013-167` / Lost to the Sands（Spell）；目录位置：`packages/card-data/data/deck-catalog.json:8729`。
- **能力摘要**：Action 法术二选一：对战场上的单位造成 4 伤害，或摧毁一件装备。
- **RIFT-9 未归类原因**：`unmatched-functional-clause`。
- **结论与映射**：**mappable**；模板：`damage`、`filter`、`implicit-printed-cost`、`kill`、`kw-action`、`location`、`mode`、`target`；原语：`choice.mode`、`continuous.timing`、`cost.printed`、`effect.damage`、`effect.kill`、`effect.zone`、`target.filter`、`target.location`、`target.query`。
- **判断理由**：RIFT-9 只漏了 Choose one 的模态头；damage、kill、目标过滤和地点已有原语。
- **v1.5 / 官方依据**：`CR 1.5 135.2.b.4`、`CR 1.5 418`、`CR 1.5 429`、`CR 1.5 355`。

### 36. `card.hash-f2018820e58aa6e64632838286e934b24f7c9c49687c3fc847be072739c1b123` — rad-154-167 · Last Caress

- **主印刷号 / 卡名**：`rad-154-167` / Last Caress（Spell）；目录位置：`packages/card-data/data/deck-catalog.json:11749`。
- **能力摘要**：反应时指定本回合下一名打出的单位，使其可打到任意战场；打出时给它 Buff。
- **RIFT-9 未归类原因**：`unmatched-functional-clause`。
- **结论与映射**：**data-issue**；模板：`buff`、`duration`、`filter`、`implicit-printed-cost`、`kw-buff`、`kw-reaction`、`location`、`special-play`、`trigger-play`、`trigger-state`；原语：`condition.predicate`、`continuous.duration`、`continuous.might`、`continuous.timing`、`cost.printed`、`effect.buff`、`effect.play`、`effect.zone`、`target.filter`、`target.location`、`target.query`、`trigger.play`、`trigger.state`。
- **判断理由**：目录保存的是 Radiance Errata 的 OLD TEXT（把“even from face down”放在括号内），官方 2026-10-09 的 NEW TEXT 已移除括号；语义路线仍是现有 play restriction、trigger.play、buff 和 duration。
- **v1.5 / 官方依据**：`CR 1.5 135.2.d.3`、`CR 1.5 420`、`CR 1.5 801.3.a`、`Radiance Errata (2026-10-09): Last Caress`。

## 交付与复现

JSON 文件是顶层数组，可直接由 Node 读取：

```bash
node -e "const x=require('./docs/plans/survey/unclassified-rad-sfd.json'); console.log(x.length, x[0].printingId, x[0].verdict)"
```

预期示例输出：`36 sfd-011-221 mappable`。JSON 中每项包含 `canonicalCardId`、`printingId`、`verdict`、`templates`、`primitives`、`reason`、`ruleRefs`，需要新原语的项另有 `newPrimitive` 数组。
