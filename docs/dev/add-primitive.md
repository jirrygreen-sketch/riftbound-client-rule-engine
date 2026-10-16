# 新增一个原语

原语（primitive）是 `packages/engine-core/src/effects/instructions/` 下的一个
`InstructionDef` 文件，一个文件实现一个 opcode。卡牌程序只引用 opcode 名字，
通用语义全部在解释器与原语里完成。

## 0. 先确认边界

- 原语只能通过 `ResolveContext` 读写。需要新的 `GameAction` 类型、新的
  `ResolveContext` 方法或新的 `ObjectSnapshot` 字段时，先停止实现，
  在最终回复里写「契约变更请求」，不要自己扩接口。
- 不要为单张卡写专用原语。卡牌文本差异属于 EffectIR 数据与参数，原语只实现
  可复用的动作。
- 规则依据必须来自 Core Rules v1.5。写代码前用 `grep -n` 在
  `/root/swarm-rift/shared/rules/CR-v1.5.txt` 定位条目，
  不要整份读取该文件。

参考：

- 契约 3.6：`docs/plans/2026-10-15-p0-contract.md`
- 接口定义：`packages/engine-core/src/effects/contract.ts`
- 现有完整例子：`packages/engine-core/src/effects/instructions/effect.draw.ts`

## 1. 新建文件

文件路径固定为：

```text
packages/engine-core/src/effects/instructions/<op>.ts
```

`<op>` 就是 `InstructionDef.op`，例如 `effect.damage`、`effect.move`。
文件名与 op 一致（`effect.damage.ts` ↔ `op: "effect.damage"`）。

命名注意事项：

- 生成器会扫描该目录下所有 `.ts` 文件（排除 `*.test.ts` 与
  `registry.generated.ts`），并静态读取默认导出的 `op` 字段。
  不要在目录里放辅助模块、常量模块或聚合 `index.ts`，否则注册表生成会失败。
- 默认导出的 `op` 必须是字面量字符串，不能是计算出来的。

## 2. 实现 `InstructionDef`

骨架（结构照抄契约 3.3 / 3.6）：

```ts
import type {
  InstructionDef,
  ResolveContext,
  Schema
} from "../contract.js";
import type { Expr } from "@riftbound/card-dsl";

/** 结算时求值的参数。argsSchema 校验的是 EffectIR 形状（未求值）。 */
export interface EffectExampleArgs {
  readonly amount: Expr;
}

function parseArgs(value: unknown): EffectExampleArgs {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("effect.example args must be an object");
  }
  const record = value as Record<string, unknown>;
  if (record.amount === undefined) {
    throw new TypeError("effect.example args.amount is required");
  }
  return value as EffectExampleArgs;
}

const argsSchema: Schema<EffectExampleArgs> = {
  parse: parseArgs
};

const effectExample = {
  op: "effect.example",
  argsSchema,
  execute(ctx: ResolveContext, args: EffectExampleArgs) {
    const amount = ctx.evaluate(args.amount);
    if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0) {
      return { status: "negated", reason: "impossible", events: [] };
    }
    const outcome = ctx.perform({ type: "draw", player: ctx.controller, amount });
    if (outcome.status !== "done") {
      return {
        status: "negated",
        reason: outcome.status === "replaced" ? "replaced"
          : outcome.status === "prevented" ? "skipped" : "impossible",
        events: [...outcome.events]
      };
    }
    ctx.link("drawn", outcome.result ?? amount);
    return { status: "executed", events: [...outcome.events] };
  }
} satisfies InstructionDef<EffectExampleArgs>;

export default effectExample;
```

实现时必须遵守：

1. **只读 `ResolveContext`**：`object` / `lastKnown` / `query` / `zoneSlice` /
   `targets` / `picks` / `player` / `evaluate` / `test` / `linked` / `history`。
   写只允许 `perform`、`link`、`addContinuous`、`registerDelayedTrigger`。
   不得直接改 state、不得推进 priority / focus、不得自己往链上加项。
2. **确定性**：不读时间、不用 `Math.random`。随机与洗牌走
   `perform({ type: "shuffle" })`。
3. **结果映射**：任何 `perform` 返回 replaced / prevented / impossible →
   `negated`；引用全部失效的目标 → `ignored` 且 reason `mistargeted`。
   部分目标失效时只用仍然合法的成员（`effect.draw.ts` 有可对照实现）。
4. **null 不是 0**：`energy: null` / `power: null` 表示没有印刷值，
   缺失信息时忽略或否定，禁止转成 0。
5. **顺序敏感读取用 `zoneSlice`**：牌库顶 / 底 N 张必须用
   `ctx.zoneSlice(player, "deck", "top", n)`；`query` 是集合查询、不保证顺序。
6. **选择用 `choose`**：需要玩家决定时抛出式挂起，调用者回滚整个 body 后带答案重放。
   不要读取 UI 状态或自己做缓存。
7. **`argsSchema` 校验求值前形状**：`Expr` 保持未求值，执行时再 `ctx.evaluate`。

## 3. 注册表自动生成

不要手写 `registry.generated.ts`、不要改共享索引。生成脚本是
`scripts/gen-registries.mjs`，它同时生成原语、关键词和卡牌的注册表。
`packages/engine-core/package.json` 已把生成接到 `prebuild` / `pretest` /
`pretypecheck`：正常跑包脚本就会重新生成。

单独生成：

```sh
node scripts/gen-registries.mjs
```

需要同时核对注册项时：

```sh
node --input-type=module -e "import('./packages/engine-core/dist/effects/instructions/registry.generated.js').then(m => console.log([...m.instructionRegistryById.keys()].sort().join('\\n')))"
```

## 4. 补测试

测试放 `packages/engine-core/test/effects/instructions/<op>.test.mjs`，
使用参考测试内核而不是生产引擎：

```ts
import draw from "../../../src/effects/instructions/effect.draw.ts";
import { runInstruction, world } from "../../../src/effects/testing/index.ts";

const run = runInstruction(draw, { amount: { kind: "constant", value: 2 } }, {
  world: world().deck("a").deck("b").build()
});
```

契约 5 节的要求是每个原语至少覆盖：正常执行、`negated`、`ignored`。
按语义补充 `choose` 挂起重放、部分目标失效、顺序、替代/阻止等边界。
禁止用 fixture 手工结算、手改区域 / 资源 / 生命值，或跳过动作直接改结果。

测试内核用法见 `packages/engine-core/src/effects/testing/README.md`，
解释器语义见 `packages/engine-core/src/effects/interpreter/README.md`。

## 5. 验证

聚焦运行（engine-core 的测试从 `src` 导入 TS，需要仓库自带的解析钩子，
与包内 `test` 脚本一致）：

```sh
pnpm --filter @riftbound/engine-core build
node --import ./packages/engine-core/test/support/register.mjs --test \
  packages/engine-core/test/effects/instructions/effect.draw.test.mjs
```

改了 engine-core，提交前必须跑包级全量：

```sh
pnpm --filter @riftbound/engine-core typecheck
heavy pnpm --filter @riftbound/engine-core test
```

原语属于 engine-core，下游 game-server 也要跑：

```sh
heavy pnpm --filter @riftbound/game-server test
```

完整命令与门禁见 [testing.md](./testing.md)。

## 6. 提交前自查

- `op` 与文件名一致，且是默认导出的字面量字符串。
- 目录里没有多余的辅助 `.ts` 文件。
- 所有状态写操作都经过 `perform`。
- 注释里写清 CR v1.5 条目号与来源。
- 没有改契约、共享索引、`pnpm-lock.yaml` 或生成的卡牌数据。
- 测试覆盖正常 / negated / ignored，且没有放宽断言。
