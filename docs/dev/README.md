# 开发者指南（新内核）

这套文档面向第一次接触本仓库的开发者，目标是让你在半天内能够独立完成
「新增一个原语 / 一个关键词 / 一张卡牌程序」中的任意一项，并知道如何验证。

当前活跃的规则内核位于 `packages/engine-core`，卡牌效果是数据、引擎只实现通用
原语。目标规则版本是 Core Rules v1.5（`rulesetVersion: "core-1.5"`）。

## 阅读顺序

| 顺序 | 文档 | 内容 |
| --- | --- | --- |
| 1 | [architecture.md](./architecture.md) | 新内核分层与数据流：游戏动作 → 事件 → 时点触发 → 链 → 解释器 → 原语 |
| 2 | [add-primitive.md](./add-primitive.md) | 新增一个 `effects/instructions/<op>.ts` 原语 |
| 3 | [add-keyword.md](./add-keyword.md) | 新增一个 `effects/keywords/<keyword>.ts` 关键词 |
| 4 | [add-card-program.md](./add-card-program.md) | 新增一张 `card-dsl/src/cards/<set>/<slug>.ts` 卡牌程序 |
| 5 | [testing.md](./testing.md) | 测试内核、golden、门禁命令 |
| 6 | [swarm-workflow.md](./swarm-workflow.md) | 任务卡、owns、提交规范 |

## 前置环境

- Node.js `^22.12.0 || ^24.0.0 || >=26.0.0`（本仓库验证过 `v22.22.2`）。
- pnpm `11.9.0`（`packageManager` 字段固定，见 `package.json`）。
- 安装依赖：`pnpm install --frozen-lockfile`。

官方卡牌目录 JSON 与图片是 gitignore 的本地数据；新 checkout 需要按
`packages/card-data/README.md` 的同步流程准备，否则涉及目录的审计命令会缺数据。

## 权威来源

写代码或文档前，先按下面的顺序确认事实，不要凭印象补全：

1. 冻结契约：`docs/plans/2026-10-15-p0-contract.md`（EffectIR v2、原语接口 v1、
   `KeywordDef`、控制结构形状）。与其它文档冲突时以它为准。
2. 引擎语义规范：`docs/rule-engine-architecture.md`（HOT FEPR、Turn State / Priority /
   Focus、费用计划、TargetPlan、事件与替代效果）。
3. 分层说明：`packages/engine-core/src/chain/README.md`、
   `packages/engine-core/src/turn/README.md`、
   `packages/engine-core/src/cost/README.md`、
   `packages/engine-core/src/effects/interpreter/README.md`、
   `packages/engine-core/src/effects/testing/README.md`。
4. 卡牌程序约定：`packages/card-dsl/src/cards/README.md`。
5. 规则原文（只读，v1.5 编号）：`/root/swarm-rift/shared/rules/CR-v1.5.txt`；
   章节索引 `docs/rules/core-1.5-sections.md`；v1.4→v1.5 差异
   `docs/rules/core-1.4-to-1.5-diff.md`。

## 两条硬规则

- 规则不明确或依赖未实现的语义，保持 `judge-required` / `blocked`，写清缺失的
  操作、规则条目和依赖任务号，不得近似实现。
- `energy: null` / `power: null` 表示没有印刷值，不得改写成 `0`。

## 当前状态提示

新内核（`packages/engine-core/src/chain/`、`turn/`、`events/`、`layers/`、
`cost/`、`target/`）正在分批落地，尚未接入 `apps/game-server` 的公开
WebSocket 房间；`packages/engine-core/src/priority-focus/` 目前是空占位，
Priority / Focus 的实际实现在 `chain/engine.ts`。
`packages/engine-core/src/duel/` 是仍在生产路径上的旧实现；两者不要混用 API。
当前进度与剩余门禁见
`docs/full-product/progress.md`，历史测试数字不算当前通过证据。

```sh
# 文中路径存在性检查（示例）
ls docs/dev/README.md docs/dev/architecture.md docs/plans/2026-10-15-p0-contract.md
```
