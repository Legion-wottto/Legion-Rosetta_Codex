Layout:

- `Documentation/`
  - notes for the Codex-focused remote host toolkit
- `Executable/Finished Item/runtime_host.py`
  - runtime host controller CLI for launch, stop, status, plan, and manifest init
- `Executable/Finished Item/runtimes.json`
  - runtime adapter registry for Codex host modes
- `Executable/Finished Item/examples/codex-remote-host/bridge-app.json`
  - sample manifest for a Codex remote host
- `Executable/Finished Item/scripts/run-codex-app-server-ws.sh`
  - explicit websocket app-server host wrapper
- `Executable/Finished Item/scripts/run-codex-remote-control.sh`
  - thin wrapper around `codex remote-control`
- `Executable/Finished Item/codex_remote_control_emulator.mjs`
  - localhost fake remote-control backend with enroll endpoint plus websocket server
- `Executable/Finished Item/codex_bridge_client.mjs`
  - dependency-free websocket client for initialize, remote status, thread start, turn start, and raw RPCs
- `Executable/Finished Item/codex_remote_control_inspect.py`
  - reads the persisted remote-control enrollment from `~/.codex/state_5.sqlite` and prints a redacted shape
- `Executable/Finished Item/scripts/run-codex-bridge-client.sh`
  - shell wrapper for the websocket bridge client
- `Executable/Finished Item/scripts/run-codex-remote-control-emulator.sh`
  - starts the localhost fake remote-control backend
- `Executable/Finished Item/scripts/run-codex-remote-control-localhost.sh`
  - runs `codex remote-control` against the localhost backend using `chatgpt_base_url`
- `Executable/Finished Item/scripts/run-codex-remote-control-inspect.sh`
  - shell wrapper for the enrollment inspector
- `Executable/Finished Item/state/`
  - active state and logs written by `runtime_host.py`

Runtime notes:

- `codex-app-server-ws`
  - starts `codex app-server` with an explicit websocket listener
  - best first target for a bridge client because the transport is explicit
- `codex-remote-control`
  - starts `codex remote-control` directly
  - useful for parity testing against Codex's own headless remote mode
- `codex-remote-control-localhost`
  - runs `codex remote-control` against the localhost emulator backend
  - useful for capturing the real remote-control websocket flow without touching chatgpt.com

Bridge scope:

- this target is the host-side remote bridge only
- it does not rebuild or proxy the full Codex desktop UI
- it keeps Codex as the backend runtime and provides a stable launch boundary

Current client scope:

- connect to a websocket app-server endpoint
- run the `initialize` / `initialized` handshake
- call `remoteControl/status/read`
- start a thread and persist the latest thread id in bridge state
- start a text turn on the latest thread
- send arbitrary raw RPCs for protocol exploration

Remote-control emulation note:

- the official mobile bridge is not a local `ws://127.0.0.1` listener on this host
- Codex persists a remote-control enrollment with a `wss://chatgpt.com/...` websocket target plus server and environment identities
- emulation work therefore needs to target the enrolled remote-control client path, not just plain `codex app-server --listen ws://...`
- the local emulator backend works by overriding `chatgpt_base_url` to `http://127.0.0.1:8787/backend-api/`, which Codex normalizes into local enroll and websocket endpoints
