#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "$0")/.." && pwd)"
CONFIG_PATH="${FEISHU_CONFIG_PATH:-$HOME/.config/remotelab/feishu-connector/config.json}"
LOG_PATH="${FEISHU_BOOT_LOG_PATH:-$HOME/.config/remotelab/feishu-connector/launchagent.log}"
PID_PATH="${FEISHU_PID_PATH:-$HOME/.config/remotelab/feishu-connector/connector.pid}"
NODE_BIN="${NODE_BIN:-}"
if [[ -z "$NODE_BIN" ]]; then
  if [[ -x /opt/homebrew/bin/node ]]; then
    NODE_BIN="/opt/homebrew/bin/node"
  else
    NODE_BIN="$(command -v node)"
  fi
fi

mkdir -p "$(dirname "$CONFIG_PATH")"
mkdir -p "$(dirname "$LOG_PATH")"
mkdir -p "$(dirname "$PID_PATH")"

if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  printf '[%s] node binary not found\n' "$(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG_PATH"
  sleep 300
  exit 0
fi

if [[ ! -f "$CONFIG_PATH" ]]; then
  printf '[%s] config missing, waiting for %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$CONFIG_PATH" >> "$LOG_PATH"
  sleep 300
  exit 0
fi

cd "$ROOT_DIR"
printf '%s\n' "$$" > "$PID_PATH"
exec env \
  PATH="$PATH" \
  HOME="$HOME" \
  USER="${USER:-}" \
  SHELL="${SHELL:-/bin/zsh}" \
  "$NODE_BIN" scripts/feishu-connector.mjs
