#!/usr/bin/env bash
# Riftbound beta 自签方案：生成私有根证书（CA）与服务器证书。
# 根证书带 nameConstraints，只能为这里列出的 IP / 域名签发证书，
# 即使根证书私钥泄露，也无法用它冒充其他网站。
set -euo pipefail

usage() {
  cat <<'USAGE'
用法：deploy/beta-tls/gen-certs.sh --ip <服务器公网IP> [--ip <IP>]... [--dns <域名>]... [--out <目录>]

  --ip    服务器 IP（可重复），写入证书 SAN 和根证书的名称约束
  --dns   可选域名（可重复）
  --out   输出目录，默认 ./riftbound-beta-tls

输出：
  ca.crt      私有根证书：分发给测试机导入信任
  ca.key      根证书私钥：只留在生成它的机器上，不上传服务器、不发给任何人
  server.crt  服务器证书：放到服务器，给 Caddy 用
  server.key  服务器私钥：放到服务器，权限 600

再次运行且输出目录里已有 ca.key 时，只重签服务器证书（用于续期），根证书不变，
测试机无需重新信任。IP 变了必须换新目录重新生成根证书：名称约束在根证书里固定。
USAGE
}

out=./riftbound-beta-tls
ips=()
dns=()
while [[ $# -gt 0 ]]; do
  case $1 in
    --ip) ips+=("${2:?--ip 需要参数}"); shift 2 ;;
    --dns) dns+=("${2:?--dns 需要参数}"); shift 2 ;;
    --out) out=${2:?--out 需要参数}; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) printf '未知参数：%s\n\n' "$1" >&2; usage >&2; exit 1 ;;
  esac
done
[[ ${#ips[@]} -gt 0 || ${#dns[@]} -gt 0 ]] || { usage >&2; exit 1; }
command -v openssl >/dev/null || { echo "需要 openssl" >&2; exit 1; }

san=()
constraints=()
for ip in "${ips[@]+"${ips[@]}"}"; do
  [[ $ip =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || { echo "不是 IPv4 地址：$ip" >&2; exit 1; }
  san+=("IP:$ip")
  constraints+=("permitted;IP:$ip/255.255.255.255")
done
for name in "${dns[@]+"${dns[@]}"}"; do
  san+=("DNS:$name")
  constraints+=("permitted;DNS:$name")
done
san_csv=$(IFS=,; echo "${san[*]}")
constraints_csv=$(IFS=,; echo "${constraints[*]}")

mkdir -p "$out"
umask 077
cd "$out"

if [[ -f ca.key && -f ca.crt ]]; then
  echo "沿用已有根证书 $out/ca.crt（只重签服务器证书）。"
  # 新 SAN 必须落在根证书的名称约束内，否则签出的证书会被客户端拒绝。
  existing=$(openssl x509 -in ca.crt -noout -ext nameConstraints 2>/dev/null || true)
  for ip in "${ips[@]+"${ips[@]}"}"; do
    grep -q "IP:$ip/" <<<"$existing" || { echo "根证书的名称约束不含 $ip：IP 变了请换新 --out 目录重新生成。" >&2; exit 1; }
  done
else
  echo "生成私有根证书……"
  openssl req -x509 -new -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
    -keyout ca.key -out ca.crt -days 730 -sha256 \
    -subj "/O=Riftbound Beta/CN=Riftbound Beta Private CA" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -addext "subjectKeyIdentifier=hash" \
    -addext "nameConstraints=critical,$constraints_csv" 2>/dev/null
fi

echo "签发服务器证书（SAN：$san_csv）……"
cat > server.ext <<EXT
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=serverAuth
subjectAltName=$san_csv
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid
EXT
openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
  -keyout server.key -out server.csr \
  -subj "/O=Riftbound Beta/CN=Riftbound Beta Server" 2>/dev/null
# macOS 要求私有 CA 签发的服务器证书有效期不超过 825 天；这里取 397 天，与公开证书一致。
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key \
  -set_serial "0x$(openssl rand -hex 16)" -days 397 -sha256 \
  -extfile server.ext -out server.crt 2>/dev/null
rm -f server.csr server.ext
chmod 600 ca.key server.key
chmod 644 ca.crt server.crt

openssl verify -CAfile ca.crt server.crt >/dev/null
echo
echo "完成：$(pwd)"
echo "  根证书 SHA-256 指纹（测试机导入时核对）："
openssl x509 -in ca.crt -noout -fingerprint -sha256 | sed 's/^/    /'
echo "  服务器证书有效期至：$(openssl x509 -in server.crt -noout -enddate | cut -d= -f2)"
echo "  ca.key 只保存在本机；server.crt 与 server.key 上传到服务器；ca.crt 发给测试者。"
