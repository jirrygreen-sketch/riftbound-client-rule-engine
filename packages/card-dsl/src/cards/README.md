# 卡牌程序编写约定

本目录存放静态 `CardProgram` 数据，不实现单卡专用结算流程。以
[P0 契约](../../../../docs/plans/2026-10-15-p0-contract.md) §3.1、§3.6、§3.7
为准，规则依据使用 Core Rules v1.5 条目号。旧卡示例与最新契约不一致时，遵循契约，
不要复制旧的运行时引用或把历史 `status` 当作可执行性证明。

## 1. 目录、命名与身份

- 程序：`packages/card-dsl/src/cards/<set>/<slug>.ts`。
- Golden：`packages/card-dsl/test/cards/<set>/<slug>.test.mjs`，与程序同目录层级、同名。
- `<set>` 使用小写系列代码，如 `ogn`、`sfd`、`rad`。`<slug>` 使用英文卡名的小写
  kebab-case，匹配 `^[a-z0-9]+(?:-[a-z0-9]+)*$`；去掉撇号、句点，空格及其他分隔符
  合并为 `-`，如 `Long Sword` → `long-sword`、`Ornn's Forge` → `ornns-forge`。
- 按 `canonicalCardId` 去重，一个卡牌身份只写一个文件；不同印刷、异画或重印不重复实现。
  从本地 `deck-catalog.json` 精确核对 canonical 身份，不使用 printing ID、slug 或自造哈希替代。
- 默认导出程序，优先使用 `import type { CardProgram } from "../../ir/index.js"`
  配合 `satisfies CardProgram`。固定 `rulesetVersion: "core-1.5"`，保留官方原文
  `sourceText`；原文和 v1.5 规则依据须可审查，不凭印象补全效果。
- 指令 `id` 在卡内唯一，链接使用已声明的指令 ID。索引由脚本生成，新增卡不手改共享索引
  或 `registry.generated.ts`，不提交生成目录或官方卡牌数据。

## 2. `status` 的判定

| 状态 | 使用条件 |
| --- | --- |
| `executable` | 整张卡的能力均有明确依据，所需原语、关键词展开、解释器及相关内核路径已合入且可执行，并有对应执行测试；仅结构校验通过或 IR 可表达不够。 |
| `judge-required` | 任一能力规则未明确，或所需原语、关键词、图层、时点等依赖尚不可执行。可保留有依据的 IR 和已支持部分的测试，但不能宣称整张卡可执行。 |
| `no-ability` | 经官方卡面确认没有能力文本，`abilities: []`，如基本符文；不是“还没实现”的占位状态。 |

`judge-required` 必须填写具体、非空的 `judgeReason`：写清缺少哪个操作/语义、相关规则条目
或原文疑点，以及依赖任务号。例如：“缺临时 Might 修改与本回合到期处理，最低 1 的
钳制尚未支持；依赖 RIFT-83/84，不近似实现。”不能只写“待实现”或“需要裁定”。
依赖落地后复核规则并补齐执行证据，再修改状态；`test.todo` 不算通过的执行证据。
`energy: null` / `power: null` 表示没有印刷值，绝不转换成 `0`。

## 3. 对象引用只写 `ObjectSelector`

IR 是静态数据，不知道运行时对象 ID 或入区序号。§3.6 的符号形状如下（此处展示契约，
不在每张卡里重新定义类型）：

```ts
type ObjectSelector =
  | "self"
  | "source"
  | { target: string }
  | { pick: string }
  | { linked: string };
```

- `"self"` 指能力宿主；`"source"` 指能力来源，来源离场后的最后已知信息由解释器处理。
- `{ target: "unit" }` 引用 `TargetSpec.id`；`{ pick: "gear" }` 引用 `PickSpec.id`。
  `targets` 会涉及目标相关触发，`picks` 是非目标选择，两者不可互换。
- `{ linked: "..." }` 引用前序指令写入的对象/对象列表链接值，键与生产者约定一致。
- 表达式的 `object`、条件中的对象、过滤器的对象锚点等，一律使用以上选择器。
  禁止在卡程序中写 `{ id, zoneEntryId }`，也不能把假 `ObjectRef` 包进常量规避校验。

解释器负责把选择器解析为运行时 `ObjectRef`；后者只属于 `ResolveContext` 与原语内部。
测试可用内核生成的真实引用绑定上下文，但不能把它们写回静态 IR。若当前类型或校验器
尚未同步该契约，应记录上游依赖（RIFT-1），保持受影响能力 `judge-required`，执行用例
标明 `test.todo`，不填假引用、不用类型断言绕过，也不在本卡任务中改共享契约。

## 4. Golden 测试分层

使用 `node:test` 和 `node:assert/strict`，从构建后的 `dist` 导入程序及校验器。
每张 `executable` 卡提供 1–3 个执行场景（可以是 4.1 节的模板级参数化用例中本卡自己的参数行）；其余卡仍须校验与结构测试。

1. **校验与身份**：调用 `validateCardProgram(program)`，断言 `ok === true`、
   `issues` 为空；核对完整 `canonicalCardId`、规则版本、状态及原文。
   `judge-required` 额外断言具体 `judgeReason`；`no-ability` 断言空能力列表。
2. **结构**：断言能力种类、关键词和值、指令顺序/参数、目标与 pick 的过滤器和数量、
   条件范围及 `linkedTo`。独立语句不要为了测试方便强行链接；不要仅断言“数组非空”。
3. **真实执行已支持部分**：用 `effects/testing/`（RIFT-46）的 `world()` 构造初始局面，
   通过已有 `runInstruction` 执行真实原语；需要指令顺序、链接、条件、选择等语义时，
   用已有 `runAbilityBody` 解释器配合测试内核执行程序的原始 body，而非手工复刻结算。
   断言实际事件、执行结果、链接值及状态变化；按效果覆盖正常、`negated`、`ignored`
   等边界。参考[测试内核说明](../../../engine-core/src/effects/testing/README.md)与
   [解释器说明](../../../engine-core/src/effects/interpreter/README.md)。
4. **尚不可执行部分**：保留可运行的结构/子效果测试，未合入依赖用 `test.todo`，标题写清
   缺失语义和真实任务号；例如 Stupefy 的临时 Might 场景依赖 RIFT-83/84。
   局部原语执行不证明整卡、关键词展开或生产链路已完成；依赖就绪后必须将 TODO 改为实际场景。

不能用 fixture 手工结算、直接改 frame/zone/resource/health、跳过回合步骤，或用伪造
callback / no-op closure 充当执行成功；不能删测试、放宽断言或把错误行为写成预期。

### 4.1 模板级参数化 golden（2026-10-17 用户批准）

IR 结构相同的一组卡（同一能力模板，如“进场时抽 N”“对一个单位造成 N 点伤害”）可以共用一个
参数化执行测试，放在 `packages/card-dsl/test/cards/templates/<template>.test.mjs`，
用通用卡牌执行测试台（`effects/testing/scenario`）经真实路径执行。它可以作为第 3 层
“真实执行”的证据，前提是：

- **每张卡有自己的参数行**：完整 `canonicalCardId`（或程序文件路径）、本卡的局面与操作、
  本卡特有的数值/目标/区域，以及**本卡自己的期望断言**（事件序列、状态变化、链接值）；
  不能只断言“整组都执行成功”或共用同一份期望结果。
- 每张卡的参数行生成独立的 `test` 用例，测试名包含卡名与 canonical 身份前缀，失败时能定位到单卡。
- 第 1、2 层（校验与身份、结构）仍按单卡写在 `test/cards/<set>/<slug>.test.mjs`（可精简为
  校验 + 关键结构断言），并在文件头注明执行证据所在的模板测试文件。
- 模板测试覆盖的边界（negated / ignored / 无合法目标等）至少每个模板一组，卡特有边界仍按卡写。

## 5. 关键词只声明，不重写

统一使用 `{ kind: "keyword", keyword, value }`（无数值时省略 `value`），例如：

```ts
{ kind: "keyword", keyword: "assault", value: 2 }
{ kind: "keyword", keyword: "quick-draw" }
```

`keyword` 对齐已注册的 `KeywordId`，不自创大小写或别名。关键词展开、叠加规则、触发、
静态效果及费用/打出改写属于 `engine-core/src/effects/keywords/<keyword>.ts`（§3.7）；
卡文件不能再手写一套相同逻辑，不能自行推进优先权或结算链。缺少展开实现时遵循
`judge-required` 口径，而不是因为能写出声明就标记 `executable`。

## 已合入的三类示例

| 类型 | 程序 / Golden | 可参考部分 |
| --- | --- | --- |
| 基本符文 Body Rune | [程序](ogn/body-rune.ts) / [测试](../../test/cards/ogn/body-rune.test.mjs) | `no-ability`、空能力、canonical 身份及原文校验。 |
| 法术 Stupefy | [程序](ogn/stupefy.ts) / [测试](../../test/cards/ogn/stupefy.test.mjs) | 具体 `judgeReason`、独立抽牌指令的真实测试、带任务号的 TODO。 |
| 装备 Long Sword | [程序](sfd/long-sword.ts) / [测试](../../test/cards/sfd/long-sword.test.mjs) | 默认导出、关键词声明、数值与结构断言；其历史 `executable` 和展开 TODO 不代表依赖已经可执行，须按第 2 节复核。 |

## 本地验证

在仓库根目录运行；不改依赖、锁文件或生成卡牌数据：

```sh
pnpm --filter @riftbound/card-dsl typecheck
heavy pnpm --filter @riftbound/card-dsl test
```

迭代时优先运行已构建的对应 `test/cards/<set>/<slug>.test.mjs`；包级测试包含构建，
必须走 `heavy` 限流。结构、子效果与 TODO 的结果分别报告，不把 TODO 计作已执行通过。
