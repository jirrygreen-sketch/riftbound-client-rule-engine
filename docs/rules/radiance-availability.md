# Radiance 构筑可用性与时钟

核验日期：2026-10-16。范围为服务器基础 Standard Constructed 印刷版本可用性，
不修改 Core Rules profile、协议、旧日志或地区发售表。

## 裁定状态

**构筑合法起点：已裁定（2026-10-16，调度者核对 Tournament Rules 2026-10-09 抽取正文）。**

- `601.3.c.6` / `601.3.c.6.a`：Standard 当前包含 Radiance（RAD），其发售日为 2026 年 10 月 23 日。
- `601.2.b`：在各地区发售对齐之前，卡牌合法性按赛事举办地区的官方产品发售日执行。

因此 Constructed 中 RAD 印刷版本从**产品发售日**起合法（按地区发售日），
不是从 Core Rules v1.5 的生效日（2026-10-16）起。规则生效、Pre-Rift
（2026-10-16 至 2026-10-22 的 Sealed 活动）都不会让 RAD 提前进入 Constructed。
抽取正文来源：本机 `work/riftboundfaq/sources/Tournament-Rules-2026-10-09.txt`
（gitignore，PDF 哈希见 `docs/rule-source-manifest.json`）。

**实现**：RAD 印刷版本在发售前保持 `previewNotReleased` /
`available: false`；自 2026-10-23 起在基础 policy 开放，与上述裁定一致。
地区发售日差异继续由已有的地区可用性逻辑处理（601.2.b）。
`tournamentComplete` 继续为 `false`，保留原有可用性 limitations；提前合法性未核实的
具体依据记录在本文，不改写纳入回放哈希的无关元数据文案。
Pre-Rift 的 Sealed 许可不扩展成本服务器的 Constructed 许可；本文不实现限制赛。

## 官方依据

1. [October 2026 Tournament Rules Changelog](https://playriftbound.com/en-us/news/announcements/october-2026-tournament-rules-changelog/)，2026-10-09 发布。
   短引：“go into effect with the Radiance Pre-Rift on October 16, 2026”。
   新增系列的短引：“Added Radiance to Standard sets.”，对应 `601.3.c.6` 至
   `601.3.c.6.a`。公告没有列出这些子条的正文，不能用新增清单替代合法日期条款。
2. [Tournament Rules 2026-10-09](https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/861752822d217edf37d9febaeaf77a7d924c1bb6.pdf)。
   版本和官方入口由上述 changelog 与 Rules Hub 交叉确认。
   仓库 `docs/rule-source-manifest.json` 记录 SHA-256 为
   `ce07da4fb632526afbbce7f058287a57e7444fa6bde17b0938ff52ce3fab3d07`；
   本次没有重新计算此 PDF 的摘要，也没有把未取得的条文当成已读证据。
3. [Rules Hub / Constructed Format Legality](https://playriftbound.com/en-us/rules-hub/)，
   栏目更新日期 2026-09-18。短引：“All sets currently produced for Riftbound are legal”。
   该栏目未明确把未来产品的预览印刷版本或 Pre-Rift 获取的卡牌提前开放。
4. [The Radiance Overview](https://playriftbound.com/en-us/news/announcements/the-radiance-overview/)，
   Key Dates：短引“Pre-Rifts: October 16 - 22, 2026”；
   短引“Release: October 23, 2026”。此处确认产品日期，不替代赛事规则。
5. [Preparing for the Radiance Pre-Rift](https://playriftbound.com/en-us/news/announcements/preparing-for-the-radiance-pre-rift/)。
   短引：“they are Sealed events”。正文要求使用活动提供的有限卡池，不允许加入收藏中的外部卡牌；
   这不是 Constructed 提前合法的声明。

上述 HTML 正文在核验时通过官方站点的 `__NEXT_DATA__` 结构化数据获取；
原始 HTML 和相关片段保留在 `/tmp/RIFT-79-gatefix-radiance-availability-clock/`，
不提交版权正文或下载产物。

## 实现边界

- `RADIANCE_RULES_EFFECTIVE_DATE = 2026-10-16` 只保留在原有 `effectiveDate` 元数据中。
- `RADIANCE_CONSTRUCTED_AVAILABLE_AT = 2026-10-23T00:00:00.000Z` 才控制基础可用性。
  官方来源仅指定日历日期；UTC 午夜是本项目的工程约定，不是官方指定的全球时刻。
- `createConstructedRules` 接受 `asOf` 或返回毫秒时间戳的 `now`；优先采用显式 `asOf`，
  无显式日期才读取注入时钟，否则使用 `Date.now`。非法日期拒绝，不退回系统时间。
- `createGameServer` 和 `loadCardCatalogRuntime` 通过服务端可信选项
  `constructedPolicy: { asOf }` 或 `constructedPolicy: { now }` 透传相同配置；
  `normalizeCardCatalog` 的第二参数也可指定相同选项。HTTP 客户端不能指定或覆盖该配置。
- 基础 policy 继续在 catalog 加载时形成快照，而非每次 HTTP 请求重新读取时间。
  生产跨日刷新需重新加载 catalog/重启；本任务不改变这一既有生命周期。
- 地区 HTTP/房间路径继续使用显式 `eventDate` 与既有服务器发售表；本任务不改地区逻辑。
- 同一身份的 OGN 等已发售印刷版本保持合法；RAD 预览版不可用不等于该身份被禁用。

## 回归边界

| 显式时刻（UTC 工程约定） | RAD available | RAD 原因 | 同身份 OGN |
| --- | --- | --- | --- |
| 2026-10-15 23:59:59.999 | false | previewNotReleased | available |
| 2026-10-16 00:00:00.000 | false | previewNotReleased | available |
| 2026-10-22 23:59:59.999 | false | previewNotReleased | available |
| 2026-10-23 00:00:00.000 | true | available | available |
| 2026-10-24 00:00:00.000 | true | available | available |

policy 测试检查完整合法 deck 的校验结果、禁牌不变和身份/印刷的差异。
HTTP 测试对五个边界分别使用 `asOf` 与注入 `now`，并把系统 `Date.now`
设为 2000-01-01 / 2030-01-01；GET catalog 与 POST validation 结果必须一致，
不随测试运行当天的时间变化。

## 全仓时间审计

运行时规则/可用性唯一使用当前时间的默认入口是本次修改的
`apps/game-server/src/constructed-policy.ts`。其 HTTP 调用点为
`card-catalog.ts` 和 `server.ts`，已透传注入选项。

其他命中均不据当前时间决定规则版本或卡牌合法性：服务端锁/测试等待超时、
前端心跳、deck 标识/更新时间、回放抓取时间、卡牌同步产物时间，以及日期输入校验。
`apps/desktop-client/tests/full-product/RegionalRoomOptions.test.tsx` 的
`new Date()` 用于证明界面不会自动填当天日期，不是合法性判定。

本写域内所有会创建基础 policy 的测试都已指定固定 `asOf` 或注入固定时钟。
范围外仍有测试间接采用基础 policy 的默认当前时间，例如
`apps/game-server/tests/duel/command-journal-p4.test.ts`、
`apps/game-server/tests/duel/optional-unit-resolved-history-p9.test.ts`、
`apps/game-server/tests/duel/printed-unit-chain-services-p8.test.ts` 及
`apps/game-server/tests/full-product/full-product-room-adapter.test.ts`。
本任务不修改这些测试，建议调度者另开统一固定测试日期的任务；不能把本次结果
表述为全仓每一个 catalog 调用都已注入时钟。候选调用点清单位于证据目录的
`out-of-scope-policy-callers.log`，完整 Date 命中清单为 `date-audit.log`。

另有范围外历史说明 `docs/data-audit.md` 的 “Radiance Effective Date” 段仍声称
10-16 开放，需调度者按本记录更新；本任务不修改该文件。
