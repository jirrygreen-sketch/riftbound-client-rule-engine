# RIFT-41：ven 系列未归类身份逐卡裁定

日期：2026-10-15；范围：RIFT-9 `classification=unclassified` 且主印刷号前缀为 `ven` 的 37 个身份。只读调研，不修改源码、测试、契约或生成卡牌数据。

本报告把能力摘要改写为自己的话，没有复制目录中的完整能力原文。`mappable` 表示已有 RIFT-9 模板 / 原语能够承载语义，仍须后续实现和 golden case；`needs-new-primitive` 表示已能明确到新增原语的实现路线；`data-issue` 和 `judge-required` 本轮没有命中。

## 依据与版本边界

- RIFT-9 输入：`docs/plans/survey/ability-templates.json`、`docs/plans/survey/ability-templates.md`；阻断原因逐条沿用 JSON 的 `blockers`。
- 卡牌输入：`packages/card-data/data/deck-catalog.json` 的主印刷和身份分组；`energy:null` / `power:null` 未改写。
- 官方 Rules Hub：https://playriftbound.com/en-us/rules-hub/；核心规则 PDF：https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf，下载文件标注 “Last Updated: 2026-10-09”。
- 官方 Radiance/v1.5 规则更新：https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/；页面标注 “Effective October 16, 2026”。本报告日期为 2026-10-15，因此将其作为目标版本依据，不声称它在报告日期已经生效。
- 官方 Radiance 勘误：https://playriftbound.com/en-us/news/announcements/radiance-errata-updates；页面列出的 Radiance 卡不包含本批 `ven-*` 身份，因此没有仅凭 RIFT-9 的提醒文字 / 标签差异认定数据错误。

## 汇总

覆盖核对：37/37 个 ven 未归类身份；四类计数为：

| 结论 | 身份数 |
| --- | ---: |
| `mappable` | 36 |
| `needs-new-primitive` | 1 |
| `data-issue` | 0 |
| `judge-required` | 0 |

本轮建议新增原语（按当前卡数排序）：

- `continuous.grant-ability`（1 张）：在指定持续期间把一个含费用、效果和自指对象引用的 activated ability 授予目标 Game Object；该能力必须按普通 activated ability 的激活、选择、费用、入链和结算流程执行。 预计复用：未来所有出现“给它一个[费用]:[效果]”或等价临时自定义激活能力的卡都可复用；本次 ven 未归类身份中仅 Dominus 需要它。

`data-issue=0` 的原因是：RIFT-9 标出的 `non-reminder-printing-difference` / `printing-stat-type-or-tag-difference` 在本批中都能解释为备用印刷的标签或提醒文字差异，未找到官方 Radiance 勘误支持的功能文本矛盾。`judge-required=0` 的原因是：逐张语义都能由现有原语组合，或能明确落到本报告的新增原语；没有保留需要猜测的规则分支。

## 逐卡结论

### ven-017-166 · Morgana, Vindictive
- canonicalCardId：`card.hash-6b5c19257cf27d1dd9fba350525b81aaed82f21aacca46a1c0920853f044a5b4`
- 能力摘要：入场时可对单位造成等同于其已标记伤害的伤害。
- RIFT-9 未归类原因：`printing-stat-type-or-tag-difference`
- 结论：`mappable`
- 模板：`damage`、`filter`、`implicit-printed-cost`、`kw-ambush`、`kw-reaction`、`target`、`trigger-play`、`trigger-state`、`value`
- 原语：`condition.value`、`continuous.timing`、`cost.printed`、`effect.damage`、`target.filter`、`target.location`、`target.query`、`trigger.play`、`trigger.state`
- 结论理由：RIFT-9 只因同身份的后续印刷存在能力/标签机械差异而阻断；“已标记伤害”是现有动态数值表达式，不需要猜测数值。
- 规则依据：`CR 142.3-142.4`、`CR 399-406`

### ven-019-166 · Renekton, Rage Fueled
- canonicalCardId：`card.hash-4ea204b4fa413be39f3508c65d93d8ef270e1bb64d97edf9a216efa7d50394f4`
- 能力摘要：可用额外费用加速入场；攻击时若自己控制的符文不超过四个，则对这里的所有敌方单位各造成 2 点伤害。
- RIFT-9 未归类原因：`printing-stat-type-or-tag-difference`
- 结论：`mappable`
- 模板：`condition`、`damage`、`filter`、`implicit-printed-cost`、`kw-accelerate`、`location`、`many`、`mode`、`trigger-combat`、`trigger-state`
- 原语：`choice.mode`、`choice.optional`、`condition.predicate`、`cost.additional`、`cost.pay`、`cost.printed`、`effect.damage`、`replacement.enter`、`target.filter`、`target.location`、`target.many`、`target.query`、`trigger.combat`、`trigger.state`
- 结论理由：RIFT-9 只因不同印刷的标签/属性差异而阻断；Accelerate、攻击触发、符文数量条件和范围伤害均已有模板组合。
- 规则依据：`CR 805`、`CR 807`、`CR 418`

### ven-021-166 · Akali, Deadly Weapon
- canonicalCardId：`card.hash-7b24e8fb2cf27a115102e669fe4fd9219a98b10d2411cc5caf4bb1826db5e3c6`
- 能力摘要：支付费用 Empower；移动后可对起点或终点的单位造成伤害，已 Empower 时数值提高，并获得临时 +1 Might。
- RIFT-9 未归类原因：`non-reminder-printing-difference, printing-stat-type-or-tag-difference`
- 结论：`mappable`
- 模板：`activated`、`condition`、`damage`、`empower`、`filter`、`implicit-printed-cost`、`kw-empower`、`kw-empowered`、`location`、`might`、`mode`、`move`、`optional`、`replacement`、`target`、`trigger-move`、`trigger-state`
- 原语：`choice.mode`、`choice.optional`、`condition.predicate`、`continuous.duration`、`continuous.might`、`cost.activated`、`cost.pay`、`cost.printed`、`effect.damage`、`effect.empower`、`effect.move`、`replacement.event`、`target.filter`、`target.location`、`target.query`、`trigger.move`、`trigger.state`
- 结论理由：两版差异是提醒文字省略与末尾标点；功能文本一致。移动触发、Empower 条件、临时 Might 和动态伤害可组合表达。
- 规则依据：`CR 442`、`CR 144`、`CR 424`、`CR 142`

### ven-023-166 · Zed, From the Shadows
- canonicalCardId：`card.hash-d7b6ea328eac7b13a0a652c5d95b38895d7026cbb51f23007ecdce1f9a3d951c`
- 能力摘要：可弃牌作为额外费用；若支付了该费用，打出带有后续攻击能力的 Shadow Clone 单位 Token。
- RIFT-9 未归类原因：`printing-stat-type-or-tag-difference`
- 结论：`mappable`
- 模板：`additional-cost`、`condition`、`cost-discard`、`discard`、`filter`、`implicit-printed-cost`、`kw-assault`、`optional`、`result`、`special-play`、`token`、`trigger-play`、`trigger-state`、`banish`
- 原语：`choice.optional`、`condition.predicate`、`condition.result`、`continuous.duration`、`continuous.might`、`continuous.timing`、`cost.additional`、`cost.discard`、`cost.printed`、`effect.discard`、`effect.play`、`effect.token`、`effect.zone`、`target.filter`、`target.location`、`target.query`、`trigger.play`、`trigger.state`、`effect.banish`、`continuous.keyword`
- 结论理由：RIFT-9 的标签差异不影响功能；额外费用凭证连接到后续 Token 打出，Token 内嵌攻击能力继续使用已有 Token、Banish 和 Assault 原语。
- 规则依据：`CR 349`、`CR 400-406`、`CR 184-187`、`CR 807`、`CR 428`

### ven-034-166 · Resonating Strike
- canonicalCardId：`card.hash-fa3fca39f51f36c4a7eaf70e836d2271f5e26b7994a64cbafa1b79ec0ea7dad7`
- 能力摘要：Hidden Reaction：把自己控制的单位从另一处移动到自己控制的战场，并使其本回合 +2 Might。
- RIFT-9 未归类原因：`unmatched-functional-clause`
- 结论：`mappable`
- 模板：`duration`、`filter`、`implicit-printed-cost`、`kw-hidden`、`kw-reaction`、`location`、`might`、`move`、`target`
- 原语：`continuous.duration`、`continuous.might`、`continuous.timing`、`cost.hidden`、`cost.pay`、`cost.printed`、`effect.move`、`effect.zone`、`target.filter`、`target.location`、`target.query`
- 结论理由：RIFT-9 未匹配的是“从不同地点移动并临时加 Might”整句；Hidden、Reaction、移动和持续增益都有现有原语。
- 规则依据：`CR 811`、`CR 813`、`CR 144`、`CR 137`

### ven-035-166 · Sanction
- canonicalCardId：`card.hash-cc029bf96714e13a2e9bbc9f58b4d2a300a4d50e4257125afc218854ce4b3acf`
- 能力摘要：Reaction 二选一：先 Empower 后在回合结束 Disempower，或先 Disempower 后在回合结束 Empower。
- RIFT-9 未归类原因：`unmatched-functional-clause`
- 结论：`mappable`
- 模板：`empower`、`filter`、`implicit-printed-cost`、`kw-empower`、`kw-empowered`、`kw-reaction`、`mode`、`target`、`trigger-phase`
- 原语：`choice.mode`、`condition.predicate`、`continuous.timing`、`cost.activated`、`cost.pay`、`cost.printed`、`effect.empower`、`target.filter`、`target.query`、`trigger.phase`、`trigger.delayed`
- 结论理由：RIFT-9 未匹配的是双模式的临时 Empower/Disempower；CR 442-443 已定义两种动作，回合结束触发可由 delayed/phase 原语连接。
- 规则依据：`CR 442-443`、`CR 317.2`、`Radiance patch: Conditional Clause Scope`

### ven-038-166 · Akali, Silent
- canonicalCardId：`card.hash-cbfb311a21f9513fabec6e5988abd82142daa5583c2f6638ef10ecc4244c44bc`
- 能力摘要：除非处于战斗中，敌方牌和能力不能选择它；移动到战场时本回合获得 +2 Might。
- RIFT-9 未归类原因：`printing-stat-type-or-tag-difference`
- 结论：`mappable`
- 模板：`condition`、`duration`、`filter`、`implicit-printed-cost`、`location`、`might`、`move`、`restrict`、`trigger-move`、`trigger-state`
- 原语：`condition.predicate`、`continuous.duration`、`continuous.might`、`continuous.restrict`、`cost.printed`、`effect.move`、`target.filter`、`target.location`、`target.query`、`trigger.move`、`trigger.state`
- 结论理由：RIFT-9 只因不同印刷的标签/属性差异而阻断；“不能被选择除非在战斗中”是条件限制替代效果。
- 规则依据：`CR 364-370`、`CR 144`、`CR 137`

### ven-040-166 · Decree of Focus
- canonicalCardId：`card.hash-e5eafd33bb50e62c31da83b13c1e44904a8cd4d53760a85e48bbb1fb82d587eb`
- 能力摘要：Reaction 选择与敌方 Fury 单位战斗中、或正被敌方 Fury 法术选择的友方单位，使其本回合 +4 Might。
- RIFT-9 未归类原因：`unmatched-functional-clause`
- 结论：`mappable`
- 模板：`duration`、`filter`、`implicit-printed-cost`、`kw-reaction`、`might`、`mode`、`target`
- 原语：`choice.mode`、`continuous.duration`、`continuous.might`、`continuous.timing`、`cost.printed`、`target.filter`、`target.query`、`continuous.combat`
- 结论理由：RIFT-9 未匹配的是“正在被选择”这一目标状态；目标查询和条件谓词可以引用当前选择过程，v1.5 的 conditional-clause scope 解决句法范围。
- 规则依据：`CR 813`、`CR 316`、`CR 354-359`、`CR 137`

### ven-041-166 · Riven, Shattered
- canonicalCardId：`card.hash-449ee3c99ccb6cbedf40282cf1e6bd9c5f1849ff561c01da7535c34da3628b11`
- 能力摘要：Weaponmaster 可折价装备；攻击时按所附 Equipment 数量，对这里的一个敌方单位每件造成 2 点伤害。
- RIFT-9 未归类原因：`printing-stat-type-or-tag-difference`
- 结论：`mappable`
- 模板：`attach`、`damage`、`filter`、`implicit-printed-cost`、`kw-equip`、`kw-weaponmaster`、`location`、`many`、`target`、`trigger-combat`、`trigger-state`、`value`
- 原语：`choice.optional`、`condition.value`、`cost.activated`、`cost.modify`、`cost.pay`、`cost.printed`、`effect.attach`、`effect.damage`、`target.filter`、`target.location`、`target.many`、`target.query`、`trigger.combat`、`trigger.play`、`trigger.state`
- 结论理由：RIFT-9 只因不同印刷标签差异而阻断；Weaponmaster、Equip 和按附着数量计算的伤害已有原语。
- 规则依据：`CR 821`、`CR 818`、`CR 418`、`CR 137`

### ven-042-166 · Shen, Scourge of Shadows
- canonicalCardId：`card.hash-bc2ea9de6b5b9ec4e65b44cd9a1410db1ee6b06013dbd81fb1d1b5daa675f1af`
- 能力摘要：Hold 时若这里恰好还有一个自己的其他单位，则抽一张牌。
- RIFT-9 未归类原因：`printing-stat-type-or-tag-difference`
- 结论：`mappable`
- 模板：`condition`、`draw`、`filter`、`implicit-printed-cost`、`location`、`trigger-score`、`trigger-state`
- 原语：`condition.predicate`、`cost.printed`、`effect.draw`、`effect.zone`、`target.filter`、`target.location`、`target.query`、`trigger.score`、`trigger.state`
- 结论理由：RIFT-9 只因不同印刷标签差异而阻断；Hold 触发、战场同处查询、精确数量条件和抽牌可直接组合。
- 规则依据：`CR 470`、`CR 431`、`CR 359`

### ven-046-166 · Nasus, Ascended
- canonicalCardId：`card.hash-2df5544ffea6f698095320fc6fa4ee6de200fc1053c9c5737ca847fc57e18b35`
- 能力摘要：自带 Deflect 2；可用高额费用 Empower；Empowered 后征服时得 1 分。
- RIFT-9 未归类原因：`printing-stat-type-or-tag-difference`
- 结论：`mappable`
- 模板：`empower`、`implicit-printed-cost`、`kw-deflect`、`kw-empower`、`kw-empowered`、`score`、`trigger-score`、`trigger-state`
- 原语：`condition.predicate`、`cost.activated`、`cost.pay`、`cost.printed`、`effect.empower`、`effect.score`、`target.player`、`target.query`、`target.tax`、`trigger.score`、`trigger.state`
- 结论理由：RIFT-9 只因不同印刷标签差异而阻断；Deflect、Empower、Conquer 得分均有正式规则条目。
- 规则依据：`CR 809`、`CR 442`、`CR 470`

### ven-052-166 · Mesmerize
- canonicalCardId：`card.hash-754aa7addecbea1ffa38ad32f6fbc52273f58dffb461b7a3b18b936fa4eee165`
- 能力摘要：Reaction 二选一：把友方单位回到其拥有者手牌，或使敌方单位本回合 -2 Might。
- RIFT-9 未归类原因：`unmatched-functional-clause`
- 结论：`mappable`
- 模板：`duration`、`filter`、`implicit-printed-cost`、`kw-reaction`、`might`、`mode`、`target`、`zone`
- 原语：`choice.mode`、`continuous.duration`、`continuous.might`、`continuous.timing`、`cost.printed`、`effect.zone`、`target.filter`、`target.query`
- 结论理由：RIFT-9 未匹配的是两个不同区域/持续效果的模式分支；回手用 effect.zone，临时负 Might 用 continuous.might。
- 规则依据：`CR 813`、`CR 178`、`CR 137`

### ven-063-166 · Nasus, Guardian of Knowledge
- canonicalCardId：`card.hash-356162b4f965ef0d8365391eaacb8f6ce7a5990f15529e553d4fd98f3e20bb89`
- 能力摘要：每回合一次，这里有敌方单位死亡时，横置着 Channel 一枚符文。
- RIFT-9 未归类原因：`printing-stat-type-or-tag-difference`
- 结论：`mappable`
- 模板：`channel`、`exhaust`、`filter`、`history`、`implicit-printed-cost`、`location`、`many`、`target`、`trigger-leave`、`trigger-state`
- 原语：`condition.history`、`cost.printed`、`effect.channel`、`effect.exhaust`、`effect.zone`、`target.filter`、`target.location`、`target.many`、`target.query`、`trigger.leave`、`trigger.state`
- 结论理由：RIFT-9 只因不同印刷标签差异而阻断；“每回合一次”用历史条件，“死亡”用离场触发，“横置 Channel”用现有资源效果。
- 规则依据：`CR 429`、`CR 431`、`CR 816`

### ven-065-166 · Swain, Visionary
- canonicalCardId：`card.hash-4f54fa53d7952e0ddc5664e048b84ba9749234c943d017b1e5038773e2f42b74`
- 能力摘要：Vision 查看主牌库顶牌并可回收；本回合已打出非 Token 单位、非 Token Gear 和法术后征服，则得 1 分。
- RIFT-9 未归类原因：`printing-stat-type-or-tag-difference`
- 结论：`mappable`
- 模板：`condition`、`duration`、`filter`、`history`、`implicit-printed-cost`、`kw-vision`、`score`、`token`、`trigger-play`、`trigger-score`、`trigger-state`
- 原语：`choice.optional`、`condition.history`、`condition.predicate`、`continuous.duration`、`cost.printed`、`effect.inspect`、`effect.recycle`、`effect.score`、`effect.token`、`effect.zone`、`target.filter`、`target.location`、`target.player`、`target.query`、`trigger.play`、`trigger.score`、`trigger.state`
- 结论理由：RIFT-9 只因不同印刷标签差异而阻断；Vision、历史条件、分类过滤和得分均已有模板/原语。
- 规则依据：`CR 817`、`CR 233`、`CR 470`、`CR 829`

### ven-068-166 · Jayce, Brilliant Inventor
- canonicalCardId：`card.hash-68f65f2c819cd1b15484ed93f4ae25ec20c4d71f4e4bd05d3a48672d492f5408`
- 能力摘要：打出自身或每回合第一次打出非 Token Gear 时，可选择除自身外的一个横置对象并 Ready。
- RIFT-9 未归类原因：`printing-stat-type-or-tag-difference`
- 结论：`mappable`
- 模板：`exhaust`、`filter`、`history`、`implicit-printed-cost`、`many`、`mode`、`optional`、`ready`、`token`、`trigger-play`、`trigger-state`
- 原语：`choice.mode`、`choice.optional`、`condition.history`、`cost.printed`、`effect.exhaust`、`effect.ready`、`effect.token`、`effect.zone`、`target.filter`、`target.location`、`target.many`、`target.query`、`trigger.play`、`trigger.state`
- 结论理由：RIFT-9 只因不同印刷标签差异而阻断；“打出自身或每回合首次打出非 Token Gear”是现有 play/history 触发组合。
- 规则依据：`CR 817`、`CR 400-406`、`CR 359`、`CR 424`

### ven-069-166 · Mel, Newly Awakened
- canonicalCardId：`card.hash-881035c8e14e8d3c7fa7299235e42c62bb45a5ba4a64f90a6f663abf348954cb`
- 能力摘要：打出时抽牌；可 Empower；Empowered 后自己的法术和能力不能被反制，且其施加的负 Might 额外多 1。
- RIFT-9 未归类原因：`printing-stat-type-or-tag-difference`
- 结论：`mappable`
- 模板：`condition`、`counter`、`draw`、`empower`、`filter`、`implicit-printed-cost`、`kw-empower`、`kw-empowered`、`might`、`mode`、`replacement`、`restrict`、`target`、`trigger-play`、`trigger-state`
- 原语：`choice.mode`、`condition.predicate`、`continuous.duration`、`continuous.might`、`continuous.restrict`、`cost.activated`、`cost.pay`、`cost.printed`、`effect.counter`、`effect.draw`、`effect.empower`、`effect.zone`、`replacement.event`、`target.filter`、`target.query`、`trigger.play`、`trigger.state`
- 结论理由：RIFT-9 只因不同印刷标签差异而阻断；反制限制与负 Might 替代效果已有 replacement/continuous 组合。
- 规则依据：`CR 442`、`CR 364-370`、`CR 404`、`CR 441`

### ven-083-166 · Rampage
- canonicalCardId：`card.hash-9c6aa95845a73edcec9a9568deba187100fbe690f0a6dfcc010810f04e6a9245`
- 能力摘要：打出时可支付额外 Body 符文；选择一友一敌，支付后友方 +2 Might，然后双方按各自 Might 互相造成伤害。
- RIFT-9 未归类原因：`unmatched-functional-clause`
- 结论：`mappable`
- 模板：`additional-cost`、`condition`、`cost-resources`、`damage`、`duration`、`filter`、`implicit-printed-cost`、`many`、`might`、`optional`、`result`、`target`、`value`
- 原语：`choice.optional`、`condition.predicate`、`condition.result`、`condition.value`、`continuous.duration`、`continuous.might`、`cost.additional`、`cost.pay`、`cost.printed`、`effect.damage`、`target.filter`、`target.many`、`target.query`
- 结论理由：RIFT-9 未匹配的是同一指令中的额外费用、条件增益和双向伤害；cost.result、condition.value 与 effect.damage 可保留支付凭证和同时性。
- 规则依据：`CR 349`、`CR 142`、`CR 467`、`CR 404`

### ven-084-166 · Ambessa, The Wolf
- canonicalCardId：`card.hash-e8452b3b9f2d2d608a43289045ddea899510d5650e10a3ffaf7066b5484d0f49`
- 能力摘要：可用费用 Empower；Empowered 后 +3 Might，并且只有在战斗中才能被造成伤害。
- RIFT-9 未归类原因：`printing-stat-type-or-tag-difference`
- 结论：`mappable`
- 模板：`activated`、`condition`、`empower`、`implicit-printed-cost`、`kw-empower`、`kw-empowered`、`might`、`restrict`
- 原语：`condition.predicate`、`continuous.duration`、`continuous.might`、`continuous.restrict`、`cost.activated`、`cost.pay`、`cost.printed`、`effect.empower`、`target.query`、`replacement.prevent`
- 结论理由：RIFT-9 只因不同印刷标签差异而阻断；“仅在战斗中可受伤”是带 combat 条件的 damage prevention。
- 规则依据：`CR 442`、`CR 364-370`、`CR 142`

### ven-085-166 · Decree of Strength
- canonicalCardId：`card.hash-a8174733ce8471dd791d71e2914a7f93d9d2f6c25c8d7937bead01c30d962f4a`
- 能力摘要：选择对手公开其手牌，从中选一张 Mind 牌并将其回收。
- RIFT-9 未归类原因：`unmatched-functional-clause`
- 结论：`mappable`
- 模板：`implicit-printed-cost`、`player`、`recycle`、`reveal`、`target`
- 原语：`cost.printed`、`effect.recycle`、`effect.reveal`、`effect.zone`、`target.player`、`target.query`
- 结论理由：RIFT-9 未匹配的是公开对手手牌后选择并回收；Reveal、玩家查询、标签过滤和 Recycle 已足够，手牌私密投影由规则层处理。
- 规则依据：`CR 425`、`CR 108.7`、`CR 161`、`CR 403`

### ven-086-166 · Gangplank, Naval
- canonicalCardId：`card.hash-b5e0e99c33e99ceb92c979c2c0f321e1350559022b999c6941a10dfd1d0d8508`
- 能力摘要：可用 Body 符文 Empower；Empowered 后，把对它的 Stun、负 Might 或回手事件替换为本回合 +3 Might。
- RIFT-9 未归类原因：`printing-stat-type-or-tag-difference`
- 结论：`mappable`
- 模板：`activated`、`condition`、`empower`、`filter`、`implicit-printed-cost`、`kw-empower`、`kw-empowered`、`kw-stun`、`might`、`mode`、`replacement`、`stun`、`zone`
- 原语：`choice.mode`、`condition.predicate`、`continuous.combat`、`continuous.duration`、`continuous.might`、`cost.activated`、`cost.pay`、`cost.printed`、`effect.empower`、`effect.stun`、`effect.zone`、`replacement.event`、`target.filter`、`target.query`
- 结论理由：RIFT-9 只因不同印刷标签/能力提醒差异而阻断；v1.5 的 replacement、条件范围和 linked-instruction 规则覆盖三种被替换事件。
- 规则依据：`CR 367-370`、`CR 442`、`CR 142`、`Radiance patch: Negated and Ignored Instructions`

### ven-088-166 · Jayce, Hammer in Hand
- canonicalCardId：`card.hash-cb3b4ba5c7faf7ff8048c29675e218c4b9fa878972899ec9a88ecfb730c74cf2`
- 能力摘要：变为 Ready 时选择 Assault 2、Deflect 2 或 Ganking 之一，本回合获得所选能力。
- RIFT-9 未归类原因：`non-reminder-printing-difference, printing-stat-type-or-tag-difference`
- 结论：`mappable`
- 模板：`duration`、`implicit-printed-cost`、`kw-assault`、`kw-deflect`、`kw-ganking`、`mode`、`ready`、`target`、`trigger-state`
- 原语：`choice.mode`、`condition.predicate`、`continuous.duration`、`continuous.might`、`continuous.movement`、`cost.pay`、`cost.printed`、`effect.ready`、`target.location`、`target.query`、`target.tax`、`trigger.state`、`continuous.keyword`
- 结论理由：两版只在关键词提醒文字上不同；Ready 触发的三选一临时关键词授予使用 Assault、Deflect、Ganking 的已有语义，并补上通用 keyword grant 依赖。
- 规则依据：`CR 807`、`CR 809`、`CR 810`、`CR 364-370`

### ven-090-166 · Cataclysmic Duel
- canonicalCardId：`card.hash-52ee12e5ff701518b1a9805038c94f6a69d57289e478e7dc7d6e55ecdc1858e9`
- 能力摘要：每位玩家各保留一个自己控制的单位，其余单位全部被消灭。
- RIFT-9 未归类原因：`unmatched-functional-clause`
- 结论：`mappable`
- 模板：`filter`、`implicit-printed-cost`、`kill`、`many`、`player`、`target`
- 原语：`cost.printed`、`effect.kill`、`effect.zone`、`target.filter`、`target.many`、`target.player`、`target.query`
- 结论理由：RIFT-9 未匹配的是“每位玩家各保留一个，其余消灭”的集合选择；player/many/query/kill 已能表达，不把它简化成手工结算。
- 规则依据：`CR 403`、`CR 428-429`、`CR 055`

### ven-092-166 · Renekton, Brute
- canonicalCardId：`card.hash-84a15f0f4b24ba842c5300ae2aa02facd4e08b04b533d248b5acc6aa5e2f1983`
- 能力摘要：支付费用本回合 +1 Might；Might 达到 10 时 Empower；Empowered 后拥有 Deflect 和 Ganking。
- RIFT-9 未归类原因：`non-reminder-printing-difference, printing-stat-type-or-tag-difference`
- 结论：`mappable`
- 模板：`activated`、`duration`、`empower`、`implicit-printed-cost`、`kw-deflect`、`kw-empower`、`kw-empowered`、`kw-ganking`、`might`、`mode`、`trigger-state`、`value`
- 原语：`choice.mode`、`condition.predicate`、`condition.value`、`continuous.duration`、`continuous.might`、`continuous.movement`、`cost.activated`、`cost.pay`、`cost.printed`、`effect.empower`、`target.location`、`target.query`、`target.tax`、`trigger.state`、`continuous.keyword`
- 结论理由：两版只省略 Empower/Deflect/Ganking 的提醒文字，功能一致；Might 阈值触发和 v1.5 Empower 状态可直接表达。
- 规则依据：`CR 442`、`CR 809`、`CR 810`、`CR 137`

### ven-106-166 · Wind and Ghosts
- canonicalCardId：`card.hash-0ee067030c4b375395ac5d95f7243ff4e4e3a7cbb6f6147ab14d3e2b30998d9f`
- 能力摘要：选择战场上的单位：Might 不超过 3 则放逐，否则回到拥有者手牌。
- RIFT-9 未归类原因：`unmatched-functional-clause`
- 结论：`mappable`
- 模板：`banish`、`condition`、`filter`、`implicit-printed-cost`、`kw-action`、`location`、`mode`、`target`、`value`、`zone`
- 原语：`choice.mode`、`condition.predicate`、`condition.value`、`continuous.timing`、`cost.printed`、`effect.banish`、`effect.zone`、`target.filter`、`target.location`、`target.query`
- 结论理由：RIFT-9 未匹配的是条件两路分支；低于等于 3 的查询走 Banish，否则走回手 zone effect。
- 规则依据：`CR 428`、`CR 178`、`CR 055`、`CR 142`

### ven-109-166 · Illaoi, Prophet of the Great Kraken
- canonicalCardId：`card.hash-aab496105448f9073e9ec14bc0fc63bb55d3209146671be6e19899fb696a2bd2`
- 能力摘要：打出或得分时打出 Bilgewater 的 Tentacle 单位 Token；自己每控制一个 Token 单位便获得 +1 Might。
- RIFT-9 未归类原因：`printing-stat-type-or-tag-difference`
- 结论：`mappable`
- 模板：`activated`、`filter`、`implicit-printed-cost`、`many`、`might`、`mode`、`token`、`trigger-play`、`trigger-score`、`trigger-state`、`value`
- 原语：`choice.mode`、`condition.value`、`continuous.duration`、`continuous.might`、`cost.activated`、`cost.printed`、`effect.token`、`effect.zone`、`target.filter`、`target.location`、`target.many`、`target.query`、`trigger.play`、`trigger.score`、`trigger.state`
- 结论理由：RIFT-9 只因不同印刷标签差异而阻断；Token 创建和按 Token 单位数量的 Might 层均已有原语。
- 规则依据：`CR 184-187`、`CR 470`、`CR 137`

### ven-110-166 · Mel, Defiant Soul
- canonicalCardId：`card.hash-ac23c451a781cab424bef57b9033b37b366730f18b5699ec3fdfd4a7cb61f807`
- 能力摘要：通过弃置法术来 Empower；变为 Empowered 时，放逐战场上 Might 不超过 3 的敌方单位。
- RIFT-9 未归类原因：`printing-stat-type-or-tag-difference`
- 结论：`mappable`
- 模板：`banish`、`discard`、`empower`、`filter`、`implicit-printed-cost`、`kw-empower`、`kw-empowered`、`location`、`mode`、`target`、`trigger-state`、`value`
- 原语：`choice.mode`、`condition.predicate`、`condition.value`、`cost.activated`、`cost.pay`、`cost.printed`、`effect.banish`、`effect.discard`、`effect.empower`、`effect.zone`、`target.filter`、`target.location`、`target.query`、`trigger.state`
- 结论理由：RIFT-9 只因不同印刷标签差异而阻断；丢弃法术作为 Empower 费用，Empowered 事件触发放逐，均有现有原语。
- 规则依据：`CR 442`、`CR 428`、`CR 055`

### ven-112-166 · Zed, Without a Sound
- canonicalCardId：`card.hash-5b42742bf383c1d6c7809e387ff198cfe26b37f06ef74cd7742bf390ea3cf2a7`
- 能力摘要：征服时在基地打出 Shadow Clone Token；之后可支付费用让自身和一个自己控制的 Clone 交换位置。
- RIFT-9 未归类原因：`printing-stat-type-or-tag-difference`
- 结论：`mappable`
- 模板：`activated`、`filter`、`implicit-printed-cost`、`kw-action`、`kw-assault`、`location`、`many`、`move`、`token`、`trigger-play`、`trigger-score`、`trigger-state`、`value`、`banish`
- 原语：`condition.predicate`、`condition.value`、`continuous.duration`、`continuous.might`、`continuous.timing`、`cost.activated`、`cost.printed`、`effect.move`、`effect.token`、`effect.zone`、`target.filter`、`target.location`、`target.many`、`target.query`、`trigger.play`、`trigger.score`、`trigger.state`、`effect.banish`、`continuous.keyword`
- 结论理由：RIFT-9 只因不同印刷标签差异而阻断；Token 内嵌能力、基地位置和双向移动可以组合，不需要把交换写成客户端操作。
- 规则依据：`CR 184-187`、`CR 144`、`CR 829`、`CR 428`

### ven-113-166 · Kennen, Storm of Shuriken
- canonicalCardId：`card.hash-f8e2a3619f710bd235f910a96127e6c5f05eb8a3971f892d3d728bab7dc7d677`
- 能力摘要：打出时 Burn 2；征服时让弃牌区的一张法术本回合获得等同其费用的 Flow。
- RIFT-9 未归类原因：`printing-stat-type-or-tag-difference`
- 结论：`mappable`
- 模板：`duration`、`filter`、`implicit-printed-cost`、`kw-burn`、`kw-flow`、`trigger-play`、`trigger-score`、`trigger-state`、`value`
- 原语：`condition.history`、`condition.predicate`、`condition.value`、`continuous.duration`、`cost.printed`、`effect.mill`、`effect.zone`、`target.filter`、`target.query`、`trigger.play`、`trigger.score`、`trigger.state`、`effect.play`、`cost.modify`、`effect.banish`
- 结论理由：RIFT-9 只因不同印刷标签差异而阻断；Burn、Flow 和“费用等于原费用”的成本修改均有规则定义。
- 规则依据：`CR 432`、`CR 829`、`CR 233`、`CR 428`

### ven-116-166 · Dragon Form
- canonicalCardId：`card.hash-ace1c75d6848b5ce9e834068a2b6255d8f82c7ccf918d3063e5a31698ccdacb6`
- 能力摘要：选择单位，使其本回合基础 Might 变为 5；自身带有 Flow 费用。
- RIFT-9 未归类原因：`unmatched-functional-clause`
- 结论：`mappable`
- 模板：`duration`、`filter`、`implicit-printed-cost`、`kw-flow`、`location`、`might`、`target`、`value`
- 原语：`condition.history`、`condition.predicate`、`condition.value`、`continuous.duration`、`continuous.might`、`cost.printed`、`target.filter`、`target.location`、`target.query`
- 结论理由：RIFT-9 未匹配的是“设置基础 Might”效果；continuous.might 的 set/base 形式和 Flow 已足够。
- 规则依据：`CR 137`、`CR 829`、`Radiance patch: Conditional Clause Scope`

### ven-126-166 · Ki Barrier
- canonicalCardId：`card.hash-c7314bf7e9131668bdd7205b5d3fbea9f04822a76c74bdac078317dc203fae52`
- 能力摘要：Reaction 选择单位，使本回合接下来 7 点伤害被防止。
- RIFT-9 未归类原因：`unmatched-functional-clause`
- 结论：`mappable`
- 模板：`duration`、`filter`、`implicit-printed-cost`、`kw-reaction`、`prevention`、`replacement`、`target`
- 原语：`condition.predicate`、`continuous.duration`、`continuous.timing`、`cost.printed`、`replacement.event`、`replacement.prevent`、`target.filter`、`target.query`
- 结论理由：RIFT-9 未匹配的是有限次数的防伤替代；replacement.prevent 需持有剩余额度并在后续 damage event 中消耗。
- 规则依据：`CR 369-370`、`CR 467`、`CR 142`

### ven-127-166 · Lacerate
- canonicalCardId：`card.hash-918c7c0acc1cff3bf6bc9579ca9dc1dfeec36e9b894becddb7b0eb8918a44cad`
- 能力摘要：选择单位，若已 Empowered 则先 Disempower；若其 Might 不超过 3 则将其消灭；自身带 Flow。
- RIFT-9 未归类原因：`unmatched-functional-clause`
- 结论：`mappable`
- 模板：`activated`、`condition`、`cost-sacrifice`、`empower`、`filter`、`implicit-printed-cost`、`kill`、`kw-empowered`、`kw-flow`、`mode`、`target`、`value`
- 原语：`choice.mode`、`condition.history`、`condition.predicate`、`condition.value`、`cost.activated`、`cost.printed`、`cost.sacrifice`、`effect.empower`、`effect.kill`、`effect.zone`、`target.filter`、`target.query`、`effect.banish`
- 结论理由：RIFT-9 未匹配的是 Disempower 后再判断 Might 的顺序；CR 443.1 与 linked-instruction 规则给出顺序和不可能指令处理。
- 规则依据：`CR 442-443`、`CR 428-429`、`CR 829`、`CR 055`

### ven-134-166 · Kayle, Justified
- canonicalCardId：`card.hash-bc9496bbf6f7cd918c02c302dd1a30bdc473b07744028532891c56fa80672908`
- 能力摘要：可 Empower 最多三次，每次提供 +2 Might；达到三次后获得 Deflect 3 和 Ganking。
- RIFT-9 未归类原因：`non-reminder-printing-difference, printing-stat-type-or-tag-difference`
- 结论：`mappable`
- 模板：`condition`、`duration`、`empower`、`history`、`implicit-printed-cost`、`kw-deflect`、`kw-empower`、`kw-empowered`、`kw-ganking`、`many`、`might`、`value`
- 原语：`condition.history`、`condition.predicate`、`condition.value`、`continuous.duration`、`continuous.might`、`continuous.movement`、`cost.activated`、`cost.pay`、`cost.printed`、`effect.empower`、`target.location`、`target.many`、`target.query`、`target.tax`、`continuous.keyword`
- 结论理由：三次 Empower 是 v1.5 明确支持的 stacking status，不是旧版二元状态；计数、每次 +2、三次关键词条件均由现有原语组合。
- 规则依据：`CR 442.1.c.1`、`CR 443.1.b`、`CR 809`、`CR 810`、`CR 137`

### ven-135-166 · Kennen, Keeper of Balance
- canonicalCardId：`card.hash-6d5c7c18a2ff9af74ab3f4a4b8ac837540733c2922614f53be32ab4e75be8f6b`
- 能力摘要：Hidden；打出或攻击时可支付费用 Stun 一个单位；这里有被 Stun 的敌方单位时自身 +2 Might。
- RIFT-9 未归类原因：`printing-stat-type-or-tag-difference`
- 结论：`mappable`
- 模板：`condition`、`cost-resources`、`filter`、`implicit-printed-cost`、`kw-hidden`、`kw-stun`、`location`、`might`、`mode`、`optional`、`stun`、`target`、`trigger-combat`、`trigger-play`、`trigger-state`
- 原语：`choice.mode`、`choice.optional`、`condition.predicate`、`continuous.combat`、`continuous.duration`、`continuous.might`、`continuous.timing`、`cost.hidden`、`cost.pay`、`cost.printed`、`effect.stun`、`effect.zone`、`target.filter`、`target.location`、`target.query`、`trigger.combat`、`trigger.play`、`trigger.state`
- 结论理由：RIFT-9 只因不同印刷标签差异而阻断；Hidden、play/attack 触发、可选费用、Stun 和位置条件均有现成表达。
- 规则依据：`CR 811`、`CR 424`、`CR 144`、`CR 317.2`

### ven-136-166 · Ambessa, Respected and Feared
- canonicalCardId：`card.hash-e8af5c2839945839572f9122c2803fdda719845f1a7356eca006d791891545cd`
- 能力摘要：可用 Order 符文 Empower；Empowered 后有 Assault 2，攻击时消灭这里一个 Might 更低的敌方单位。
- RIFT-9 未归类原因：`printing-stat-type-or-tag-difference`
- 结论：`mappable`
- 模板：`activated`、`empower`、`filter`、`implicit-printed-cost`、`kill`、`kw-assault`、`kw-empower`、`kw-empowered`、`location`、`target`、`trigger-combat`、`trigger-state`、`value`
- 原语：`condition.predicate`、`condition.value`、`continuous.duration`、`continuous.might`、`cost.activated`、`cost.pay`、`cost.printed`、`effect.empower`、`effect.kill`、`effect.zone`、`target.filter`、`target.location`、`target.query`、`trigger.combat`、`trigger.state`、`continuous.keyword`
- 结论理由：RIFT-9 只因不同印刷标签差异而阻断；Empower 后 Assault 和攻击时条件消灭可直接组合。
- 规则依据：`CR 442`、`CR 807`、`CR 429`、`CR 418`

### ven-142-166 · Dominus
- canonicalCardId：`card.hash-981bce17b37bbc9e61b2bc56b12191d12b4c0d17be51ad4a950324e1e4941c5a`
- 能力摘要：本回合使一个单位的 Might 翻倍，并临时授予它一个支付两枚 Rainbow 符文即可 Ready 自身的激活能力。
- RIFT-9 未归类原因：`unmatched-functional-clause`
- 结论：`needs-new-primitive`
- 模板：`activated`、`duration`、`filter`、`implicit-printed-cost`、`kw-action`、`might`、`ready`、`target`
- 原语：`continuous.duration`、`continuous.might`、`continuous.timing`、`cost.activated`、`cost.printed`、`effect.ready`、`target.filter`、`target.query`、`continuous.grant-ability`
- 新原语建议：`continuous.grant-ability`；在指定持续期间把一个含费用、效果和自指对象引用的 activated ability 授予目标 Game Object；该能力必须按普通 activated ability 的激活、选择、费用、入链和结算流程执行。
- 结论理由：RIFT-9 未匹配的是临时授予一个带费用、自指 Ready 效果的激活能力；现有 effect.ready 只能执行 Ready，不能承载新的 activated-ability 定义，因此需要新增原语。
- 规则依据：`CR 364`、`CR 369-370`、`CR 399-406`、`CR 137`

### ven-145-166 · Curator of the Sands
- canonicalCardId：`card.hash-913749be19f87a0f632bd0690ad0490bb254a346584c09e1b8c3244137f609a7`
- 能力摘要：打出高费用单位、Gear 或激活能力时，可横置自身并 Ready 最多两枚符文。
- RIFT-9 未归类原因：`printing-stat-type-or-tag-difference`
- 结论：`mappable`
- 模板：`cost-modify`、`exhaust`、`filter`、`many`、`mode`、`optional`、`ready`、`target`、`trigger-play`、`trigger-state`、`value`
- 原语：`choice.mode`、`choice.optional`、`condition.value`、`cost.modify`、`cost.printed`、`effect.exhaust`、`effect.ready`、`target.filter`、`target.many`、`target.query`、`trigger.play`、`trigger.state`
- 结论理由：RIFT-9 只因不同印刷标签差异而阻断；高费用分类触发、横置费用和最多两枚符文 Ready 可组合。
- 规则依据：`CR 400-406`、`CR 431`、`CR 424`、`CR 470`

### ven-154-166 · Public Execution
- canonicalCardId：`card.hash-c0e71d5f247d83c5854d4a20f7ece28e38086a6726e768eae11da9b47b22991b`
- 能力摘要：选择友方单位，再消灭一个 Might 更低的敌方单位；自身带 Flow 费用。
- RIFT-9 未归类原因：`unmatched-functional-clause`
- 结论：`mappable`
- 模板：`activated`、`filter`、`implicit-printed-cost`、`kill`、`kw-flow`、`target`、`value`
- 原语：`condition.history`、`condition.predicate`、`condition.value`、`cost.activated`、`cost.printed`、`effect.kill`、`effect.zone`、`target.filter`、`target.query`、`effect.play`、`cost.modify`、`effect.banish`
- 结论理由：RIFT-9 未匹配的是友方 Might 作为比较基准的条件消灭；target/query、condition.value、kill 和 Flow 已覆盖。
- 规则依据：`CR 429`、`CR 829`、`CR 137`、`CR 055`

## 后续实现边界

- 这些结论是实现路线调查，不是已实现或可上线声明；所有卡仍须按 v1.5 目标规则编写 IR、通过规则层验证并补 golden case。
- `continuous.grant-ability` 只解决 Dominus 的能力承载缺口；其 Ready、Might 翻倍、费用支付和能力链流程仍分别复用已有原语与核心规则。
- 备用印刷的 tags / reminder 差异仍应在卡数据审计中保留逐印刷记录，不能把身份主印刷的标签复制到其他印刷。

## JSON 读取示例

```bash
node --input-type=module - <<'JS'
import fs from 'node:fs';
const cards = JSON.parse(fs.readFileSync('docs/plans/survey/unclassified-ven.json', 'utf8'));
console.log(cards.length, cards.filter(card => card.verdict === 'mappable').length);
JS
```

预期输出：`37 36`。
