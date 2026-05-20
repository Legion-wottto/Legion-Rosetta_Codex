#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


BASE = Path(__file__).resolve().parent
STATE_DIR = BASE / "state"
LOG_DIR = STATE_DIR / "logs"
TEMPLATES_DIR = BASE / "templates"
RUNTIMES_PATH = BASE / "runtimes.json"
ACTIVE_STATE_PATH = STATE_DIR / "active-instance.json"


def ensure_dirs() -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, payload: Any) -> None:
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with tmp_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")
    tmp_path.replace(path)


def load_runtimes() -> dict[str, Any]:
    data = load_json(RUNTIMES_PATH)
    items = data.get("runtimes", [])
    by_name: dict[str, Any] = {}
    for item in items:
        by_name[item["name"]] = item
    return by_name


def load_app_manifest(path: Path) -> dict[str, Any]:
    data = load_json(path)
    required = ["app_id", "app_name", "entry_url", "window"]
    missing = [key for key in required if key not in data]
    if missing:
        raise SystemExit(f"manifest missing keys: {', '.join(missing)}")
    return data


def load_active_state() -> dict[str, Any] | None:
    if not ACTIVE_STATE_PATH.exists():
        return None
    return load_json(ACTIVE_STATE_PATH)


def pid_is_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def poll_state(state: dict[str, Any] | None) -> dict[str, Any] | None:
    if state is None:
        return None
    pid = state.get("pid")
    alive = isinstance(pid, int) and pid_is_alive(pid)
    state["healthy"] = bool(alive)
    state["status"] = "running" if alive else "dead"
    return state


def runtime_by_name(name: str) -> dict[str, Any]:
    runtimes = load_runtimes()
    if name not in runtimes:
        raise SystemExit(f"unknown runtime: {name}")
    return runtimes[name]


def expand_value(value: str, context: dict[str, str]) -> str:
    return value.format(**context)


def default_runtime_name(app: dict[str, Any]) -> str:
    return str(app.get("preferred_runtime") or "codex-app-server-ws")


def build_launch_plan(app_path: Path, runtime_name: str | None) -> dict[str, Any]:
    app_path = app_path.resolve()
    app = load_app_manifest(app_path)
    runtime = runtime_by_name(runtime_name or default_runtime_name(app))

    app_dir = app_path.parent
    context = {
        "runtime_root": str(RUNTIMES_PATH.parent.resolve()),
        "app_dir": str(app_dir),
        "app_manifest": str(app_path),
        "app_id": str(app["app_id"]),
        "app_name": str(app["app_name"]),
    }
    raw_runtime_dir = expand_value(str(runtime["cwd"]), context)
    runtime_dir = Path(raw_runtime_dir).expanduser()
    if not runtime_dir.is_absolute():
        runtime_dir = (RUNTIMES_PATH.parent / runtime_dir).resolve()
    else:
        runtime_dir = runtime_dir.resolve()

    entry_url = str(app["entry_url"])
    window = app["window"]
    context.update(
        {
            "runtime_dir": str(runtime_dir),
            "entry_url": entry_url,
            "window_title": str(window.get("title") or app["app_name"]),
            "window_width": str(window.get("width") or 1360),
            "window_height": str(window.get("height") or 900),
        }
    )

    command = [expand_value(part, context) for part in runtime["command"]]
    env = os.environ.copy()
    for key, value in runtime.get("env", {}).items():
        env[key] = expand_value(str(value), context)

    plan = {
        "app": app,
        "app_manifest": str(app_path),
        "runtime": runtime["name"],
        "runtime_notes": runtime.get("notes", ""),
        "cwd": str(runtime_dir),
        "command": command,
        "env": {key: env[key] for key in runtime.get("env", {})},
    }
    return plan


def write_active_state(plan: dict[str, Any], pid: int, started_at: int, stdout_path: Path, stderr_path: Path) -> None:
    state = {
        "app_id": plan["app"]["app_id"],
        "app_name": plan["app"]["app_name"],
        "app_manifest": plan["app_manifest"],
        "runtime": plan["runtime"],
        "runtime_notes": plan["runtime_notes"],
        "pid": pid,
        "started_at": started_at,
        "cwd": plan["cwd"],
        "command": plan["command"],
        "env": plan["env"],
        "log_stdout": str(stdout_path),
        "log_stderr": str(stderr_path),
        "healthy": True,
        "status": "running",
    }
    write_json(ACTIVE_STATE_PATH, state)


def launch_app(app_manifest: str, runtime_name: str | None) -> None:
    ensure_dirs()
    active = poll_state(load_active_state())
    if active and active.get("healthy"):
        raise SystemExit(f"instance already active: {active['app_name']} on {active['runtime']}")

    plan = build_launch_plan(Path(app_manifest), runtime_name)
    started_at = int(time.time())
    slug = f"{plan['app']['app_id']}-{plan['runtime']}-{started_at}"
    stdout_path = LOG_DIR / f"{slug}.out.log"
    stderr_path = LOG_DIR / f"{slug}.err.log"

    with stdout_path.open("ab") as stdout_handle, stderr_path.open("ab") as stderr_handle:
        proc = subprocess.Popen(
            plan["command"],
            cwd=plan["cwd"],
            env={**os.environ, **plan["env"]},
            stdin=subprocess.DEVNULL,
            stdout=stdout_handle,
            stderr=stderr_handle,
            start_new_session=True,
        )

    write_active_state(plan, proc.pid, started_at, stdout_path, stderr_path)
    print(f"launched {plan['app']['app_name']} via {plan['runtime']} pid={proc.pid}")


def stop_active() -> None:
    ensure_dirs()
    active = load_active_state()
    if not active:
        print("no active instance")
        return

    pid = active.get("pid")
    if isinstance(pid, int) and pid_is_alive(pid):
        os.killpg(pid, signal.SIGTERM)
        deadline = time.time() + 5
        while time.time() < deadline:
            if not pid_is_alive(pid):
                break
            time.sleep(0.1)
        if pid_is_alive(pid):
            os.killpg(pid, signal.SIGKILL)

    active["healthy"] = False
    active["status"] = "stopped"
    active["stopped_at"] = int(time.time())
    write_json(ACTIVE_STATE_PATH, active)
    print(f"stopped {active['app_name']} on {active['runtime']}")


def switch_runtime(app_manifest: str, runtime_name: str) -> None:
    active = poll_state(load_active_state())
    if active and active.get("healthy"):
        stop_active()
    launch_app(app_manifest, runtime_name)


def status() -> None:
    ensure_dirs()
    active = poll_state(load_active_state())
    payload = {
        "active": active,
        "available_runtimes": sorted(load_runtimes().keys()),
    }
    print(json.dumps(payload, indent=2, sort_keys=True))


def list_runtimes() -> None:
    for name, runtime in sorted(load_runtimes().items()):
        print(f"{name}: {runtime.get('notes', '')}")


def print_plan(app_manifest: str, runtime_name: str | None) -> None:
    plan = build_launch_plan(Path(app_manifest), runtime_name)
    print(json.dumps(plan, indent=2, sort_keys=True))


def init_app(target_dir: str, app_name: str, app_id: str, entry_url: str, runtime_name: str) -> None:
    ensure_dirs()
    target = Path(target_dir).expanduser().resolve()
    target.mkdir(parents=True, exist_ok=True)
    manifest_path = target / "bridge-app.json"
    if manifest_path.exists():
        raise SystemExit(f"manifest already exists: {manifest_path}")

    payload = {
        "app_id": app_id,
        "app_name": app_name,
        "preferred_runtime": runtime_name,
        "entry_url": entry_url,
        "window": {
            "title": app_name,
            "width": 1360,
            "height": 900,
        },
        "bridge": {
            "owner": "Runtime Host",
            "version": 1,
        },
    }
    write_json(manifest_path, payload)
    print(f"created {manifest_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Codex remote host runtime launcher")
    sub = parser.add_subparsers(dest="cmd", required=True)

    list_parser = sub.add_parser("list-runtimes")
    list_parser.set_defaults(cmd="list-runtimes")

    status_parser = sub.add_parser("status")
    status_parser.set_defaults(cmd="status")

    stop_parser = sub.add_parser("stop")
    stop_parser.set_defaults(cmd="stop")

    init_parser = sub.add_parser("init-app")
    init_parser.add_argument("target_dir")
    init_parser.add_argument("--name", required=True)
    init_parser.add_argument("--app-id", required=True)
    init_parser.add_argument("--entry-url", required=True)
    init_parser.add_argument("--runtime", default="codex-app-server-ws")

    plan_parser = sub.add_parser("plan")
    plan_parser.add_argument("app_manifest")
    plan_parser.add_argument("--runtime")

    launch_parser = sub.add_parser("launch")
    launch_parser.add_argument("app_manifest")
    launch_parser.add_argument("--runtime")

    switch_parser = sub.add_parser("switch-runtime")
    switch_parser.add_argument("app_manifest")
    switch_parser.add_argument("runtime")

    args = parser.parse_args()
    if args.cmd == "list-runtimes":
        list_runtimes()
    elif args.cmd == "status":
        status()
    elif args.cmd == "stop":
        stop_active()
    elif args.cmd == "init-app":
        init_app(args.target_dir, args.name, args.app_id, args.entry_url, args.runtime)
    elif args.cmd == "plan":
        print_plan(args.app_manifest, args.runtime)
    elif args.cmd == "launch":
        launch_app(args.app_manifest, args.runtime)
    elif args.cmd == "switch-runtime":
        switch_runtime(args.app_manifest, args.runtime)
    else:
        raise SystemExit(f"unsupported command: {args.cmd}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
