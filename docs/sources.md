# 资料与版本

## 1. 官方资料

| 资料 | 用途 | 地址 |
| --- | --- | --- |
| Riftbound 官方规则中心 | Core Rules、Tournament Rules、FAQ 和版本入口 | https://playriftbound.com/en-us/rules-hub/ |
| Tournament Rules 变更说明 | 赛事规则变更和当前版本核对 | https://playriftbound.com/en-us/news/announcements/october-2026-tournament-rules-changelog/ |

规则版本状态（2026-10-12 核查）：

- 当前生效：Core Rules `v1.4`，PDF 与本地规则文本均标注 last updated `2026-07-16`。
- 未来目标：Core Rules `v1.5 / Radiance`，PDF 标注 last updated `2026-10-09`；官方 patch notes 明确其生效日为 `2026-10-16`。
- 未来目标：Tournament Rules `2026-10-09`；官方 changelog 明确其随 Radiance Pre-Rift 于 `2026-10-16` 生效。
- 发布日期不等于生效日期；Radiance 产品发售日为 `2026-10-23`，不能据此推导或替代规则生效日。
- 具体对局必须把实际使用的规则版本写入 Replay Envelope，不依赖“最新”这个相对词。

2026-10-12 已核实两个官方正文：

- [Radiance Rules Update](https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/) 首句为 "Radiance Rules Update Effective October 16, 2026"，页面发布时间为 `2026-10-09T16:00Z`。
- [October 2026 Tournament Rules Changelog](https://playriftbound.com/en-us/news/announcements/october-2026-tournament-rules-changelog/) 说明 "Today's rules go into effect with the Radiance Pre-Rift on October 16, 2026"。

官方正文只给出日历日期。若规则 fixture 把该日期表示为 `2026-10-16T00:00:00.000Z`，`00Z` 是本项目的实现假设，不是官方指定的 UTC 午夜。

官方规则中心是规范来源。若官方页面后续更新，先更新 manifest、测试夹具和回放兼容策略，再修改实现。

## 2. 参考站点和文章

| 来源 | 参考范围 | 边界 |
| --- | --- | --- |
| Rift Atlas 中文站 | 牌桌信息密度、牌卡展示、交互节奏的产品参考 | 不复制代码、布局、素材或品牌 |
| CSDN：YGO 生态文章 | 卡牌数据生态、脚本化和工具链思路 | 不把 YGO 连锁语义直接套到 Riftbound |

链接：

- https://play.riftatlas.com/zh-CN
- https://blog.csdn.net/gitblog_01117/article/details/141419828

## 3. 本地研究资料

研究阶段使用过以下本地资料，但它们被根目录 `.gitignore` 排除，不作为公开仓库内容：

```text
work/riftboundfaq/sources/CR-v1.5.pdf
work/riftboundfaq/sources/CR-v1.4.pdf
work/riftboundfaq/sources/Tournament-Rules-2026-10-09.pdf
work/riftboundfaq/sources/card-catalog.json
work/riftboundfaq/sources/card-errata.json
work/riftboundfaq/sources/rules-manifest.json
work/riftbound-core-rules-text/Riftbound-Core-Rules-Latest.txt
work/riftboundfaq/content/(rulings)/
```

其中 `(rulings)` 目录是非官方维护的 FAQ/裁判案例整理。它适合用来发现测试场景和解释争议，但不替代官方规则。发布到公开项目时只保留链接、版本、抽象案例和本项目原创解释。

## 4. 版本治理

每次规则或卡牌数据更新都创建一个不可变版本：

```text
ruleset/
  core-1.4/
  core-1.5/
  tournament-2026-10-09/
cards/
  data-2026-10-09-radiance/
```

### 4.1 当前卡池覆盖基线

当前目标卡池是**官方唯一印刷记录 1,381 张**，按系列覆盖为：

```text
OGN 352 + OGS 24 + RAD 192 + SFD 288 + UNL 288 + VEN 237 = 1381
```

社区来源 `LouisCourrian/riftbound-cards` 的 `v2026-10-10` release 当前为
1,380 张，缺 `unl-022-219` 普通版。它只用于文本修正、字段对照和缺失差异
提示，不能替代官方印刷记录作为覆盖基线。

### 4.2 同步流程与验证记录

2026-10-11 的实际验证结果如下：

```text
node scripts/sync-current-cards.mjs --dry-run
```

该命令在 `packages/card-data` 目录执行。

该命令退出 0，未写入文件；结果为社区来源 1,380 张、官方英文 1,381 张、
官方中文 1,381 张，生成合并结果 1,381 张，其中 `unl-022-219` 由官方图库
补齐。当前持久化快照和图像状态见
[packages/card-data/README.md](../packages/card-data/README.md)。

当前 deck catalog 为 1,381 个 printing、1,080 个 canonical identity、
46 个跨系列 identity，其中 1,212 个 standard printing、169 个
alternate printing；显示名中 1,355 个为中文、26 个为英文 fallback。
45 个以 ASCII `*` 结尾的官方 public code 已修正为 alternate，且所有
`primaryPrintingId` 保持稳定。

卡图缓存同样已在本地核对：`data/images` 为 1,381 个文件、0 个空文件，
`images-manifest.json` 为 1,381 条且 `ok=true`、`partial=false`、
missing/failures 均为 0；`sync:images --dry-run` 报告 1,381 resumed、
0 missing、0 failed。以上只证明数据与图像缓存完成，不证明官方效果规则
已经实现。

构筑校验同样是有限范围：当前实现官方禁牌、按 canonical 身份合并后的张数
上限和区域结构；Domain Identity、Champion/Legend/Signature 以及独立核验的
地区可用性限制仍未实现。

工作区验证必须区分通过和失败项。2026-10-11 的 `pnpm build`、
`pnpm typecheck`、全量 `pnpm test`、frozen install 和 audit 检查均通过。
当前测试总数和分包结果以 [implementation-status.md](implementation-status.md)
为准，不在此处维护第二份计数。

更新流程：

1. 下载或读取官方版本。
2. 记录发布日期、来源地址和 SHA-256。
3. 应用勘误并生成数据 diff。
4. 运行规则回归和回放 golden fixtures。
5. 更新 `rules-manifest` 和文档。
6. 标记旧版本为可回放但不可用于新对局，除非赛事策略另有要求。

## 5. 版权和再分发

本仓库不提交：

- 官方 PDF 原件。
- Riot/LoL/Riftbound 商标和 Logo。
- 官方卡图、角色立绘、素材包。
- 未确认许可的完整卡牌文案数据库。
- 本地扫描器、`node_modules` 或临时研究文件。

原创设计、接口和测试策略以仓库 LICENSE 为准。引用第三方名称和链接不等于取得第三方内容的再分发授权。
