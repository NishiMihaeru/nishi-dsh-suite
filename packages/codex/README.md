# nishi-dsh-codex

Independent Codex integration package for Nishi DSH Suite.

It preserves the accepted DSH rc.2 Codex subagent lifecycle, package-local managed Codex runtime resolution, Codex primary-history bridge, read-only Project Memory access, and the Codex-native web-search backend seam.

## Runtime boundaries

- DSH subagent provider ID: `codex`
- primary provider: `codex-app-server` (vendored source snapshot from `wingoo/codex-plugin-dsh` @ `79fe7503390d641680bad8efade52782a3c31ced`, MIT License, not an official OpenAI plugin)
- Codex runtime: the user's installed official `codex` CLI, located through `DSH_CODEX_EXECUTABLE` or `PATH`; no `@openai/codex*` package is bundled
- native Codex authentication remains vendor-owned
- native Codex memory and project-doc injection are suppressed in the app-server invocation the primary owns, with `memories.use_memories=false`, `memories.generate_memories=false`, and `project_doc_max_bytes=0`, so DSH project memory is the only durable memory a turn sees
- `CODEX-GLOBAL-AGENTS-001` remains `ACCEPTED_WITH_KNOWN_UPSTREAM_DEBT`

This package does **not** register Antigravity and does **not** register the model-facing `web_search` tool. The `./web-search-backend` export is consumed by `nishi-dsh-primary-web-search`.

No credentials, API keys, session tokens, or authentication databases are copied or bundled.
