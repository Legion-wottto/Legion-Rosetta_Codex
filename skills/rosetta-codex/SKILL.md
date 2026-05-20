---
name: rosetta-codex
description: Launch, stop, inspect, or probe the Legion Rosetta Codex runtime host. Use when the user asks to start the Codex remote-host, check host status, inspect remote-control enrollment state, run the localhost emulator, stop a running host, or probe the app-server websocket endpoint. The host must be running in the current project directory.
---

# Rosetta Codex

Toolkit for launching and inspecting the Codex Linux remote-control host.

## Locate the project root

Check in order, use the first path that contains `Executable/Finished Item/runtime_host.py`:

1. The current working directory
2. Walk upward from cwd until the file is found or the filesystem root is reached

If the project root cannot be found, tell the user and stop.

Set:
```
EXEC="<root>/Executable/Finished Item"
MANIFEST="$EXEC/examples/codex-remote-host/bridge-app.json"
```

## Launch the app-server host (default)

`runtime_host.py` daemonizes the child process and returns immediately. Run it normally — no `&` needed.

```bash
python3 "$EXEC/runtime_host.py" launch "$MANIFEST"
```

Output confirms the PID. The app-server listens at `ws://127.0.0.1:8765`.

## Launch variants

```bash
# Real remote-control mode (enrolls outbound to chatgpt.com)
python3 "$EXEC/runtime_host.py" launch "$MANIFEST" --runtime codex-remote-control

# Localhost emulator lane (emulator must be started first)
python3 "$EXEC/runtime_host.py" launch "$MANIFEST" --runtime codex-remote-control-localhost
```

## Start the localhost emulator

The emulator is a foreground process — background it with `&`:

```bash
node "$EXEC/codex_remote_control_emulator.mjs" &
EMULATOR_PID=$!
echo "emulator pid=$EMULATOR_PID"
```

It listens at `http://127.0.0.1:8787/backend-api`. After it starts, launch the `codex-remote-control-localhost` runtime to point Codex at it.

## Stop the active host

```bash
python3 "$EXEC/runtime_host.py" stop
```

## Check status

```bash
python3 "$EXEC/runtime_host.py" status
```

Reports active instance PID, runtime name, health, and log paths.

## Inspect enrollment state

```bash
python3 "$EXEC/codex_remote_control_inspect.py"
```

Reads `~/.codex/state_5.sqlite`. Healthy real enrollment shows `scheme: wss`, `host: chatgpt.com`. Localhost emulator enrollment shows `host: 127.0.0.1`. No rows means `codex remote-control` has not been run yet.

## Probe the app-server endpoint

```bash
node "$EXEC/codex_bridge_client.mjs" probe
```

Connects, runs the `initialize` / `initialized` handshake, and prints the result. Run this after launching the app-server to confirm it is healthy.

## Available runtimes

```bash
python3 "$EXEC/runtime_host.py" list-runtimes
```
