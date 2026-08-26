# nishi-dsh-codex-usage-source

Official local Codex app-server adapter used by Nishi DSH Suite to read account rate-limit state.

It starts the package-pinned `@openai/codex@0.147.0` app-server, performs only the initialize + `account/rateLimits/read` JSON-RPC lifecycle, and shuts the process down. It does not create threads, send model prompts, copy credentials, parse token databases, or use a custom HTTP authentication flow.
