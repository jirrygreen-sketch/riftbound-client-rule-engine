# Desktop Build

Last reviewed: 2026-10-14

桌面客户端是 React + Vite 应用，由 Tauri 2 包装。仓库默认的 `bundle.targets`
仍是 `["nsis"]`（Windows 安装包），根级 `desktop:build` 也仍以 NSIS 为目标，
默认 Rust 工具链与包名未变。本文同时记录两条互相独立的构建路径：用户 Mac 上
已实际产出并做过 GUI 验收的 `app` 包，以及尚未验收的 Windows NSIS 路径。

## 本文的证据范围

当前 macOS 工作区已完成两个 unsigned 原生包的构建及实际 GUI 验证。验证记录位于
`outputs/coordination/resume-20261013/artifacts/native-layout-current/UI-ACCEPTANCE.json`，
历史完整整局另见 `native-desktop-current/native-fullmatch-verification.json`。这些记录只
证明所列场景；Windows 构建和完整产品验收仍需独立完成。下文 CI 失败原因保留为历史推断，
本次没有重新读取该 GitHub 任务日志。

## 仓库配置当前状态（已确认）

- `apps/desktop-client/src-tauri` 含 Rust 入口、capability、构建脚本与 Tauri 配置。
- `bundle.active` 为 `true`，`bundle.targets` 为 `["nsis"]`；这是**根默认**，未改动。
- `bundle.icon` 引用的四个文件真实存在（见下文“图标”一节），已按实际工作区核对存在。
- `@tauri-apps/cli` 由 `@riftbound/desktop-client` 声明；根级别名提供 `desktop:dev`
  与 `desktop:build`（后者当前指向 `tauri build --bundles nsis`）。
- `beforeDevCommand` 运行 desktop-client 的 Vite 脚本，双方都锁定
  `127.0.0.1:5173`，Vite 使用 `--strictPort`，端口被占用时直接失败，不会静默改端口。
- 生产与开发 CSP 都允许可配置的 `http:`/`https:`/`ws:`/`wss:` 连接，因为卡牌目录
  与游戏服务器地址由用户配置；这是有意的宽网络策略，不是误配的通配符。默认
  capability 未授予 filesystem/shell 等插件权限。
- `apps/desktop-client/src-tauri/rust-toolchain.toml` 将工具链钉在 `1.90.0`
  (`profile = "minimal"`)，与 `Cargo.toml`（`rust-version = "1.90"`）及 CI 安装步骤一致。
- 源码树中 `apps/desktop-client/src-tauri/Cargo.lock` **已存在**（约 104 KB，schema
  `version = 4`）。它当前**尚未由主控提交**，因此“干净 Git 基线包含该锁文件”这一
  说法**不能断言**（见下文边界说明）。
- 默认 `productName = "Riftbound Desktop Client"`、`identifier =
  "com.riftbound.desktop-client"`、主窗口 `1440x900`（`minWidth 1120`）。用户 Mac 的
  A/B 验收通过任务专用 `--config` 覆盖为 `1280x800`（`minWidth 1024`）并在包名/标识
  上做测试变体，**没有**改动仓库默认值。

## 用户 Mac 上已实际产出的本地 app（已验收）

以下为**用户 Mac（macOS arm64）上的真实构建与 GUI 证据**，不是远程 Linux 工作环境的运行
结果，也不是 Windows 产物：

- 使用任务专用的 Rust `1.90.0` 工具链与独立的 `cargoHome`/`rustupHome`/`target`
  目录，成功产出 **unsigned** 的 `Riftbound Layout A.app` 与 `Riftbound Layout B.app`
  两个 arm64 本地包（B 仅为测试用 title/name/identifier 变体）。
- 最新 A/B 可执行文件各约 3,416,336 字节，SHA-256 分别为
  `75654dc1…e676`（A）与 `73fd44b1…5c28`（B）；早前一对 bundle 哈希为
  `dbf514f4…f3df`（A）与 `3255cfc6…fe1b`（B），旧 Timing 命名包哈希未变。
- 已做**真实 GUI 验收**：新版双原生窗口房间 `17cecbea` 完成 19 条真实命令（符文取
  6 能量 + 1 Mind、支付进化日、双方让过后自动 Draw4，手牌 7→11），当前源码对
  schema 4 原生存档严格双视角恢复通过，原日志 7,220,302 字节未变。
- 另有历史房间 `4083c787` 的双原生窗口**完整整局**（22 回合、B 8 分、stateVersion
  258、34 独立命令/48 投递/14 幂等重试）；当前源码用**显式 legacy 执行 profile** 对
  其 48 投递做了严格 fresh replay 且双方视角一致。该 profile 与新 Spell 双 GUI
  不是同一证据，见边界。
- 这些包是 **unsigned 本地 app**，`--no-sign`，不是可分发的签名安装包。

**不要**把早期快照中的“Mac 当前没有工具链 / 没有 app / `Cargo.lock` 未生成”当作现状：
Mac 上工具链与 app 均已存在，`Cargo.lock` 也已在源码树中生成（只是未提交）。

### 可复用的相对路径模板与构建命令（Mac）

下列路径来自主控证据 `curated-proof-input.json` 的 `currentToolchain`，对应**用户 Mac
工作区**内的任务专用工具链。下列为相对仓库根的任务工具链路径；这些二进制不随源码检出分发。使用这次已准备好的
Mac 工作区可按同一布局复用：

```text
outputs/coordination/resume-20261013/artifacts/native-desktop-current/toolchain/rustup
outputs/coordination/resume-20261013/artifacts/native-desktop-current/toolchain/cargo
outputs/coordination/resume-20261013/artifacts/native-desktop-current/toolchain/rustup/toolchains/1.90.0-aarch64-apple-darwin/bin
outputs/coordination/resume-20261013/artifacts/native-timing-region-current/target
```

在仓库根下按相对路径设置环境（示意，`<repo>` 为仓库根）：

```text
export RUSTUP_HOME="<repo>/outputs/coordination/resume-20261013/artifacts/native-desktop-current/toolchain/rustup"
export CARGO_HOME="<repo>/outputs/coordination/resume-20261013/artifacts/native-desktop-current/toolchain/cargo"
export CARGO_TARGET_DIR="<repo>/outputs/coordination/resume-20261013/artifacts/native-timing-region-current/target"
export PATH="<repo>/outputs/coordination/resume-20261013/artifacts/native-desktop-current/toolchain/rustup/toolchains/1.90.0-aarch64-apple-darwin/bin:$PATH"
```

Mac 上的 app 包由**显式覆写**生成：用 `--bundles app` 覆盖根默认的 `nsis`，用
`--config` 指向任务专用配置把窗口设为 `1280x800` 并做测试变体，用 `--no-sign`
跳过签名：

```text
pnpm --filter @riftbound/desktop-client exec tauri build \
  --bundles app --config <task-config>.json --no-sign
```

该覆写命令**只作用于这一次调用**；仓库默认的 `bundle.targets=["nsis"]`、默认包名与
Rust 工具链均保持不变。

## 尚未验收 / 明确边界

- **Windows NSIS**：已检查的远程 Linux 工作环境没有 Windows MSVC/SDK 工具链，未执行 Windows NSIS
  构建或安装；**没有** Windows NSIS 安装包，也**没有** Windows 目标平台实机安装与
  运行证据。当前 Mac 上的 A/B `app` 包不构成 Windows 验收。
- **干净 Git 复现**：此前的完整回归在独立 noGit 源快照运行，当前源码树的 `Cargo.lock` 也未提交，因此原
  默认分支上“干净 Git checkout 包含该锁文件”的说法不能断言。
- **当前源码全量回归**：最近的组件/包绿线（客户端 718、`card-dsl` 202 且 0 skip、
  服务端 authority 47、choice 13）属于**不同验证范围**，不能相加当作全量；完整的
  2449 通过对应更早的 545 文件源快照，不代表当前全量。
- **规则/效果覆盖**：默认官方程序 65；显式 `Accelerate` 67 / `Extended` 71 是来源
  绑定的 IR，**尚未生产执行**（`productionWiring: false`）。可选额外费用生产
  owner、`nominaljournal`/`entryboundary`/`Killcost` 等仍在途，不得标为已交付。未知
  官方语义一律保持 `judge-required`/`blocked`。
- **合同冻结结构与 P6**：可选 P6 的“冻结结构 repair”已被 2 个真实反例拒绝，故相关
  修复仍为 STAGED，未合入生产。

## CI 工作流（当前配置）

`.github/workflows/desktop-build.yml` 在 `windows-latest`（`x86_64-pc-windows-msvc`）上
运行。其 Rust 步骤名为 `Install Rust 1.90.0 MSVC`，在 `pwsh` 下显式安装并默认
`1.90.0-x86_64-pc-windows-msvc`（`--profile minimal`），因此 CI 不会漂到更新的 stable。
随后依次运行 `pnpm install --frozen-lockfile`、断言被忽略的卡牌数据与图片缓存不存在、
`pnpm build`/`typecheck`/`test`、`pnpm desktop:build`（`tauri build --bundles nsis`），
最后上传 `apps/desktop-client/src-tauri/target/release/bundle/nsis/*-setup.exe`
（`if-no-files-found: error`）。该工作流仅触发于 `workflow_dispatch` 及匹配路径的
`push`/`pull_request`；本轮未触发、未联网运行。

## CI 依赖策略（历史/推断）

以下为**历史记录**，含推断成分，本轮未重新联网、也未复验：

- 首次 Windows CI 运行 `38142856156`（commit `62382fe`）到达 `Install dependencies`
  步骤（`pnpm install --frozen-lockfile`）后，后续 build/test/bundling 步骤被跳过；
  公开 Actions 元数据显示**未产出安装包**。原始 job 日志无法经公开未认证端点获取，
  故本文不引用其控制台原文。
- 主要解释（推断）：pnpm 11 将默认 `minimumReleaseAge` 提升到 1440 分钟，而 12 个
  锁定的 `@tauri-apps/cli*@2.12.2` 落在该窗口内；这些曾是锁定项里唯一命中
  `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` 的条目。该解释因原始日志不可得而**待确认**。
- 缓解措施：这 12 个锁定项已写入 `pnpm-workspace.yaml` 的
  `minimumReleaseAgeExclude`。该缓解**尚未有绿线 CI 验证**，视为待验证；Tauri CLI
  版本变更时需复核该排除列表。
- 不要用 `--trust-lockfile`、`--no-frozen-lockfile`、关闭策略或删除质量检查来绕过该
  失败：这些做法掩盖供应链校验失败而非解决问题。

## 静态检查（离线）

在 Linux 源快照上做过的**离线**检查（不下载、不编译）：

- `tauri.conf.json` 与 `capabilities/default.json` 可解析为合法 JSON。
- `build.frontendDist` 为 `../dist`、`build.devUrl` 为 `http://127.0.0.1:5173`，与
  `beforeDevCommand` 运行的 Vite 脚本一致。
- 文档中链接的文件路径均存在（本文与前文引用的文档路径已逐条核对存在性）。

已检查的远程 Linux 环境没有 Rust/MSVC 工具链（pnpm 可通过任务专用路径运行），因此在**此快照**内无法
运行 `cargo check`/`tauri build`；这**不**说明用户 Mac 缺少工具链（Mac 上已验证可用）。

## 图标

`bundle.icon` 引用的四个文件在源码树中存在（主控工作区实测，SHA-256 已核对）：

```text
apps/desktop-client/src-tauri/icons/32x32.png        75e35f2a…6b3a
apps/desktop-client/src-tauri/icons/128x128.png      dc25ad7e…8e02
apps/desktop-client/src-tauri/icons/128x128@2x.png   c76b88c1…7afe
apps/desktop-client/src-tauri/icons/icon.ico         58d8bb63…1376
```

远程打包 tar 省略了 PNG 二进制，这**只**是快照收录问题（已作为非产品缺陷被拒），
不能据此声称项目缺图标。

## 命令

仓库根：

```text
pnpm desktop:dev
pnpm desktop:build
pnpm --filter @riftbound/desktop-client build
```

- `desktop:build` 当前走根默认 `--bundles nsis`，需要 Windows 上的 Rust 与 MSVC 工具链；
  Mac 上产出 `app` 包时按上文用 `--bundles app --config <task-config>.json --no-sign`
  显式覆写。
- `pnpm --filter @riftbound/desktop-client build` 只做 TypeScript 检查并生成 Vite 前端
  bundle，不编译 Rust、也不产出安装包。
- `desktop:dev` 锁定 `127.0.0.1:5173` 且 `--strictPort`；端口被占用时必须失败，不要
  改指向其他正在运行的 Vite 或允许 Vite 自选端口。

Windows 构建成功时的 NSIS 期望输出：

```text
apps/desktop-client/src-tauri/target/release/bundle/nsis/*-setup.exe
```

## 目标平台说明

- 仓库**默认**未配置 macOS 打包目标：`bundle.targets` 为 `["nsis"]`，`rust-toolchain.toml`
  也未声明 `targets`。用户 Mac 上的 `app` 包是通过**一次性 `--bundles app` 覆写**得到的，
  并不是把 macOS 目标写进了默认配置。
- 本地 Mac `cargo check`/`cargo build` 与本地 `app` GUI 证据**都不得**被当作 Windows
  NSIS 验收。

## Windows 前置条件

1. Rust `1.90.0`（由 `rust-toolchain.toml` 钉住）并带 `x86_64-pc-windows-msvc` 目标；
   `Cargo.toml` 要求 Rust 1.90 或更新。
2. Microsoft C++ Build Tools（含 Desktop development with C++ 与 Windows 10/11 SDK）。
3. WebView2 Runtime（受支持的 Windows 通常预装）。
4. Node.js `^22.12.0`、`^24.0.0` 或 `>=26.0.0`，以及 pnpm 11.9.0。
5. 首次拉取 Rust crate 与 NSIS 工具链需要网络。

只有当 `desktop:build`（NSIS 目标）成功，且生成的 NSIS 安装包在干净 Windows 环境上
安装并启动之后，才可把 Windows 安装包标为已验收。
