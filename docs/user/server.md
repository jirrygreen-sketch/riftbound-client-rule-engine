# 启动与配置服务端

权威服务端位于 `apps/game-server`。它提供 WebSocket 房间服务与 HTTP 卡牌目录、卡图、
卡组校验接口。本文只使用仓库内已存在的脚本与环境变量。

## 准备环境

- Node.js `^22.12.0 || ^24.0.0 || >=26.0.0`（根 `package.json` 的 `engines`）。
- pnpm `11.9.0`（根 `package.json` 的 `packageManager`）。
- 依赖安装使用冻结锁文件：

```bash
pnpm install --frozen-lockfile
```

## 准备卡牌数据（全新检出处必需）

官方卡牌目录与图片是被 Git 忽略的本地生成物。服务端读取的是
`packages/card-data/data/deck-catalog.json`（默认路径硬编码在
`apps/game-server/src/card-catalog.ts`），图片清单是 `data/images-manifest.json`。
如果文件不存在，HTTP 目录接口会返回 `503 catalog-unavailable`，错误信息形如
“Card catalog file not found: ...”。

在需要真实卡池时，先在仓库根目录同步并生成：

```bash
pnpm cards:sync
pnpm cards:images
pnpm cards:catalog
```

`cards:sync` 会联网抓取官方来源并构建 `data/catalog.json`；`cards:images` 下载图片缓存
并写 `data/images-manifest.json`；`cards:catalog` 从快照生成 `data/deck-catalog.json`。
这些文件**不要提交**，也不要打进发布产物。

## 启动

前台启动（开发时自动重启）：

```bash
pnpm dev:server
```

普通启动：

```bash
pnpm start:server
```

两者分别转发到 `apps/game-server` 的 `dev`（`tsx watch src/index.ts`）与 `start`
（`tsx src/index.ts`）。启动成功后控制台会打印 `Riftbound game server`、`Health:`、
`Cards:` 与 `WebSocket:` 四行地址。按 `Ctrl+C` 发送 `SIGINT`（或 `SIGTERM`）时，
进程会调用 `server.stop()` 后退出。

## 环境变量

全部来自 `apps/game-server/src/index.ts`：

| 变量 | 默认值 | 取值与作用 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | HTTP 与 WebSocket 绑定的主机。 |
| `PORT` | `8787` | HTTP 与 WebSocket 绑定的端口，非数字会被 `Number()` 解析成 `NaN` 并导致监听失败。 |
| `RIFTBOUND_STORAGE_DIRECTORY` | 未设置 | 设置后使用 `FileRoomStore` 持久化房间；未设置时使用内存房间存储。 |
| `RIFTBOUND_DUEL_PROFILE` | `p4` | 仅允许 `v1` 或 `p4`；其他值启动即抛出 `TypeError`。 |
| `RIFTBOUND_DUEL_RUNTIME_PROFILE` | p4 房间未设置时使用 `optional-unit-choice-clock-v4` | 仅允许 `public-chain-v1`、`optional-unit-choice-clock-v4`、`optional-unit-physical-chain-v4`、`optional-unit-resolved-history-v5`；非 p4 房间设置该变量会抛出 `TypeError`。 |

示例（macOS / Linux）：

```bash
RIFTBOUND_STORAGE_DIRECTORY=/var/lib/riftbound-rooms pnpm start:server
```

示例（Windows PowerShell）：

```powershell
$env:RIFTBOUND_STORAGE_DIRECTORY = "C:\temp\riftbound-rooms"
pnpm start:server
```

只想换端口时：

```bash
PORT=9000 pnpm start:server
```

默认只监听本机回环地址。要让同一局域网里的另一台机器连上来，把 `HOST` 设成那台
服务端机器可被访问的地址（具体地址取决于你的网络配置），并在客户端里填对应的地址。

## 接口

默认监听 `127.0.0.1:8787` 时（实现见 `apps/game-server/src/server.ts`）：

| 方法与路径 | 说明 |
| --- | --- |
| `GET /health` | 返回 `{"status":"ok","rooms":<当前房间数>}`。 |
| `GET /api/cards` | 返回公开卡牌目录；可带 `regionCode` / `eventDate` 查询参数走地区赛事目录。 |
| `GET /api/card-images/<printingId>` | 返回该印刷版的图片；未在图片清单中时为 `404 image-not-found`。 |
| `POST /api/decks/validate` | 请求体为 `{ deck: { zone: [{ cardId, quantity }] } }`，返回服务端构筑校验结果。 |
| WebSocket `/ws`（HTTP 升级） | 房间与对局命令、事件、投影的唯一 WebSocket 端点；其他路径的升级请求会被拒绝。 |

客户端里的两个地址要一起改：房间连接页填 WebSocket 地址（默认
`ws://127.0.0.1:8787`），卡组管理页的“仓库服务地址”填 HTTP 地址（默认
`http://127.0.0.1:8787`）。只改其中一个时，会表现为能连房间但卡牌目录加载失败，
或反过来。

## 房间持久化

设置 `RIFTBOUND_STORAGE_DIRECTORY` 后，服务端在启动时创建并检查该目录、探测写权限、
恢复已持久化的房间，然后才开始监听。每个房间占用一个以房间号 SHA-256 命名的子目录，
其布局为：

```text
storageDirectory/
  <sha256(room-id)>/
    archive.log
```

`archive.log` 是有序、带校验的权威日志，也是唯一必需的持久化文件；存储层虽然接受
`archive.snapshot.json` 路径，但按 `snapshotMode: "ignored"` 配置它不参与正确性，
恢复只依赖日志。房间归档是服务端私有格式，当前源码只把它交给 `FileRoomStore`，公开接口
不下发归档内容。**没有设置该变量时房间只在内存中，服务端重启会丢失房间与事件历史。**
生产使用还需要自行准备备份、保留策略与恢复演练。

## 验证服务端

启动后可以在另一个终端检查：

```bash
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8787/api/cards
```

本仓库的发布门禁命令为：

```bash
pnpm build
pnpm typecheck
pnpm test
```

## 截图占位说明

> 截图占位（待本机视觉验证补图）：`docs/user/images/server-start.png` —— 服务端启动日志中的四个地址。

客户端的连接与建房流程见 [playing.md](playing.md)。
