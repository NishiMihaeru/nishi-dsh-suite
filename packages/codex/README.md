# nishi-dsh-codex

Independent Codex integration package for Nishi DSH Suite.

It contributes the Codex primary provider: the external Codex App Server bridge, the Codex primary-history bridge, and the Codex-native web-search backend seam. Delegation was removed in `0.1.0-rc.3`, so this package no longer registers a subagent provider and no longer reaches project memory itself — project memory is DSH's own tool surface, identical on every provider.

## Runtime boundaries

- primary provider: `codex-app-server` (vendored source snapshot from `wingoo/codex-plugin-dsh` @ `79fe7503390d641680bad8efade52782a3c31ced`, MIT License, not an official OpenAI plugin)
- Codex runtime: the user's installed official `codex` CLI, located through `DSH_CODEX_EXECUTABLE` or `PATH`; no `@openai/codex*` package is bundled
- native Codex authentication remains vendor-owned
- native Codex memory and project-doc injection are suppressed in the app-server invocation the primary owns, with `memories.use_memories=false`, `memories.generate_memories=false`, and `project_doc_max_bytes=0`, so DSH project memory is the only durable memory a turn sees
- `CODEX-GLOBAL-AGENTS-001` remains `ACCEPTED_WITH_KNOWN_UPSTREAM_DEBT`

This package does **not** register Antigravity and does **not** register the model-facing `web_search` tool: it contributes a search **backend** through its descriptor, and the core owns the tool, the routing and the result contract.

No credentials, API keys, session tokens, or authentication databases are copied or bundled.
