# nishi-dsh-codex-usage-source

Official local Codex app-server adapter used by Nishi DSH Suite to read account rate-limit state.

It starts the installed official `codex` CLI in app-server mode, performs only the initialize + `account/rateLimits/read` JSON-RPC lifecycle, and shuts the process down. It does not create threads, send model prompts, copy credentials, parse token databases, or use a custom HTTP authentication flow.
