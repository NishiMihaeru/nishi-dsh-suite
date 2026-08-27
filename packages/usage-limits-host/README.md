# nishi-dsh-usage-limits-host

Host-lifetime Usage & Limits integration for Nishi DSH Suite.

This package owns the DSH host service, safe RPC projection, browser Usage & Limits UI, Model Accounts status UI, and local collector composition. It intentionally does **not** expose vendor OAuth/session/token material to the browser.

## Runtime dependencies

The package value-imports and therefore installs exact prerelease versions of:

- `nishi-dsh-usage-limits` — normalized public usage contract and collectors;
- `nishi-dsh-provider-kit` — shared vendor CLI runtime, including the official Codex app-server rate-limit source and the official Claude CLI usage/limits source.

DeepSeek Harness platform packages remain peer dependencies so the plugin shares the host's rc.2 Cordis/services rather than installing duplicate framework instances.

## Browser surface

The browser entry registers:

- `Usage & Limits` in the sidebar/settings surfaces;
- `Model Accounts` as a status/removal surface for supported vendor-owned authentication state.

Direct subscription OAuth is not initiated by this package. Codex, Claude, and Antigravity authentication remains owned by their vendor clients.

## Safety properties

- public usage DTOs are parsed through `nishi-dsh-usage-limits` before crossing RPC;
- malformed requests return generic `bad-request` errors;
- host exceptions are reduced to generic internal errors rather than leaking local paths, tokens, stderr, or raw provider payloads;
- legacy OAuth grants may be removed, but are never copied or replayed by the browser integration.

Compatibility target: DeepSeek Harness `0.1.1-rc.2`, Node.js 24.
