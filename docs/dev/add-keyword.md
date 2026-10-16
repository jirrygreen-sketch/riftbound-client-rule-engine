# 新增一个关键词

关键词（keyword）是 `packages/engine-core/src/effects/keywords/<Keyword>.ts` 下的
一个默认导出 `KeywordDef`。关键词本身**不写流程**，它只把印刷在卡面上的关键词
展开成契约 3.1 的 `Ability[]`（触发 / 静态 / 启动 / 替代 / 打出改写），
之后由解释器、时点和链执行。

```text
CardProgram.abilities 里的 { kind: "keyword", keyword, value }
  -> KeywordDef.expand({ value, host })
    -> Ability[]（EffectIR 能力）
      -> 解释器 / 时点 / 链 / 图层
```

## 0. 先确认边界

- 接口是冻结的：`packages/engine-core/src/effects/keyword-contract.ts` 与契约
  `docs/plans/2026-10-15-p0-contract.md` 3.7 节。不要改 `KeywordDef` 形状。
- 关键词不能自己推进优先权、自己结算另一张卡、或直接改状态。
- 展开里无法用现有原语表达的部分，保持卡牌 `judge-required`，
  在 `ruleRefs` 旁注明缺口，不要近似实现。
- 规则依据用 Core Rules v1.5 条目号；用 `grep -n` 在
  `/root/swarm-rift/shared/rules/CR-v1.5.txt` 定位后按行读取。

## 1. 新建文件

```text
packages/engine-core/src/effects/keywords/<Keyword>.ts
```

文件名使用卡面方括号内的名称原文（保留大小写与连字符），例如
`Assault.ts`、`Quick-Draw.ts`、`Deathknell.ts`。注册表由
`scripts/gen-registries.mjs` 生成，按 `keyword` 字段索引。

注意：与 `instructions/` 相同，生成器会扫描 `keywords/` 下所有 `.ts` 文件，
每个文件都必须是一个关键词定义，不能放共享辅助模块；需要共用工具就内联，
或依赖已导出的 `@riftbound/card-dsl` 类型。

## 2. 实现 `KeywordDef`

骨架（可对照 `packages/engine-core/src/effects/keywords/Assault.ts`）：

```ts
import type { Ability } from "@riftbound/card-dsl";
import type { CardContextRef, KeywordDef } from "../keyword-contract.js";

const example = {
  keyword: "Example",
  valued: false,          // 是否带数值：Assault 2 → true；Quick-Draw → false
  stacking: "single",     // "sum" | "single" | "separate"
  ruleRefs: ["900", "900.1"],
  expand(input: { readonly value?: number; readonly host: CardContextRef }): readonly Ability[] {
    void input.value;
    return [
      {
        kind: "static",
        effect: {
          kind: "continuous.timing",
          value: { kind: "constant", value: "reaction" },
          source: { canonicalCardId: input.host.canonicalCardId },
          scope: "source",
          permissions: ["play"]
        }
      }
    ];
  }
} satisfies KeywordDef;

export default example;
```

### 2.1 `stacking` 怎么选

| 取值 | 含义 | 现有例子 |
| --- | --- | --- |
| `"sum"` | 同名关键词的数值相加后只展开一次 | `Assault.ts`（CR 807.2）、`Shield.ts`、`Disarm.ts`、`Deflect.ts` |
| `"single"` | 多个同名实例只算一个 | `Quick-Draw.ts`、`Ganking.ts`（CR 810.2）、`Action.ts` |
| `"separate"` | 每个实例展开为独立能力 | `Deathknell.ts`、`Equip.ts`、`Flow.ts` |

判断依据写进文件头注释与 `ruleRefs`。规则里的数值相加只对带数值的被动关键词
成立，不要照搬到布尔式许可（`Action.ts` 的注释解释了这一点）。

### 2.2 宿主引用用符号选择器

展开结果里的对象位置一律写 `ObjectSelector`（`"self"` / `"source"` /
`{ target }` / `{ pick }` / `{ linked }`），由解释器在运行时绑定。
禁止在关键词展开里写 `{ id, zoneEntryId }` 的运行时引用。
`Assault.ts` 导出的 `SELF_OBJECT_REF = "self"` 可作范例。

### 2.3 展开结果必须通过校验

`expand` 返回的每个能力都要能通过 `validateCardProgram`。测试里用最小
`CardProgram` 外壳包住展开结果做断言，参考
`packages/engine-core/test/effects/keywords/Assault.test.mjs`。

## 3. 卡牌侧只声明

卡牌程序里只写声明，不复制展开逻辑：

```ts
{ kind: "keyword", keyword: "assault", value: 2 }
```

注意 `keyword` 字段对齐已注册的 `KeywordId`，不要自创大小写或别名。
带印刷参数的（如 `[Equip]` 的费用）按契约 3.8 走 `params`；当前冻结的
`KeywordDef.expand` 输入只正式声明 `value` 与 `host`（`CardContextRef` 只有
`canonicalCardId`），现有实现（如 `Flow.ts`、`ShowOff.ts`）在同一形状上声明
可选 `params` 并向前兼容。需要更多上下文时先写契约变更请求，不要改
`keyword-contract.ts`。

## 4. 补测试

测试放 `packages/engine-core/test/effects/keywords/<Keyword>.test.mjs`。
至少覆盖：

1. `keyword` / `valued` / `stacking` / `ruleRefs` 的身份断言。
2. 带值与不带值（默认值）两种展开；没有印刷数值时按规则取默认值，
   例如 `Assault.ts` 的 `ASSAULT_DEFAULT_VALUE = 1`（CR 807.1.b.3）。
3. 展开结果逐个通过 `validateCardProgram`。
4. 同名多实例的合并行为（`sum` / `single` / `separate` 各断言一次）。
5. 已经可以真实执行的能力用 `runInstruction` / `runAbilityBody` 跑执行场景；
   依赖尚未合入的语义用 `test.todo` 并写明依赖任务号，不算通过证据。

`runAbilityBody` 包一层测试原语的写法可参考
`packages/engine-core/test/effects/keywords/Quick-Draw.test.mjs`。

## 5. 验证

```sh
pnpm --filter @riftbound/engine-core build
node --import ./packages/engine-core/test/support/register.mjs --test \
  packages/engine-core/test/effects/keywords/Assault.test.mjs
```

提交前：

```sh
pnpm --filter @riftbound/engine-core typecheck
heavy pnpm --filter @riftbound/engine-core test
heavy pnpm --filter @riftbound/game-server test
```

完整门禁见 [testing.md](./testing.md)。
