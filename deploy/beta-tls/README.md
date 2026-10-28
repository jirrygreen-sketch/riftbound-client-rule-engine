# Riftbound beta 上云：自签证书方案

适用场景：上云做小范围 beta，测试者人数少、机器可控，暂时没有域名或正式证书。
正式上线请换成 DV 证书，方法见文末。

```
测试机（浏览器 / 桌面 App）
   │  https://<IP>/        网页
   │  wss://<IP>/ws        对局连接
   ▼
Caddy :443（私有 CA 签发的证书）
   ├─ /ws、/api/*、/health  → game-server 127.0.0.1:8787（明文，只监听本机）
   └─ 其他路径              → 客户端网页（apps/desktop-client/dist）
```

本目录文件：

| 文件 | 用途 |
|---|---|
| `gen-certs.sh` | 生成私有根证书和服务器证书 |
| `Caddyfile` | Caddy 反向代理配置 |

本方案已在 Mac 上做过端到端验证（证书签发给 127.0.0.1，Caddy v2.11.7 监听 18443），通过项：
- https 访问网页和 SPA 路由回退；
- `/api/cards` 压缩传输、`/health`；
- wss 握手及收发消息；
- 客户端不发 SNI 的 IP 直连握手；
- 不信任根证书的连接被拒绝；
- 根证书越权签发的证书被名称约束拒绝。

---

## 1. 生成证书（在管理员自己的电脑上做，不要在服务器上做）

```sh
cd ~/project/xxself/riftbound-beta
deploy/beta-tls/gen-certs.sh --ip <服务器公网IP> --out ~/riftbound-beta-tls
# 有域名可以一起写上：--dns beta.example.com
```

输出四个文件：

| 文件 | 去向 |
|---|---|
| `ca.key` | **只留在这台电脑**，不上传、不发给任何人。只有续签服务器证书时才用到 |
| `ca.crt` | 发给每位测试者导入信任（第 4 步） |
| `server.crt`、`server.key` | 上传到服务器（第 3 步） |

脚本最后会打印根证书的 SHA-256 指纹。把指纹和 `ca.crt` 一起发给测试者，让他们导入时核对。

几点说明：
- **名称约束**：根证书带 nameConstraints，只能为上面写的 IP 或域名签证书。即使 `ca.key` 泄露，也冒充不了其他网站。
- **有效期**：服务器证书 397 天，根证书 2 年。
- **续期**：对同一个 `--out` 目录再跑一次脚本，只会重签服务器证书，测试机不用重新导入。
- **换 IP**：名称约束固定在根证书里，必须换一个新的 `--out` 目录重新生成；测试机要删掉旧根证书、导入新的。

## 2. 部署 game-server（云服务器上）

要求：Node `^22.12.0 || ^24.0.0 || >=26.0.0`，pnpm 11.9.0。

```sh
git clone <仓库地址> /srv/riftbound && cd /srv/riftbound
git checkout <要测的版本>
pnpm install --frozen-lockfile
pnpm --filter @riftbound/desktop-client build      # 生成 apps/desktop-client/dist（网页客户端）

# 启动服务端：只监听本机，由 Caddy 对外
PORT=8787 HOST=127.0.0.1 \
RIFTBOUND_STORAGE_DIRECTORY=/srv/riftbound-data/rooms \
RIFTBOUND_M1_PRESETS_ONLY=1 \
pnpm --filter @riftbound/game-server start
```

官方卡牌目录和卡图文件被 gitignore 了，新克隆的仓库里没有。需要按 `scripts/beta/start-m1-beta.sh` 开头的检查准备好 M1 牌表和 catalog，也可以直接在服务器上跑一次这个脚本做自检。

长期运行建议用 systemd 管理，示例：

```ini
# /etc/systemd/system/riftbound-server.service
[Unit]
Description=Riftbound game-server
After=network.target

[Service]
WorkingDirectory=/srv/riftbound
Environment=PORT=8787 HOST=127.0.0.1 RIFTBOUND_STORAGE_DIRECTORY=/srv/riftbound-data/rooms RIFTBOUND_M1_PRESETS_ONLY=1
ExecStart=/usr/bin/env pnpm --filter @riftbound/game-server start
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

## 3. 部署 Caddy（云服务器上）

1. 安装 Caddy v2，参考 https://caddyserver.com/docs/install 。Ubuntu/Debian 可以用官方 apt 源，也可以直接放一个官方二进制。
2. 放证书：
   ```sh
   sudo mkdir -p /etc/riftbound/tls
   sudo cp server.crt server.key /etc/riftbound/tls/
   sudo chown -R caddy:caddy /etc/riftbound/tls     # 以 caddy 用户运行时
   sudo chmod 600 /etc/riftbound/tls/server.key
   ```
3. 把本目录的 `Caddyfile` 复制到 `/etc/caddy/Caddyfile`，并配置环境变量。systemd 下可以写在 `sudo systemctl edit caddy` 里：
   ```ini
   [Service]
   Environment=RIFT_BETA_HOST=<服务器公网IP>
   Environment=RIFT_BETA_TLS_DIR=/etc/riftbound/tls
   Environment=RIFT_BETA_WEB_ROOT=/srv/riftbound/apps/desktop-client/dist
   ```
4. 先校验配置，再重启：
   ```sh
   sudo -u caddy env RIFT_BETA_HOST=... RIFT_BETA_TLS_DIR=... RIFT_BETA_WEB_ROOT=... \
     caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
   sudo systemctl restart caddy
   ```
5. 云安全组 / 防火墙放行 TCP 443；要用 http→https 自动跳转的话，再放行 TCP 80。**不要**对外开放 8787。

服务器上自检：

```sh
curl --cacert ca.crt https://<服务器公网IP>/health        # 返回 {"status":"ok",...}
```

## 4. 测试机信任根证书

**导入前**先核对指纹，要和管理员给的一致：

```sh
openssl x509 -in ca.crt -noout -fingerprint -sha256
```

**macOS**（Safari、Chrome、Edge 和 Riftbound 桌面 App 都用系统钥匙串）：
- 图形界面：
  1. 双击 `ca.crt`，导入到“系统”钥匙串。
  2. 在“钥匙串访问”里找到 *Riftbound Beta Private CA*，双击打开。
  3. 展开“信任”，把“使用此证书时”改成**始终信任**，关闭窗口时输入密码确认。
- 命令行：
  ```sh
  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ca.crt
  ```

**Windows**（Edge、Chrome 和桌面 App 用的 WebView2 都用系统证书库）：
- 图形界面：
  1. 双击 `ca.crt`，点“安装证书”，选“本地计算机”。
  2. 选“将所有的证书都放入下列存储”，存储选**受信任的根证书颁发机构**，完成。
- 命令行（管理员 PowerShell）：
  ```powershell
  certutil -addstore -f Root ca.crt
  ```

**Firefox** 默认用自己的证书库：设置 → 隐私与安全 → 证书 → 查看证书 → 证书颁发机构 → 导入 `ca.crt`，勾选“信任由此证书颁发机构来标识网站”。

导入后重启浏览器或 App，打开 `https://<服务器公网IP>/health`，不出现证书警告就说明成功了。

## 5. 客户端改用 wss 地址

客户端不需要改代码。“V2 服务地址”填 `wss://` 地址后，卡牌目录和卡图会自动改走 `https://`。

- **网页**：浏览器打开 `https://<服务器公网IP>/`，进「房间连接」。
- **桌面 App**：打开 Riftbound Desktop Client，进「房间连接」。

在 **V2 服务地址** 一栏填下面任意一种写法，然后点「连接」：

```
wss://<服务器公网IP>/ws
wss://<服务器公网IP>
https://<服务器公网IP>
```

默认值 `ws://127.0.0.1:8787/ws` 只适用于本机 beta。后面的建房、加入、开局流程和本机 beta 一样，见 `BETA-上手说明.md` 第 3 节。

卡图直接从官方 CDN `cmsassets.rgpub.io` 加载，不经过我们的服务器，所以测试机要能访问这个域名。

## 6. 常见问题

| 现象 | 原因与处理 |
|---|---|
| 浏览器提示“您的连接不是私密连接” / `NET::ERR_CERT_AUTHORITY_INVALID` | 根证书没导入，或没设成“始终信任”。按第 4 步重做，然后重启浏览器 |
| 网页能打开但连不上对局，显示连接中或已断开 | V2 服务地址还是 `ws://127.0.0.1...`，改成 `wss://<IP>/ws` |
| `NET::ERR_CERT_COMMON_NAME_INVALID` | 访问用的 IP / 域名不在证书 SAN 里。用 `gen-certs.sh` 时写对的 `--ip` 重签 |
| 桌面 App 连不上，浏览器却正常 | Firefox 用的是自己的证书库，不代表系统已信任；按第 4 步导入系统证书库 |
| `curl: (60) SSL certificate problem` | 服务器上自检时没带 `--cacert ca.crt` |

## 7. beta 结束后

- **测试机删除信任**：
  - macOS：在“钥匙串访问”里删除 *Riftbound Beta Private CA*。
  - Windows：运行 `certutil -delstore Root "Riftbound Beta Private CA"`。
- **管理员**：销毁 `ca.key`。

## 正式上线：换 DV 证书

有了备案域名后，把 `Caddyfile` 里的站点地址改成域名，删掉 `tls ...` 行和全局的 `auto_https disable_certs`。Caddy 会自动向 Let's Encrypt 申请并续期 DV 证书，测试机也就不用再导入根证书。
