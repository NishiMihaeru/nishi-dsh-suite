# Third-Party Notices

Nishi DSH Suite composes migrated derivative provider integrations originally based on DeepSeek Harness packages.

## DeepSeek Harness

- Upstream: `deepseek-ai/deepseek-harness`
- Compatibility baseline: `0.1.1-rc.2`
- License: MIT
- Copyright: Copyright (c) 2026 DeepSeek

Upstream MIT notices and permission terms are retained in the leaf packages that contain derived code.

## Anthropic Claude Agent SDK

The Claude Code integration uses `@anthropic-ai/claude-agent-sdk` as a runtime dependency. This bundle does not copy Anthropic SDK source code or authentication material.

## OpenAI Codex

The Codex integrations depend on official OpenAI Codex packages and the user's vendor-owned authentication state. This bundle does not redistribute vendor credentials or authentication stores.

## Codex Primary Provider Adapter (`codex-plugin-dsh`)

- Upstream: `wingoo/codex-plugin-dsh`
- Source snapshot commit: `79fe7503390d641680bad8efade52782a3c31ced`
- Author: wingoo
- License: MIT

`codex-plugin-dsh` provides the `codex-app-server` provider adapter that integrates with the local Codex App Server. `nishi-dsh-codex` incorporates the reviewed source snapshot from commit `79fe7503390d641680bad8efade52782a3c31ced` (open-source by wingoo, MIT License, not an official OpenAI plugin).

## Google Antigravity

The Antigravity integration executes the `agy` client boundary. Account authentication remains owned by that client. The third-party-harness policy boundary is documented as provider-policy ambiguous rather than represented as Google-approved.
