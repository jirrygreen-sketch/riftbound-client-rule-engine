# 新增一张卡牌程序

卡牌程序是静态数据：`packages/card-dsl/src/cards/<set>/<slug>.ts` 默认导出一个
`CardProgram`。引擎不为单张卡写结算代码；文本差异通过 EffectIR 数据表达。

本仓库已有大量卡牌 golden 可对照；本页给出从定位官方数据到提交的完整通道。

## 0. 先确认边界

- 卡牌程序约定以 `packages/card-dsl/src/cards/README.md` 为准，本页是操作化补充。
- 契约 3.1（`CardProgram`）与 3.9（控制结构形状）见
  `docs/plans/2026-10-15-p0-contract.md`。
- `status` 只有三个取值：`executable` / `judge-required` / `no-ability`。
  只要有一条能力缺规则依据或缺原语，就是 `judge-required`；
  IR 能表达不等于可执行。
- `energy: null` / `power: null` 表示没有印刷值，不得写成 `0`。

## 1. 目录、命名、身份

```text
程序：packages/card-dsl/src/cards/<set>/<slug>.ts
测试：packages/card-dsl/test/cards/<set>/<slug>.test.mjs
```

- `<set>` 用小写系列代码：`ogn`、`ogs`、`rad`、`sfd`、`unl`、`ven`
  （现有目录见 `packages/card-dsl/src/cards/`）。
- `<slug>` 是英文卡名的小写 kebab-case，匹配
  `^[a-z0-9]+(?:-[a-z0-9]+)*$`。去掉撇号与句点，其它分隔符合并为 `-`：
  `Long Sword` → `long-sword`、`Ornn's Forge` → `ornns-forge`。
- 按 `canonicalCardId` 去重，一个卡牌身份一个文件。不同印刷、异画、重印不重复实现。
- 不要手改 `packages/card-dsl/src/cards/registry.generated.ts`（生成文件，已
  gitignore）。新增文件后运行 `node scripts/gen-registries.mjs` 即可，
  包脚本的 `prebuild` / `pretest` / `pretypecheck` 也会自动生成。

### 1.1 从本地 catalog 精确取身份

`canonicalCardId` 由官方全名哈希得到（见
`packages/card-data/scripts/build-deck-catalog.mjs` 的 `canonicalId()`）。
用脚本按全名精确查询，不要用 printing ID、slug 或自造哈希替代：

```sh
node --input-type=module -e "
  import { readFileSync } from 'node:fs';
  const catalog = JSON.parse(readFileSync('packages/card-data/data/deck-catalog.json', 'utf8'));
  const card = catalog.cards.find(entry => entry.fullName === 'Long Sword');
  console.log(card);
"
```

输出示例（2026-10-16 本地数据）：

```text
Long Sword -> card.hash-cab923a670e4baa826aa3de381c8b992bf33987fcb0d65feb75ca538a8681010 SFD-022/221
Body Rune  -> card.hash-a2227b03e9e13c8e2ddae7a973c746cc4243ff631dfaf462dc9823e687bbbf17 OGN-126/298
```

`deck-catalog.json` 是 gitignore 的本地数据；新 checkout 需先按
`packages/card-data/README.md` 同步，文件不存在时不要猜 `canonicalCardId`。

## 2. 写程序

骨架（对照 `packages/card-dsl/src/cards/sfd/long-sword.ts` 与
`packages/card-dsl/src/cards/ogn/body-rune.ts`）：

```ts
import type { CardProgram } from "../../ir/index.js";

/**
 * Card Name (set-###-###) — 类型、费用。
 *
 * Printed text:
 *   <官方原文>
 *
 * Rules evidence (Core Rules v1.5):
 * - 4xx.x: ...
 */
const cardName = {
  canonicalCardId: "card.hash-...",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 <具体原语 / 语义>，依据 CR v1.5 <条目号>；依赖 <任务号>，不近似实现。",
  sourceText: "<官方原文，保留方括号关键词与换行>",
  abilities: [
    // 关键词只声明：{ kind: "keyword", keyword: "quick-draw" }
    // 触发 / 启动 / 静态 / 替代 / 打出：见契约 3.1
  ]
} satisfies CardProgram;

export default cardName;
```

硬性要求：

1. `rulesetVersion` 固定 `"core-1.5"`（常量 `EFFECT_IR_V2_RULESET`，
   从 `@riftbound/card-dsl` 导出）。
2. `sourceText` 保留官方原文，供审查；不要凭印象补全效果文本。
3. `judge-required` 必须写具体非空的 `judgeReason`：缺哪个操作 / 语义、
   相关规则条目或原文疑点、依赖任务号。不能只写「待实现」。
4. 关键词只声明，不重写：`{ kind: "keyword", keyword: "assault", value: 2 }`。
   展开逻辑属于 `effects/keywords/<Keyword>.ts`（见
   [add-keyword.md](./add-keyword.md)）。
5. IR 里的对象位置一律用符号 `ObjectSelector`：
   `"self"`、`"source"`、`{ target: id }`、`{ pick: id }`、`{ linked: id }`。
   禁止 `{ id, zoneEntryId }`，也不能把假 `ObjectRef` 包进常量规避校验。
6. 指令 `id` 在卡内唯一，`linkedTo` 引用已声明的指令 ID。
7. 「可以……」写成 `choice.optional` 并把被选择的指令包进 `body`，
   不要写成「choice + 后续 linkedTo」（`validateCardProgram` 会拒绝）。

### 2.1 查找规则依据

```sh
# 先定位行号，再按行读取，禁止整份读入
grep -n "Assault" /root/swarm-rift/shared/rules/CR-v1.5.txt | head
sed -n "12345,12380p" /root/swarm-rift/shared/rules/CR-v1.5.txt
```

规则文本只读；章节索引 `docs/rules/core-1.5-sections.md`，
v1.4→v1.5 差异 `docs/rules/core-1.4-to-1.5-diff.md`。

## 3. 写 golden 测试

测试路径与程序同名同层级：`packages/card-dsl/test/cards/<set>/<slug>.test.mjs`。
使用 `node:test` + `node:assert/strict`，从构建后的 `dist` 导入：

```js
import assert from "node:assert/strict";
import test from "node:test";
import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/long-sword.js";

test("long-sword: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? null : result.issues));
  assert.equal(program.canonicalCardId, "card.hash-cab...");
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
});
```

分层要求（`packages/card-dsl/src/cards/README.md` 第 4 节）：

1. **校验与身份**：`validateCardProgram` 通过、`issues` 为空；核对完整
   `canonicalCardId`、规则版本、状态、原文；`judge-required` 断言具体
   `judgeReason`，`no-ability` 断言空能力列表。
2. **结构**：能力种类、关键词与值、指令顺序与参数、目标 / pick 的过滤器与数量、
   条件范围、`linkedTo`。不要只断言「数组非空」。
3. **真实执行已支持部分**：用 `effects/testing/` 的 `world()` 构造局面，
   经 `runInstruction` 执行原语；需要顺序 / 链接 / 条件 / 选择时用
   `runAbilityBody` 跑程序的原始 body。断言实际事件、结果、链接值与状态变化，
   覆盖 `negated` / `ignored` 边界。参考
   `packages/card-dsl/test/cards/ogn/stupefy.test.mjs`。
4. **尚不可执行部分**：保留可运行的结构 / 子效果测试，未合入依赖用
   `test.todo` 并写清缺失语义与真实任务号（例如
   `packages/card-dsl/test/cards/sfd/long-sword.test.mjs` 的两条 todo）。
   `test.todo` **不算执行证据**。

禁止：用 fixture 手工结算、直接改 frame / zone / resource / health、跳过回合步骤、
伪造 callback 或 no-op closure 充当执行成功、删测试、放宽断言、把错误行为写成预期。

## 4. 验证

先构建再跑该卡的 golden：

```sh
pnpm --filter @riftbound/card-dsl build
node --test packages/card-dsl/test/cards/sfd/long-sword.test.mjs
```

改了 card-dsl，提交前跑包级全量：

```sh
pnpm --filter @riftbound/card-dsl typecheck
heavy pnpm --filter @riftbound/card-dsl test
```

卡牌程序会进入 `packages/card-dsl/src/cards/registry.generated.ts`，
部分 golden 会用它做注册断言（例如
`packages/card-dsl/test/cards/sfd/gold.test.mjs`）。当前还没有把卡牌注册表
接入 engine-core 或 integration-tests 的生产装配路径，因此卡牌改动
不强制下游回归；如果确实改了共享契约或 engine-core，再补跑：

```sh
heavy pnpm --filter @riftbound/engine-core test
```

不提交生成目录、官方卡牌数据或 `registry.generated.ts`。完整门禁见
[testing.md](./testing.md)。
