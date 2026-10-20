#!/usr/bin/env bash
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=4100
PIDFILE="$DIR/.server.pid"
LOG="/tmp/opencode/ilyrics-server.log"

running() {
  [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null
}

kill_all() {
  # 先杀 pidfile 记录的进程，再按端口兜底杀所有占用 4100 的进程
  if [ -f "$PIDFILE" ]; then
    kill "$(cat "$PIDFILE")" 2>/dev/null
    rm -f "$PIDFILE"
  fi
  pkill -f "node $DIR/server.js" 2>/dev/null
  local pids
  pids=$(ss -tlnp 2>/dev/null | grep ':4100 ' | grep -o 'pid=[0-9]\+' | cut -d= -f2 | sort -u)
  for p in $pids; do kill "$p" 2>/dev/null; done
  sleep 0.5
}

case "${1:-start}" in
  start)
    if running; then
      echo "已在运行 pid=$(cat "$PIDFILE") http://localhost:$PORT"
      exit 0
    fi
    kill_all
    nohup node "$DIR/server.js" > "$LOG" 2>&1 &
    echo $! > "$PIDFILE"
    sleep 1
    if running && curl -fs -o /dev/null "http://localhost:$PORT/"; then
      echo "已启动 pid=$(cat "$PIDFILE") http://localhost:$PORT 日志=$LOG"
    else
      echo "启动失败，查日志：$LOG"
      exit 1
    fi
    ;;
  stop)
    if running || ss -tlnp 2>/dev/null | grep -q ':4100 '; then
      kill_all
      echo "已停止"
    else
      echo "未在运行"
    fi
    ;;
  restart)
    kill_all
    "$0" start
    ;;
  install)
    ok=1
    if command -v node >/dev/null 2>&1; then
      echo "[ok] node $(node -v)"
    else
      echo "[✗] 未安装 node（需要 >= 18）"
      ok=0
    fi
    if [ -f "$DIR/server.js" ]; then
      echo "[ok] server.js 存在"
    else
      echo "[✗] 缺少 server.js（请在仓库目录内运行）"
      ok=0
    fi
    mkdir -p "$(dirname "$LOG")" && echo "[ok] 日志目录就绪：$(dirname "$LOG")"
    chmod +x "$0" && echo "[ok] server.sh 已可执行"
    if [ -f "$DIR/package.json" ]; then
      deps=$(node -e "const p=require('$DIR/package.json');console.log(Object.keys(p.dependencies||{}).length)" 2>/dev/null || echo 0)
      if [ "$deps" -gt 0 ]; then
        (cd "$DIR" && npm install --no-audit --no-fund >/dev/null 2>&1) && echo "[ok] npm 依赖已安装（$deps 个）" || { echo "[✗] npm install 失败"; ok=0; }
      else
        echo "[ok] 零依赖项目，无需 npm install"
      fi
    fi
    if curl -fs -m 3 "http://127.0.0.1:8080/v1/models" >/dev/null 2>&1; then
      echo "[ok] llama.cpp 上游 127.0.0.1:8080 在线"
    else
      echo "[!] 上游 127.0.0.1:8080 未响应——生成前需要 llama.cpp 服务在线"
    fi
    if [ "$ok" -eq 1 ]; then
      echo "安装检查通过 ✦ 下一步：./server.sh start"
    else
      echo "安装检查有失败项，按上面提示处理后重试"
      exit 1
    fi
    ;;
  status)
    if running; then
      echo "运行中 pid=$(cat "$PIDFILE") http://localhost:$PORT"
    elif ss -tlnp 2>/dev/null | grep -q ':4100 '; then
      echo "运行中（端口 $PORT 被非 pidfile 进程占用：$(ss -tlnp 2>/dev/null | grep ':4100 ' | grep -o 'pid=[0-9]\+' | cut -d= -f2 | head -1)，restart 可接管）"
    else
      echo "未运行"
    fi
    ;;
  logs)
    tail -n "${2:-50}" "$LOG"
    ;;
  *)
    echo "用法: server.sh [install|start|stop|restart|status|logs [行数]]"
    exit 1
    ;;
esac
