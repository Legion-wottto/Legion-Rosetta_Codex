#!/usr/bin/env bash
set -euo pipefail

DEFAULT_CODEX_BIN="$(command -v codex 2>/dev/null || true)"
CODEX_BIN="${CODEX_BIN:-${DEFAULT_CODEX_BIN:-codex}}"
CODEX_APP_SERVER_LISTEN="${CODEX_APP_SERVER_LISTEN:-ws://127.0.0.1:8765}"
CODEX_WS_AUTH="${CODEX_WS_AUTH:-}"
CODEX_WS_TOKEN_FILE="${CODEX_WS_TOKEN_FILE:-}"
CODEX_WS_SHARED_SECRET_FILE="${CODEX_WS_SHARED_SECRET_FILE:-}"
CODEX_WS_ISSUER="${CODEX_WS_ISSUER:-}"
CODEX_WS_AUDIENCE="${CODEX_WS_AUDIENCE:-}"

cmd=(
  "${CODEX_BIN}"
  app-server
  --listen "${CODEX_APP_SERVER_LISTEN}"
)

if [[ -n "${CODEX_WS_AUTH}" ]]; then
  cmd+=(--ws-auth "${CODEX_WS_AUTH}")
fi

if [[ -n "${CODEX_WS_TOKEN_FILE}" ]]; then
  cmd+=(--ws-token-file "${CODEX_WS_TOKEN_FILE}")
fi

if [[ -n "${CODEX_WS_SHARED_SECRET_FILE}" ]]; then
  cmd+=(--ws-shared-secret-file "${CODEX_WS_SHARED_SECRET_FILE}")
fi

if [[ -n "${CODEX_WS_ISSUER}" ]]; then
  cmd+=(--ws-issuer "${CODEX_WS_ISSUER}")
fi

if [[ -n "${CODEX_WS_AUDIENCE}" ]]; then
  cmd+=(--ws-audience "${CODEX_WS_AUDIENCE}")
fi

exec "${cmd[@]}"
