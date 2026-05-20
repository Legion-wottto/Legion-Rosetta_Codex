#!/usr/bin/env bash
set -euo pipefail

CLIENT_BIN="${CLIENT_BIN:-node}"
CLIENT_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

exec "${CLIENT_BIN}" "${CLIENT_SCRIPT_DIR}/codex_bridge_client.mjs" "$@"
