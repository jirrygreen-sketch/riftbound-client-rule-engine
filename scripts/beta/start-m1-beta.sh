#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(CDPATH= cd -- "${SCRIPT_DIR}/../.." && pwd)
STATE_DIR=${RIFTBOUND_BETA_STATE_DIR:-"${ROOT}/.riftbound/m1-beta"}
LOG_DIR=${RIFTBOUND_BETA_LOG_DIR:-"${STATE_DIR}/logs"}
STORAGE_DIR=${RIFTBOUND_STORAGE_DIRECTORY:-"${STATE_DIR}/rooms"}
CATALOG="${ROOT}/packages/card-data/data/deck-catalog.json"
SERVER_PORT=${RIFTBOUND_BETA_SERVER_PORT:-8787}
CLIENT_A_PORT=${RIFTBOUND_BETA_CLIENT_A_PORT:-5173}
CLIENT_B_PORT=${RIFTBOUND_BETA_CLIENT_B_PORT:-5174}
PID_FILE="${STATE_DIR}/processes.pids"
VITE_CONFIG=${RIFTBOUND_BETA_VITE_CONFIG:-${ROOT}/apps/desktop-client/vite.config.ts}
READY_TIMEOUT_SECONDS=${RIFTBOUND_BETA_READY_TIMEOUT_SECONDS:-180}
[[ ${READY_TIMEOUT_SECONDS} =~ ^[1-9][0-9]*$ ]] || {
  printf '错误：RIFTBOUND_BETA_READY_TIMEOUT_SECONDS 必须是正整数。\n' >&2
  exit 1
}

usage() {
  cat <<'EOF'
用法：scripts/beta/start-m1-beta.sh [--stop|--status|--help]

默认依次执行：
  1. 检查 Node/pnpm、M1 牌表、catalog 与端口；
  2. 通过 pnpm 构建工作区；
  3. 启动 game-server 和两个 Vite 客户端；
  4. 等待 HTTP、catalog 与两个客户端页面就绪；
  5. 打印两个客户端 URL、服务器健康地址和停止命令。

可选环境变量：
  RIFTBOUND_BETA_SERVER_PORT  默认 8787
  RIFTBOUND_BETA_CLIENT_A_PORT 默认 5173
  RIFTBOUND_BETA_CLIENT_B_PORT 默认 5174
  RIFTBOUND_BETA_STATE_DIR     默认 <repo>/.riftbound/m1-beta
  RIFTBOUND_BETA_LOG_DIR       默认 <state>/logs
  RIFTBOUND_STORAGE_DIRECTORY  默认 <state>/rooms（启动器会创建并交给自检）
  RIFTBOUND_BETA_VITE_CONFIG   默认 apps/desktop-client/vite.config.ts
  RIFTBOUND_BETA_READY_TIMEOUT_SECONDS 默认 180（服务端与客户端就绪等待秒数）

可选客户端：macOS 安装 Rust 1.90 后，用
  pnpm desktop:dev
启动 Tauri 原生窗口（固定连接 Vite 的 5173 端口），再开第二个浏览器窗口。
EOF
}

die() {
  printf '错误：%s\n' "$*" >&2
  exit 1
}

read_pid() {
  local name=$1
  [[ -f ${PID_FILE} ]] || return 1
  local pid
  pid=$(sed -n "s/^${name}=//p" "${PID_FILE}" | tail -1)
  [[ ${pid} =~ ^[0-9]+$ ]] || return 1
  printf '%s\n' "${pid}"
}

pid_matches() {
  local pid=$1
  local expected=$2
  kill -0 "${pid}" 2>/dev/null || return 1
  local command
  command=$(ps -o command= -p "${pid}" 2>/dev/null || true)
  [[ ${command} == *"${expected}"* ]]
}

process_group_alive() {
  local pgid=$1
  kill -0 -- "-${pgid}" 2>/dev/null
}

wait_group_exit() {
  local pgid=$1
  for _ in $(seq 1 40); do
    process_group_alive "${pgid}" || return 0
    sleep 0.1
  done
  return 1
}

stop_process() {
  local name=$1
  local pid
  if ! pid=$(read_pid "${name}"); then
    local port
    case ${name} in
      server) port=${SERVER_PORT} ;;
      client-a) port=${CLIENT_A_PORT} ;;
      client-b) port=${CLIENT_B_PORT} ;;
    esac
    if [[ -z ${pid:-} && ! -f ${PID_FILE} ]] && port_listening "${port}"; then
      die "${name} 端口 ${port} 有进程但不是本脚本记录的所有者；请手动确认后停止。"
    fi
    return 0
  fi
  if kill -0 "${pid}" 2>/dev/null || process_group_alive "${pid}"; then
    kill -- "-${pid}" 2>/dev/null || kill "${pid}" 2>/dev/null || true
    wait_group_exit "${pid}" || kill -KILL -- "-${pid}" 2>/dev/null || true
  fi
}

stop_all() {
  for name in client-b client-a server; do stop_process "${name}"; done
  : >"${PID_FILE}"
  printf '已停止本脚本记录的进程。\n'
}

show_status() {
  local any=false
  for name in server client-a client-b; do
    local pid
  if pid=$(read_pid "${name}") && { kill -0 "${pid}" 2>/dev/null || process_group_alive "${pid}"; }; then
      printf '%-9s PID %s 运行中\n' "${name}" "${pid}"
      any=true
    else
      printf '%-9s 未运行\n' "${name}"
    fi
  done
  [[ ${any} == true ]]
}

recorded_processes_alive() {
  local found=false
  for name in server client-a client-b; do
    local pid
    if pid=$(read_pid "${name}") && { kill -0 "${pid}" 2>/dev/null || process_group_alive "${pid}"; }; then
      found=true
      break
    fi
  done
  [[ ${found} == true ]]
}

port_listening() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

wait_for_url() {
  local name=$1
  local url=$2
  local log=$3
  local offset=$4
  local recent
  local attempts=$((READY_TIMEOUT_SECONDS * 2))
  local attempt=0
  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    if curl -fsS --max-time 2 "${url}" >/dev/null 2>&1; then return 0; fi
    if [[ ${name} == game-server ]]; then
      if ((attempt == 1 || attempt % 10 == 0)); then
        printf '正在恢复房间并等待 game-server 就绪（%s/%s 秒）……\n' \
          "$(((attempt + 1) / 2))" "${READY_TIMEOUT_SECONDS}"
      fi
      if [[ -f ${log} ]]; then
        local progress
        progress=$(log_since "${log}" "${offset}" | rg -o '\[room-restore\][^\n]*' | tail -1 || true)
        [[ -z ${progress} ]] || printf '  %s\n' "${progress}"
      fi
    fi
    if [[ -f ${log} ]]; then
      recent=$(log_since "${log}" "${offset}")
      if grep -Eq 'EADDRINUSE|strictPort|Error:|Failed to start|failed to load' <<<"${recent}"; then
        tail -80 "${log}" >&2
        return 1
      fi
    fi
    sleep 0.5
  done
  printf '%s 未在 %s 秒内就绪；日志：%s\n' \
    "${name}" "${READY_TIMEOUT_SECONDS}" "${log}" >&2
  tail -80 "${log}" >&2 || true
  return 1
}

record_pid() {
  local name=$1
  local pid=$2
  printf '%s=%s\n' "${name}" "${pid}" >>"${PID_FILE}"
}

case ${1:-} in
  --help|-h|help)
    usage
    exit 0
    ;;
  --stop|stop)
    stop_all
    exit 0
    ;;
  --status|status)
    show_status
    exit 0
    ;;
  "")
    ;;
  *)
    usage >&2
    die "未知参数：$1"
    ;;
esac

[[ -f "${ROOT}/pnpm-lock.yaml" ]] || die "请在 riftbound-full-product 仓库内运行；找不到 pnpm-lock.yaml。"
if git -C "${ROOT}" show-ref --verify --quiet refs/heads/integration; then
  behind=$(git -C "${ROOT}" rev-list --count HEAD..integration)
  [[ ${behind} == 0 ]] || die "当前分支落后本地 integration ${behind} 个提交；先合并最新 integration 后重试。"
fi
mkdir -p "${STATE_DIR}" "${LOG_DIR}" "${STORAGE_DIR}"

if [[ -f ${PID_FILE} ]]; then
  if recorded_processes_alive; then
    die "本脚本已有运行中的实例。先执行 scripts/beta/start-m1-beta.sh --stop。"
  fi
  : >"${PID_FILE}"
fi

for spec in "server:${SERVER_PORT}" "client-a:${CLIENT_A_PORT}" "client-b:${CLIENT_B_PORT}"; do
  name=${spec%%:*}
  port=${spec##*:}
  if port_listening "${port}"; then
    die "${name} 端口 ${port} 已被占用；换端口或先停止占用者。"
  fi
done

[[ -f ${CATALOG} ]] || die "缺少 ${CATALOG}。先联网运行：pnpm cards:sync"

cd "${ROOT}"
printf '运行启动前自检……\n'
RIFTBOUND_STORAGE_DIRECTORY="${STORAGE_DIR}" node "${SCRIPT_DIR}/check-m1-beta.mjs" --require-free \
  --card-server-port "${SERVER_PORT}" \
  --server-port "${SERVER_PORT}" --client-a-port "${CLIENT_A_PORT}" --client-b-port "${CLIENT_B_PORT}"

if [[ ${RIFTBOUND_BETA_SKIP_BUILD:-0} == 1 ]]; then
  printf '跳过构建（RIFTBOUND_BETA_SKIP_BUILD=1；仅用于已有构建产物的本机诊断）。\n'
else
  printf '构建工作区……（首次可能耗时数分钟）\n'
  pnpm install --frozen-lockfile
  if command -v heavy >/dev/null 2>&1; then
    heavy pnpm build
  else
    pnpm build
  fi
fi

cleanup_failed_start() {
  local status=$?
  if [[ ${status} -ne 0 ]]; then
    stop_all >/dev/null 2>&1 || true
    printf '启动失败；日志目录：%s\n' "${LOG_DIR}" >&2
  fi
  return "${status}"
}
trap 'cleanup_failed_start $?' EXIT

launch_group() {
  local name=$1
  local log=$2
  shift 2
  # Node's detached spawn is portable to macOS Bash 3.2 and makes each child
  # the leader of its own process group. The recorded PID is therefore safe
  # input for owner-only cleanup without process-name matching.
  local pid
  pid=$(node -e '
    const { spawn } = require("node:child_process");
    const fs = require("node:fs");
    const [log, command, ...args] = process.argv.slice(1);
    const output = fs.openSync(log, "a");
    const child = spawn(command, args, {
      detached: true,
      stdio: ["ignore", output, output]
    });
    if (!child.pid) process.exit(1);
    child.unref();
    process.stdout.write(String(child.pid));
  ' "${log}" "$@") || die "${name} 进程无法启动。"
  record_pid "${name}" "${pid}"
}

log_size() {
  local log=$1
  if [[ -f ${log} ]]; then
    wc -c <"${log}" | tr -d '[:space:]'
  else
    printf '0\n'
  fi
}

log_since() {
  local log=$1
  local offset=$2
  if [[ ! -f ${log} ]]; then
    return 0
  fi
  tail -c +"$((offset + 1))" "${log}"
}

ensure_group_alive() {
  local name=$1
  local label=$2
  local pid
  pid=$(read_pid "${name}") || die "${label} 未记录启动 PID。"
  kill -0 "${pid}" 2>/dev/null || process_group_alive "${pid}" ||
    die "${label} 启动后立即退出；日志：${LOG_DIR}/${name}.log"
}

printf '启动 game-server（:%s）……\n' "${SERVER_PORT}"
server_log_offset=$(log_size "${LOG_DIR}/server.log")
launch_group server "${LOG_DIR}/server.log" \
  env PORT="${SERVER_PORT}" HOST=127.0.0.1 \
  RIFTBOUND_STORAGE_DIRECTORY="${STORAGE_DIR}" \
  RIFTBOUND_M1_PRESETS_ONLY=1 \
  pnpm --filter @riftbound/game-server start
ensure_group_alive server server

printf '启动 client A（:%s）……\n' "${CLIENT_A_PORT}"
client_a_log_offset=$(log_size "${LOG_DIR}/client-a.log")
launch_group client-a "${LOG_DIR}/client-a.log" \
  pnpm --filter @riftbound/desktop-client exec vite \
  --config "${VITE_CONFIG}" --host 127.0.0.1 --port "${CLIENT_A_PORT}" --strictPort
ensure_group_alive client-a client-a

printf '启动 client B（:%s）……\n' "${CLIENT_B_PORT}"
client_b_log_offset=$(log_size "${LOG_DIR}/client-b.log")
launch_group client-b "${LOG_DIR}/client-b.log" \
  pnpm --filter @riftbound/desktop-client exec vite \
  --config "${VITE_CONFIG}" --host 127.0.0.1 --port "${CLIENT_B_PORT}" --strictPort
ensure_group_alive client-b client-b

wait_for_url "game-server" "http://127.0.0.1:${SERVER_PORT}/health" "${LOG_DIR}/server.log" "${server_log_offset}"
wait_for_url "catalog" "http://127.0.0.1:${SERVER_PORT}/api/presets" "${LOG_DIR}/server.log" "${server_log_offset}"
wait_for_url "client A" "http://127.0.0.1:${CLIENT_A_PORT}/" "${LOG_DIR}/client-a.log" "${client_a_log_offset}"
wait_for_url "client B" "http://127.0.0.1:${CLIENT_B_PORT}/" "${LOG_DIR}/client-b.log" "${client_b_log_offset}"

trap - EXIT
if [[ -w ${PID_FILE} ]]; then
  chmod 600 "${PID_FILE}"
fi
cat <<EOF

M1 beta 本地实例已启动。

客户端 A：http://127.0.0.1:${CLIENT_A_PORT}/
客户端 B：http://127.0.0.1:${CLIENT_B_PORT}/
V2 服务：ws://127.0.0.1:${SERVER_PORT}/ws
健康检查：http://127.0.0.1:${SERVER_PORT}/health
日志目录：${LOG_DIR}
房间数据：${STORAGE_DIR}

停止本脚本启动的全部进程：
  scripts/beta/start-m1-beta.sh --stop

查看进程：
  scripts/beta/start-m1-beta.sh --status
EOF
