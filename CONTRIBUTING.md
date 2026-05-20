# Contributing

Keep changes narrow and testable.

## Principles

- Preserve Codex as the backend runtime.
- Prefer host-boundary tooling over UI rebuilds.
- Keep the real `chatgpt.com` enrollment path and the localhost emulator path clearly separate.
- Do not commit live state, logs, local enrollments, or machine-specific paths.

## Before opening a change

- Verify `codex` is available on `PATH`.
- Test only the lane you changed.
- Scrub any local usernames, home paths, thread ids, tokens, or enrollment URLs from examples and logs.

## Suggested checks

```bash
python3 "Executable/Finished Item/runtime_host.py" status
python3 "Executable/Finished Item/runtime_host.py" plan "Executable/Finished Item/examples/codex-remote-host/bridge-app.json"
"Executable/Finished Item/scripts/run-codex-remote-control-inspect.sh"
```

If you changed the emulator or bridge client, include the command you used and the observable result in the pull request.
