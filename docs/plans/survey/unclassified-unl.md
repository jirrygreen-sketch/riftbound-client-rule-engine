# UNL unclassified 身份逐张结论

本报告覆盖 `ability-templates.json` 中同时满足 `classification = unclassified` 且主印刷号以 `unl-` 开头的身份，共 **31 个**，覆盖率为 **31 / 31**。

结论按四类解释：

- `mappable`：现有 RIFT-9 模板和原语足以表示能力，不代表已经实现。
- `needs-new-primitive`：规则语义清楚，但现有原语缺少必要的绑定、替代或事件关系。
- `data-issue`：目录文本、标签或印刷差异与官方来源不一致，先修数据。
- `judge-required`：规则资料没有给出足够明确的结算裁定，保持 pending，不猜测实现。

规则资料按 **2026-10-15** 的状态记录。Core Rules v1.5 已发布，但官方页面和 Radiance patch notes 注明 **2026-10-16** 生效，所以本文把它作为目标规则版本引用。

## 来源与方法

- RIFT-9 输入：`docs/plans/survey/ability-templates.json`、`docs/plans/survey/ability-templates.md` 第 3、4、7 节，以及 `packages/card-data/data/deck-catalog.json`。
- Core Rules v1.5：官方 [Rules Hub](https://playriftbound.com/en-us/rules-hub/) PDF，下载到 `/tmp/RIFT-42-triage-unl/core-rules-v1.5.pdf`，SHA-256 为 `94d41fee86f88b61c4157c0389c0595d990b98e5b42555c99d9f649ee64d1fec`。
- Radiance 规则更新：[Core Rules: Radiance Patch Notes](https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/)。
- Unleashed 勘误：[Unleashed Errata Updates](https://playriftbound.com/en-us/news/rules-and-releases/unleashed-errata-updates/)。该页明确修正 Mirror Image、Bone Skewer、Rengar。
- Gardens、Red Brambleback、Blue Sentinel、Elder Dragon 的标签或文字核对使用 `deck-catalog.json` 内对应的官方 CMS 卡图 URL；卡图副本只在 `/tmp/RIFT-42-triage-unl/`，未提交。
- 完整 `templates`、`primitives`、`newPrimitive` 和 `ruleRefs` 在同目录 JSON 中逐条给出；本文表格保留人工可读摘要。

## 汇总

| 结论 | 身份数 | 身份 |
| --- | ---: | --- |
| `mappable` | 17 | Arachnoid Horror、Call to Battle、Conscription、Friendship、Curtain Call、Tactical Retreat、Hextech Gauntlets、Clash of Giants、Disposal Order、Flurry of Feathers、Stare Down、XP Tracker、Insightful Investigator、Moonfall、Baron Nashor、Crescent Strike、Keeper's Verdict |
| `needs-new-primitive` | 6 | Repulse、Lotus Trap、Ivern, Friend to All、The List、Alpha Strike、Smoke and Mirrors |
| `data-issue` | 7 | Mirror Image、Bone Skewer、Rengar, Trophy Hunter、Red Brambleback、Blue Sentinel、Gardens of Becoming、Elder Dragon |
| `judge-required` | 1 | Dancing Grenade |
| **合计** | **31** | **31 / 31 覆盖** |

建议新增原语按预计可复用身份数排序。计数把已经是 lexical candidate、但同样需要该语义的明确卡也算入复用范围，不代表已执行卡数。

| 建议 ID | 语义边界 | 预计身份数 | 预计复用卡 |
| --- | --- | ---: | --- |
| `trigger.reflexive` | `Do this:` 按条件建立链项，必要时按 N 次建立多个独立链项，并保留来源和对象绑定 | 7 | Mirror Image、Bone Skewer、Alpha Strike、Ivern、Wild Claw、Forgotten Relic、Kharox |
| `trigger.repeat` | 真实 Conquer/Hold 等事件触发时额外触发一次，不把手动 activate 当成原事件 | 4 | Red Brambleback、Blue Sentinel、Karthus, Eternal、Detonation Amplifier |
| `effect.swap-location` | 两个永久物成对交换地点，按一个原子移动关系结算 | 2 | Smoke and Mirrors、Zed, Without a Sound |
| `choice.tag` | 从 v1.5 允许的标签全集选择并保存运行时 tag 名称 | 2 | Ivern, Friend to All、The List |
| `effect.grant-tag` | 把运行时所选 tag 临时授予单位并进入特征层 | 1 | Ivern, Friend to All |
| `continuous.lethal-threshold` | 按来源和敌我关系改变致死伤害阈值 | 1 个身份 | Elder Dragon |
| `replacement.damage-multiplier` | 在指定持续窗口内替换将造成的伤害数额 | 1 | Lotus Trap |
| `target.relation` | 验证链上 spell/ability 的目标集合是否与已选对象满足关系约束 | 1 | Repulse |

## 逐卡结论

能力摘要使用自己的话概述目录能力，没有全文复制。RIFT-9 原因保留输入报告给出的 blocker 语义；完整模板和原语列表见 JSON。

| # | canonicalCardId / 主印刷号 / 卡名 | 能力原文摘要 | RIFT-9 原因 | 你的结论 |
| ---: | --- | --- | --- | --- |
| 1 | `card.hash-158f0c8fe09a511b90b88574669f5f31fbfc1742ef2b6dea8f7b903e7a448423` / `unl-117-219` / Arachnoid Horror | Hunt 2；本体和友方单位可以在特定已占据战场入场，条件是有孤立敌方单位。 | `unmatched-functional-clause`：两句地点许可。 | **mappable**。`condition.predicate`、`continuous.location`、`target.filter` 足够；规则 `355.2`、`740.2.a`、`823.1`。 |
| 2 | `card.hash-1624e5bc418da476f531d04662765fc6e20f06c4b970aa940a696af64789318b` / `unl-200-219` / Mirror Image | 选择单位，在基地生成 ready 的 Reflection token，使其复制目标并带 Temporary。 | `unmatched-functional-clause`：选择单位。 | **data-issue**。官方勘误改为 `Then do this:`；修正后使用 `copy`、`token`、`kw-temporary`，并复用 `trigger.reflexive`。规则 `388.1`、`420.3`、`446.3`、`816.1`。 |
| 3 | `card.hash-1d05a8db288bc071a9e9736106ed0815284bac8ec41b7795f5d4b43e4a75217c` / `unl-101-219` / Call to Battle | 先移动己方单位，再让对手把一个己方单位移动到相同战场。 | `unmatched-functional-clause`：选择对手。 | **mappable**。`effect.move`、`target.player`、`target.location`、`target.query`；规则 `355.4`、`355.5`、`421.1`。 |
| 4 | `card.hash-25d95fca3a71b0c54c47c59f37cb281740cdfe6478a2d0f9c23309aaff471bcd` / `unl-140-219` / Conscription | 可选支付 5 XP 改变目标范围，然后接管、横置并召回目标单位。 | `unmatched-functional-clause`：按附加费用切换 Might 限制。 | **mappable**。`cost.xp`、`cost.additional`、`condition.result`、`effect.control`、`effect.exhaust`、`effect.move`；规则 `204.2`、`355.1`、`415.1`、`458.1`、`730.2`。 |
| 5 | `card.hash-37a5883a0f15a4118620e230230c119a9ac1e87495ffa0716a061bf8d9c2422f` / `unl-106-219` / Repulse | 选己方战场单位，反制一个只选择它的敌方 spell/ability。 | `unmatched-functional-clause`：选择己方单位。 | **needs-new-primitive**。新增 `target.relation`，验证链上对象的完整目标集合；规则 `355.9`、`355.10`、`355.11`、`426.1`。 |
| 6 | `card.hash-380c1a7758d95d28f1a1ab46065c44a878dd909f52f43900cdf66c7669153512` / `unl-046-219` / Friendship | Reaction；按己方单位中四个标签各自存在的数量给单位加 Might。 | `unmatched-functional-clause`：选择单位。 | **mappable**。`condition.value` 已覆盖标签集合计数；规则 `133.8`、`355.5`、`143.2`。 |
| 7 | `card.hash-4609651295618e769925ca1121b1e4b5f1589eaef0c44d494c4efea35f85899c` / `unl-020-219` / Dancing Grenade | 造成伤害；受影响单位的控制者可付 Power 重放本 spell，后续伤害按本回合累计次数增加 Bonus Damage。 | `unmatched-functional-clause`：可再次打出本 spell。 | **judge-required**。需要官方裁定当前 resolving spell 的来源、嵌套重放顺序和次数归属；规则 `158.3`、`418.4`、`418.5`、`420.3` 不足以安全落地。 |
| 8 | `card.hash-461012a9889f3812c0033854e007b78f0f8ad1f1d1ef943bf505bfd5defabca6` / `unl-182-219` / Curtain Call | Repeat 可支付多个费用，每次从尚未选过的四种效果中选一种。 | `unmatched-functional-clause`：模式选择历史。 | **mappable**。`effect.repeat`、`choice.mode`、`condition.history`；规则 `355.3`、`820.1`、`820.2`、`820.2.a`。 |
| 9 | `card.hash-4a35c75cbe6c3eeae825ce423a2f3dbbdbbbc76b117a9c54735ebc7a7c7c4290` / `unl-013-219` / Lotus Trap | Hidden Reaction；本回合让指定单位受到的全部伤害翻倍。 | `unmatched-functional-clause`：选择单位。 | **needs-new-primitive**。新增 `replacement.damage-multiplier`；规则 `142.4`、`369.1`、`418.1`、`418.5`。 |
| 10 | `card.hash-4f9132b39e7882b566918d9e149431cd5ca28810eebc329edb678b0585a346a8` / `unl-177-219` / Ivern, Friend to All | 打出时选 Bird/Cat/Dog/Poro 之一并赋予自身；Conquer/Hold 时检查标签集合并计分。 | `unmatched-functional-clause`：选择标签并获得标签。 | **needs-new-primitive**。新增 `choice.tag`、`effect.grant-tag`；`condition.value` 继续复用；规则 `133.8`、`355.5`、`383.4.d`、`763.1`。 |
| 11 | `card.hash-507e1a3735db5fb2eaf2f03eb1f87ec27cf10682ba26b203f5b753db41e3eb00` / `unl-138-219` / The List | 打出时命名标签；横置后让带该标签的单位降低 Might。 | `unmatched-functional-clause`：命名标签。 | **needs-new-primitive**。新增 `choice.tag`，保存运行时标签名供 `target.filter` 使用；规则 `355.1`、`355.5`、`760`、`763.1`。 |
| 12 | `card.hash-5726eb484767a4425aeceb77e181b534986492340b0bc94c0bcf8d4ae478d598` / `unl-139-219` / Bone Skewer | Hidden；选战场、展示手牌并可选免费打出一张单位，成功后 Stun。 | `unmatched-functional-clause`：战场、手牌单位和免费打出。 | **data-issue**。官方勘误把 `When they do` 改为 `If they do, then do this:`；修正后已有 `effect.reveal`、`effect.play`、`cost.modify`、`effect.stun`，并需 `trigger.reflexive`；规则 `388.1`、`420.3`、`425.1`、`356.1`。 |
| 13 | `card.hash-615c0725c9dee5568f8995d3c574c9270aea149c0f18dc1de8953693293494b2` / `unl-192-219` / Alpha Strike | 让选定己方单位把 Might 伤害分配给多个敌方单位；每杀一个单位获得 1 XP。 | `unmatched-functional-clause`：选择己方单位。 | **needs-new-primitive**。新增 `trigger.reflexive` 的按 Kill 事件计数形式；规则 `388.1.a`、`389.1`、`418.8`、`429.5`、`730.1`。 |
| 14 | `card.hash-6add1fe7f28222eaf95929c9ea158fc564653d8c24fc981553089763dd098361` / `unl-083-219` / Smoke and Mirrors | 选两个不同地点的己方单位；至少一个 Temporary 时交换地点并抽牌。 | `unmatched-functional-clause`：成对选择且要求不同地点。 | **needs-new-primitive**。新增 `effect.swap-location`，保证交换是原子成对关系；规则 `355.4`、`448.1`、`448.3`、`449.1`、`451.1`。 |
| 15 | `card.hash-6e703faa3d5dcede2068e4872e8021e824403fe96e25a18904960e6595699c35` / `unl-175-219` / Tactical Retreat | 单位下一次将死亡时，改为治疗、横置并召回。 | `unmatched-functional-clause`：选择友方单位。 | **mappable**。现有 Replacement、Heal、Exhaust、Recall 可组合；规则 `369.1`、`370.1`、`419.1`、`415.1`、`458.1`。 |
| 16 | `card.hash-7af45bc5485b4630b0159d3ebb543753b28e1c439f0bdccf266c500a9d157088` / `unl-120-219` / Rengar, Trophy Hunter | Ambush；即使没有己方单位，也能在有敌方单位的战场入场。 | `unmatched-functional-clause`、`non-reminder-printing-difference`：主印刷与其他印刷不同。 | **data-issue**。官方勘误改为动词 `Ambush` 的新文本；统一数据后复用 `kw-ambush`、`continuous.location`；规则 `822.1`、`822.1.c`、`355.2`。 |
| 17 | `card.hash-955bd858659e4d3eb8edfd20347a7496c51932de05cafd32fc71d86d94f96e47` / `unl-188-219` / Hextech Gauntlets | Equip 费用的 Energy 按所选单位 Might 动态减少。 | `unmatched-functional-clause`：按目标 Might 减费。 | **mappable**。`cost.modify`、`condition.value`、`effect.attach`；规则 `206`、`818.1`、`818.1.c.4`、`143.2.a`。 |
| 18 | `card.hash-a16acd4fee0dfec2b4646c11865b24e416113a307ddab35294168618aa9d4856` / `unl-110-219` / Clash of Giants | 选两个单位，让双方按各自 Might 互相造成伤害。 | `unmatched-functional-clause`：选择两个单位。 | **mappable**。与 Challenge 等已有 reciprocal damage 结构相同；规则 `355.5`、`418.1`、`418.6`、`143.2.a`。 |
| 19 | `card.hash-ae826439bb4605b7d72d3b0b431548f77c4cde681a949dd0e613036488b554c0` / `unl-103-219` / Disposal Order | 二选一：回收对手 Trash 中至多三张，或抽一张。 | `unmatched-functional-clause`：模式和多目标。 | **mappable**。`effect.recycle`、`target.many`、`effect.draw`；规则 `355.3`、`417.1`、`417.1.c`、`414.1`。 |
| 20 | `card.hash-afac76ad6c5f670cc47f942343901c50caf6df49ccf238b5f8cf9b710906eba5` / `unl-044-219` / Flurry of Feathers | 二选一：反制 spell，或生成四个带 Deflect 的 Bird token。 | `unmatched-functional-clause`：模式选择。 | **mappable**。`effect.counter`、`effect.token`、`target.tax`；规则 `355.3`、`426.1`、`809.1`、`180`、`185`。 |
| 21 | `card.hash-b01f4d5df7d2f8e495a921ff9e1382d11332309f969c740e6a72d9d73bf8ebd2` / `unl-107-219` / Stare Down | 选己方单位和战场，把该处 Might 更低的所有敌方单位移回基地并获得 XP。 | `unmatched-functional-clause`：两个选择。 | **mappable**。`effect.move`、`effect.xp`、`condition.value`、`target.many`；规则 `355.4`、`355.5`、`421.1`、`143.2.a`、`729.1`。 |
| 22 | `card.hash-bd13577acf2621457b102b04d868bc9c236deec535cbd42baead7bc5fee78ab4` / `unl-t08` / XP Tracker | token 上的 XP 追踪和 Level 规则提示，不产生独立结算动作。 | `unmatched-functional-clause`：提示句没有被模板识别。 | **mappable**。按规则提示处理，复用 `kw-level`、`condition.value`；规则 `729`、`730`、`731`、`824.1`。 |
| 23 | `card.hash-c9dc0b3daad63f09feabdf740bc69b2b327719079fe5d68568f0f4680d45abd2` / `unl-135-219` / Insightful Investigator | 展示对手手牌；可付 2 XP 选择一张，使其弃掉该牌并抽一张。 | `unmatched-functional-clause`：XP 可选费用后的手牌选择。 | **mappable**。`effect.reveal`、`choice.optional`、`condition.result`、`effect.discard`、`effect.draw`；规则 `355.5`、`355.9`、`355.10`、`425.1`、`414.1`、`730.2`。 |
| 24 | `card.hash-cc540d8a2bbd62d237f265dc99b08da25c4499af36778a1dc01cf4165c0b9553` / `unl-029-219` / Red Brambleback | Accelerate；真实 Conquer 时该处己方 Conquer effects 额外触发一次，另有 Conquer Buff。 | `unmatched-functional-clause`、`printing-stat-type-or-tag-difference`：额外触发未匹配，alternate 标签缺失。 | **data-issue**。官方 alternate 卡图仍有 Ionia，目录丢失；修正后需 `trigger.repeat`，区分真实 Conquer 与手动 activate；规则 `383.4.g.2`、`471.1`、`805.1`、`133.8`。 |
| 25 | `card.hash-cc5b4c7c8552ab416ee26137732c2e83c4df87b7e9fed57fdc4d1c19b390bcba` / `unl-087-219` / Blue Sentinel | Shield 2；真实 Hold 时该处己方 Hold effects 额外触发一次；下一 Main Phase 开始时 Add Rainbow Power。 | `unmatched-functional-clause`、`printing-stat-type-or-tag-difference`：额外触发未匹配，alternate 标签缺失。 | **data-issue**。官方 alternate 卡图仍有 Mount Targon，目录丢失；修正后复用 `trigger.repeat` 和 delayed Add；规则 `383.4.g.2`、`391.2`、`430.1`、`471.2`、`133.8`。 |
| 26 | `card.hash-e2e26781b4b52ed2eb1cf50ca00160e4ad95f6b59a93ca58abd157a6e8cee977` / `unl-198-219` / Moonfall | 选己方有单位的战场，可选移动一个敌方单位过去，再让该处敌方单位降 Might。 | `unmatched-functional-clause`：战场选择条件。 | **mappable**。`effect.move`、`continuous.might`、`condition.predicate`、`target.location`；规则 `355.4`、`355.5`、`421.1`、`449.2`、`427.1`。 |
| 27 | `card.hash-ea5887640ac2868198c368d889903ebf8fd5895f4ac0b6e2f8db54a5178aad74` / `unl-213-219` / Gardens of Becoming | 该处单位获得横置换取 1 XP 的 Activated Ability。 | `unmatched-functional-clause`：目录尾部是孤立引号。 | **data-issue**。官方卡图显示完整文本为 `Units here have [Exhaust]: Gain 1 XP.`；修正目录后复用 `activated`、`cost.exhaust`、`effect.xp`；规则 `151.1`、`415.1`、`729.1`。 |
| 28 | `card.hash-f38d5cb54f004209cfc8fd9489817ccc83394ce2f7125972d8538d18c193cc6d` / `unl-147-219` / Baron Nashor | 按是否已存在创建 Baron Pit token，创建成功时把自己放到那里；另有敌方不可选和友方加 Might。 | `unmatched-functional-clause`：If you do 后的入场地点替换。 | **mappable**。v1.5 `369.3` 直接以 Baron Nashor 为例；复用 `effect.token`、`condition.result`、`effect.zone`、地点替换。 |
| 29 | `card.hash-f61b6c198fa8246d56a2b3ef18175df62f2d19dcbbfe1b90bd2cd61fa150304b` / `unl-118-219` / Elder Dragon | 你的伤害对敌方单位可用任意正数达到致死；打出时每个地点至多选一个敌方单位并造成 1。 | `printing-stat-type-or-tag-difference`：alternate 标签缺失。 | **data-issue**。官方两张卡图都显示 Demacia·Dragon，目录 alternate 漏掉 Demacia；能力还需 `continuous.lethal-threshold` 对应 `142.4.c`。 |
| 30 | `card.hash-f7adf9f6506b55f668b24e077add9d1252841ee4cbb74fb432903d6cfc842c88` / `unl-072-219` / Crescent Strike | 选战场和其中一个敌方单位；主目标受 4，其余敌方单位各受 1。 | `unmatched-functional-clause`：战场和单位的联合选择。 | **mappable**。`target.many`、`effect.damage`、`target.location`；规则 `355.5`、`355.11`、`418.1`、`418.1.d`。 |
| 31 | `card.hash-f90cd5af60e3899d3330ee8473377f3975c421713216d6ec28e24242296f72be` / `unl-204-219` / Keeper's Verdict | 选战场上的敌方单位，由其所有者选择放在自己 Main Deck 顶或底。 | `unmatched-functional-clause`：对象选择和顶/底模式。 | **mappable**。`effect.order`、`effect.zone`、`choice.mode`、所有者绑定；规则 `355.3`、`355.5`、`355.9`、`056.2`。 |

## 数据问题明细

| 卡 | 问题 | 官方核对 |
| --- | --- | --- |
| Mirror Image | 目录是旧的连续句式，缺少 `Then do this:` 对复制动作的反身触发边界。 | Unleashed Errata 的 NEW TEXT。 |
| Bone Skewer | 目录是 `When they do`，官方改成 `If they do, then do this:`，影响免费打出成功后的 Stun 绑定。 | Unleashed Errata 的 NEW TEXT；Core Rules `420.3` 还以 Bone Skewer 作为地点和忽略费用的示例。 |
| Rengar, Trophy Hunter | 目录主印刷使用旧的 `be played` 文案，官方改为动词 `Ambush` 并明确无己方单位也可入场。 | Unleashed Errata 的 NEW TEXT。 |
| Red Brambleback | `unl-029a-219` 官方卡图仍显示 Ionia，目录 tags 为空。 | `deck-catalog.json` 内官方 CMS 卡图 URL。 |
| Blue Sentinel | `unl-087a-219` 官方卡图仍显示 Mount Targon，目录 tags 为空。 | `deck-catalog.json` 内官方 CMS 卡图 URL。 |
| Gardens of Becoming | 目录 ability 以孤立引号和斜杠结尾，官方卡图给出完整横置换 XP 句子。 | `deck-catalog.json` 内官方 CMS 卡图 URL。 |
| Elder Dragon | `unl-118a-219` 官方卡图仍显示 Demacia·Dragon，目录 tags 只有 Dragon。 | `deck-catalog.json` 内官方 CMS 卡图 URL；两张官方卡图的能力文本一致。 |

## JSON 校验

JSON 是顶层数组，包含 31 条身份记录。可用下面命令读取并核对覆盖数：

```bash
node -e 'const x=require("./docs/plans/survey/unclassified-unl.json"); console.log(x.length); console.log(x.reduce((a,c)=>(a[c.verdict]=(a[c.verdict]||0)+1,a),{}))'
```

预期输出：

```text
31
{ mappable: 17, "needs-new-primitive": 6, "judge-required": 1, "data-issue": 7 }
```
