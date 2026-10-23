# M1 Beta 本机试玩指南（2026-10-23）

本文面向在本机使用两个客户端，由两名真人试玩 Rumble SFD 对 Fiora SFD 的测试者。目标路径是协议 V2 的独立房间界面。当前版本仍是一期 beta 验证版，不代表完整官方 Riftbound 规则已经验收。

## 准备

1. 使用 Node.js `22.12+`（22 系列）或 `24`，以及 pnpm `11.9.0`。
2. 在仓库根目录执行 `pnpm install --frozen-lockfile`。
3. 官方卡片目录被 Git 忽略，新 checkout 不会包含它。先联网执行：

   ```bash
   pnpm cards:sync
   pnpm --filter @riftbound/card-data sync:images
   ```

   图片缺失通常只导致卡面占位；`packages/card-data/data/deck-catalog.json` 缺失会阻止建房或提交预组。不要提交这些本地数据。
4. 默认端口为服务端 `8787`、两个浏览器客户端 `5173` 和 `5174`。可用 `RIFTBOUND_BETA_*_PORT` 修改。

## 一键启动

在仓库根目录运行：

```bash
scripts/beta/start-m1-beta.sh
```

脚本会先检查 Node、pnpm、M1 牌表、catalog 和端口，再执行 frozen install 与工作区构建。成功后会打印：

```text
客户端 A：http://127.0.0.1:5173/
客户端 B：http://127.0.0.1:5174/
V2 服务：ws://127.0.0.1:8787/ws
```

两个地址请分别在不同浏览器窗口或不同浏览器 profile 中打开；同源标签页共享 `localStorage`，会把上一局的 V2 恢复会话带到另一名玩家。若目录缺失，脚本会停止并提示先运行 `pnpm cards:sync`。日志与本地房间数据默认写入仓库内被忽略的 `.riftbound/m1-beta/`。

可在启动前单独检查：

```bash
node scripts/beta/check-m1-beta.mjs --require-free --card-server-port 8787 --server-port 8787 --client-a-port 5173 --client-b-port 5174
```

运行中的实例可用以下命令查看或只停止本脚本记录的进程：

```bash
scripts/beta/start-m1-beta.sh --status
scripts/beta/start-m1-beta.sh --stop
```

## Apple Silicon Mac

浏览器双窗方案不需要 Rust。服务端与 Vite 都监听本机回环地址，普通步骤与 Linux 相同。若要用一个原生 Tauri 窗口，先安装 Xcode Command Line Tools 和仓库锁定的 Rust `1.90.0`，再执行 `pnpm desktop:dev`；Tauri 开发配置使用 `127.0.0.1:5173`，所以该端口必须已有客户端 A。另一名玩家仍打开 `http://127.0.0.1:5174/`。

不要用同一个浏览器 profile 的两个标签伪造两名玩家。需要两个独立存储上下文，例如 Chrome 的两个 profile、一个原生 app 加一个浏览器，或一个普通窗口加一个隐私窗口。

当前 V2 真人 UI 还没有闭合验收。按本次代码与运行重核，至少一个本地 checkout 的旧 catalog 快照会触发会话恢复循环：刷新后客户端送回 `afterEventSeq=0`，服务端在游戏开始前拒绝事件游标并反复重连。测试时如果看到“连接中/重连中”不断切换，或建房成功后有 `Game events are not available before the game starts`，立即停止重复点击，按下文收集日志；这不代表需要绕过 ACK。

## 进入 V2 房间

两窗口都按以下路径操作：

1. 从首页打开“房间连接”。
2. 点击“使用协议 v2 独立房间”。
3. 在“V2 服务地址”填 `ws://127.0.0.1:8787/ws`（若改了服务端端口，使用脚本打印的地址），提交连接。
4. 客户端 A 选择 Rumble 的一端后点“创建 1v1 房间”；记下页面上的房间号。
5. 客户端 B 填同一房间号并点“加入房间”。
6. A、B 各选自己的 M1 预组。首次 `RIFTBOUND_M1_PRESETS_ONLY=1` 启动只接受 `rumble-sfd` 和 `fiora-sfd`；脚本已默认开启此闸门。
7. 两窗口分别点“提交预组牌组”，再点“准备”。第二个“准备”成功后进入换牌阶段，正式对局尚未开始。
8. 服务端按 CR 115 的回合顺序开放换牌窗口。轮到你的窗口时，查看“我的手牌”中的 4 张起手：点“保留起手”不换牌，或选择至多 2 张后点“换掉 N 张”。未轮到的一方会看到等待提示，不能代对手操作。
9. 双方都确认后，服务端用共同确认的换牌结果开始首回合。之后手牌才可能包含首个回合的抽牌。

换牌实现依据 Core Rules v1.5：开局各有 4 张起手（CR 116）；按回合顺序，每名玩家可选 0–2 张，先补抽同样数量，再回收换下的牌（CR 117、117.1–117.3）；首名玩家进入正式回合后开始行动（CR 118）。若服务端拒绝选择，保留页面上的确认理由并停止重复点击；不要绕过 ACK，也不要手工改投影或对手手牌。

## 一局怎么打

所有可见动作都应以当前两个投影和“最近的命令确认”为准；不要因为按钮存在就假定动作一定合法。

- **出牌**：选择自己手牌，再按页面公布的出牌目的地与目标要求选择对象，最后点“打出手牌”。需要目标的牌只在服务端公布候选时可选；没有候选就不要猜对象 ID。
- **费用与符文**：用“取能量”获得 Energy；用“取 Power”将一张符文回收为对应 Domain 的 Power。能量与 Power 的数字来自服务端投影，页面不接受客户端自报费用。
- **选择提示**：按当前 owner 显示的可选、模式、对象、排序或数值提交；对手视角会等待。不要切换到错误窗口代答。
- **移动**：选择自己的单位与合法目的地，再点“移动单位”。
- **战斗与 Showdown**：查看“链 / 优先权”和“战斗”区域。当前 UI 会显示投影中的 Priority、Focus、Showdown window、战斗步骤和伤害双方；按当前合法控件行动。不要从旧 P4 界面另开一局。
- **让过与结束回合**：使用 V2 面板的 Pass 或结束回合控件。若某个控件未出现在当前投影要求的路径中，记录当时的阶段、链、Priority/Focus 和可复现步骤。
- **胜负**：比分达到投影的胜利分后，页面显示胜者；对局中也可点“认输”，但认输结果不能算作 beta 自然终局验收。

当前真人 UI 尚未完成全流程验收。就绪报告列出的已知 blocker 包括：对局真正开始时 V2 客户端的会话恢复循环、Panel 未暴露显式结束回合/推进伤害控件、choose 候选与 rollback 的稳定性，以及固定种子自然终局并非 6/6。看到卡住时先保存证据，不要用开发工具手改状态或绕开 ACK。

## 已知限制

- 只有 V2 独立房间按 M1 预组白名单启动；旧界面不是另一条可替代的验收路径。
- V2 的本机回放没有接入当前完整 capture/save 流程；现有保存按钮依赖旧 Duel projection。权威 journal 仍保留在 `.riftbound/m1-beta/rooms/`，但它目前没有面向用户的完整 strict replay 入口。
- 服务端默认规则边界仍以 fail-closed 为原则。未知、未裁定或未证明的效果必须停在 judge-required/blocked，不能由客户端近似结算。
- 本 beta 不承诺完整 1,408 张卡的官方效果覆盖、赛事编排、联网 matchmaking、签名/公证或生产级持久化集群。

## 出问题时收集什么

请收集以下材料，并写明复现时间、两名玩家的昵称、预组、房间号以及出错前的操作：

- 两个窗口的全页截图，特别是“连接状态”“最近的命令确认”“链 / 优先权”“战斗”“选择请求”和可见错误。
- 浏览器 Console 的 `Maximum update depth exceeded`、未识别数据包、ACK 超时或拒绝原因；先停止重复操作再复制。
- `scripts/beta/start-m1-beta.sh` 所在状态目录下的 `logs/server.log`、`logs/client-a.log`、`logs/client-b.log`。
- `.riftbound/m1-beta/rooms/<hash>/archive.log`。这是私密房间归档，只交给项目维护者，不要公开贴出其中 `resumeToken`。
- 若使用 Tauri，另附终端中的 `pnpm desktop:dev` 输出和 macOS 版本；不要上传签名私钥或账户凭据。

收集日志时只停止自己启动的进程。使用脚本时优先执行 `scripts/beta/start-m1-beta.sh --stop`，不要按进程名或端口批量终止其他并行任务。
