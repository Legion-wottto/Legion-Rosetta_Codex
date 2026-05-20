#!/usr/bin/env bash
set -euo pipefail

DEFAULT_CODEX_BIN="$(command -v codex 2>/dev/null || true)"
CODEX_BIN="${CODEX_BIN:-${DEFAULT_CODEX_BIN:-codex}}"
CODEX_RC_EMULATOR_HOST="${CODEX_RC_EMULATOR_HOST:-127.0.0.1}"
CODEX_RC_EMULATOR_PORT="${CODEX_RC_EMULATOR_PORT:-8787}"
CODEX_RC_EMULATOR_BASE_PATH="${CODEX_RC_EMULATOR_BASE_PATH:-/backend-api}"

remote_base_url="http://${CODEX_RC_EMULATOR_HOST}:${CODEX_RC_EMULATOR_PORT}${CODEX_RC_EMULATOR_BASE_PATH}/"

exec "${CODEX_BIN}" -c "chatgpt_base_url=\"${remote_base_url}\"" remote-control
