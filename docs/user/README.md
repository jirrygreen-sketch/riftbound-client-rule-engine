# Riftbound 用户指南

本目录面向**玩家**，说明如何安装桌面客户端、启动或连接服务端、建房、组卡、
对局操作、查看回放和排查常见问题。文档中的界面文案直接引用客户端源码中的字符串，
命令与环境变量来自仓库根目录 `package.json`、`apps/game-server/src/index.ts`、
`apps/desktop-client/package.json` 与 `.github/workflows/release.yml`。

## 目录

| 文档 | 内容 |
| --- | --- |
| [install.md](install.md) | 从 GitHub Release 下载 macOS / Windows 安装包，校验与安装；从源码构建 |
| [server.md](server.md) | 启动 `apps/game-server`、环境变量、HTTP / WebSocket 端点、卡牌数据准备 |
| [playing.md](playing.md) | 连接服务器、创建或加入房间、组卡、对局操作、回放查看 |
| [faq.md](faq.md) | 常见问题与已知边界 |

## 最短上手路径

1. 从 GitHub Release 下载自己平台的安装包并安装，见 [install.md](install.md)。
2. 在一台机器上启动服务端，见 [server.md](server.md)；默认地址为
   `ws://127.0.0.1:8787`，界面里填写的服务地址也是这个默认值。
3. 打开客户端，在首页点击“房间连接”，连接服务端后创建房间。
4. 在“卡组管理”里搭好卡组并保存；进入房间后点“提交当前卡组”，双方点击“准备开局”后进入牌桌。
5. 对局中所有可执行操作以牌桌右侧“动作与选择”面板中**已启用**的按钮为准；
   结束后可在“对局回放”里回看本机记录。

## 重要边界

- 本项目是**非官方**的粉丝项目，不是完整可玩的官方 Riftbound 实现。
- 部分卡牌效果尚未实现。客户端在“创建新房间”区域显示提示：
  “部分卡牌效果尚未支持；可用操作以当前牌桌提示为准。”遇到未接入的效果时，界面停在
  “等待规则处理”，不会猜测结算，也不会让你手改状态。
- 房间默认只存在内存里：不设置 `RIFTBOUND_STORAGE_DIRECTORY` 时，服务端重启会丢失
  房间和事件历史。
- 回放是**本机个人回放**，只包含服务端已经发给当前视角的投影帧，不是全局战绩或严格引擎回放。
- 安装包未做代码签名与公证，macOS Gatekeeper 与 Windows SmartScreen 会告警；
  官方 Release 说明中给出了放行步骤与 SHA-256 校验方式。

## 截图占位说明

界面示意截图由本机视觉验证统一补图。占位格式如下，补图时替换为真实截图并保留文件名约定：

> 截图占位（待本机视觉验证补图）：`docs/user/images/home.png` —— 首页六个入口与连接状态。

## 文档来源

本指南描述的是当前源码的真实行为，包括已知缺口。条款与规则引用以仓库中受版本控制的
来源为准（`docs/rule-source-manifest.json`、`docs/rules/`），页面上的能力边界以
`docs/full-product/progress.md` 与交付目标为准；本指南不预填尚未验收的功能。
