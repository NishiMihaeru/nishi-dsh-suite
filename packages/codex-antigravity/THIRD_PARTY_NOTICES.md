# Third-Party Notices

This package (`nishi-dsh-codex-antigravity`) is a repository-maintained intentional extension and derivative work based on `@deepseek-ai/dsh-subagent-codex@0.1.1-rc.2` from the DeepSeek Harness project (`deepseek-ai/deepseek-harness`).

## DeepSeek Harness Derivative Provenance

- **Upstream Project:** DeepSeek Harness (`deepseek-ai/deepseek-harness`)
- **Baseline Package:** `@deepseek-ai/dsh-subagent-codex@0.1.1-rc.2`
- **Upstream License:** MIT
- **Copyright:** Copyright (c) 2026 DeepSeek

The original DeepSeek MIT notice is retained in full in this package's `LICENSE` file. This package is an intentional derivative that injects policy command-line overrides (`-c memories.use_memories=false`, `-c memories.generate_memories=false`, `-c project_doc_max_bytes=0`) into the Codex `app-server` launch arguments to suppress native generated memories, native memory injection, and repository/project `AGENTS.md` discovery while preserving the upstream JSON-RPC app-server lifecycle and native authentication.

## Authentication & State Safety Boundary

- **Authentication & State:** No credentials, API keys, session tokens, or authentication state are bundled, copied, or read by this package. Authentication remains product-native to Codex, official `agy`, and the host environment.
- **CODEX_HOME:** No `CODEX_HOME` environment override or credential directory manipulation is performed.
- **Antigravity:** The package invokes the official `agy` executable and does not extract or replay Google/Antigravity OAuth, cookie, keyring, or session material.
