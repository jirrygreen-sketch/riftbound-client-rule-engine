# 官方组卡规则与限禁表核查

核查日期：2026-10-15。当前基线为 Core Rules v1.4 和 2026-07-16 Tournament Rules；本文已按这两份官方 PDF 校正条号。2026-10-16 生效的 Radiance 规则单独列为未来版本。来源以 Riot Games / Riftbound 官方规则中心及官方 PDF 为准，卡图、社区材料和抓取数据不能替代规则来源。

July Tournament Rules 的 `601.1.c.1` 规定 sideboard 上限为 10；其 PDF 与本仓库 `rule-source-manifest.json` 的 SHA-256 一致。官方 July changelog 给出的生效日为 2026-07-24。

## 版本基线

| 来源 | 版本 / 日期 | 官方 URL | SHA-256 |
|---|---|---|---|
| **Riftbound Core Rules（当前生效基线）** | `1.4`，PDF 标注 last updated `2026-07-16` | [Rules Hub](https://playriftbound.com/en-us/rules-hub/) | `9C5FB8B8638F2CD19CEDA237929FA2C37AAC23C797CC7410294993470BA5A30B` |
| **Riftbound Tournament Rules（当前生效基线）** | PDF 标注 Last Updated `2026-07-16`；公告生效 `2026-07-24` | [July changelog](https://playriftbound.com/en-us/news/announcements/july-2026-tournament-rules-update-changelog/) | `6A5BE5501C494ECC841FB2572E715D9006F611FF2E5C97023A5BE1B5C884E61F` |
| Riftbound Core Rules v1.5 / Radiance（**未来**，`2026-10-16` 生效） | PDF 标注 last updated `2026-10-09` | [Core Rules PDF](https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf) / [Patch Notes](https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/) | `94D41FEE86F88B61C4157C0389C0595D990B98E5B42555C99D9F649EE64D1FEC` |
| Riftbound Tournament Rules `2026-10-09`（**未来**，`2026-10-16` 生效） | PDF 标注 `2026-10-09` | [Tournament Rules PDF](https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/861752822d217edf37d9febaeaf77a7d924c1bb6.pdf) / [October Changelog](https://playriftbound.com/en-us/news/announcements/october-2026-tournament-rules-changelog/) | `CE07DA4FB632526AFBBCE7F058287A57E7444FA6BDE17B0938FF52CE3FAB3D07` |
| Rules Hub: Constructed Format Legality | `2026-09-18` | [Rules Hub](https://playriftbound.com/en-us/rules-hub/) | 页面，无 PDF 哈希 |

本地核查文件为 `work/rules/CR-v1.4.pdf` 和 `work/riftboundfaq/sources/Tournament-Rules-2026-07-16.pdf`。未来版本的来源、日期与摘要另见 `docs/rule-source-manifest.json`；本次条号校正不以未来版本替代当前基线。

2026-10-12 时，当前生效 Core Rules 为 `v1.4 / 2026-07-16`；`v1.5 / Radiance`
是已发布、2026-10-16 生效的未来目标。官方文章只给出日历日期；实现层若使用
`2026-10-16T00:00:00.000Z`，该 `00Z` 时间是工程假设，不是官方指定 UTC 午夜。

## 官方规则事实（均按当前生效 CR v1.4 + July TR 条号）

### 同名与副标题

- CR `132.1`：每张卡有一个唯一识别它的 name。
- CR `132.3`：不同语言印刷但代表同一张卡时，在组卡和游戏中视为同名；官方例子为 English `Chemtech Enforcer` 与中文对应卡。
- CR `132.4`：带副标题的卡，完整 name 是 `[Short Name], [Subtitle]`。官方例子明确 `Kai'Sa, Evolutionary` 和 `Kai'Sa, Survivor` 只是 short name 相同，但 names 不同。
- CR `103.2.b.2`：即使代表同一角色，不同 name 的卡也不同；官方例子为 `Yasuo, Remorseful` 与 `Yasuo, Windrider`。

结论：`Yasuo, Remorseful` 和 `Yasuo, Windrider` 不是同一张卡，各自按各自的上限计算。

### 份数

- CR `103.2.b`：Main Deck 中同名卡最多 3 张。
- CR `103.2.b.1`：Chosen Champion 计入该 3 张上限；官方例子允许 Chosen Champion 之外再放入 2 张同名卡。
- CR `103.2.d`：与 Champion Legend 同 Champion tag 的 Signature cards 合计最多 3 张（`103.2.d.1` 为不限卡名的合计）。
- CR `103.4.c`：需要多张 Battlefield 时，同名 Battlefield 不能超过 1 张。
- CR `103.3` 只规定 Rune Deck 为 12 张 Rune（`103.3.a.1` 要求符合 Domain Identity）；该节没有规定 Rune 的同名份数上限。
- TR `601.1.c.1`：允许 sideboard 时，sideboard 至多 10 张（July TR 与 Oct TR 文本一致）。
- TR `601.1.c.2`：sideboard 只能含合法 Main Deck cards。
- TR `601.1.c.3`：同名卡上限按 Main Deck + sideboard 合并计算。

重印与语言版：

- TR `601.2.a`：卡只能来自该格式合法系列，或与该格式合法系列中的卡同名。
- TR `601.2.c`：旧卡重印到新系列但 collector number 不在该系列正常编号内时，不改变其格式合法性。
- 因此，语言版和同名重印会共享同一个规则的 name；collector number、系列编号和语言本身不是 name。

物理版次说明：Core Rules 和 Tournament Rules 未出现专门的 “alternate art” 条款。任何“普通版、异画、promo、重印都按同名合并计数”的具体实现，应记录为基于 CR `132.3` / `132.4` 和 TR `601.2.a` 的实现口径，而不是宣称有独立的官方异画条款。

### 牌组构成

- CR `103.2`：Main Deck 至少 40 张，包含 Chosen Champion Unit 以及 Units、Gear、Spells。
- TR `601.1.b`：比赛中 Main Deck 必须正好 40 张（含 Chosen Champion）。
- TR `402.1`：比赛须注册 Main Deck 恰好 40 张（**含** chosen champion）、1 Legend、12 runes、恰好 3 battlefields 且**各自 name 唯一**。
- CR `103.1`：1 张 Champion Legend（`103.1.a` 开局放 Legend Zone；`103.1.b` 决定 Domain Identity）。
- CR `103.2.a.1` / `103.2.a.2`：1 个 Chosen Champion，必须是 Champion Unit，且 Champion tag 必须匹配 Champion Legend。
- CR `103.3.a`：Rune Deck 为 12 张 Rune Cards。
- CR `103.4.a`：Battlefield 数量由 Mode of Play 决定，不是 Core Rules 的全局固定值。
- Core Rules 认可模式中，`485.4.a`、`486.4.a`、`487.4.a`、`488.4.a`、`489.4.a` 均规定每名玩家在组卡时提供 3 张 Battlefield。实际进入游戏的 Battlefield 数量按模式说明：
  - 1v1 Duel：Battlefield Count 2，每玩家 3 张，开局随机选 1 张（CR `485.4` / `485.5`）。
  - 1v1 Match：Battlefield Count 2，每玩家 3 张，每局选 1 张；Best of 3 中已用过的 Battlefield 按规则更换（CR `486.4` / `486.5`）。
  - FFA3（Skirmish）：Battlefield Count 3，每玩家 3 张，开局随机选 1 张（CR `487.4` / `487.5`）。
  - FFA4（War）：Battlefield Count 3，每玩家 3 张，先手玩家的 Battlefield 不使用（CR `488.4` / `488.5`）。
  - 2v2（Magma Chamber）：Battlefield Count 3，每玩家 3 张，先手玩家的 Battlefield 不使用（CR `489.4` / `489.5`）。
- CR `489.8.h`：2v2 队友不能使用相同 Champion Legend。
- CR `489.8.i`：2v2 队友不能使用相同 Battlefields。
- Mode of Play 变量表见 CR `483.1`–`483.8`（Number of Players / Formation / Victory Score / Battlefield Count / Setup / Format / First Turn Process / Unique Rules）。

### 领域

- CR `103.1.b`：Champion Legend 决定牌组 Domain Identity。
- CR `103.1.b.3`：单领域卡只能进入对应相同领域的 Domain Identity。
- CR `103.1.b.4`：多领域卡只能进入包含其全部所列领域的 Domain Identity。
- CR `103.1.b.5`（1.4 原文）：只是"某些 **Game Effect** 允许无视域把卡加入 deck，这些卡仍计入该 deck 的 Domain Identity"的**例外**；**它不是**"本身没有 Domain 的卡可进入任意 Domain Identity"。
- CR `103.2.c`：Main Deck 受 Domain Identity 限制。
- CR `103.3.a.1`：Rune Deck 必须属于 Champion Legend 的 Domain Identity。
- CR `103.4.b`：Battlefield **如适用**，也受 Domain Identity 限制。
- **CR v1.4 没有定义**"本身没有 Domain 的卡"如何参与 Domain Identity 判定；`Colorless` 一词在 CR v1.4 全文出现 **0 次**。因此"战场只有 `Colorless` 域时是否受域限制""无域卡如何计数"属 **source 未定义项**，不得由实现猜定（与代码 `constructed-policy.ts` 的 `colorless-domain` limitation 一致）。

### 系列合法性

- TR `601.2.a`：卡只能来自该格式合法系列，或与合法系列中的卡同名。
- TR `601.2.b`：在地区发售未同步期间，按赛事举办地区的官方产品上线日执行地区限制。
- TR `601.3.c`（July TR，当前生效）：当前 Standard 包含：
  - Origins supplemental set contained in Proving Grounds（OGS）
  - Origins（OGN）
  - Spiritforged（SFD）
  - Unleashed（UNL）
  - Vendetta（VEN）
- `Radiance（RAD）` 是 **future October TR** 才新增的 `601.3.c.6`（发售日 `2026-10-23`），**不在** July TR 的 `601.3.c` 里，也未在 2026-10-12 生效。
- 已公开或已预览不等于已可使用。规则只授予“合法系列中的卡”资格；不能把全部预览内容自动视为可用产品池。
- Rules Hub 说明官方计划从 `2028` 年开始为 Standard Constructed 引入系列轮换。

## 未来目标（CR v1.5 / Radiance，`2026-10-16` 生效）——不得混入当前

以下仅供未来版本预置，**不是** 2026-10-12 的当前规则：

- CR v1.5 / Radiance 于 `2026-10-16` 生效；Radiance（RAD）产品发售 `2026-10-23`。
- future October TR 在 `601.3.c` 增加 `601.3.c.6 Radiance (RAD)`、`601.3.c.6.a Release Date: October 23rd, 2026`。
- sideboard `10 or fewer` 等条文在 July 与 October 两版**一致**，故 sideboard 上限 10 **不需要**等 October 版生效。
- 本文的构筑与模式条号只对应 v1.4；未来 v1.5 的条号须在版本切换时单独核对。

## 当前官方限禁表

以下内容来自 Rules Hub 的 Constructed Format Legality 页面，页面标注 `Last updated: September 18, 2026`。这不是推断值，也不是社区 banlist。

### Constructed

禁用 Cards：

- `Called Shot`
- `Ekko, Recurrent`
- `Draven, Vanquisher`
- `Fight or Flight`
- `Scrapheap`
- `Stealthy Pursuer`
- `Stacked Deck`

禁用 Battlefields：

- `The Arena’s Greatest`
- `Aspirant’s Climb`
- `Dreaming Tree`
- `Obelisk of Power`
- `Reaver’s Row`

### 2v2 Constructed

在上述 Constructed 禁用内容基础上，2v2 Constructed 额外禁用 Legend：

- `Master Yi, Wuju Bladesman`

官方 2v2 表格同样列出 Cards 与 Battlefields。其中 2v2 表格显示为 `Draven Vanquisher`，而 Constructed 表格显示为 `Draven, Vanquisher`；本文按官方页面原文保留差异，并将其视为对应同一目标的官方显示。

### 限禁规则

- TR `601.2.d`：特定格式禁用的卡不能加入牌组。
- TR `601.2.d.1`：官方禁用卡列表位于规则中心。
- TR `601.2.d.2`：低 OPL 且完全使用官方预构牌组配置时，可使用该配置中的禁用卡；一旦改动牌组或加入 sideboard，即不再允许。
- TR `602.1.b`：Constructed 禁用卡在 Limited 默认可用，除非该 Limited 格式也另行禁用。
- 官方材料未给出单独的 Limited 全局 banlist；不能在实现中虚构该表。

## 待实现配置

这些是实现需要定义的配置或口径；不应写成官方原文。

1. **Canonical name 聚合**：需要一个 canonical name 字段，将语言版本、同名重印、普通版和异画映射到同一规则的 name。副标题卡不得只按 short name 聚合；`[Short Name], [Subtitle]` 才是完整 name。
2. **物理版次不参与计数**：collector number、语言、画面、边框、稀有度或 promo 状态本身不创建新的规则 name。该口径来自官方 name 规则，但具体字段映射是待实现配置。
3. **模式配置**：将 Core Rules 的认可模式建模为配置，至少包含 Main Deck 数量、Rune Deck 数量、每玩家 Battlefield 数量、实际 Battlefield Count、2v2 的 Legend 与 Battlefield 互斥规则；当前模式条号以 `485`（Duel）/`486`（Match）/`487`（FFA3）/`488`（FFA4）/`489`（2v2）为准。
4. **格式配置**：区分 casual Core Rules（Main Deck 至少 40）和比赛 Constructed（含 champion 的 zone group 合计正好 40，`mainDeck` 39 + `champion` 1）；sideboard 是否启用、上限（`0..10`）和换牌规则也应配置化。
5. **地区与生效时间窗**：Radiance 需要配置 `effective 2026-10-16`、产品发售 `2026-10-23` 和赛事地区产品上线日。不要只用“已公开”或“已列入规则文档”作为可用开关。
6. **限禁表版本化**：按来源日期（当前为 `2026-09-18`）和格式（Constructed / 2v2 Constructed）版本化。官方页面更新后必须重新核对，不能沿用推断。
7. **不虚构规则**：官方没有给出 Rune 同名上限的独立条款；实现不得默认套用 Main Deck 的 3 张上限。官方也没有单独定义 Limited 全局 banlist。CR v1.4 也未定义 `Colorless`/无域卡的 Domain Identity 处理；不得由实现猜定。

## 实现映射与真实缺口

见来源核查记录（`../outputs/coordination/resume-20261013/staging/wave378/constructed-v14-july-source-reconciliation/outputs/coordination/resume-20261013/artifacts/constructed-v14-july-source-reconciliation/`）：把每条 source 映射到 `constructed-policy.ts` / `deck-validation.ts` / `constructed-regional-context.ts` / `constructed-regional-policy.ts` 的具体函数，并区分**阳性/阴性已覆盖**与**真实缺口**。本文件只做来源核对，不改规则引擎决策。
