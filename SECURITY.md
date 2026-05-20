# Security

## Scope

This repository operates around a live Codex remote-control host boundary. Treat it as host tooling, not a toy demo.

## Sensitive material

Do not publish:

- `~/.codex/auth.json`
- `~/.codex/state_5.sqlite`
- live enrollment records
- websocket targets or headers that expose secrets
- copied logs containing prompt content or machine-specific data

## Reporting

If you find a security issue in this repository, open a private report with:

- affected file or component
- impact
- reproduction steps
- whether the issue touches real Codex enrollment, auth, or local state persistence

## Hard rule

Never commit generated state from `Executable/Finished Item/state/` other than the placeholder file used to keep the directory present.
