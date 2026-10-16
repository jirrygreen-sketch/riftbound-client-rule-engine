# 测试、golden 与门禁命令

## 1. 测试分层

`docs/test-matrix.md` 定义了测试目标与分层（单元、属性、状态机、卡牌组合、回放、
联机一致性、UI、兼容性）。新内核相关测试的分布如下：

| 层 | 位置 | 说明 |
| --- | --- | --- |
| 原语单元 | `packages/engine-core/test/effects/instructions/effect.draw.test.mjs`（每原语一个同名文件） | 参考测试内核 + `runInstruction` |
| 关键词 | `packages/engine-core/test/effects/keywords/Assault.test.mjs`（每关键词一个同名文件） | 展开结构 + 可执行部分 |
| 解释器 | `packages/engine-core/test/effects/interpreter/` | 控制结构、选择、链接、条件 |
| 链 / 优先权 | `packages/engine-core/test/chain/` | 真实事件序列与 FEPR |
| 回合 | `packages/engine-core/test/turn/flow.test.mjs` | 阶段驱动与清理 |
| 费用 / 目标 / 图层 | `packages/engine-core/test/cost/`、`packages/engine-core/test/target/`、`packages/engine-core/test/layers/` | 计划、支付、重验、图层 |
| 卡牌 golden | `packages/card-dsl/test/cards/sfd/long-sword.test.mjs`（每卡一个同名文件） | 校验 + 结构 + 真实执行 |
| 服务端 | `apps/game-server/tests/lobby-ready.test.ts`（Vitest，整个目录 `apps/game-server/tests/`） | 房间、会话、投影、存储 |
| 集成 | `packages/integration-tests/`（Vitest） | 跨包契约与整局回归 |

场景覆盖清单随实现登记，例如 `packages/engine-core/src/chain/SCENARIO-COVERAGE.md`、
`packages/engine-core/test/turn/SCENARIO-COVERAGE.md`、「表中的覆盖」不等于官方
命名卡牌或完整回合已经接入。

## 2. 参考测试内核

原语与关键词测试不依赖生产引擎，而使用 `packages/engine-core/src/effects/testing/`
的确定性参考内核（说明见同目录 `README.md`）：

```ts
import { runInstruction, world } from "../../../src/effects/testing/index.ts";

const kernel = world().deck("top").deck("second").build();
const run = runInstruction(draw, { amount: { kind: "constant", value: 1 } }, {
  world: kernel
});
```

要点：

- 内核拥有区域、引用、动作、替代钩子与选择重放；测试只构造该原语需要的对象。
- `choose` 用答案表驱动；不提供答案时返回 `asked` 且世界不变，提供答案后重放整个
  原语事务。
- 读牌库顶 / 底 N 张必须用 `ctx.zoneSlice(...)`；`query` 是集合查询，不保证顺序。
- 打出 token 用 `create-token(to: "chain")` + `play`；`world.pendingItems` 可检查
  链上待打出项。
- `reveal` / `look` / `show-off` 的结果是实际展示 / 查看的对象引用列表。

测试内核是**参考实现**：它不推进生产优先权与 Finalize。链、回合、费用、
目标等生产语义的验证在对应的 `packages/engine-core/test/chain/`、
`packages/engine-core/test/turn/`、`packages/engine-core/test/cost/`、
`packages/engine-core/test/target/` 目录，用真实动作与解释器执行。

## 3. Golden 测试

「golden」在本仓库指按规则条目或卡牌身份命名的固定场景测试，要求
`given（局面构造）→ commands / instructions → expect（事件序列 / 状态断言）`。
卡牌 golden 的分层（校验与身份、结构、真实执行、TODO）见
`packages/card-dsl/src/cards/README.md` 第 4 节与
[add-card-program.md](./add-card-program.md)。

硬性禁止（`docs/plans/2026-10-15-p0-contract.md` 第 5 节、任务通用约束）：

- 删测试、放宽断言、把错误行为写成预期。
- 用 fixture 手工结算、直接改 frame / zone / resource / health、跳过回合步骤。
- 伪造 callback 或 no-op closure 充当执行成功。
- 把 `test.todo` 当作已执行通过的证据。

修 bug 必须补能复现原问题的测试。未知规则保持 `judge-required` /
`blocked`，不得近似实现；`energy: null` / `power: null` 不得改写成 `0`。

## 4. 单包命令

所有命令在仓库根目录执行。**全量构建、全量测试、打包、e2e 必须加 `heavy` 前缀**
（共享机器限流），聚焦测试不加。

### engine-core

```sh
pnpm --filter @riftbound/engine-core build
node --import ./packages/engine-core/test/support/register.mjs --test \
  packages/engine-core/test/effects/instructions/effect.draw.test.mjs

pnpm --filter @riftbound/engine-core typecheck
heavy pnpm --filter @riftbound/engine-core test
```

`packages/engine-core/test/support/register.mjs` 注册解析钩子，让 `.ts` 源码里的相对 `.js`
引用指向同目录 `.ts`（等价于 `apps/game-server/vitest.config.ts` 里的
`engine-core-source-prefers-typescript` 插件）。直接 `node --test` 运行导入
`packages/engine-core/src/` 下源码的测试会因无法解析 `.ts` 而失败，必须带这个
`--import`（包内 `pnpm test` 已自带）。

### card-dsl

```sh
pnpm --filter @riftbound/card-dsl build
node --test packages/card-dsl/test/cards/sfd/long-sword.test.mjs

pnpm --filter @riftbound/card-dsl typecheck
heavy pnpm --filter @riftbound/card-dsl test
```

card-dsl 的 golden 从 `dist` 导入，先构建再跑。

### game-server / desktop-client（Vitest）

```sh
pnpm --filter @riftbound/game-server exec vitest run --config vitest.config.ts tests/lobby-ready.test.ts
pnpm --filter @riftbound/desktop-client exec vitest run --config vitest.config.ts tests/ConnectionPanel.test.tsx

pnpm --filter @riftbound/game-server typecheck
heavy pnpm --filter @riftbound/game-server test
```

### 其他包

```sh
heavy pnpm --filter @riftbound/protocol test
heavy pnpm --filter @riftbound/card-data test
heavy pnpm --filter @riftbound/replay-core test
heavy pnpm --filter @riftbound/judge-tools test
heavy pnpm --filter @riftbound/integration-tests test
```

`integration-tests` 依赖共享测试库的部分不要单独跑，先在最终回复说明。

桌面客户端的测试文件在 `apps/desktop-client/tests/`（Vitest 的 `include` 是
`tests/**/*.test.{ts,tsx}`），传 `src/` 路径片段会报 `No test files found`。

## 5. 门禁

改动属于哪个包，就要在最终验收前跑该包的全量测试与类型检查；改了 engine-core
还要加跑下游 game-server（任务通用约束）。

```sh
pnpm --filter <包名> typecheck
heavy pnpm --filter <包名> test

# engine-core 的下游
heavy pnpm --filter @riftbound/game-server test
```

全工作区命令（协调者统一执行）：

```sh
pnpm typecheck
heavy pnpm test
heavy pnpm build
```

基线（协调者给出的 integration=e2cbcdf 记录，**历史数字，不是当前通过证据**）：
engine-core 875、game-server 605、card-dsl 336、card-data 92、protocol 91、
replay-core 77、integration-tests 39、judge-tools 18 全绿；
desktop-client 845/856，其中 11 个已知失败由 RIFT-2 负责。你的改动不得让任何包
比基线更差；实际数字以本次运行为准。

## 6. 起服务与进程管理（共享机器）

- 只能用 `SWARM_PORT_BASE` 起的 `SWARM_PORT_SPAN` 个端口（任务卡会写端口段）。
- 启动进程时记录 PID：`echo $! >> /tmp/$SWARM_TASK.pids`；停止时按记录的 PID 杀。
- **禁止** `pkill -f`、`killall`、`fuser -k`、按名字或端口批量杀进程。
- 不连接 / 修改生产数据库，不 `systemctl`、不部署、不 `git push`。
- 证据日志放 `/tmp/$SWARM_TASK/`；不写 `outputs/coordination/**`。

## 7. 文档改动的验证

只改 `docs/dev/` 时，用脚本检查文中引用的每个仓库路径真实存在
（跳过带 `<...>` 占位符的模板路径）：

```sh
python3 - <<'PY'
import pathlib, re, sys

ROOT = pathlib.Path(".").resolve()
# 只把「像路径」的反引号内容与 Markdown 链接当路径校验；
# 忽略 <...> 占位符、纯标识符（如 ObjectRef）与命令。
PATH_RE = re.compile(r"^[A-Za-z0-9_.@-]+(/[A-Za-z0-9_.*@-]+)+/?$")
ROOTS = ("packages/", "apps/", "docs/", "scripts/", "/root/", "./")

missing, checked = [], 0
for doc in sorted(pathlib.Path("docs/dev").glob("*.md")):
    text = doc.read_text(encoding="utf-8")
    tokens = re.findall(r"`([^`\n]+)`", text)
    tokens += re.findall(r"\[[^\]]*\]\(([^)\s]+)\)", text)
    for raw in tokens:
        candidate = raw.strip().rstrip(".,;:()")
        if "<" in candidate or ">" in candidate or not PATH_RE.match(candidate):
            continue
        if candidate.startswith("/root/"):
            path = pathlib.Path(candidate)
        elif candidate.startswith("./"):
            path = doc.parent / candidate[2:]
        elif candidate.startswith(ROOTS):
            path = ROOT / candidate
        else:
            continue
        checked += 1
        if not path.exists():
            missing.append((str(doc), candidate))

if missing:
    print("MISSING:")
    for doc, candidate in missing:
        print(" ", doc, candidate)
    sys.exit(1)
print(f"checked {checked} paths; all referenced paths exist")
PY
```
