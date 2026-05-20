#!/usr/bin/env bash
set -euo pipefail

DEFAULT_CODEX_BIN="$(command -v codex 2>/dev/null || true)"
CODEX_BIN="${CODEX_BIN:-${DEFAULT_CODEX_BIN:-codex}}"

exec "${CODEX_BIN}" remote-control
