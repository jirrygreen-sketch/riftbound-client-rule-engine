# 安装桌面客户端

桌面客户端是 React + Vite 前端加 Tauri 2 外壳（`apps/desktop-client`）。发布流水线
`.github/workflows/release.yml` 在推送 `v*` tag 或手动指定已有 tag 时，为下列平台构建
安装包并上传到对应的 GitHub Release：

| 平台 | 产物 |
| --- | --- |
| macOS（Apple Silicon） | `riftbound-desktop-<tag>-macos-arm64.dmg` |
| macOS（Intel） | `riftbound-desktop-<tag>-macos-x64.dmg` |
| Windows（x64） | `riftbound-desktop-<tag>-windows-x64.exe`（NSIS 安装包） |

每个安装包旁边都有一个同名的 `.sha256` 校验文件，例如
`riftbound-desktop-v0.1.0-macos-arm64.dmg.sha256`。

> 截图占位（待本机视觉验证补图）：`docs/user/images/release-assets.png` —— GitHub Release 的安装包与校验文件列表。

## 从 GitHub Release 安装

1. 打开仓库的 GitHub Releases 页面，选择需要的版本。
2. 下载与你的操作系统、CPU 架构匹配的安装包和它的 `.sha256` 文件。
3. 先校验下载文件，再安装运行。

### macOS

1. 打开 DMG，把 “Riftbound Desktop Client.app” 拖进“应用程序”。
2. 安装包**未做代码签名与公证**。首次启动如果被 Gatekeeper 拦截，在“应用程序”里
   右键点击 App，选择“打开”，再在对话框中确认“打开”；macOS 会记住这次例外。
3. 如果 macOS 仍然拦截，打开“系统设置 > 隐私与安全性”，找到被拦截的应用提示，选择
   “仍要打开”。
4. 需要命令行兜底时，可以移除隔离属性（该步骤同时写在 Release 说明里）：

   ```bash
   xattr -dr com.apple.quarantine "/Applications/Riftbound Desktop Client.app"
   ```

5. 校验下载文件：

   ```bash
   shasum -a 256 -c riftbound-desktop-<tag>-macos-arm64.dmg.sha256
   ```

### Windows

1. 运行下载到的 `*-setup.exe`（NSIS 安装包）。
2. 如果 SmartScreen 提示“无法识别的应用”，选择“更多信息”，再选择“仍要运行”。
3. 如果浏览器或 Microsoft Defender 拦截了下载，在下载记录中选择“保留”，然后重新运行安装包。
4. 校验下载文件：

   ```powershell
   certutil -hashfile riftbound-desktop-<tag>-windows-x64.exe SHA256
   ```

   把输出与同名 `.sha256` 文件中的值比较。

## 从源码构建（开发者路径）

环境要求来自仓库配置：Node.js `^22.12.0 || ^24.0.0 || >=26.0.0`、pnpm `11.9.0`
（`package.json` 的 `engines` 与 `packageManager`）。Tauri 外壳的 Rust 工具链固定在
`1.90.0`（`apps/desktop-client/src-tauri/rust-toolchain.toml`）。

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm desktop:build
```

`pnpm desktop:build` 等价于 `pnpm --filter @riftbound/desktop-client tauri:build`；在
Windows 上按仓库默认的 `bundle.targets=["nsis"]` 产出安装包，路径形如
`apps/desktop-client/src-tauri/target/release/bundle/nsis/*-setup.exe`。
仓库默认的打包目标是 Windows 专用的 NSIS，在 macOS 上需要显式覆盖打包目标 dmg
（发布流水线就是这样做的）：

```bash
pnpm --filter @riftbound/desktop-client exec tauri build --bundles dmg
```

只想用浏览器预览前端、不打包桌面外壳时，可以用开发服务器或预览服务器：

```bash
pnpm dev
pnpm preview
```

`pnpm dev` 在 `127.0.0.1:5173` 上以严格端口启动 Vite；`pnpm preview` 在
`127.0.0.1:4173` 上预览已构建的前端。Tauri 开发模式使用：

```bash
pnpm desktop:dev
```

> 截图占位（待本机视觉验证补图）：`docs/user/images/install-warning.png` —— macOS / Windows 首次启动告警放行对话框（各一张）。

## 安装后的第一次检查

1. App 打开后应看到首页标题 “Riftbound” 与副标题 “选择下方入口开始你的对局体验”。
2. 左侧状态栏显示“未连接服务器”与“未加入房间”，卡组数量为当前本机保存的卡组数。
3. 首页六个入口依次为：房间连接、卡组管理、对局回放、个人信息管理、退出、设置；
   进行中的对局还会出现“继续对局”。

> 截图占位（待本机视觉验证补图）：`docs/user/images/first-run.png` —— 首次启动的首页与六个入口。

连接服务端的步骤见 [server.md](server.md) 与 [playing.md](playing.md)。
