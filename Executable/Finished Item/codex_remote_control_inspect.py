#!/usr/bin/env python3
from __future__ import annotations

import json
import sqlite3
import urllib.parse
from pathlib import Path


STATE_DB = Path.home() / ".codex" / "state_5.sqlite"


def redact(value: str, keep: int = 8) -> str:
    if len(value) <= keep:
        return value
    return value[:keep]


def main() -> None:
    if not STATE_DB.exists():
        raise SystemExit(f"missing sqlite db: {STATE_DB}")

    con = sqlite3.connect(STATE_DB)
    rows = con.execute(
        """
        select websocket_url, account_id, app_server_client_name, server_id,
               environment_id, server_name, updated_at
        from remote_control_enrollments
        order by updated_at desc
        """
    ).fetchall()
    con.close()

    payload = []
    for websocket_url, account_id, client_name, server_id, environment_id, server_name, updated_at in rows:
        url = urllib.parse.urlparse(websocket_url)
        payload.append(
            {
                "scheme": url.scheme,
                "host": url.hostname,
                "path_len": len(url.path or ""),
                "has_query": bool(url.query),
                "account_id_prefix": redact(account_id),
                "client_name": client_name,
                "server_id_prefix": redact(server_id),
                "environment_id_prefix": redact(environment_id),
                "server_name": server_name,
                "updated_at": updated_at,
            }
        )

    print(json.dumps({"enrollments": payload}, indent=2))


if __name__ == "__main__":
    main()
