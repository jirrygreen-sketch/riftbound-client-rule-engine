# RIFT-1124：官方中文卡牌效果说明来源与接入方案（2026-10-28）

## 结论

官方 `zh_CN` 卡牌库确实返回中文卡名、套装名和大量中文效果正文，可以直接作为后续版本的唯一中文效果说明来源。当前本地 `deck-catalog.json` 共有 1,381 个印刷；其中 33 个印刷的英文能力为空，1,348 个印刷有英文能力。对有英文能力的印刷，本次观察到：

- 1,316 个有中文结构化正文（`text.richText.body` 或 `effect.richText.body` 含汉字）。
- 另有 2 个 Gear 的结构化正文为空，但同一官方 `zh_CN` 记录的 `cardImage.accessibilityText` 含完整中文装配说明；仅作为经过字段核验的展示补充后，可显示覆盖为 1,318/1,348（97.77%）。
- 20 个的官方中文正文与英文逐字相同，不把它们计为中文覆盖。
- 10 个有英文能力，但官方中文结构化正文为空且 accessibilityText 只含类型与卡名。
- 因此以全部 1,381 个印刷为分母时，严格结构化正文可用 1,316 个；含上述 2 个安全展示补充为 1,318 个；再把本来无需效果的 33 个也算作“无需翻译”时，完整显示覆盖为 1,351 个。

后续产品应默认显示官方中文；20 个英文回退和 10 个缺正文印刷必须明确显示“官方中文正文不可用，以下为英文”，或“官方中文正文不可用”，禁止机器翻译、按英文自行补写中文或从类似卡牌推断正文。中文正文只改变显示和查询，不替换现有英文 `ability`、DSL 编译输入、规则执行身份或旧回放语义。

## 请求证据

### 官方卡牌库 API

2026-10-28 直接从 Riot Publishing Content API 请求；使用仓库同步脚本相同的 `Accept: application/json` 和公开分页逻辑，未使用第三方转述或机器翻译。

| locale | URL | HTTP | 请求时间（UTC） | 响应 `resultsUpdatedAt` |
| --- | --- | --- | --- | --- |
| `en_US` | `https://content.publishing.riotgames.com/publishing-content/v2.0/public/channel/riftbound_website/list/riftbound_gallery_cards?locale=en_US` | 200 | 2026-10-28T14:49:31Z–14:49:38Z | 2026-10-28T14:49:34.910478670Z（首 200 条） |
| `zh_CN` | `https://content.publishing.riotgames.com/publishing-content/v2.0/public/channel/riftbound_website/list/riftbound_gallery_cards?locale=zh_CN` | 200 | 同批 | 2026-10-28T14:49:37.893071677Z（首 200 条） |

随后使用仓库真实函数 `fetchOfficialGallery` 分页并补取 `limit=2000` 快照，时间范围为 2026-10-28T14:52:44Z–14:53:17Z：

- `en_US`：200、200、199、199、198、200、198、198、16 条分页记录后，空页停止；分页去重 1,407，快照补 1，最终 1,408。API metadata 报 `totalItems=1416`，与实际可去重记录不一致。
- `zh_CN`：200、199、200、198、198、200、198、198、15 条分页记录后，空页停止；分页和快照都是 1,408，最终 1,408。API metadata 报 `totalItems=1415`。
- 两个最终集合与本地目录的 1,381 个印刷 ID 全部匹配；在目录交集上没有英文独有或中文独有 ID。
- 同一路径第二次完整复抓遇到 Cloudflare IPv4 `ETIMEDOUT` 和 IPv6 `ENETUNREACH`。首次成功结果保留，生产实现仍需现有重试、快照对账和失败即停止逻辑。

响应结构：`data[]` 是卡牌记录，`metadata` 包含 `totalItems/totalPages/locale/resultsUpdatedAt`，`linkdata.next` 提供下一页。卡牌稳定键为 `id`。本次相关字段路径为：

| 路径 | 已观察含义 | 本次本地化情况 |
| --- | --- | --- |
| `data[].name` | 卡名 | 通常中文；21 个值与英文相同，2 个为空 |
| `data[].subtitle` | 绰号 | 存在时通常中文 |
| `data[].text.label` | 规则文本栏标题 | 全部 `技能` |
| `data[].text.richText.body` | Rules Text 的 HTML | 多数中文；有 55 个记录为空/缺字段 |
| `data[].effect.label` | Effect Text 栏标题 | 33 个，值仍为英文 `Effect` |
| `data[].effect.richText.body` | 贴附卡 Effect Text | 33 个，均有汉字 |
| `data[].cardType.type[].id/label` | 主类型稳定 ID/显示值 | ID 可映射；label 仍英文 |
| `data[].cardType.superType[].id/label` | 传奇、冠军等 | ID 可映射；label 仍英文 |
| `data[].tags.tags` | 标签值 | 英文为主，少数已是中文；137 个不同值 |
| `data[].domain.values[].id/label` | 域 ID/显示值 | ID 可映射；label 仍英文，字段标题为 `特性` |
| `data[].rarity.value.id/label` | 稀有度 | ID 可映射；label 仍英文，字段标题为 `稀有度` |
| `data[].set.value.label` | 系列名 | 中文，如 `起源`、`铸魂淬炼` |
| `data[].energy/power/might` | 费用/战力对象 | 数字 ID 可复用；仅部分字段标题为 `法力`、`战力` |
| `data[].illustrator.values[].label` | 画师 | 人名/工作室保持原文，字段标题为 `画师` |
| `data[].cardImage.accessibilityText` | 官方可访问文本 | 多数中文；不是所有记录都包含 Effect Text |

### 官方网页通道

- `https://playriftbound.com/zh-cn/card-gallery/`：2026-10-28T14:51:15Z 返回 200，`__NEXT_DATA__` 内嵌 1,408 张卡，抽样的 6 张与 API 字段一致。它是同一发布数据源的网页分发，不是额外的通用正文来源。
- `https://playriftbound.com/zh-cn/rules-hub/`：200，是官方中文规则中心。
- `https://playriftbound.com/zh-cn/news/announcements/radiance-errata-updates/`：200，页面 `displayedPublishDate` 为 2026-10-09T16:00:00.000Z，标题为“化神争锋系列勘误更新”；正文包含带新旧中文文本的勘误条目。
- `https://playriftbound.com/zh-cn/news/organizedplay/radiance-rules-faq-and-clarifications/` 与 Vendetta 规则 FAQ：200，中文规则裁定/FAQ，可用于解释和裁定，不是逐印刷卡牌正文目录。
- `https://playriftbound.com/zh-cn/how-to-play/`：200，教学页，不是逐印刷卡牌正文来源。

中文官方来源的采用优先级应为：印刷卡牌库结构化正文 → 同一记录的 accessibilityText 且可严格切出正文 → 官方中文勘误公告中按卡名、系列和旧文本唯一匹配的新文本 → 无匹配则回退英文并标明语言，或只显示卡名。规则 FAQ 只用于裁定，不据此生成本地化卡牌正文。

## 中英对照脱敏示例

以下仅保留公开卡牌文本、稳定 printing ID、字段路径和少量符号，不保留 cookie、请求私有头或大段响应。中文 source URL 对每个示例都是上述 `locale=zh_CN` API；英文对照使用 `locale=en_US`。

### 1. `ogn-001-298`：普通关键词与费用符号

- 中文卡名：`灼焰飞龙`；英文：`Blazing Scorcher`。
- 中文 `text.richText.body`：`<p>[急速]（你可以选择额外支付:rb_energy_1:和:rb_rune_fury:，让我以活跃状态进场。）</p>`
- 英文 `text.richText.body`：`<p>[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)</p>`
- 中文 accessibilityText 将同类符号改为 `[1]` 和 `[C]`；结构化正文仍使用 `:rb_*:` token。产品渲染应以结构化 `:rb_*:` token 为准，accessibilityText 只用于正文补充或在固定 token 词典下转回图标。

### 2. `sfd-001-221`：中文关键词和 Might 位置

- 中文卡名：`矢志不退`；英文：`Against the Odds`。
- 中文 `text.richText.body`：`[反应] ... 本回合内:rb_might:+2。`
- 英文 `text.richText.body`：`[Reaction] ... +2 :rb_might: this turn.`
- 两边仅关键词和语序改变，`:rb_might:` 原样保留；中文强调位置会出现 `:rb_might:+2`，不能按英文固定“符号在前”解析。

### 3. `unl-019-219`：Rules Text 与 Effect Text 分离

- 中文卡名：`枯萎战斧`；英文：`Blighted Battleaxe`。
- 中文响应只有 `effect.richText.body`：`<p>在你回合结束时，如果我本回合没有征服战场，则卸除此装备，并对我造成4点伤害。</p>`
- 中文 accessibilityText：`Riftbound Gear: 枯萎战斧. [装配][1][C]（支付[1]和[C]：将此牌贴附到你控制的一名单位上。）`
- 英文响应同时有 `text`（`[Equip] ...`）和 `effect`。这说明 `text` 缺失并不代表整个卡牌无效果；两者也不能按卡牌类型无条件二选一。客户端必须分别保留、标注和显示 Rules Text/Effect Text。

另外 `ven-001-166` 可看到 `[已强化][&gt;]`、`[强攻2]`、`[法盾]`；HTML 中的 `&gt;` 表示关键词关联符号，渲染时解码为 `>`，不能当作普通文本或重新翻译。

## 覆盖率与缺口

口径基于本地 `packages/card-data/data/deck-catalog.json`（`dataVersion=2026-10-12-official-gallery`，1,381 个印刷），用 `id` 对齐同一时段的官方中英文快照。一个印刷仅在其 `text` 或 `effect` 至少一段含汉字时算作中文结构化覆盖；纯净符号/数字、英文原文和只含卡名的可访问文本都不算中文效果覆盖。

| 系列 | 目录印刷 | 有英文能力 | 中文结构化覆盖 | accessibilityText 补充 | 可显示中文 | 与英文相同 | 缺中文结构化正文 | 无英文能力 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| OGN | 352 | 332 | 321 | 0 | 321 | 2 | 9 | 20 |
| OGS | 24 | 24 | 24 | 0 | 24 | 0 | 0 | 0 |
| RAD | 192 | 186 | 186 | 0 | 186 | 0 | 0 | 6 |
| SFD | 288 | 288 | 269 | 2 | 271 | 16 | 1 | 0 |
| UNL | 288 | 288 | 287 | 0 | 287 | 1 | 0 | 0 |
| VEN | 237 | 230 | 229 | 0 | 229 | 1 | 0 | 7 |
| **合计** | **1,381** | **1,348** | **1,316** | **2** | **1,318** | **20** | **10** | **33** |

### 与英文逐字相同的 20 张

- OGN 2：`ogn-008-298`、`ogn-252-298`。
- SFD 16：`sfd-040-221`、`sfd-143-221`、`sfd-154-221`、`sfd-198-221`、`sfd-223-star-221`、`sfd-224-star-221`、`sfd-225-star-221`、`sfd-227-star-221`、`sfd-228-star-221`、`sfd-230-star-221`、`sfd-232-star-221`、`sfd-233-star-221`、`sfd-235-star-221`、`sfd-236-star-221`、`sfd-237-star-221`、`sfd-239-star-221`。
- UNL 1：`unl-196-219`。
- VEN 1：`ven-116-166`。

### 有英文能力但中文结构化正文为空的 10 张

- OGN 9：`ogn-121a-298`、`ogn-300-298`、`ogn-300-star-298`、`ogn-301-298`、`ogn-301-star-298`、`ogn-305-298`、`ogn-305-star-298`、`ogn-308-298`、`ogn-308-star-298`。
- SFD 1：`sfd-191-221`。

这些缺口可归为三个直接原因：官方 `zh_CN` 记录没有 `text/effect`；只有类型和卡名的 accessibilityText；少数中文卡名/字段本身为空。`ogn-066a-298` 的正文已中文化，但 `name` 与 `subtitle` 为空；这不影响效果覆盖，却不满足完整中文显示，目录构建应回退同一 canonical identity 的已验证中文名，或显式回退英文并记录原因。

### 33 个无英文能力印刷

它们是 24 个基础符文 printing 与 9 个无文本单位 printing。中文 API 通常只返回卡名或 `[无文本]`，不需要翻译正文；仍应显示中文名和“无规则文本”。`ven-t04` 的中文 `name` 为空，须回退英文 `Recruit` 或同一 canonical identity 的已验证中文名。

### 可显示文本的边界

- 两个 accessibilityText 补充是 `sfd-095-221`（多兰之刃）与 `sfd-161-221`（暴风大剑）。两者的官方中文可访问文本完整包含装配说明。
- 其余 accessibilityText 可能只含卡名，不能仅因含汉字就算作效果正文；必须以同一卡记录、类型前缀、卡名的严格切分，以及固定 `[1]/[C]/[A]/[E]/[M]/[>]` 词典校验为前提。
- 本次有 12 个印刷的中文 `text/effect` 不构成中文结构化正文，但只给其中 2 个安全展示补充。其余 30 个包括 20 个与英文相同和 10 个中文结构缺失，只回退英文或显示无正文，不凭 accessibilityText 猜造。

## 符号与关键词表示

官方中文结构化正文继续使用与英文相同的 `:rb_*:` token；没有把它们替换成中文名称。本次 1,408 条中文卡牌记录中观察到 18 种 token：

| API token | 客户端显示 |
| --- | --- |
| `:rb_energy_0:` … `:rb_energy_8:` | 对应数字的法力/符能图标 |
| `:rb_might:` | Might 图标 |
| `:rb_exhaust:` | 休眠/Exhaust 图标 |
| `:rb_rune_fury:`、`:rb_rune_calm:`、`:rb_rune_mind:`、`:rb_rune_body:`、`:rb_rune_chaos:`、`:rb_rune_order:` | 对应域符能图标 |
| `:rb_rune_rainbow:` | 任意域/rainbow 符能图标 |

关键词使用方括号，并且中文名称与英文不同，例如 `[Accelerate]`/`[急速]`、`[Reaction]`/`[反应]`、`[Equip]`/`[装配]`、`[Hidden]`/`[待命]`、`[Assault 2]`/`[强攻2]`、`[Deflect]`/`[法盾]`。关联标记在 HTML 中为 `&gt;`，解码后是 `>`，例如 `[已强化][&gt;]`。

客户端应按 token 白名单渲染，不解析自然语言猜规则。未识别的 `:rb_*:`、原始 HTML 标签或残缺标记应完整显示为转义原文，并记录一次本地化渲染告警；不能静默删除，也不能用近似图标替代。CR v1.5 135.2.e 说明这些 symbols 的 shorthand；135.2.d.3 说明 reminder text 的存在、缺失或措辞不影响游戏功能。中文正文中的关键词仍是显示与查询文本，权威执行继续由英文 canonical 输入和 engine 决定。

## 接入方案

### 1. 同步与校验（`packages/card-data`）

在 `scripts/sync-current-cards.mjs` 的现有双 locale 获取之后，新增一个纯函数，从每条 `zh_CN` 原始记录生成 `localizedTexts["zh-CN"]`：

- `rulesTextHtml`：`text.richText.body` 或 `null`。
- `effectTextHtml`：`effect.richText.body` 或 `null`。
- `accessibilityText`：`cardImage.accessibilityText` 或 `null`，只保留原文供审计。
- `sourceUrl`：本次已去凭据的 API URL。
- `sourceUpdatedAt`：该 locale 的 `resultsUpdatedAt`。
- `syncedAt`：本次 sync 的 UTC 时间。
- `sourceLocale`：固定 `zh-CN`。
- `status`：`official-structured`、`official-accessibility-supplemented`、`english-fallback`、`no-effect` 或 `missing`。

原始 `data[]` 仍按现有结构存于 `localizedGalleries["zh-CN"].cards`，避免破坏现有审计输入。快照文件虽然被 gitignore，也应持久化来源 URL、字段级 hash、`resultsUpdatedAt` 和同步时间；目录构建只用这些字段生成公开显示字段。

严格校验：

- 中英文 ID 集合必须一致；现有 `fetchOfficialGalleries` 已执行同步重试和一次快照对账。
- `text`/`effect` 必须是字符串或明确缺失；保留原 HTML 的段落/列表结构，不把 `effect` 拼入英文 `ability`。
- 移除 HTML 后若为纯符号、英文原文或空串，状态不能标成 `official-zh`。
- 若中文文本与英文逐字相同，标为 `english-fallback`，客户端明确提示。
- accessibilityText 补充必须经过该卡中文名、类型前缀和 token 词典的严格匹配；遇到多个候选项则保持 `missing`/英文回退。
- 官方勘误公告成为第三个来源时，记录 URL、公告日期、匹配的卡名/系列/旧文本与 canonical ID；不能仅按名称模糊匹配。

### 2. `deck-catalog.json` 的兼容字段

不建议把中文文本写进现有英文 `ability`，因为该字段被覆盖率、DSL 和潜在 runtime 编译路径消费。可在每个 printing 上追加展示字段：

```text
localizedAbilityRulesText?: string
localizedAbilityEffectText?: string
localizedAbilityLanguage?: "zh-CN" | "en-US"
localizedAbilityStatus?: "official-structured" | "official-accessibility-supplemented" | "english-fallback" | "no-effect" | "missing"
localizedAbilitySource?: {
  url: string
  locale: "zh-CN"
  updatedAt: string
  syncedAt: string
}
```

保留现有 `ability`、`canonicalCardId`、`energy:null`、`power:null`、printing ID 和 groups，不把 `null` 改成 `0`，也不升级旧 replay/catalog schema。若父级决定给 `/api/cards` 的 schema 升版，应由父级统一处理；本任务不修改契约。

### 3. 服务端目录和 `/api/cards`

`apps/game-server/src/card-catalog.ts` 目前会对未知 catalog 字段做严格拒绝；接入时必须让服务端白名单、shape guard 和 `publicCard()` 同时显式转发上述展示字段。它们只属于公开目录，不进入 server-private card program authority、规则判定或旧 replay frame。

`/api/cards` 现有 `schemaVersion: 1` 结构应保持兼容，只在父级批准后通过可选字段暴露。API 不得在请求时临时翻译或从卡图 OCR；应返回已校验的 catalog 字段。若采用新 endpoint，则建议只读 `/api/cards/localization`，由同一 catalog digest 绑定，避免改变旧客户端解析。

### 4. 客户端显示位置

1. **卡牌图鉴/选牌列表**：已有 `localizedName` 继续使用；中文正文放在卡片详情或辅助区域，不把长文本塞进紧凑卡牌 tile。
2. **牌组构建预览**：`DeckBuilder`/`CardArtPreview` 目前只展示卡图和卡名；增加中文 Rules Text、Effect Text 与来源状态，标签使用“规则文本”“效果文本”。
3. **对局卡牌预览**：`CardPreviewOverlay` 在图片下方显示中文正文；对局操作仍只由服务端 `actionOptions` 决定，文本绝不生成或放行命令。
4. **英文回退/缺失**：`english-fallback` 明确显示“官方中文正文不可用，以下为英文”；`missing` 显示“官方中文正文不可用”，不显示未经证实的替代文本。
5. **搜索**：只把已校验的中文正文纳入检索，回退英文仍可按英文搜索；结果 UI 标出语言与来源状态。

HTML 必须用白名单渲染：只允许 `p`、`br`、`ul`、`li`、`strong`/`em` 等已知结构标签；其余转义。`:rb_*:` 采用版本化的 icon/token map；`[关键词]` 可着色但不得被当规则语法解析。

### 5. 回滚与缓存

- 目录 digest 或 `dataVersion` 应覆盖中文展示文本和来源 stamp，使服务器与客户端发现不匹配。
- 中文正文更新时，旧 replay 仅保留其原 catalog stamp；不得用新中文文本改写旧日志或改变旧回放判断。
- 本地缓存同时保留英文编译文本和中文展示文本；缺少中文缓存不阻止合法操作，只显示明确回退状态。

## 可派发任务卡

### 任务 A：同步、审计与目录生成中文正文

- 唯一写域：`packages/card-data/scripts/sync-current-cards.mjs`、`packages/card-data/scripts/build-deck-catalog.mjs`、`packages/card-data/test/sync-current-cards.test.mjs`、`packages/card-data/test/build-deck-catalog.test.mjs`、`packages/card-data/test/deck-catalog-audit.test.mjs`、`docs/full-product/zh-card-text-coverage-2026-10-28.json`。
- 验收：用真实 `fetchOfficialGallery` 和 `buildDeckCatalog` 路径；中英文 ID 完全一致；`text`/`effect` 分开保留；1,316 严格结构化、1,318 可显示、20 英文相同、10 结构缺失的基准在稳定快照下可复现；篡改/缺字段/未知 token 时 fail closed；不手改 gitignored 生成物，不转写 `energy:null`/`power:null`。

### 任务 B：服务端公开字段与 `/api/cards` 兼容接入

- 唯一写域：`apps/game-server/src/card-catalog.ts`、`apps/game-server/tests/card-catalog.test.ts`（如实际文件名不同，限定到对应 catalog 测试）、可选新增 `apps/game-server/tests/card-catalog-localization.test.ts`。
- 验收：新字段通过严格 guard，旧 schema 1 客户端仍可解析；公开 catalog 同时返回英文 `ability` 与中文展示字段；中文字段不进入 private authority；状态/来源在直接 `/api/cards` 响应中可核验；旧 catalog fixture 不报错。

### 任务 C：客户端中文显示、回退与符号渲染

- 唯一写域：`apps/desktop-client/src/net/CardCatalogClient.ts`、`apps/desktop-client/src/components/CardArtPreview.tsx`、`apps/desktop-client/src/components/DeckBuilder.tsx`、`apps/desktop-client/src/full-product/duel/DuelOverlays.tsx`、对应 `apps/desktop-client/tests/CardCatalogClient.test.ts`、`CardArtPreview`/`DeckBuilder`/`DuelOverlays` 测试。
- 验收：中文状态显示 Rules/Effect 两段；20 个英文相同与 10 个结构缺失显示明确回退；`:rb_*:` 18 个 token、`[中文关键词]`、`&gt;` 均正确处理；未知 token/HTML 安全转义；文本绝不生成 legal action；无中文时卡名与操作仍可用。

三张任务卡写域互不重叠；若服务端可选字段需要先由父级批准，任务 B/C 可先按父级确定的字段形状开工。

## 使用条件、版权与风险

### 已引用官方页面上的条件

- Riot Games Terms of Service `https://www.riotgames.com/en/terms-of-service`（2026-10-28 请求，HTTP 200）第 3.1 节将使用 Riot Services 及其 Virtual Content 的许可限定为 individual, non-commercial, entertainment purposes，并写明除经 Riot 签署的明确书面合同外，不得 copy、translate、publish 或 otherwise distribute Riot Services 或 Riot intellectual property。第 3.2 节说明 Riot 及其许可方拥有内容/Game Content 的权利，并指向其 Legal Jibber Jabber policy。页面页脚显示 `© 2026 Riot Games, Inc. All Rights Reserved.`。
- Riot Games API Terms `https://developer.riotgames.com/terms`（页面标注 LAST UPDATED: DECEMBER 9, 2013）的 Licensed Uses and Restrictions 允许在遵守条款时把 Game Information 显示给 Application 的 end users，但禁止未经授权 use/distribute/transmit；如收费或转售/许可 Application、就访问 Game Information 收费，须先通知 Riot 并取得 prior written approval。
- `https://playriftbound.com/zh-cn/card-gallery/` 的 `robots.txt` 是 `User-agent: * / Allow: /`，仅说明抓取路径允许，不构成再分发、商用、翻译或商标授权。

这些条款不能替代项目需要的授权判断。正式发布前应由项目负责人按实际商业/分发方式取得或将现有授权核对清楚；文档的“读取公开页面”和“获得授权”是两个不同结论。

### 风险与缓解

- **源内容不完整且会变化**：本次 API metadata 总数与实际去重记录相差 8/9，中文 20 张英文回退、10 张结构缺失；使用快照比对、失败即拦、保留英文回退。
- **网页与 API 并非两个独立来源**：网页内嵌同一发布数据，不能通过两处一致宣称翻译准确，只说明分发一致。
- **勘误与旧印刷冲突**：官方卡库仍可能保留印刷原文，勘误公告有新版文本；必须把 printed 与 effective 文本分别记录，已勘误中文按公告证据应用，旧回放继续按原 stamp。
- **空值/缺字段造成数据误判**：`energy:null`/`power:null` 表示无印刷费用，不能改为 0；字段缺失表示无法证明，不能臆造。
- **accessibilityText 不是稳定正文 API**：它有时只有卡名，有时使用 `[1]/[C]` 缩写，有时不包含 Effect Text；只可严格校验后作为展示补充。
- **安全渲染**：官方正文是 HTML，必须白名单渲染和 token 转义；不能让文本成为客户端合法动作或服务端规则输入。
- **版权/商业分发**：官方可公开访问不等于获得本地复制、翻译、再分发、商业化授权；这是发布前的独立门禁。
- **可复现性**：官方响应无公开版本号，`resultsUpdatedAt` 只到单次响应；建议在 catalog manifest 保留请求日期、locale、URL、响应 hash、字段级 hash和统计，并使同步失败绝不覆盖上一份可验证快照。

## 规则依据

- CR v1.5 132.3：不同语言但代表同一张牌的卡牌在 deckbuilding 与 gameplay 中有同一个名称；本次按稳定 printing ID 对齐，不按本地化名称猜测。
- CR v1.5 132.4：短名加副标题共同构成完整名称；中英 subtitle 必须分别保留。
- CR v1.5 135.2.d.3：reminder text 的存在、缺失或措辞不影响游戏功能。
- CR v1.5 135.2.e：定义 Exhaust、Might、任意域 Power、本域 Power、符号与 `[>]` 关联标记；与 API 的 `:rb_*:` token/HTML 映射对应。
- CR v1.5 135.3、135.4 与 136：Rules Text 可为空；贴附时 Rules Text 不活跃；Effect Text 是独立段落并能追加到宿主。故接入必须分字段保留 `text` 与 `effect`。

## 验证与证据文件

- `/tmp/RIFT-1124-zh-card-text-source/gallery-en_US.json`、`gallery-zh_CN.json`：首 200 条双 locale 原始响应。
- `/tmp/RIFT-1124-zh-card-text-source/gallery-snapshot-en_US.json`、`gallery-snapshot-zh_CN.json`：`limit=2000` 快照。
- `/tmp/RIFT-1124-zh-card-text-source/fetch-official-summary.json`：真实 `fetchOfficialGallery` 分页、hash、UTC 时间与对账结果。
- `/tmp/RIFT-1124-zh-card-text-source/coverage-strict.json`：1,381 个印刷的严格逐卡统计与状态。
- `/tmp/RIFT-1124-zh-card-text-source/effect-missing.json`：有英文能力但缺中文结构化正文的逐卡清单。
- `/tmp/RIFT-1124-zh-card-text-source/playriftbound-gallery-zh.html`：官方中文网页内嵌数据证据。
- `/tmp/RIFT-1124-zh-card-text-source/official-zh-1ccfde915b88.html`：官方中文勘误页面证据。

本任务只新增本文档，不修改代码、生成卡牌数据、契约、锁定文件或旧回放。
