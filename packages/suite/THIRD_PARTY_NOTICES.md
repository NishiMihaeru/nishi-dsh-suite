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

## Google Antigravity

The Antigravity integration executes the `agy` client boundary. Account authentication remains owned by that client. The third-party-harness policy boundary is documented as provider-policy ambiguous rather than represented as Google-approved.
