# 规则 Fixture 与可追溯裁判模型

## 1. 目标和边界

`@riftbound/judge-tools` 的 `createOfficialRadianceRuleFixtureSet()` 提供一组
面向未来规则引擎的测试规格。它的目标是：

1. 用稳定 ID 记录官方规则条目的适用语义。
2. 区分“资料已发布”和“规则已生效”。
3. 把自动执行、玩家选择、未实现语义和裁判介入划分成显式决策类型。
4. 让隐私信息在 fixture、回放和裁判请求边界内不可携带。

该包不实现引擎状态机，也不声称任何卡牌效果已经可执行。fixture 中的
`statement`、`given` 和 `expected` 是本项目原始的测试规格，不复制官方规则或
裁判案例文本。

## 2. 时间语义

当前 fixture 的建档时间：

```text
asOf = 2026-10-11T00:00:00.000Z
```

2026-10-12 官方正文核实结果：

```text
official effective date = 2026-10-16
```

Radiance patch notes 首句为 "Radiance Rules Update Effective October 16,
2026"，Tournament Rules changelog 说明 "Today's rules go into effect with
the Radiance Pre-Rift on October 16, 2026"。两篇文章均只给出日历日期。

代码 fixture 使用：

```text
effectiveAt = 2026-10-16T00:00:00.000Z
```

其中 `00Z` 是可序列化实现假设，用于把日历日映射为时间戳；官方未指定 UTC
午夜。在 2026-10-16 当天创建对局时应按赛事时区口径选择实际切换点，不得
宣称该时间戳来自官方正文。

在 `2026-10-16` 前，Radiance Core Rules 和 2026-10 Tournament Rules 是已
发布的未来规则，不能被当成当前对局的默认权威。2026-10-12 时当前生效
Core Rules 是 `v1.4 / 2026-07-16`。fixture 中的
`source.governance.radiance-effective-window` 明确断言这一点。

Vendetta 官方 FAQ 的 `effectiveUntil` 记录为 `2026-10-16T00:00:00.000Z`，原因是
官方 FAQ 自身声明新 Core Rules 生效后优先于旧 FAQ。这里的日历边界来自新
Core Rules 生效日；`00Z` 同样是 fixture 实现假设。

## 3. 来源清单

| 来源 ID | 类型 | 版本 | 官方文档日期 / 发布时间 | 官方生效日 | fixture 生效时间戳 | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| `riftbound.core-rules-1.4` | official-rule | `1.4` | `2026-07-16`（last updated） | 2026-10-12 时 active | 未使用 | 无 |
| `riftbound.core-rules` | official-rule | `1.5` | `2026-10-09`（last updated） | `2026-10-16` | `2026-10-16T00:00:00.000Z`（实现假设） | `94D41FEE86F88B61C4157C0389C0595D990B98E5B42555C99D9F649EE64D1FEC` |
| `riftbound.radiance-patch-notes` | official-rule | `2026-10-09` | `2026-10-09T16:00:00.000Z`（published） | `2026-10-16` | `2026-10-16T00:00:00.000Z`（实现假设） | 无 |
| `riftbound.tournament-rules` | policy-document | `2026-10-09` | `2026-10-09T16:00:00.000Z`（published） | `2026-10-16` | `2026-10-16T00:00:00.000Z`（实现假设） | `CE07DA4FB632526AFBBCE7F058287A57E7444FA6BDE17B0938FF52CE3FAB3D07` |
| `riftbound.official-faq` | official-case | `2026-08-14` | `2026-08-14T01:00:00.000Z`（published） | 至 `2026-10-16` | 至 `2026-10-16T00:00:00.000Z`（实现假设） | 无 |

Core Rules PDF:
`https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf`

Radiance Patch Notes:
`https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/`

Tournament Rules PDF:
`https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/861752822d217edf37d9febaeaf77a7d924c1bb6.pdf`

Vendetta Rules FAQ:
`https://playriftbound.com/en-us/news/rules-and-releases/vendetta-rules-faq-and-clarifications`

`EvidenceRef` 只保存 `sourceType`、`sourceId`、`url`、`version` 和 `ref`。没有
摘录、引用或正文字段；消费者必须自行访问来源并遵守其条款。

## 4. 决策模型

| decision | 含义 | 引擎要求 |
| --- | --- | --- |
| `auto` | 存在唯一、确定的结果 | 未来引擎可自动断言 |
| `prompt` | 合法结果依赖玩家选择 | 未来引擎必须生成 Prompt |
| `notImplemented` | 官方语义明确，但规格未要求当前实现 | 只作为测试规格，不声称已完成 |
| `judgeRequired` | 缺少可执行权威或属于政策裁量 | 阻断自动近似执行并升级裁判 |

`judgeRequired` 必须携带 `judgeReason`，并引用已注册来源。非 `judgeRequired`
case 不允许携带 `judgeReason`，避免把政策解释伪装成规则结果。

当前裁判原因只包含模型内置的枚举：

- `ambiguous-rule`
- `conflicting-authorities`
- `missing-authoritative-source`
- `policy-escalation`
- `discretionary-effect`

## 5. Fixture 矩阵

| Fixture ID | 类别 | decision | 官方引用 |
| --- | --- | --- | --- |
| `source.governance.radiance-effective-window` | source-governance | auto | Patch Notes, Tournament Rules |
| `chain.finalize.order` | chain | auto | CR 337.1, 337.1.a, 337.1.b |
| `chain.finalize.immediate-resolution.exception` | chain | auto | CR 337.2 |
| `chain.resolve.newest-finalized-first` | chain | auto | CR 340.1 |
| `priority.focus.single-holder` | priority | auto | CR 312, 313 |
| `focus.priority-coupling` | focus | auto | CR 312.1, 313.2, 313.4 |
| `focus.showdown-does-not-pass-after-triggered-or-add-chain` | focus | auto | CR 346.1 |
| `cleanup.blocks-fepr-priority-focus` | cleanup | auto | CR 320, 320.1 |
| `cleanup.recursive-fixed-point` | cleanup | auto | CR 322, 322.1 |
| `cleanup.deferred-during-resolution` | cleanup | auto | CR 321, 321.1 |
| `execute.partially-impossible` | execute-as-much-as-possible | notImplemented | CR 55, 55.1 |
| `privacy.hand-count-public` | privacy | auto | CR 108.7.c, 108.7.e, 128.4 |
| `privacy.facedown-zone-public-card-private` | privacy | auto | CR 107.3.f, 128.4 |
| `privacy.cannot-compel-typed-secret-choice` | privacy | prompt | CR 128.6, 128.6.a |
| `object.identity.non-board-boundary` | object-identity | notImplemented | CR 124, 124.1 |
| `judge.required-unknown-card-semantics` | judge-decision | judgeRequired | CR 55, Official FAQ |
| `judge.tournament-policy-separate-layer` | judge-decision | judgeRequired | CR 333, Tournament Rules |

## 6. 隐私保证

`JudgeEvent.payload` 是唯一的开放式 JSON 区域，但解析器会递归拒绝隐藏手牌键：

```text
hand
hiddenhand
privatehand
concealedhand
opponenthand
```

键名比较会忽略大小写、`-` 和 `_`，因此 `private_hand` 或 `concealed-hand`
同样被拒绝。这个行为与 `packages/replay-core` 的事件隐私校验保持一致。

fixture 不需要携带完整游戏状态。未来引擎接入时，应由引擎生成最小必要事实；
任何隐藏手牌事实都必须进入受控裁判视图，而不是进入可交换 fixture。

## 7. 校验规则

`validateRuleFixtureSet()` 会拒绝：

- 未注册或重复的来源证据。
- 缺少或指向未知来源的 lifecycle。
- 晚于 `asOf` 的发布时间。
- `effectiveAt` 早于 `publishedAt` 的窗口。
- `effectiveUntil` 早于或等于 `effectiveAt` 的窗口。
- `historical` 来源缺少 `effectiveUntil`。
- `judgeRequired` 缺少原因或原因证据未注册。
- 非 `judgeRequired` 携带原因。
- 事件 payload 中的隐藏手牌数据。

`serializeRuleFixtureSet()` 递归排序对象键但保留数组顺序；
`stableHashRuleFixtureSet()` 使用 FNV-1a 64 位哈希。相同语义内容在对象键顺序
不同时应得到相同序列化和哈希。

## 8. 使用方式

```ts
import {
  createOfficialRadianceRuleFixtureSet,
  validateRuleFixtureSet
} from "@riftbound/judge-tools";

const fixtures = createOfficialRadianceRuleFixtureSet();
const result = validateRuleFixtureSet(fixtures);
```

未来引擎实现每个 fixture 前，必须：

1. 确认对局实际生效的规则版本。
2. 用引擎状态生成最小 `given` 输入。
3. 把 `expected` 映射为可观测事件和状态断言。
4. 保留 `decision` 语义，不把 `prompt` 或 `judgeRequired` 降级成默认选择。
5. 为 `notImplemented` case 建立独立实现任务，不因 schema 校验通过而声称已完成。

## 9. 剩余限制

- fixture 是规格层，不包含规则引擎执行器。
- `notImplemented` case 只定义断言，不代表当前引擎能力。
- 当前未注册具体卡牌效果语义；不会虚构任何卡牌行为。
- 2026-10-11 时 Radiance 和 2026-10 Tournament Rules 尚未生效，不能作为默认
  对局规则集。
- 网页来源未保存快照；线上内容变化时需要重新核对版本、发布时间、生效时间和
  文件摘要。
