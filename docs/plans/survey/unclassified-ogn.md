# RIFT-40：OGN / OGS 未归类身份逐卡调研

日期：2026-10-15（UTC）。分支：`task/RIFT-40-triage-ogn`；调研起点：`5ed9d2682ffdf28c38d9d84a63193c5d079ad4a6`。只新增本报告和同名 JSON，不修改源码、测试、契约、目录或旧回放。

## 1. 覆盖与结论

严格按 RIFT-9 JSON 的 `cards` 对象键取 canonicalCardId，筛 `classification === "unclassified"` 且 `primaryPrintingId` 以 `ogn-` / `ogs-` 开头。共 **43 / 43 个身份，40 OGN + 3 OGS**，涉及 **79 个印刷**。不是按所有印刷前缀筛，也不把同名不同副标题合并；零遗漏、零重复。

| 结论 | 身份数 | 含义 |
| --- | ---: | --- |
| mappable | 20 | 规则和文字有依据，能进入 RIFT-9 既有模板/原语的设计路线 |
| needs-new-primitive | 3 | 规则已说明，但 RIFT-9 原语族缺少明确表达边界 |
| data-issue | 19 | 过期勘误或同一身份的权威元数据冲突，先修资料再编译 |
| judge-required | 1 | 保留具体未证实的语义范围，不给近似实现 |
| 合计 | 43 | 20 + 3 + 19 + 1 |

**这些是路线结论，不是执行状态升级。** RIFT-9 的 108 个模板、78 个原语是调研建议，并非已实现 API。所有未实现/资料未修复/规则未确认的正式能力继续保持现有 judge-required/blocked；本报告不改任何覆盖状态，也不称官方引擎已完成。

采用互斥的主结论：先挡资料问题，再检查具体裁定缺口，再区分既有表达/新增表达。data-issue 的模板和原语只表示修复后的候选；例如 Dragon's Rage 同时需要反身触发，但主类仍是资料问题。judge-required 的原语只是可确定动作族，不代表整卡可编译。

## 2. 依据与权威边界

2026-10-15 实际下载 Rules Hub 所链接的 142 页 Core Rules PDF；页首标记 Last Updated 2026-10-09。Hub 的 Radiance 公告明确 **2026-10-16** 生效，因此这里按任务要求评审目标 v1.5，不把它写成 2026-10-15 已生效规则，也不改当前/历史 profile 或默认 schema。

文中 `CR v1.5 N` 都指 S-CR 的条目编号，而不是 PDF 页码；`S-ORIGINS 卡名` 等指对应官方页面的该卡 New Text 条目。摘要和解释均为自己的话，不提交官方卡文/PDF/抽取全文。

| 来源 ID | 官方来源与定位 | 原始证据 SHA-256 |
| --- | --- | --- |
| S-HUB | Rules Hub；`https://playriftbound.com/en-us/rules-hub/` | `6ba33457a24ff2101585f909d68e961240419e31e56ec72fae5ba9b464bf08a5` |
| S-CR | Core Rules，2026-10-09 更新，目标 v1.5；`https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf` | `94d41fee86f88b61c4157c0389c0595d990b98e5b42555c99d9f649ee64d1fec` |
| S-RADIANCE | Radiance Patch Notes，2026-10-09 发布，2026-10-16 生效；`https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/` | `c4cf5cf46b4b2df5f7972c7de2a406ecd9a8b74d7eb2ee73734e24cfe6cf8cae` |
| S-ORIGINS | Origins Card Errata；`https://riftbound.leagueoflegends.com/en-us/news/rules-and-releases/riftbound-origins-card-errata/` | `9b48e2c68c05dfee93e6b7e0e7910aae05f4ba4a6b0f7e94b75e336b65731c36` |
| S-SPIRITFORGED | Spiritforged Errata；`https://riftbound.leagueoflegends.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/` | `75a276ea48bf7adebb19c7f4ba33b600108410453e9e352de0ec4e6888182c57` |
| S-UNLEASHED | Unleashed Errata；`https://playriftbound.com/en-us/news/rules-and-releases/unleashed-errata-updates/` | `e1db9a7d3728c17cb70f589b5bf704fad094d9173fcb18391c2b708cdf635cec` |
| S-VENDETTA | Vendetta Errata；`https://playriftbound.com/en-us/news/announcements/vendetta-errata-updates` | `8d342bbebd38afa9f7bc263125aaa69bb285a3acd4e9429271f95d6b9b0c1db2` |
| S-RADIANCE-ERRATA | Radiance Errata Updates；`https://playriftbound.com/en-us/news/announcements/radiance-errata-updates` | `3401089a01cb292dc0dc71fe342757946ad3ada77add2d90d45815d194dc0a29` |
| S-GALLERY | Riot Publishing API 官方图库；只用于观察元数据及列表结构，不覆盖勘误；`https://content.publishing.riotgames.com/publishing-content/v2.0/public/channel/riftbound_website/list/riftbound_gallery_cards?locale=en_US&from=0&limit=2000` | `41a13fc34daf93a7b90856b1b82692cd677d02969037a3b03251c01e1a291163` |

- RIFT-9 输入：`docs/plans/survey/ability-templates.json`（SHA-256 `d70df5ed938ef2cb1544ec6bc0485aea1d5181890127dae28857f84e87cb12de`），以及 Markdown 第 3、4、7 节。
- 卡文输入：`packages/card-data/data/deck-catalog.json`（SHA-256 `06d99a589fed6046bff8072847946d5304a8ca43ef1e4e2c680c4a7a0f1df766`），主印刷以 groups / survey 双重核对；现有 null 费用只读，未改成 0。
- PDF 使用已安装的 pypdf 抽取，带 `=== PDF PAGE N ===` 页界；正文 `core-rules.txt` SHA-256 为 `8d1537c57d31773546421ff30ddc507a189c0eaa20b0f159a87b4a10e24ee026`。可从 Rules Hub 重下并用 `python3 /tmp/RIFT-40-triage-ogn/extract-sources.py` 复现本机证据。
- HTML 从 `__NEXT_DATA__.props.pageProps.page.blades[].richText.body` 提取，未把相关报道推荐区当正文。包括 Radiance Patch / Radiance Errata，并追查 Origins、Spiritforged、Unleashed、Vendetta 勘误；Radiance Errata 的四个条目未直接涉及本次 43 身份，不能据它撤销早期勘误。
- S-GALLERY 的本次响应 data 为 1408 条，metadata.totalItems 为 1416，不能当全库完整性证明；本任务范围的 79 / 79 印刷 ID 均实际找到。记录 resultsUpdatedAt：`2026-10-15T10:54:57.321529521Z`。图库原始标签自身有冲突，且部分文字仍是旧版：**官方勘误优先于图库陈旧文本**，不能按最新抓取时间覆盖勘误。
- 证据仅位于 `/tmp/RIFT-40-triage-ogn/`，包含 PDF、抽取文本、HTML、图库 JSON、`sources-manifest.json`、复核脚本；不提交这些缓存或图片。

## 3. 新原语建议

以下 ID 是本调研的**建议名**，不伪装成 RIFT-9 已存在 ID，也不修改任何契约。按本范围需要它的身份数降序、同数按 ID 排序。计数包含须先修复资料的调用者，不把其他系列的复用候选加进本范围覆盖数。

| 建议原语 | 本范围身份数 | 调用者 | v1.5 条目 |
| --- | ---: | --- | --- |
| `trigger.reflexive` | 2 | `ogn-200-298`、`ogn-258-298`（资料修复后） | 388.1、388.1.b、389.1、389.2 |
| `effect.extra-turn` | 1 | `ogn-122-298` | 735、736、737、738 |
| `effect.rechoose` | 1 | `ogn-080-298` | 752.1、752.2、753、753.1、753.2、753.3、754、755 |

### trigger.reflexive

执行 Do this / Do one of the following 指令时，按条件生成独立的 pending chain item；捕获上一步对象或数值绑定，再按 FEPR 独立完成选择、费用、合法性和结算。不是把后续效果内联执行，也不是任意触发所有分支。

RIFT-9 缺口：trigger.state 能描述事件触发、trigger.delayed 能描述时间窗口，但均未明示“由执行中的指令生成新 pending 项并独立 finalization”的操作；不能把这一链生命周期藏在 mode/damage 里。

预计复用：Dragon's Rage, Lee Sin（`ogn-258-298`）：S-ORIGINS Dragon's Rage；须先修复旧文本；Arise!（`sfd-198-221`）：S-SPIRITFORGED Arise! 新文本；Guards!（`sfd-154-221`）：S-UNLEASHED Guards! 新文本；Disintegrate（`ogn-005-298`）：S-ORIGINS Disintegrate 新文本；Forgotten Relic（`ven-108-166`）：本地目录 ven-108-166；仅后续复用候选，不是本次裁定；Hwei, Brooding Painter（`unl-080-219`）：本地目录 unl-080-219；仅后续复用候选，不是本次裁定。

### effect.extra-turn

向当前回合之后的临时回合队列插入指定玩家的额外回合；不改永久座次。多个效果按规则队列顺序插入；额外回合走完整阶段与清理，结束后恢复原队列，不能用直接重置阶段或跳过正常回合模拟。

RIFT-9 缺口：没有改变临时回合队列的原语；trigger.phase 只能观察时点，effect.zone 只转区。

预计复用：Promising Future → Time Warp：CR v1.5 738 示例是间接调用，不是 Promising Future 自身直接创建回合；本地 1080 身份未发现第二个直接文本调用者。

### effect.rechoose

对已 finalized 的链项目重新绑定全部可重做选择：入场地点、模式、移动目的地、目标；排除 as-played 决定和可选额外费用。不允许只改一部分，不重打原牌，不再付款；无合法完整选择时否定该指令，重新产生适用的选中触发并保留原有来源限制。

RIFT-9 缺口：target.query 的正常目标选择/重验与 choice.mode 初次选择不包含对 finalized 项的全量重做，也不包含再次产生选中触发及免重付成本。

预计复用：Rebuttal（`ven-152-166`）：本地目录新选择语句；S-RADIANCE Making New Choices 明确点名。


不另造以下原语：减费下限用 `cost.modify`，额外 Hidden 槽位用 `continuous.restrict`，buff 消耗用 `effect.buff` 加成本上下文，recall 用 RIFT-9 已明列的 `effect.move` 的 recall 变体；必须保留支付时机、来源、限制和事件差别，不能因复用名字而省略语义。Lux 的受限能量需要按来源保存份额与可花费谓词，RIFT-9 的 `effect.resources` + `continuous.restrict` 可作规划表达；若父任务冻结的真实契约不支持此组合，仍须请求扩展，不能当普通通用能量释放。

## 4. 逐卡结论

下列模板和既有原语 ID 均来自 RIFT-9；模板列表为人工纠正后的组合，不继承 `unclassified` 占位模板，也不把词法扫描误命中的 ready/replace/mode 等照搬。Main Deck 卡包含正常印刷费用模板；Legend/Battlefield 不补造正常出牌费。原语列给出依赖闭包，不表示本卡文本自身执行每个依赖动作。

### 1. Sky Splitter (ogn-014-298)

- canonicalCardId：`card.hash-94735882304ffe96826dd127aea87fdfaac6f979e3b075524de966b982a9c89f`。
- 能力摘要：己方最高战力降低本咒语能量费用，对一个战场单位造成 5 点伤害。
- RIFT-9 未归类原因：`unmatched-functional-clause`；目录出处：`packages/card-data/data/deck-catalog.json:328`。
- 结论：**mappable**。漏识别的是减费句，不是新效果。用己方单位查询的最大 Might 给 cost.modify 参数；356.4.e 的官方示例直接包含本卡与 Eager Apprentice。减费在总费用步骤读取，不改印刷费用，也不把其他折扣的最低值当全局下限。
- 映射路线，模板 ID：`cost-modify`、`damage`、`filter`、`implicit-printed-cost`、`kw-action`、`location`、`target`、`value`。
- 既有原语 ID（含模板依赖闭包）：`condition.value`、`continuous.timing`、`cost.modify`、`cost.printed`、`effect.damage`、`target.filter`、`target.location`、`target.query`。
- 依据：`CR v1.5 356.4.b`；`CR v1.5 356.4.e`；`CR v1.5 356.4.g`；`CR v1.5 418.1`；`CR v1.5 806.1`。

### 2. Blind Fury (ogn-025-298)

- canonicalCardId：`card.hash-5d9f81372ed036e6b436801528f2d8f8c5ebcc636cfa4c396219c28c446bdfac`。
- 能力摘要：各对手公开牌库顶牌；选一张先放逐再免费打出，其他公开牌回收。
- RIFT-9 未归类原因：`unmatched-functional-clause`；目录出处：`packages/card-data/data/deck-catalog.json:563`。
- 结论：**mappable**。主目录已经包含 S-ORIGINS Blind Fury 的先放逐步骤。每位对手及其牌库是循环绑定；公开不会改变牌的所在区，不能省略 banish，忽略的是基础 Energy 与 Power 而非全部追加费用；未选牌回到各自拥有者牌库。
- 映射路线，模板 ID：`banish`、`cost-modify`、`implicit-printed-cost`、`kw-action`、`many`、`player`、`recycle`、`result`、`reveal`、`special-play`、`target`。
- 既有原语 ID（含模板依赖闭包）：`condition.predicate`、`condition.result`、`condition.value`、`continuous.timing`、`cost.modify`、`cost.printed`、`effect.banish`、`effect.play`、`effect.recycle`、`effect.reveal`、`effect.zone`、`target.many`、`target.player`、`target.query`。
- 依据：`CR v1.5 056.2`；`CR v1.5 355.18`；`CR v1.5 356.1.b.1`；`CR v1.5 356.1.b.3`；`CR v1.5 417.1.c`；`CR v1.5 425.1.a.2`；`CR v1.5 420.5`；`S-ORIGINS Blind Fury`。

### 3. Draven, Showboat (ogn-028-298)

- canonicalCardId：`card.hash-2fce7f4e1db0ed6a111d74a7702d3846593794a9cddf1a1722959543f53ec58e`。
- 能力摘要：自身战力随己方分数持续增加。
- RIFT-9 未归类原因：`printing-stat-type-or-tag-difference`；目录出处：`packages/card-data/data/deck-catalog.json:665`。
- 结论：**data-issue**。OGN 带 Noxus，ven-172-166 不带；本次官方 API 仍重复这一差异，不是 RIFT-9 误报。133.8.a 允许效果引用标签，不能把它当纯展示差异或自动取并集。能力本身可用持续战力与分数值表达，但身份元数据须由 card-data 对照正式牌面/勘误统一。
- 修复后的候选路线，模板 ID：`implicit-printed-cost`、`might`、`value`。
- 既有原语 ID（含模板依赖闭包）：`condition.value`、`continuous.duration`、`continuous.might`、`cost.printed`、`target.query`。
- 依据：`CR v1.5 132.4`；`CR v1.5 133.8.a`；`CR v1.5 479.4`；`S-GALLERY ogn-028-298 / ven-172-166`。

### 4. Jinx, Demolitionist (ogn-030-298)

- canonicalCardId：`card.hash-ebb7c06b81cac9f92ad088fcd2b809aa1e4f83f98e4ae2bbe3ad591e7259a141`。
- 能力摘要：可付加速费用以重置状态入场，进攻时额外战力；打出时弃两张牌。
- RIFT-9 未归类原因：`printing-stat-type-or-tag-difference`；目录出处：`packages/card-data/data/deck-catalog.json:711`。
- 结论：**data-issue**。OGN 带 Zaun，ven-168-166 缺失；官方 API 同样冲突。省略 Accelerate/Assault 提醒不改变能力，但不能据此忽略标签差异。元数据修复后可按既有关键词和弃牌原语编译；弃两张是效果，不是可退款/不可支付的弃牌费用。
- 修复后的候选路线，模板 ID：`discard`、`implicit-printed-cost`、`kw-accelerate`、`kw-assault`、`trigger-play`。
- 既有原语 ID（含模板依赖闭包）：`choice.optional`、`condition.predicate`、`continuous.duration`、`continuous.might`、`cost.additional`、`cost.pay`、`cost.printed`、`effect.discard`、`effect.zone`、`replacement.enter`、`target.query`、`trigger.play`。
- 依据：`CR v1.5 133.8.a`；`CR v1.5 423.4`；`CR v1.5 807.1`；`CR v1.5 805.1`；`S-GALLERY ogn-030-298 / ven-168-166`。

### 5. Shakedown (ogn-033-298)

- canonicalCardId：`card.hash-ba7c14228a3f1b238f24fea9d3c946f61d32728e8186d24e325cee8bce8302f3`。
- 能力摘要：选敌方单位，由它的控制者决定让施法者抽两张，或让该单位承受 6 点伤害。
- RIFT-9 未归类原因：`unmatched-functional-clause`；目录出处：`packages/card-data/data/deck-catalog.json:800`。
- 结论：**mappable**。Choose 单句只是目标绑定。目标在 finalization 选，unless 分支由该单位控制者在结算时决定，不能把选择权交给施法者；抽牌与伤害分支使用现有选择、结果绑定和效果原语，空牌库交给 Burn Out 内核处理。
- 映射路线，模板 ID：`condition`、`damage`、`draw`、`filter`、`implicit-printed-cost`、`kw-reaction`、`mode`、`player`、`result`、`target`。
- 既有原语 ID（含模板依赖闭包）：`choice.mode`、`condition.predicate`、`condition.result`、`continuous.timing`、`cost.printed`、`effect.damage`、`effect.draw`、`effect.zone`、`target.filter`、`target.player`、`target.query`。
- 依据：`CR v1.5 355.5`；`CR v1.5 355.18`；`CR v1.5 359.3.e.5`；`CR v1.5 414.1`；`CR v1.5 418.1`；`CR v1.5 432.1`。

### 6. Vayne, Hunter (ogn-035-298)

- canonicalCardId：`card.hash-af6a9ff16e9f4f9849e489bb4ab37b18a1f12ed88da4b151ac85c770eb68d8c6`。
- 能力摘要：进攻时增加战力；有对手控制战场时重置状态入场；征服后可付能量将自身收回拥有者手牌。
- RIFT-9 未归类原因：`printing-stat-type-or-tag-difference`；目录出处：`packages/card-data/data/deck-catalog.json:852`。
- 结论：**data-issue**。SFD 两印刷多 Sentinel，OGN 没有，官方 API 可复现。不能凭重印较新就为全部身份加 Sentinel，或静默丢弃它。能力可由既有模板表达，但须先固定权威标签；enter ready 是替代，不是先横置再 ready。
- 修复后的候选路线，模板 ID：`condition`、`cost-resources`、`enter`、`implicit-printed-cost`、`kw-assault`、`optional`、`player`、`trigger-score`、`zone`。
- 既有原语 ID（含模板依赖闭包）：`choice.optional`、`condition.predicate`、`continuous.duration`、`continuous.might`、`cost.pay`、`cost.printed`、`effect.zone`、`replacement.enter`、`target.player`、`target.query`、`trigger.score`。
- 依据：`CR v1.5 133.8.a`；`CR v1.5 359.2.c`；`CR v1.5 471.1`；`CR v1.5 369.3`；`S-GALLERY ogn-035-298 / sfd-223-221 / sfd-223-star-221`。

### 7. Vi, Destructive (ogn-036-298)

- canonicalCardId：`card.hash-bcfd5b90d3252713ccfca0703a0d9aef17711a45ff2065bd68d7dd7822950b51`。
- 能力摘要：可标准移动于战场之间；以回收弃牌区一张牌为费用，本回合自身战力增加 1。
- RIFT-9 未归类原因：`printing-stat-type-or-tag-difference`；目录出处：`packages/card-data/data/deck-catalog.json:878`。
- 结论：**data-issue**。OGN 带 Piltover，ven-167-166 缺失，官方 API 一致复现；Ganking 提醒省略不是语义冲突。能力可映射；417.3 以本卡为例明确回收是费用，弃牌区无牌时不能激活。标签问题不能用只比较能力文本绕过。
- 修复后的候选路线，模板 ID：`activated`、`cost-recycle`、`duration`、`implicit-printed-cost`、`kw-ganking`、`might`。
- 既有原语 ID（含模板依赖闭包）：`continuous.duration`、`continuous.might`、`continuous.movement`、`cost.activated`、`cost.printed`、`cost.recycle`、`effect.recycle`、`effect.zone`、`target.location`、`target.query`。
- 依据：`CR v1.5 133.8.a`；`CR v1.5 417.3`；`CR v1.5 810.1`；`S-GALLERY ogn-036-298 / ven-167-166`。

### 8. Kai'Sa, Survivor (ogn-039-298)

- canonicalCardId：`card.hash-6109f0c3bc10309b97f11204acad6c44060c1d502ba47608e1a7e5f37dc4f87f`。
- 能力摘要：可付加速费用以重置状态入场；征服时抽一张。
- RIFT-9 未归类原因：`printing-stat-type-or-tag-difference`；目录出处：`packages/card-data/data/deck-catalog.json:949`。
- 结论：**data-issue**。OGN 两印刷带 The Void，ven-sp1-006 缺失，官方 API 同样冲突。删掉关键词提醒本身无碍，但标签是可引用特征，须独立修复；能力可用加速和征服抽牌路线，不需新原语。
- 修复后的候选路线，模板 ID：`draw`、`implicit-printed-cost`、`kw-accelerate`、`trigger-score`。
- 既有原语 ID（含模板依赖闭包）：`choice.optional`、`cost.additional`、`cost.pay`、`cost.printed`、`effect.draw`、`effect.zone`、`replacement.enter`、`target.query`、`trigger.score`。
- 依据：`CR v1.5 133.8.a`；`CR v1.5 414.1`；`CR v1.5 471.1`；`CR v1.5 805.1`；`S-GALLERY ogn-039-298 / ven-sp1-006`。

### 9. Party Favors (ogn-071-298)

- canonicalCardId：`card.hash-545730428f68ed4f654f780ffcb9e3789ff51480ea2f17983910893660b0dc3f`。
- 能力摘要：每位其他玩家选抽牌或符文，施法者与该玩家分别获得其所选奖励。
- RIFT-9 未归类原因：`unmatched-functional-clause`；目录出处：`packages/card-data/data/deck-catalog.json:1740`。
- 结论：**mappable**。为每位其他玩家保存独立模式值，再遍历两类结果；不是所有人共用一个模式，也不是施法者只领取一次奖励。channel exhausted 使用符文入场状态，不是 Add 能量或先重置入场再横置；多人选择在结算执行。
- 映射路线，模板 ID：`channel`、`draw`、`enter`、`implicit-printed-cost`、`many`、`mode`、`player`、`result`。
- 既有原语 ID（含模板依赖闭包）：`choice.mode`、`condition.predicate`、`condition.result`、`cost.printed`、`effect.channel`、`effect.draw`、`effect.zone`、`replacement.enter`、`target.many`、`target.player`、`target.query`。
- 依据：`CR v1.5 303.2.a`；`CR v1.5 355.10.e`；`CR v1.5 355.18`；`CR v1.5 414.1`；`CR v1.5 431.1`；`CR v1.5 431.2`。

### 10. Sona, Harmonious (ogn-073-298)

- canonicalCardId：`card.hash-dfe8783713db3f1121fbe8f02d18a936119747140a56f3207d218839b579f070`。
- 能力摘要：目录主印刷按战场持续条件在回合末重置四个符文；勘误改为回合末检查战场条件后，至多重置四个友方符文。
- RIFT-9 未归类原因：`non-reminder-printing-difference`、`printing-stat-type-or-tag-difference`；目录出处：`packages/card-data/data/deck-catalog.json:1786`。
- 结论：**data-issue**。S-ORIGINS Sona 已改写触发条件位置并加入 up to，ven-sp2-006 已采用新版而 OGN 仍旧版；另有 Demacia 标签差异。383.2.a.1 直接以新版 Sona 为例：触发时在战场即可，之后响应移走不取消该效果。不能将旧 while 作为持续重验条件继续实现。
- 修复后的候选路线，模板 ID：`condition`、`filter`、`implicit-printed-cost`、`location`、`many`、`ready`、`trigger-phase`。
- 既有原语 ID（含模板依赖闭包）：`condition.predicate`、`cost.printed`、`effect.ready`、`target.filter`、`target.location`、`target.many`、`target.query`、`trigger.phase`。
- 依据：`CR v1.5 133.8.a`；`CR v1.5 383.2.a.1`；`CR v1.5 416.1`；`S-ORIGINS Sona, Harmonious`；`S-GALLERY ogn-073-298 / ven-sp2-006`。

### 11. Mystic Reversal (ogn-080-298)

- canonicalCardId：`card.hash-ea7dd5402b09dfde273f51aee83776f88c4e3f1fb8f52b4863aa43d307a8ebda`。
- 能力摘要：取得一个咒语的控制权，并可为该已在链上的咒语重做选择。
- RIFT-9 未归类原因：`unmatched-functional-clause`；目录出处：`packages/card-data/data/deck-catalog.json:2031`。
- 结论：**needs-new-primitive**。effect.control 能改控制者，但 target.query 的正常选择/重验和 choice.mode 的初次模式选择不能代表 750 节的重新选择生命周期。须新增 effect.rechoose；Radiance 专门改为全部选择重做，并再次触发适用的选中效果。只换目标、不重验来源限制或重新付款均不正确。
- 映射路线，模板 ID：`control`、`filter`、`implicit-printed-cost`、`kw-reaction`、`optional`、`target`。
- 既有原语 ID（含模板依赖闭包）：`choice.optional`、`continuous.duration`、`continuous.timing`、`cost.printed`、`effect.control`、`target.filter`、`target.query`。 拟新增：`effect.rechoose`（实现所必需；语义及复用见第 3 节）。
- 依据：`CR v1.5 355.9.a`；`CR v1.5 355.15`；`CR v1.5 191.3`；`CR v1.5 752.1`；`CR v1.5 752.2`；`CR v1.5 753`；`CR v1.5 753.3`；`CR v1.5 754`；`CR v1.5 755`；`S-RADIANCE Making New Choices`。

### 12. Eager Apprentice (ogn-084-298)

- canonicalCardId：`card.hash-e5d8b2e1e9ee0d9e2669fae947f4252a33dfc970df9cd39ad8477263b66fccc6`。
- 能力摘要：位于战场时，己方咒语获得减一能量费用的折扣，该折扣最低降至一。
- RIFT-9 未归类原因：`unmatched-functional-clause`；目录出处：`packages/card-data/data/deck-catalog.json:2116`。
- 结论：**mappable**。只是旧扫描器漏掉 reduced by。cost.modify 的 min 参数只约束本次折扣，不把基础零费抬到一，也不阻止其他折扣继续降到零；356.4.e 直接列本卡与 Sky Splitter 的折扣顺序。离开战场后被动效果不再适用。
- 映射路线，模板 ID：`condition`、`cost-modify`、`filter`、`implicit-printed-cost`、`location`、`value`。
- 既有原语 ID（含模板依赖闭包）：`condition.predicate`、`condition.value`、`cost.modify`、`cost.printed`、`target.filter`、`target.location`、`target.query`。
- 依据：`CR v1.5 356.4.b`；`CR v1.5 356.4.e`；`CR v1.5 365.1`；`CR v1.5 479.4`。

### 13. Convergent Mutation (ogn-108-298)

- canonicalCardId：`card.hash-6d70f12e2dfb5fbc2398e27f4f4f03110c0310091884499b782107d95b9d6c65`。
- 能力摘要：让一名友方单位本回合获得战力增量，增至另一名友方单位的当前战力。
- RIFT-9 未归类原因：`unmatched-functional-clause`；目录出处：`packages/card-data/data/deck-catalog.json:2646`。
- 结论：**mappable**。主目录符合 S-ORIGINS 新文本。两个不同友方单位均须按目标规则绑定，结算读取合法对象的当前 Might；增量取不能为负的差值并按 arithmetic snapshot 保存，不是修改 base Might、持续追随另一单位或降低较高战力。任一所需引用变 null 时忽略相关指令。
- 映射路线，模板 ID：`duration`、`filter`、`implicit-printed-cost`、`kw-reaction`、`many`、`might`、`target`、`value`。
- 既有原语 ID（含模板依赖闭包）：`condition.value`、`continuous.duration`、`continuous.might`、`continuous.timing`、`cost.printed`、`target.filter`、`target.many`、`target.query`。
- 依据：`CR v1.5 355.10`；`CR v1.5 359.3.e.12`；`CR v1.5 359.3.f.2`；`CR v1.5 479.4.b`；`CR v1.5 479.4.c`；`S-ORIGINS Convergent Mutation`。

### 14. Promising Future (ogn-115-298)

- canonicalCardId：`card.hash-d7bf59ee29e8ca9c306efe1bf2bd701f4edb154b5dea8674d4b6dc7aff35f61d`。
- 能力摘要：各玩家查看自己牌库顶五张并留一张用于依次打出，其余回收；只忽略能量费。
- RIFT-9 未归类原因：`unmatched-functional-clause`；目录出处：`packages/card-data/data/deck-catalog.json:2843`。
- 结论：**data-issue**。S-ORIGINS Promising Future 要求从五张中先放逐一张，目录主印刷和本次图库仍是只选择，缺少关键转区。修复后可复用 inspect/banish/play：从下一玩家开始入链，只免 Energy，Power 与追加费用仍支付；pending 项不能被 Mystic Reversal 等选择。不能从未获许可的牌库直接打出。
- 修复后的候选路线，模板 ID：`banish`、`choice-order`、`cost-modify`、`implicit-printed-cost`、`inspect`、`many`、`player`、`recycle`、`result`、`special-play`。
- 既有原语 ID（含模板依赖闭包）：`choice.order`、`condition.predicate`、`condition.result`、`condition.value`、`continuous.timing`、`cost.modify`、`cost.printed`、`effect.banish`、`effect.inspect`、`effect.play`、`effect.recycle`、`effect.zone`、`target.many`、`target.player`、`target.query`。
- 依据：`CR v1.5 303.2.a`；`CR v1.5 355.9.a`；`CR v1.5 356.1.b.2`；`CR v1.5 420.5`；`CR v1.5 738`；`S-ORIGINS Promising Future`；`S-RADIANCE Pending Item Target Legality`。

### 15. Viktor, Innovator (ogn-117-298)

- canonicalCardId：`card.hash-27a69aef36a430f79f170618dfa72e36b2605b39fa8a3a67366ac01669844aa0`。
- 能力摘要：在对手回合打出牌时，在自己的基地打出一个 Recruit 衍生单位。
- RIFT-9 未归类原因：`non-reminder-printing-difference`、`printing-stat-type-or-tag-difference`；目录出处：`packages/card-data/data/deck-catalog.json:2891`。
- 结论：**data-issue**。OGN 带 Zaun，ven-176-166 缺失；官方 API 同样冲突。in/to your base 的文字差异在该效果中是同一入场地点，不是新机制；整卡仍需解决标签。token 使用正式 Recruit 定义，不能临时拼一个不带规则来源的单位。
- 修复后的候选路线，模板 ID：`condition`、`implicit-printed-cost`、`location`、`player`、`token`、`trigger-play`。
- 既有原语 ID（含模板依赖闭包）：`condition.predicate`、`cost.printed`、`effect.token`、`effect.zone`、`target.location`、`target.player`、`target.query`、`trigger.play`。
- 依据：`CR v1.5 133.8.a`；`CR v1.5 187.1`；`CR v1.5 383.1`；`S-GALLERY ogn-117-298 / ven-176-166`。

### 16. Ahri, Inquisitive (ogn-119-298)

- canonicalCardId：`card.hash-c68ef91624a369cffdc5c5e3f81ab2700878a51de07b1cde21bbfc25db8dea10`。
- 能力摘要：攻击或防守时，本回合降低同地一名敌方单位的战力，最低为一。
- RIFT-9 未归类原因：`printing-stat-type-or-tag-difference`；目录出处：`packages/card-data/data/deck-catalog.json:2966`。
- 结论：**data-issue**。OGN 与 VEN 特印含 Ionia，SFD 两印刷不含；官方 API 可复现。攻击/防守是两个可触发事件，不是玩家二选一模式；能力可映射到战斗触发、地点和带下限快照的减战力，但不能略过标签冲突。
- 修复后的候选路线，模板 ID：`duration`、`filter`、`implicit-printed-cost`、`location`、`might`、`target`、`trigger-combat`。
- 既有原语 ID（含模板依赖闭包）：`continuous.duration`、`continuous.might`、`cost.printed`、`target.filter`、`target.location`、`target.query`、`trigger.combat`。
- 依据：`CR v1.5 133.8.a`；`CR v1.5 359.3.f.2`；`CR v1.5 383.1`；`CR v1.5 479.4.b`；`S-GALLERY ogn-119-298 / sfd-227-221 / ven-sp3-006`。

### 17. Teemo, Strategist (ogn-121-298)

- canonicalCardId：`card.hash-605d9e63c28576716347062f9abdcd9fe543138a4b9bee8f5308c24ffac2ae1e`。
- 能力摘要：旧目录允许防守或从隐藏打出时翻五张并按隐藏牌数量伤害；勘误只保留防守触发，先选择同地敌方单位再翻牌。
- RIFT-9 未归类原因：`printing-stat-type-or-tag-difference`；目录出处：`packages/card-data/data/deck-catalog.json:3039`。
- 结论：**data-issue**。S-ORIGINS Teemo 删除 played-from-Hidden 分支并明确目标选择早于公开五张牌；主印刷及 SFD 仍是旧文字，且 Bandle City 标签不一致。135.2.b.5.a 和 715.4 已引用新版。须以正式勘误更新能力，不能保留双触发或看完牌才选目标。
- 修复后的候选路线，模板 ID：`damage`、`filter`、`implicit-printed-cost`、`kw-hidden`、`location`、`recycle`、`result`、`reveal`、`target`、`trigger-combat`、`value`。
- 既有原语 ID（含模板依赖闭包）：`condition.predicate`、`condition.result`、`condition.value`、`continuous.timing`、`cost.hidden`、`cost.pay`、`cost.printed`、`effect.damage`、`effect.recycle`、`effect.reveal`、`effect.zone`、`target.filter`、`target.location`、`target.query`、`trigger.combat`。
- 依据：`CR v1.5 133.8.a`；`CR v1.5 135.2.b.5.a`；`CR v1.5 355.5`；`CR v1.5 715.4`；`CR v1.5 811.1`；`S-ORIGINS Teemo, Strategist`；`S-GALLERY ogn-121-298 / sfd-230-221`。

### 18. Time Warp (ogn-122-298)

- canonicalCardId：`card.hash-037ac90c7e1ee070f9dea523811caa91e2b1f5c8018e4cc7753149ebb5eba7d7`。
- 能力摘要：为施法者安排当前回合之后的额外回合，并将自身放逐。
- RIFT-9 未归类原因：`unmatched-functional-clause`；目录出处：`packages/card-data/data/deck-catalog.json:3086`。
- 结论：**needs-new-primitive**。RIFT-9 的 78 个原语没有回合队列修改能力；effect.zone 或 trigger.phase 不能创建一个完整回合。新增 effect.extra-turn，按 735–738 处理插入顺序及原座次恢复，自身放逐仍用现有 banish。规则本身明确，不应因缺代码而标规则歧义。
- 映射路线，模板 ID：`banish`、`implicit-printed-cost`、`player`。
- 既有原语 ID（含模板依赖闭包）：`cost.printed`、`effect.banish`、`effect.zone`、`target.player`、`target.query`。 拟新增：`effect.extra-turn`（实现所必需；语义及复用见第 3 节）。
- 依据：`CR v1.5 359.3.e.15`；`CR v1.5 428.1`；`CR v1.5 735`；`CR v1.5 736`；`CR v1.5 737`；`CR v1.5 738`。

### 19. Challenge (ogn-128-298)

- canonicalCardId：`card.hash-27cf1792f7bb4da955117bb4a15cb33f4e4705984cacfac9055a2884b061e4e1`。
- 能力摘要：一名友方与一名敌方单位按各自战力互相造成伤害。
- RIFT-9 未归类原因：`unmatched-functional-clause`；目录出处：`packages/card-data/data/deck-catalog.json:3232`。
- 结论：**mappable**。Choose 句是两个目标的绑定。418.6.b.3 直接用本卡说明伤害来源是两个单位而非咒语；用 effect.damage 的来源及多对象批次表达，先取得合法双方当前 Might，不能调用战斗步骤、触发攻击/防守或把双方伤害错误归给施法者。
- 映射路线，模板 ID：`damage`、`filter`、`implicit-printed-cost`、`kw-action`、`many`、`target`、`value`。
- 既有原语 ID（含模板依赖闭包）：`condition.value`、`continuous.timing`、`cost.printed`、`effect.damage`、`target.filter`、`target.many`、`target.query`。
- 依据：`CR v1.5 355.5`；`CR v1.5 359.3.f.2`；`CR v1.5 418.1.d`；`CR v1.5 418.6.b.3`；`CR v1.5 418.6.b.4`。

### 20. Herald of Scales (ogn-140-298)

- canonicalCardId：`card.hash-8f0ac98c17845f49a654e9543fdfa1946ec646cc7efc52fbd3395790fb4be660`。
- 能力摘要：己方 Dragon 牌获得减两能量费用的折扣，该折扣最低降至一。
- RIFT-9 未归类原因：`unmatched-functional-clause`；目录出处：`packages/card-data/data/deck-catalog.json:3493`。
- 结论：**mappable**。Dragon 标签筛选加 cost.modify 即可，不是新原语。只作用于己方符合标签的牌的 Energy 分量；最低值只限制此折扣，不提升原本更低的费用，也不修改 Power 或印刷费用。
- 映射路线，模板 ID：`cost-modify`、`filter`、`implicit-printed-cost`、`value`。
- 既有原语 ID（含模板依赖闭包）：`condition.value`、`cost.modify`、`cost.printed`、`target.filter`、`target.query`。
- 依据：`CR v1.5 133.8.a`；`CR v1.5 356.4.b`；`CR v1.5 356.4.e`；`CR v1.5 479.4`。

### 21. Wallop (ogn-146-298)

- canonicalCardId：`card.hash-d17776003a48b0ee24115e1938482e85fa10ac7c582b993ca9d4b891b3dd1d48`。
- 能力摘要：可消耗一个己方 buff 作为追加费用来免本咒语基础费用，然后重置一名单位。
- RIFT-9 未归类原因：`unmatched-functional-clause`；目录出处：`packages/card-data/data/deck-catalog.json:3617`。
- 结论：**mappable**。RIFT-9 effect.buff 的边界已包含添加/消耗；与 cost.additional 和支付记录组合即可，不需把 buff 当 Energy，也不需新资源系统。finalization 声明并支付合法己方 buff；忽略基础 Energy/Power 不免其他追加费用。counter 费用选择不属于目标选择。
- 映射路线，模板 ID：`additional-cost`、`buff`、`cost-modify`、`implicit-printed-cost`、`kw-action`、`optional`、`ready`、`result`、`target`。
- 既有原语 ID（含模板依赖闭包）：`choice.optional`、`condition.predicate`、`condition.result`、`condition.value`、`continuous.duration`、`continuous.might`、`continuous.timing`、`cost.additional`、`cost.modify`、`cost.printed`、`effect.buff`、`effect.ready`、`target.query`。
- 依据：`CR v1.5 355.10.c`；`CR v1.5 356.1.b`；`CR v1.5 356.2.b`；`CR v1.5 357.2`；`CR v1.5 702.2.b`；`CR v1.5 742.1`；`CR v1.5 745.2`。

### 22. Sabotage (ogn-156-298)

- canonicalCardId：`card.hash-ec4ca2df92b603ace480ec363b3bd1f1ce182f05602b2dd361a08eadfd7574a6`。
- 能力摘要：选一个对手，公开其手牌，并将其中一张非单位牌回收。
- RIFT-9 未归类原因：`unmatched-functional-clause`；目录出处：`packages/card-data/data/deck-catalog.json:3869`。
- 结论：**mappable**。先在 finalization 选择对手；手牌对象属于非公开区，公开信息不会把手牌区变成 Public Zone，因此牌的选择在结算时按公开集合进行，不能把未知手牌预先列为公共目标，也不能伪造弃牌动作。回收去拥有者对应牌库。
- 映射路线，模板 ID：`filter`、`implicit-printed-cost`、`player`、`recycle`、`result`、`reveal`、`target`。
- 既有原语 ID（含模板依赖闭包）：`condition.predicate`、`condition.result`、`cost.printed`、`effect.recycle`、`effect.reveal`、`effect.zone`、`target.filter`、`target.player`、`target.query`。
- 依据：`CR v1.5 355.5`；`CR v1.5 355.10.a`；`CR v1.5 355.18`；`CR v1.5 417.1.c`；`CR v1.5 425.1.a`；`CR v1.5 425.3.a`；`CR v1.5 425.4`。

### 23. Sett, Brawler (ogn-164-298)

- canonicalCardId：`card.hash-7f8a999072e7b65566be686c006f6ade129a206d08922b9e25ebe2d9167d26ae`。
- 能力摘要：打出或征服时获得 buff；消耗自身 buff 可在本回合增加四点战力。
- RIFT-9 未归类原因：`non-reminder-printing-difference`、`printing-stat-type-or-tag-difference`；目录出处：`packages/card-data/data/deck-catalog.json:4116`。
- 结论：**data-issue**。OGN 带 Ionia，SFD/VEN 缺失，官方 API 仍冲突；新版 When you play me or when I conquer 与旧版双事件不是模式选择。effect.buff 已覆盖消耗，成本置于 activated 边界，不能把 spend 降为结算时可失败的免费效果。元数据统一后走既有路线。
- 修复后的候选路线，模板 ID：`activated`、`buff`、`duration`、`implicit-printed-cost`、`might`、`trigger-play`、`trigger-score`。
- 既有原语 ID（含模板依赖闭包）：`condition.predicate`、`continuous.duration`、`continuous.might`、`cost.activated`、`cost.printed`、`effect.buff`、`target.query`、`trigger.play`、`trigger.score`。
- 依据：`CR v1.5 133.8.a`；`CR v1.5 204.1.b`；`CR v1.5 357.2`；`CR v1.5 383.1`；`CR v1.5 702.2.b`；`S-GALLERY ogn-164-298 / sfd-232-221 / ven-sp4-006`。

### 24. Miss Fortune, Buccaneer (ogn-193-298)

- canonicalCardId：`card.hash-713732fef292fb529d388efbec2020949fdfaeca0c39e3afeb5ed43119a7f3e5`。
- 能力摘要：自身和友方单位可以直接打到空且无人控制的战场。
- RIFT-9 未归类原因：`unmatched-functional-clause`；目录出处：`packages/card-data/data/deck-catalog.json:4792`。
- 结论：**mappable**。用 continuous.location 添加入场地点许可；170.11.c 明确 open 同时要求无单位与无控制者，不能只判断无人控制，也不是 Ganking 或改变出牌时机。自身许可在打出时可用，友方许可随该被动在场生效；目标地点按 355.2.b 校验。
- 映射路线，模板 ID：`condition`、`filter`、`implicit-printed-cost`、`location`、`special-play`。
- 既有原语 ID（含模板依赖闭包）：`condition.predicate`、`continuous.location`、`continuous.timing`、`cost.printed`、`effect.play`、`effect.zone`、`target.filter`、`target.location`、`target.query`。
- 依据：`CR v1.5 170.11.c`；`CR v1.5 355.2.b`；`CR v1.5 365.1`；`CR v1.5 366.1`。

### 25. Twisted Fate, Gambler (ogn-200-298)

- canonicalCardId：`card.hash-6d4a83a454e91140b5cccaf25cef83d38b553d0863d8f7c80b8719fe33d8475e`。
- 能力摘要：攻击时展示并回收符文库顶符文，按该符文的域生成伤害、抽牌或晕眩后续效果。
- RIFT-9 未归类原因：`unmatched-functional-clause`；目录出处：`packages/card-data/data/deck-catalog.json:5012`。
- 结论：**needs-new-primitive**。Do one of the following 在 388.1.b 是反身触发，不是玩家任意选模式，也不能把所有后续效果内联进攻击触发。新增 trigger.reflexive，保存已公开并回收符文的域，再生成对应独立 pending 项，由该项进行自己的目标选择/结算。目录三个分支连写是列表序列化缺失换行，S-GALLERY 的 ul/li 能恢复边界，文字未截断。
- 映射路线，模板 ID：`condition`、`damage`、`draw`、`filter`、`implicit-printed-cost`、`location`、`many`、`recycle`、`result`、`reveal`、`stun`、`trigger-combat`。
- 既有原语 ID（含模板依赖闭包）：`condition.predicate`、`condition.result`、`continuous.combat`、`continuous.duration`、`cost.printed`、`effect.damage`、`effect.draw`、`effect.recycle`、`effect.reveal`、`effect.stun`、`effect.zone`、`target.filter`、`target.location`、`target.many`、`target.query`、`trigger.combat`。 拟新增：`trigger.reflexive`（实现所必需；语义及复用见第 3 节）。
- 依据：`CR v1.5 388.1.b`；`CR v1.5 389.1`；`CR v1.5 389.2`；`CR v1.5 417.1.b`；`CR v1.5 425.1.a.2`；`CR v1.5 359.3.e.13`；`S-GALLERY ogn-200-298 text.richText.body`。

### 26. Possession (ogn-203-298)

- canonicalCardId：`card.hash-18e556f7feed1c4774ba2262a9ef50441960dfa08dadbf07fd4011f655b4f544`。
- 能力摘要：取得战场上一名敌方单位的控制权，再将它召回至新控制者的基地。
- RIFT-9 未归类原因：`unmatched-functional-clause`；目录出处：`packages/card-data/data/deck-catalog.json:5104`。
- 结论：**mappable**。选择单位后按顺序先改变控制者，再执行 recall。RIFT-9 effect.move 明列 move/recall，但 IR 必须保留 recall 变体，不发 Move 事件，不凭空横置或治疗；不把单位送入卡牌拥有者而非新控制者的基地。无明示期限的控制不添加回合末归还。
- 映射路线，模板 ID：`control`、`filter`、`implicit-printed-cost`、`kw-action`、`location`、`move`、`result`、`target`。
- 既有原语 ID（含模板依赖闭包）：`condition.predicate`、`condition.result`、`continuous.duration`、`continuous.timing`、`cost.printed`、`effect.control`、`effect.move`、`target.filter`、`target.location`、`target.query`。
- 依据：`CR v1.5 191.4`；`CR v1.5 359.3.e.14`；`CR v1.5 457`；`CR v1.5 458`；`CR v1.5 460.1`。

### 27. Yasuo, Windrider (ogn-205-298)

- canonicalCardId：`card.hash-03848f0e530587876003913478c758509f6b05e8b89b33575cb4fd9da70f9cf1`。
- 能力摘要：可标准移动于战场之间；每回合第三次移动时获得一分。
- RIFT-9 未归类原因：`printing-stat-type-or-tag-difference`；目录出处：`packages/card-data/data/deck-catalog.json:5150`。
- 结论：**data-issue**。OGN 带 Ionia，SFD 两印刷缺失，官方 API 同样冲突。能力可用对象级移动历史和第三次事件触发；recall 不计 Move，不能把每三次循环触发写成第三次。470.2 明确卡文 score 1 point 是获分，不是战场征服计分流程。
- 修复后的候选路线，模板 ID：`history`、`implicit-printed-cost`、`kw-ganking`、`score`、`trigger-move`。
- 既有原语 ID（含模板依赖闭包）：`condition.history`、`continuous.movement`、`cost.printed`、`effect.score`、`target.location`、`target.player`、`target.query`、`trigger.move`。
- 依据：`CR v1.5 133.8.a`；`CR v1.5 383.1`；`CR v1.5 458`；`CR v1.5 470.2`；`CR v1.5 810.1`；`S-GALLERY ogn-205-298 / sfd-235-221`。

### 28. Call to Glory (ogn-207-298)

- canonicalCardId：`card.hash-9eef9a0508648141992bbe70aa56b64551bbd00d06fd8be401c85dda6f542339`。
- 能力摘要：可消耗一个己方 buff 作为追加费用来免本咒语基础费用，令一名单位本回合加三战力。
- RIFT-9 未归类原因：`unmatched-functional-clause`；目录出处：`packages/card-data/data/deck-catalog.json:5216`。
- 结论：**mappable**。同 Wallop 的成本组合可复用。消耗 buff 是 finalization 非资源追加费用；按结果记录决定基础费用忽略，不吞掉其他费用。buff 的来源对象不是因为付费而成为本咒语目标，战力目标另行选择，持续至回合末。
- 映射路线，模板 ID：`additional-cost`、`buff`、`cost-modify`、`duration`、`implicit-printed-cost`、`kw-reaction`、`might`、`optional`、`result`、`target`。
- 既有原语 ID（含模板依赖闭包）：`choice.optional`、`condition.predicate`、`condition.result`、`condition.value`、`continuous.duration`、`continuous.might`、`continuous.timing`、`cost.additional`、`cost.modify`、`cost.printed`、`effect.buff`、`target.query`。
- 依据：`CR v1.5 355.10.c`；`CR v1.5 356.1.b`；`CR v1.5 356.2.b`；`CR v1.5 357.2`；`CR v1.5 702.2.b`；`CR v1.5 742.1`；`CR v1.5 745.2`。

### 29. Karma, Channeler (ogn-235-298)

- canonicalCardId：`card.hash-65e0ab54a0954e391f643dc900a7a0faa2cd298faa850e7c436e13659498922d`。
- 能力摘要：打出时可查看并回收主牌库顶牌；勘误后，每次将一批牌回收到主牌库时 buff 一名友方单位。
- RIFT-9 未归类原因：`printing-stat-type-or-tag-difference`；目录出处：`packages/card-data/data/deck-catalog.json:5851`。
- 结论：**data-issue**。S-ORIGINS Karma 为回收触发加上 to your Main Deck，主目录仍缺这一区域条件。还存在 Ionia 缺失的重印差异；本次官方 API 的 OGN 甚至把英雄标签写成 Vi，不能用图库覆盖勘误或覆盖目录中 Karma 标签。一次一批回收只触发一次，符文回收不满足新条件。
- 修复后的候选路线，模板 ID：`buff`、`condition`、`filter`、`implicit-printed-cost`、`kw-vision`、`recycle`、`target`、`trigger-state`。
- 既有原语 ID（含模板依赖闭包）：`choice.optional`、`condition.predicate`、`continuous.duration`、`continuous.might`、`cost.printed`、`effect.buff`、`effect.inspect`、`effect.recycle`、`effect.zone`、`target.filter`、`target.query`、`trigger.play`、`trigger.state`。
- 依据：`CR v1.5 052`；`CR v1.5 133.8.a`；`CR v1.5 383.1`；`CR v1.5 417.1.a`；`CR v1.5 417.1.b`；`CR v1.5 817.1`；`S-ORIGINS Karma, Channeler`；`S-GALLERY ogn-235-298 / sfd-237-221`。

### 30. King's Edict (ogn-237-298)

- canonicalCardId：`card.hash-b27ddd6f340335a3b0cd6b5ad2ba3cd49695bb3a7430d3cfe541271f528f0baf`。
- 能力摘要：从下一位玩家起，各其他玩家选一个施法者不控制且尚未被该咒语选过的单位，随后消灭所选单位。
- RIFT-9 未归类原因：`unmatched-functional-clause`；目录出处：`packages/card-data/data/deck-catalog.json:5898`。
- 结论：**mappable**。使用有序玩家循环和已选集合去重，不用随机选取或只支持 1v1。355.10.e 规定这种由其他玩家选取的集合不是咒语目标，355.18 使选择在结算完成；不能在 finalization 预填所有选择，也不把每次选择误作独立 kill。
- 映射路线，模板 ID：`choice-order`、`filter`、`implicit-printed-cost`、`kill`、`many`、`player`、`result`、`target`。
- 既有原语 ID（含模板依赖闭包）：`choice.order`、`condition.predicate`、`condition.result`、`cost.printed`、`effect.kill`、`effect.zone`、`target.filter`、`target.many`、`target.player`、`target.query`。
- 依据：`CR v1.5 055`；`CR v1.5 303.2.a`；`CR v1.5 355.10.e`；`CR v1.5 355.18`；`CR v1.5 429.1`。

### 31. Leona, Determined (ogn-238-298)

- canonicalCardId：`card.hash-5cbcf053019f85d2ed95e9f9710c31e3286d72d0e93b515699b5b03dc6f9d0e4`。
- 能力摘要：防守时获得 Shield 战力；攻击时晕眩一名同地敌方单位。
- RIFT-9 未归类原因：`printing-stat-type-or-tag-difference`；目录出处：`packages/card-data/data/deck-catalog.json:5924`。
- 结论：**data-issue**。OGN 带 Mount Targon，ven-184-166 不带，官方 API 同样冲突。提醒删减不改变 Shield 或 Stun；能力可映射，但整卡身份元数据待统一。晕眩不横置单位，也不是让它不承受伤害。
- 修复后的候选路线，模板 ID：`filter`、`implicit-printed-cost`、`kw-shield`、`location`、`stun`、`target`、`trigger-combat`。
- 既有原语 ID（含模板依赖闭包）：`condition.predicate`、`continuous.combat`、`continuous.duration`、`continuous.might`、`cost.printed`、`effect.stun`、`target.filter`、`target.location`、`target.query`、`trigger.combat`。
- 依据：`CR v1.5 133.8.a`；`CR v1.5 424.1.b`；`CR v1.5 814.1`；`S-GALLERY ogn-238-298 / ven-184-166`。

### 32. Darius, Executioner (ogn-243-298)

- canonicalCardId：`card.hash-e6a58258933ab19a3c7228a2f9c1ca8bc777a3d378b3ee92ae1b4deca50792b9`。
- 能力摘要：满足 Legion 时打出后重置自身；同地其他友方单位持续加一战力。
- RIFT-9 未归类原因：`printing-stat-type-or-tag-difference`；目录出处：`packages/card-data/data/deck-catalog.json:6097`。
- 结论：**data-issue**。OGN 带 Noxus，SFD 两印刷缺失，官方 API 同样冲突；Trifarian 保留，不能把所有非英雄标签一并清掉。能力用既有 Legion 历史条件与同地排除自身的持续修正；打出后的 ready 是触发效果，不改写成 enter-ready 替代。
- 修复后的候选路线，模板 ID：`filter`、`implicit-printed-cost`、`kw-legion`、`location`、`might`、`ready`、`trigger-play`。
- 既有原语 ID（含模板依赖闭包）：`condition.history`、`condition.predicate`、`continuous.duration`、`continuous.might`、`cost.printed`、`effect.ready`、`target.filter`、`target.location`、`target.query`、`trigger.play`。
- 依据：`CR v1.5 133.8.a`；`CR v1.5 359.2.c`；`CR v1.5 416.1`；`CR v1.5 479.4`；`CR v1.5 812.1`；`S-GALLERY ogn-243-298 / sfd-236-221`。

### 33. Divine Judgment (ogn-244-298)

- canonicalCardId：`card.hash-adf97d6260131adb3a3b5b54d1904b16d8330ea2476fe31e8652a57b081a380a`。
- 能力摘要：每位玩家选定单位、装备、符文、手牌的保留集合，然后回收其余对象。
- RIFT-9 未归类原因：`unmatched-functional-clause`；目录出处：`packages/card-data/data/deck-catalog.json:6144`。
- 结论：**judge-required**。具体缺口是集合范围，不是回收动作：原文只在手牌桶写明 their hands，未为 units/gear/runes 限定各玩家控制/拥有的集合；Recycle the rest 也未明确是每位玩家自身集合的补集还是全部已选集合的全局补集。133.3.a 只把未限定单位等指向 board，355.10.e/355.18 只确定非目标选择及结算时机，417.1/417.2 只确定回收目的地/须指定来源，均不能推出“各自保留自己控制的两件”。本次所查官方勘误及 Radiance 说明没有补足这一区域/控制者限定；提交精确场景请裁判/规则负责人确认，暂不赋予可执行语义。
- 只确认动作族，不批准程序，模板 ID：`filter`、`implicit-printed-cost`、`many`、`player`、`recycle`、`result`、`target`。
- 既有原语 ID（含模板依赖闭包）：`condition.predicate`、`condition.result`、`cost.printed`、`effect.recycle`、`effect.zone`、`target.filter`、`target.many`、`target.player`、`target.query`。
- 依据：`CR v1.5 133.3.a`；`CR v1.5 355.10.e`；`CR v1.5 355.18`；`CR v1.5 417.1`；`CR v1.5 417.2.a`；`S-GALLERY ogn-244-298`；`S-ORIGINS / S-SPIRITFORGED / S-UNLEASHED / S-VENDETTA / S-RADIANCE-ERRATA 检索未有该卡条目`。

### 34. Stormbringer, Volibear (ogn-250-298)

- canonicalCardId：`card.hash-0ff7c0201c85564ecdaf790021fc4115874fec7665a462b27901498984988f3c`。
- 能力摘要：选择己方基地的一名友方单位，以它的当前战力伤害一个战场上的全部敌方单位，再将它移至那里。
- RIFT-9 未归类原因：`unmatched-functional-clause`；目录出处：`packages/card-data/data/deck-catalog.json:6314`。
- 结论：**mappable**。绑定基地单位和目标战场，先 damage 再 Move，地点与伤害值引用相同上下文；all enemy units 是自动集合而非逐个目标。伤害文本未指定该友方单位为来源，418.6.a 的默认来源仍是本咒语，不可因为读取其 Might 而把伤害归给单位。移动仍服从合法地点及禁止规则。
- 映射路线，模板 ID：`damage`、`filter`、`implicit-printed-cost`、`location`、`many`、`move`、`result`、`target`、`value`。
- 既有原语 ID（含模板依赖闭包）：`condition.predicate`、`condition.result`、`condition.value`、`cost.printed`、`effect.damage`、`effect.move`、`target.filter`、`target.location`、`target.many`、`target.query`。
- 依据：`CR v1.5 355.4`；`CR v1.5 355.10.b`；`CR v1.5 355.10.d`；`CR v1.5 359.3.f.2`；`CR v1.5 418.6.a`；`CR v1.5 451.1`。

### 35. Noxian Guillotine, Darius (ogn-254-298)

- canonicalCardId：`card.hash-c973c5f4508531db7ec8b07e87359987755e8136cf2abb7b2e92df957e1ff837`。
- 能力摘要：通常为一名单位登记本回合下一次受伤时消灭它的触发；满足 Legion 则立即消灭。
- RIFT-9 未归类原因：`unmatched-functional-clause`；目录出处：`packages/card-data/data/deck-catalog.json:6411`。
- 结论：**mappable**。158.2 的官方例子直接说明后面的 Legion 指令会替换前面的延迟指令，不是为受伤/死亡事件注册替代。非 Legion 路径建立一次性受伤延迟触发，必须实际有伤害事件；Legion 路径立即 kill，不能同时留下延迟触发，也不能伪造 damage 回调。
- 映射路线，模板 ID：`condition`、`delayed`、`duration`、`implicit-printed-cost`、`kill`、`kw-action`、`kw-legion`、`target`、`trigger-state`。
- 既有原语 ID（含模板依赖闭包）：`condition.history`、`condition.predicate`、`continuous.duration`、`continuous.timing`、`cost.printed`、`effect.kill`、`effect.zone`、`target.query`、`trigger.delayed`、`trigger.phase`、`trigger.state`。
- 依据：`CR v1.5 158.2`；`CR v1.5 383.1`；`CR v1.5 391.2`；`CR v1.5 392`；`CR v1.5 418.1.e.1`；`CR v1.5 812.1`。

### 36. Dragon's Rage, Lee Sin (ogn-258-298)

- canonicalCardId：`card.hash-5db2b31990da2ad96271bf74f4d78f1ae9ef9c614ec7bcec1735b3cc17f301ae`。
- 能力摘要：先移动敌方单位，再由后续效果选该目的地另一名敌方单位，让两者按战力互伤。
- RIFT-9 未归类原因：`unmatched-functional-clause`；目录出处：`packages/card-data/data/deck-catalog.json:6509`。
- 结论：**data-issue**。S-ORIGINS Dragon's Rage 在移动之后加入 Then do this，旧目录没有该反身触发边界。不是可忽略标点：第二个目标应由新 pending 项完成选择，不是在原咒语 finalization 固定，也不是移动后无响应窗口立刻互伤。先更新权威文本，再用拟议 trigger.reflexive 配合现有 move/damage；不以同步内联近似。
- 修复后的候选路线，模板 ID：`damage`、`filter`、`implicit-printed-cost`、`location`、`many`、`move`、`result`、`target`、`value`。
- 既有原语 ID（含模板依赖闭包）：`condition.predicate`、`condition.result`、`condition.value`、`cost.printed`、`effect.damage`、`effect.move`、`target.filter`、`target.location`、`target.many`、`target.query`。 拟新增：`trigger.reflexive`（先修资料，再接入；语义及复用见第 3 节）。
- 依据：`CR v1.5 355.5.b`；`CR v1.5 388.1`；`CR v1.5 389.1`；`CR v1.5 418.6.b.3`；`CR v1.5 451.1`；`S-ORIGINS Dragon's Rage`。

### 37. Unforgiven (ogn-259-298)

- canonicalCardId：`card.hash-6c69039e3668542be770179f1820017af14307a2e3e79a1c71a35edc3e408061`。
- 能力摘要：付两能量并横置传奇，移动一名友方单位，路径一端必须是该单位自己的基地。
- RIFT-9 未归类原因：`non-reminder-printing-difference`；目录出处：`packages/card-data/data/deck-catalog.json:6532`。
- 结论：**data-issue**。S-ORIGINS Unforgiven 明确将 your base 改为 its base；主印刷仍旧版，ogn-305-298 与 star 版已新版。两者在队友场景不等价，不能在归一化时随便选一个；修复后按单位控制者基地约束移动路径。Legend 的 energy/power null 保持 null，激活两能量另行支付。
- 修复后的候选路线，模板 ID：`activated`、`cost-exhaust`、`cost-resources`、`filter`、`location`、`move`、`target`。
- 既有原语 ID（含模板依赖闭包）：`cost.activated`、`cost.exhaust`、`cost.pay`、`effect.move`、`target.filter`、`target.location`、`target.query`。
- 依据：`CR v1.5 107.1`；`CR v1.5 127.1`；`CR v1.5 204.1.b`；`CR v1.5 449.1`；`CR v1.5 449.2`；`CR v1.5 451.1`；`S-ORIGINS Unforgiven`；`S-GALLERY ogn-259-298 / ogn-305-298`。

### 38. Guerilla Warfare, Teemo (ogn-264-298)

- canonicalCardId：`card.hash-1175fb7ab62c4d777b8ccd63b423982a0b70440ed2d5652d2b61dde6fb07b06f`。
- 能力摘要：从弃牌区取回至多两张带 Hidden 的牌，并在本回合免除隐藏牌的费用。
- RIFT-9 未归类原因：`unmatched-functional-clause`；目录出处：`packages/card-data/data/deck-catalog.json:6656`。
- 结论：**mappable**。cost.hidden 已覆盖隐藏动作和费用，cost.modify 与本回合持续许可可免隐藏费用，不必新设 Hide 效果。811.1.c.1 明确 Hide 不是 Play；只免费用，不免己方回合/open 状态、控制战场、槽位及次回合才能反应的限制，也不让无 Hidden 的牌可隐藏。
- 映射路线，模板 ID：`cost-modify`、`duration`、`filter`、`implicit-printed-cost`、`kw-hidden`、`many`、`restrict`、`target`、`zone`。
- 既有原语 ID（含模板依赖闭包）：`condition.predicate`、`condition.value`、`continuous.duration`、`continuous.restrict`、`continuous.timing`、`cost.hidden`、`cost.modify`、`cost.pay`、`cost.printed`、`effect.zone`、`target.filter`、`target.many`、`target.query`。
- 依据：`CR v1.5 422.1`；`CR v1.5 811.1.b`；`CR v1.5 811.1.c.1`；`CR v1.5 811.6`。

### 39. Siphon Power, Viktor (ogn-266-298)

- canonicalCardId：`card.hash-d619150ac39f656ea38c332ad3a03989be755c3114becae61bb346ae3996951d`。
- 能力摘要：选一个战场，友方单位本回合加一战力，敌方单位本回合减一且最低一。
- RIFT-9 未归类原因：`unmatched-functional-clause`；目录出处：`packages/card-data/data/deck-catalog.json:6705`。
- 结论：**mappable**。Choose battlefield 是地点目标，双方单位是程序筛选集合，不能逐一收 Deflect 费用。按施法者的友敌关系分组，分别施加 arithmetic 效果；敌方最低值以应用时快照限制。478.1.c 官方示例明确提及本卡与单位依赖层计算。
- 映射路线，模板 ID：`duration`、`filter`、`implicit-printed-cost`、`kw-reaction`、`location`、`many`、`might`、`target`。
- 既有原语 ID（含模板依赖闭包）：`continuous.duration`、`continuous.might`、`continuous.timing`、`cost.printed`、`target.filter`、`target.location`、`target.many`、`target.query`。
- 依据：`CR v1.5 355.10.b`；`CR v1.5 355.10.d`；`CR v1.5 478.1.c`；`CR v1.5 479.4.b`；`CR v1.5 479.4.e`。

### 40. Bandle Tree (ogn-278-298)

- canonicalCardId：`card.hash-5440d378426747276f389ce3e9731d1378a3a303a7309d785ef183114d2c326c`。
- 能力摘要：控制此战场的玩家可在这里多隐藏一张牌。
- RIFT-9 未归类原因：`unmatched-functional-clause`；目录出处：`packages/card-data/data/deck-catalog.json:6975`。
- 结论：**mappable**。continuous.restrict 的数量例外与 cost.hidden 的槽位检查可表达常规一张加一张；不授予免付费、立即使用或跨战场隐藏许可。“you” 按190.6.d 指战场控制者，无控制者时不授予玩家额外槽位；秘密信息仍不可暴露。
- 映射路线，模板 ID：`kw-hidden`、`location`、`restrict`、`value`。
- 既有原语 ID（含模板依赖闭包）：`condition.predicate`、`condition.value`、`continuous.restrict`、`continuous.timing`、`cost.hidden`、`cost.pay`、`effect.zone`、`target.location`、`target.query`。
- 依据：`CR v1.5 107.3`；`CR v1.5 190.6.d`；`CR v1.5 811.1.b`。

### 41. Gentlemen's Duel (ogs-008-024)

- canonicalCardId：`card.hash-2837500ae259cc6b529efd728cf65b05c957555d4e133c0d55310df08cf1b7d7`。
- 能力摘要：友方单位本回合加三战力，再与一名敌方单位按双方战力互伤。
- RIFT-9 未归类原因：`unmatched-functional-clause`；目录出处：`packages/card-data/data/deck-catalog.json:8115`。
- 结论：**mappable**。Then choose 不是 388.1 的 Do this 反身触发标记，因此两个目标均在原咒语 finalization 选择；不能先加战力、看响应结果再选敌人。结算先加三，再读取双方合法当前 Might 执行互伤，来源是单位而非咒语；保留 linked instruction 的失去目标语义。
- 映射路线，模板 ID：`damage`、`duration`、`filter`、`implicit-printed-cost`、`kw-action`、`many`、`might`、`target`、`value`。
- 既有原语 ID（含模板依赖闭包）：`condition.value`、`continuous.duration`、`continuous.might`、`continuous.timing`、`cost.printed`、`effect.damage`、`target.filter`、`target.many`、`target.query`。
- 依据：`CR v1.5 355.5`；`CR v1.5 359.3.e.14`；`CR v1.5 359.3.f.2`；`CR v1.5 388.1`；`CR v1.5 418.6.b.3`；`CR v1.5 479.4`。

### 42. Lux, Crownguard (ogs-014-024)

- canonicalCardId：`card.hash-6f9f9006a5d35f01fe282aeeb87157def728c3d5ae72e9d0eb39f4f0e496b14e`。
- 能力摘要：横置自身产生两能量，所产能量只能用于打出咒语。
- RIFT-9 未归类原因：`non-reminder-printing-difference`、`printing-stat-type-or-tag-difference`；目录出处：`packages/card-data/data/deck-catalog.json:8260`。
- 结论：**data-issue**。OGS 带 Demacia，ven-sp6-006 缺失，官方 API 同样冲突。Use only 与 Spend this Energy only 是限制所产资源用途的明确/旧写法，不应把旧短句误读为该能力只能在付咒语费时激活。修复标签后由 effect.resources 配 continuous.restrict 表达资源来源/用途谓词；池中受限份额必须独立记账，不能给所有能量套全局限制或忽略限制。Add 按430.2即时完成，非普通可响应链。
- 修复后的候选路线，模板 ID：`activated`、`cost-exhaust`、`implicit-printed-cost`、`kw-reaction`、`resources`、`restrict`。
- 既有原语 ID（含模板依赖闭包）：`condition.predicate`、`continuous.restrict`、`continuous.timing`、`cost.activated`、`cost.exhaust`、`cost.printed`、`effect.resources`、`target.query`。
- 依据：`CR v1.5 133.8.a`；`CR v1.5 163.1`；`CR v1.5 166.1`；`CR v1.5 430.2`；`CR v1.5 430.3`；`CR v1.5 054.2`；`S-GALLERY ogs-014-024 / ven-sp6-006`。

### 43. Highlander, Yi (ogs-020-024)

- canonicalCardId：`card.hash-65c099c33a6f39283027cbf4532037cbd7fe982a1e896afd5bf5d35e0fc16512`。
- 能力摘要：为友方单位登记本回合下一次死亡的替代：治疗、横置并召回。
- RIFT-9 未归类原因：`unmatched-functional-clause`；目录出处：`packages/card-data/data/deck-catalog.json:8407`。
- 结论：**data-issue**。S-ORIGINS Highlander 把 dies 改为 would die，并补 heal 与明确 exhaust；主目录仍是旧版。省略治疗会让伤害仍致命，在清理时再次死亡。修复后用一次性 delayed replacement 加治疗/横置/recall，死亡被替代就没有实际死亡事件，不触发 Deathknell；recall 不发 Move。
- 修复后的候选路线，模板 ID：`duration`、`exhaust`、`filter`、`heal`、`implicit-printed-cost`、`kw-reaction`、`move`、`replacement`、`target`。
- 既有原语 ID（含模板依赖闭包）：`condition.predicate`、`continuous.duration`、`continuous.timing`、`cost.printed`、`effect.exhaust`、`effect.heal`、`effect.move`、`replacement.event`、`target.filter`、`target.location`、`target.query`。
- 依据：`CR v1.5 391.3`；`CR v1.5 419.1`；`CR v1.5 370.1.a.1`；`CR v1.5 458`；`CR v1.5 460.1`；`CR v1.5 808.1.d.1`；`S-ORIGINS Highlander`。

## 5. 待处理清单与验收

1. card-data：19 个资料问题保持阻断。按逐卡条目修复过期勘误；对官方图库自相矛盾的区域/派别标签核对正式牌面或追加官方澄清，不能自动选主印刷、最新印刷、并集或交集。Karma 的图库 Vi 标签尤其不可导入覆盖。
2. 规则负责人：确认 Divine Judgment 的控制者/区域选择范围及剩余集合定义。可用最小场景：A 控制 3 个单位，B 控制 1 个单位；B 能否把 A 的两个单位列入保留集合？最终补集如何得到？再扩展到转移控制、队友和 Unit-Gear。确认前不实现各自保留的常见猜测。
3. 父任务契约变更请求：评审 `trigger.reflexive`、`effect.rechoose`、`effect.extra-turn` 的 IR 与 journal 设计。只新增建议，不改共享类型/协议/依赖/锁文件/旧日志；不能以这些建议升级旧回放。
4. 20 个 mappable 身份可进入现有规划路线，但需正式 IR 编译与规则测试才能从 judge-required 退出；本任务不写实现或测试，不跑无关包测试/全量构建。

JSON 是顶层数组，严格保留任务要求的 `canonicalCardId, printingId, verdict, templates, primitives, newPrimitive?, reason, ruleRefs` 字段。`newPrimitive` 是含建议 ID、语义、条目、复用卡的对象；`stage=after-data-fix` 表示资料修复后的额外依赖。既有原语只出现在 `primitives`，新名字不会混入其中。

在仓库根读取示例：

```bash
node -e 'const fs = require("node:fs"); const cards = JSON.parse(fs.readFileSync("docs/plans/survey/unclassified-ogn.json", "utf8")); console.log(cards.length, cards.reduce((counts, card) => ({ ...counts, [card.verdict]: (counts[card.verdict] || 0) + 1 }), {}));'
node /tmp/RIFT-40-triage-ogn/validate-docs.mjs
git diff --check
```

本次验证结果：43 行 JSON 可解析；43 / 43 身份及主印刷精确集合相等；79 / 79 关联印刷官方响应可定位；四类计数 20/3/19/1；模板/原语 ID 有效且依赖闭合；规则条目可在下载正文找到；Markdown/JSON 一一对应。证据日志：`/tmp/RIFT-40-triage-ogn/validation.log`。本任务仅文档调研，未启动服务、未访问数据库、未改源码和测试，包级测试/typecheck 不适用；全工作区门禁由调度者负责。
