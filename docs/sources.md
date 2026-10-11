# 资料与版本

## 1. 官方资料

| 资料 | 用途 | 地址 |
| --- | --- | --- |
| Riftbound 官方规则中心 | Core Rules、Tournament Rules、FAQ 和版本入口 | https://playriftbound.com/en-us/rules-hub/ |
| Tournament Rules 变更说明 | 赛事规则变更和当前版本核对 | https://playriftbound.com/en-us/news/announcements/october-2026-tournament-rules-changelog/ |

设计基线：

- Core Rules：`v1.5 / Radiance`。
- Tournament Rules：`2026-10-09`。
- 具体对局必须把实际使用的规则版本写入 Replay Envelope，不依赖“最新”这个相对词。

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
  core-1.5/
  tournament-2026-10-09/
cards/
  data-2026-10-09-radiance/
```

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
