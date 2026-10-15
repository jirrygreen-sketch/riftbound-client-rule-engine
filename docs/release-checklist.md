# 发布清单

Last reviewed: 2026-10-14

本清单定义“从干净检出出发”必须通过的命令与数据预期。官方卡牌快照与图片缓存
有意不入 Git：

- `packages/card-data/data/catalog.json`
- `packages/card-data/data/deck-catalog.json`
- `packages/card-data/data/images-manifest.json`
- `packages/card-data/data/images/`

任何发布构建、打包产物或 CI 缓存都不得依赖这些本地文件。桌面客户端只打包自己的
`dist` 输出与 Tauri 可执行文件，不打包 `@riftbound/card-data` 或
`@riftbound/game-server`。

> 2026-10-14 当前已有 macOS unsigned A/B 包与实际 GUI 证据。当前工作树仍有未提交实现，
> Windows NSIS/实机及干净 Git 检出复现尚未验收。分包测试和独立 noGit 源快照回归不能
> 替代以下发布门禁；验收记录见 `outputs/coordination/resume-20261013/curated-proof-input.json`。

## 干净检出

从全新克隆或干净 CI runner 运行：

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
pnpm desktop:build
```

构建步骤必须先于类型检查。工作区包从 `dist` 暴露 TypeScript 声明，干净检出处先做
类型检查会让 `@riftbound/engine-core` 在解析 `@riftbound/protocol` 时失败。

在装了 Rust MSVC 的 Windows runner 上，验证 `pnpm desktop:build` 产出一个 NSIS
产物：

```text
apps/desktop-client/src-tauri/target/release/bundle/nsis/*-setup.exe
```

CI 工作流会先断言被忽略的本地卡牌数据与图片不存在，然后再构建。

### 当前目标平台边界（不得混淆）

- **Windows NSIS / 安装 / 实机：尚未验收。** 当前无 Windows NSIS 产物、无目标平台
  安装与运行证据；已检查的远程 Linux 环境不具备 Windows 工具链，本次没有安装新工具。前端或
  引擎/内核的绿线**不构成** Windows 或整产品验收。
- **用户 Mac（macOS arm64）已有强证据**：任务专用 Rust 1.90 工具链成功产出 unsigned
  的 `Riftbound Layout A.app`/`Riftbound Layout B.app`（`1280x800` 变体，`--bundles
  app --config <task-config>.json --no-sign` 显式覆写），并完成真实双原生窗口 GUI：
  房间 `17cecbea` 的 19 条真实命令（Spell 支付、双双让过、自动 Draw4）以及历史房间
  `4083c787` 的 48 投递完整整局严格 fresh replay。**这不是 Windows 证据，也不证明全部
  官方效果。**
- **干净 Git 复现：不能说已满足。** 当前是 noGit 源快照；源码树里
  `apps/desktop-client/src-tauri/Cargo.lock` 虽已生成，但**未由主控提交**，因此不能
  断言干净 Git 基线已含该锁文件。首次成功 Rust 构建会生成该文件；只有在构建与安装包
  冒烟测试通过后再提交该锁文件。
- **不把组件绿线当全量。** 最近的分项数字（客户端 718、`card-dsl` 202 且 0 skip、
  服务端 authority 47、choice 13）属于**不同验证范围**，不能相加当作全量通过；完整的
  2449 通过对应更早的 545 文件源快照，不代表当前全量。默认官方程序 65；显式
  `Accelerate` 67 / `Extended` 71 仅为来源绑定 IR，未生产执行。

## 规则来源溯源

`docs/rule-source-manifest.json` 是官方 Riftbound 规则来源的受版本控制、可离线校验
记录（URL、版本、last-updated 与 effective 日期、SHA-256、hash 状态）。官方 PDF 保持
在 `work/` 下被 Git 忽略，因此干净检出无需任何本地文件即可校验清单：

```powershell
pnpm --filter @riftbound/card-data verify:rule-sources:manifest-only
```

该模式只校验清单本身——schema、`https` URL、日历日期与 SHA-256 形态——并跳过所有本地
文件，因此无 `work/` PDF 的干净检出也能通过。

默认校验器会额外复检本地文件，仍不联网、不下载：

```powershell
pnpm --filter @riftbound/card-data verify:rule-sources
```

- 当清单中的本地 PDF 存在时，重算其 SHA-256 并与清单比对；不一致时以退出码 1 失败。
- 本地文件缺失会报为 `missing` 且不使运行失败；绝不要让干净检出门禁依赖这些被忽略的
  PDF。
- 没有文档化哈希的来源保持 `sha256: null` 与 `hashStatus: "pending"`。绝不猜测哈希、
  也绝不联网获取；校验器只为溯源记录 URL。
- 该校验不改动已记录的日期：Core Rules `v1.4` 保持 `lastUpdated 2026-07-16`，
  `v1.5 / Radiance` 与 Tournament Rules 的 effective 日期保持 `2026-10-16`，与
  `docs/sources.md` 一致。

## 全量测试门禁

递归 `pnpm test` 是发布测试门禁。基础套件需要保持干净检出安全；实际卡池验收还需执行同步后的真实目录用例，不能以缺数据跳过代替完整验收。
如果某个套件开始依赖本地官方目录、图片缓存或其他生成文件，应修复该套件，而不是把生成
的卡牌数据加入 Git，或把发布门禁收窄到选定包。

全量门禁仍待验收：当前快照内的分项绿线不能相加当全量（见上文边界）。

## 卡牌数据同步

若手动服务器验证需要官方卡牌数据，本地生成并保持在发布产物之外：

```powershell
pnpm cards:sync
pnpm cards:images
pnpm cards:catalog
```

同步后单独运行服务器侧验证：

```powershell
pnpm test:server
pnpm typecheck:server
```

不要提交、上传、缓存或打包生成的本地数据。干净检出处 `deck-catalog.json` 缺失是预期
的，不是向源码控制加入真实卡图的理由。
