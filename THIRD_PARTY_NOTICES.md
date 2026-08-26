# Third-Party Notices

Nishi DSH Suite includes migrated derivative provider code originally based on DeepSeek Harness packages.

## DeepSeek Harness

- Upstream: `deepseek-ai/deepseek-harness`
- Accepted migration baseline: `0.1.1-rc.2`
- License: MIT
- Copyright: Copyright (c) 2026 DeepSeek

Upstream MIT notices and permission terms are retained in package-local notices/licenses where derived code requires them.

## Anthropic Claude Agent SDK

The Claude Code integration uses `@anthropic-ai/claude-agent-sdk` as a runtime dependency. This repository does not copy Anthropic SDK source code. Users remain responsible for terms applicable to their Claude Code/SDK installation and account.

## OpenAI Codex

The Codex integration depends on official OpenAI Codex packages and/or the installed official Codex client. This repository does not redistribute vendor credentials or authentication stores.

## External Codex Primary Provider Plugin (`codex-plugin-dsh`)

- Upstream: `wingoo/codex-plugin-dsh`
- Pinned commit: `79fe7503390d641680bad8efade52782a3c31ced`
- Author: wingoo
- License: MIT

`codex-plugin-dsh` provides the `codex-app-server` provider adapter that communicates with the local Codex App Server. It is an open-source external plugin by wingoo and is not an official OpenAI plugin.

## Google Antigravity

The Antigravity integration executes the official `agy` client boundary. Account authentication remains owned by that client. The current third-party-harness policy boundary is documented as provider-policy ambiguous rather than represented as Google-approved.
