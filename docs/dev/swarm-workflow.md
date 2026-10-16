# 任务卡、owns 与提交规范

本仓库同时有几十个任务在不同 git worktree 里开发。每张任务卡会先给一段通用约束，
再给具体目标与「负责的文件」清单。这一页把流程写成可执行步骤。

## 1. 工作目录与分支

- 每个任务在自己的 git worktree 里工作，分支名为 `task/<任务名>`
  （例如当前目录分支 `task/RIFT-279-docs-dev-guide`）。
- 所有 worktree 共享同一个仓库；其他任务同时在改同一仓库的其他部分。
- 动手前先确认实际状态，不要相信任何缓存的快照：

```sh
git rev-parse --abbrev-ref HEAD
git log --oneline -3
git status --porcelain
```

## 2. owns：只改范围内的文件

- 任务卡的「负责的文件（owns）」就是写权限边界：只新增 / 修改其中列出的文件。
- 确实必须改范围外的共享文件（路由注册、导航配置、语言包索引等）时，
  只做**追加式最小改动**，并在最终回复里逐个列出。
- 不做与本任务无关的重构、重排、批量格式化；那会与其他任务产生合并冲突。
- 接口 / 类型 / 协议以契约目录为准，不要修改契约。契约不够用时，在最终回复写
  「契约变更请求」并说明原因，先按现有契约完成能做的部分。

本仓库的注册表设计就是为了避免并发冲突：原语、关键词、卡牌的索引由
`scripts/gen-registries.mjs` 生成（`registry.generated.ts` 已 gitignore），
新增实现只新增文件，不手改共享索引。

## 3. 资源与并发（共享机器）

- 全量构建、全量测试、打包、e2e 一律加 `heavy` 前缀：
  `heavy pnpm build`、`heavy pnpm -r --no-bail run test`。heavy 会排队限流，
  防止几十个任务同时构建撑爆内存。
- 平时只跑与本任务相关的聚焦测试；全量回归由调度者统一执行。
- 起服务只能用 `SWARM_PORT_BASE` 起的 `SWARM_PORT_SPAN` 个端口（任务卡会写具体
  端口段）。
- 只停止自己启动的进程：启动时 `echo $! >> /tmp/$SWARM_TASK.pids`，
  停止时按这些 PID 杀。**禁止** `pkill -f`、`killall`、`fuser -k`。
- 只写：当前 worktree、`/tmp/$SWARM_TASK/`、包管理器缓存。
  `/root/swarm-rift/shared/` 只读。
- 不连接 / 修改生产数据库；不 `systemctl`、不部署、不 `git push`。

## 4. Git 安全

**禁止**以下操作（曾把整个任务的改动清空）：

- `git checkout -- .`
- `git restore .`
- `git reset --hard`
- `git stash`
- `git clean`
- 修改 `GIT_DIR` / `GIT_WORK_TREE`

需要对比基线时用 `git diff` / `git show HEAD:<path>`，或把文件复制到 `/tmp` 再看。
不要提交日志、截图、构建产物、`node_modules`；`git add -f` 只为强行加被忽略文件
是不允许的。不要修改 `pnpm-lock.yaml`、依赖或生成的卡牌数据；需要时写
「契约变更请求」。

## 5. 提交规范

完成后提交到任务分支（可以多次提交）：

```sh
git add -A
git commit -m "RIFT-<n>: <english summary>"
```

- 提交信息用英文简述，并以工单号开头，例如 `RIFT-3: fix ...`。
- 提交信息末尾加一行：

  ```text
  Co-Authored-By: Codex <noreply@openai.com>
  ```
- 不 `git push`；parent/协调任务负责收集、集成与推送。

## 6. 验证深度

按任务通用约束匹配验证深度：

- 改了哪个包，最终验收前必须跑该包全量 `heavy pnpm --filter <包名> test` 和
  `pnpm --filter <包名> typecheck`。
- 改了 `engine-core`，还要加跑 `heavy pnpm --filter @riftbound/game-server test`
  （下游）。
- 只改文档时，运行文档自己的路径检查（见
  [testing.md](./testing.md) 第 7 节），不触发重型构建。

聚焦命令、`heavy` 用法与基线数字见 [testing.md](./testing.md)。

## 7. 规则红线（违反即打回）

- 未知 / 未裁定的官方卡牌能力保持 `judge-required` / `blocked` / pending，
  不得近似实现；`energy: null` / `power: null` 表示无印刷费，不得改写为 `0`。
- 不得用 fixture 手工结算、手改 frame / zone / resource / health、跳过回合步骤、
  伪造 callback 或 no-op closure 让测试通过。
- 不放宽客户端 ACK guard，不用重连或假 DTO 绕过。
- 旧 profile（1–9）与旧回放日志必须保持可严格重放，不得升级或改写旧日志、
  默认 profile / schema。
- 修 bug 必须补能复现原问题的测试；不准删测试、放宽断言、把错误行为写成预期。
- 不写 `outputs/coordination/**`；证据日志放 `/tmp/$SWARM_TASK/`。

## 8. 并行 Agent 约定

- 不要调用 `spawn_agent` 等派生子代理的能力：并发由调度器在主任务层面控制，
  子代理会绕过资源闸门。
- 需要多个工作流时，由调度者创建独立 worktree 与任务卡；每个工作流有独立、
  不重叠的 owns。
- 父任务负责共享契约、依赖与锁文件、集成验证、提交与推送；子任务只做自己
  scope 内的实现与本页要求的验证。

## 9. 最终回复格式

最终回复用中文，包含四部分，调度者据此验收：

1. **做了什么**：对照任务卡验收项逐条给出「完成 / 部分完成 / 未做 + 原因」。
2. **改了哪些文件**：范围外的单独列出。
3. **验证**：跑了哪些命令、结果如何，贴关键输出。
4. **风险、遗留问题、契约变更请求**：没有就写「无」；证据日志路径也在这里给出。

只有全部要求完成、验证通过、提交成功（且没有谎报）才算交付。
