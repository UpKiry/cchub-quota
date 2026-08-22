#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/../cc-hub-usage.conf"

usage() {
  cat <<'EOF'
用法:
  ./get-cc-hub-raw.sh [开始日期] [结束日期]

示例:
  ./get-cc-hub-raw.sh
  ./get-cc-hub-raw.sh 2026-08-01 2026-08-23

说明:
  通过 /api/auth/login 换取临时 auth-token Cookie，然后保存以下原始 JSON:
    login.json
    quota.json
    today.json
    stats-summary.json
    usage-logs.json

配置:
  项目根目录的 cc-hub-usage.conf，包含 CCH_URL 和 CCH_API_KEY。
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ ! -f "$CONFIG_FILE" ]]; then
  printf '错误：找不到配置文件：%s\n' "$CONFIG_FILE" >&2
  exit 2
fi

# 配置文件由用户维护，格式与现有 CC Hub 配置保持一致。
# shellcheck disable=SC1090
source "$CONFIG_FILE"

if [[ -z "${CCH_URL:-}" || -z "${CCH_API_KEY:-}" ]]; then
  printf '错误：配置文件必须设置 CCH_URL 和 CCH_API_KEY。\n' >&2
  exit 2
fi

CCH_URL="${CCH_URL%/}"
START_DATE="${1:-$(date +%F)}"
END_DATE="${2:-$START_DATE}"

if [[ ! "$START_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ || \
      ! "$END_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  printf '错误：日期必须使用 YYYY-MM-DD 格式。\n' >&2
  exit 2
fi

if ! command -v curl >/dev/null 2>&1; then
  printf '错误：找不到 curl。\n' >&2
  exit 2
fi

OUTPUT_DIR="${CCH_RAW_OUTPUT_DIR:-$SCRIPT_DIR/../cc-hub-raw-$(date +%Y%m%d-%H%M%S)}"
if ! mkdir -m 700 -p "$OUTPUT_DIR"; then
  printf '错误：无法创建输出目录：%s\n' "$OUTPUT_DIR" >&2
  exit 1
fi

COOKIE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cc-hub-cookie.XXXXXX")"
COOKIE_JAR="$COOKIE_DIR/cookies.txt"
cleanup() {
  rm -f "$COOKIE_JAR"
  rmdir "$COOKIE_DIR" 2>/dev/null || true
}
trap cleanup EXIT

request_with_body() {
  local url="$1"
  local body_file="$2"
  local response status body

  if ! response="$(curl -sS -L --max-time 60 \
      -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
      -H 'Accept: application/json' \
      -H 'Content-Type: application/json' \
      --data-binary @- \
      -w $'\n%{http_code}' \
      "$url" <<<"$(printf '{"key":"%s"}' "$CCH_API_KEY")")"; then
    printf '错误：无法连接：%s\n' "$url" >&2
    return 1
  fi

  status="${response##*$'\n'}"
  body="${response%$'\n'*}"
  printf '%s' "$body" >"$body_file"
  printf '%s' "$status"
}

request_get() {
  local name="$1"
  local path="$2"
  local output_file="$OUTPUT_DIR/$name.json"
  local response status body

  if ! response="$(curl -sS -L --max-time 60 \
      -b "$COOKIE_JAR" \
      -H 'Accept: application/json' \
      -w $'\n%{http_code}' \
      "$CCH_URL$path")"; then
    printf '错误：无法连接：%s\n' "$CCH_URL$path" >&2
    return 1
  fi

  status="${response##*$'\n'}"
  body="${response%$'\n'*}"
  printf '%s' "$body" >"$output_file"
  chmod 600 "$output_file"

  if [[ ! "$status" =~ ^2[0-9]{2}$ ]]; then
    printf '错误：%s 返回 HTTP %s，原始响应已保存：%s\n' "$path" "$status" "$output_file" >&2
    return 1
  fi
  printf '已保存：%s (HTTP %s)\n' "$output_file" "$status"
}

LOGIN_FILE="$OUTPUT_DIR/login.json"
LOGIN_STATUS="$(request_with_body "$CCH_URL/api/auth/login" "$LOGIN_FILE")" || exit 1
chmod 600 "$LOGIN_FILE"
if [[ ! "$LOGIN_STATUS" =~ ^2[0-9]{2}$ ]]; then
  printf '错误：登录失败，HTTP %s，原始响应已保存：%s\n' "$LOGIN_STATUS" "$LOGIN_FILE" >&2
  exit 1
fi
if ! grep -q '[[:space:]]auth-token[[:space:]]' "$COOKIE_JAR"; then
  printf '错误：登录返回成功，但没有收到 auth-token Cookie。\n' >&2
  printf '原始登录响应：%s\n' "$LOGIN_FILE" >&2
  exit 1
fi
printf '登录成功，原始响应已保存：%s\n' "$LOGIN_FILE"

request_get quota '/api/v1/me/quota'
request_get today '/api/v1/me/today'
request_get stats-summary \
  "/api/v1/me/usage-logs/stats-summary?startDate=$START_DATE&endDate=$END_DATE"
request_get usage-logs \
  "/api/v1/me/usage-logs?startDate=$START_DATE&endDate=$END_DATE&limit=100"

printf '\n原始数据目录：%s\n' "$OUTPUT_DIR"
