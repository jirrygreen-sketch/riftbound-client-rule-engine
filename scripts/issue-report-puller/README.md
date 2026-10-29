# 问题报告拉取（RIFT-1133）

线上游戏服务器在香港，访问不到内网 Zira，所以采用以下流程：

1. 客户端把玩家的问题报告提交到游戏服务器（RIFT-1131）。
2. 服务器只在内存里暂存报告，不写盘，重启即清空（RIFT-1132）。
3. 本目录的脚本在内网的一台 Mac 上定时运行，把报告转成 Zira 工单。

## 每次运行做什么
1. 带口令调用 `GET /api/issue-reports/pending` 取待处理报告。
2. 在 Zira RIFT 项目为每份报告建单：标题前缀【玩家上报】，标签 `user-report`、`m1`，父任务 RIFT-1046；附件为 `client-log.json`，在对局中时还有 `match-log.json`。
3. 建单成功后，调用 `POST /api/issue-reports/ack` 让服务器删除这些报告。
4. `~/.local/state/riftbound/issue-puller.json` 记录“报告编号 → 工单号”。确认失败时，下次只补发确认，不会重复建单。

## 配置
- 拉取口令：`~/.config/riftbound/issue-pull-token`，权限 600，内容与服务器环境变量 `RIFTBOUND_ISSUE_PULL_TOKEN` 相同。
- Zira 凭据：默认运行时从 `~/.claude.json` 的 `mcpServers.zira.headers.Authorization` 读取，不另存。
- 可选覆盖：`~/.config/riftbound/issue-puller.json`，可设置的字段见 `pull.mjs` 中的 `DEFAULTS`，例如 `serverUrl`、`batchSize`、`ziraAuthFile`。

## 安装与运维
```sh
scripts/issue-report-puller/install-launchd.sh        # 每 5 分钟运行一次，可传秒数修改间隔
node scripts/issue-report-puller/pull.mjs             # 手动运行一次
node --test scripts/issue-report-puller/pull.test.mjs # 单元测试
tail -f ~/Library/Logs/riftbound-issue-report-puller.log
launchctl bootout gui/$(id -u)/ai.riftbound.issue-report-puller   # 停用
```
日志只记录报告编号、工单号和结果，不记录报告内容和任何凭据。
