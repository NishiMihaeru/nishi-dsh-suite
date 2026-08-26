# CachyOS remaining live-provider acceptance — 2026-08-26

Status: **SUPERSEDED BY FINAL PASS**

This record captured the intermediate Node 24 live-provider state before normal Claude Code authentication and the official `agy` runtime became available. Its executed Usage & Limits and missing-client-isolation evidence remains valid, but the provider blockers recorded here were later cleared.

Final authenticated CachyOS live acceptance is recorded in:

- `docs/acceptance/2026-08-26-cachyos-final-live.md`

Executed intermediate environment:

- repository HEAD `6bbd600c352fdedc66497fde4b7b02fbc90c6584`;
- CachyOS Linux;
- Node `v24.19.0` through fnm;
- system `/usr/bin/node` remained `v22.23.2`;
- pnpm `11.21.0`;
- DSH `0.1.1-rc.2`.

## Intermediate evidence retained

- `pnpm verify:local`: PASS.
- Claude unauthenticated failure isolation: PASS.
- Antigravity inference missing-runtime isolation: PASS.
- Usage & Limits aggregate runtime/UI: PASS.
- browser projection/redaction: PASS.
- missing global Codex/Claude/agy startup isolation: PASS.
- Project Memory hashes remained unchanged.
- real `~/.dsh` and vendor auth/config remained untouched.

The former `BLOCKED_AUTH`, `BLOCKED_RUNTIME_MISSING`, and Project Memory aggregate `PENDING` statuses in this record are no longer current; see the final live acceptance record for the accepted state.
