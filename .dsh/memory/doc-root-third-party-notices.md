# Mirrored project documentation

Source: `THIRD_PARTY_NOTICES.md`
Mode: verbatim substantive content

---

# Third-Party Notices

Nishi DSH Suite includes migrated derivative provider code originally based on DeepSeek Harness packages.

## DeepSeek Harness

- Upstream: `deepseek-ai/deepseek-harness`
- Accepted migration baseline: `0.1.1-rc.2`
- License: MIT
- Copyright: Copyright (c) 2026 DeepSeek

Upstream MIT notices and permission terms are retained in package-local notices/licenses where derived code requires them.

## Anthropic Claude Code

The Claude usage/limits source drives the user's installed official Claude Code CLI (`claude`) as an external process. No Anthropic SDK, runtime, or model client is bundled or redistributed, and no Anthropic authentication material is copied. Users remain responsible for terms applicable to their Claude Code installation and account.

## OpenAI Codex

The Codex integration drives the user's installed official Codex CLI (`codex`) as an external process. No OpenAI runtime package is bundled or redistributed, and this repository does not redistribute vendor credentials or authentication stores.

## Codex Primary Provider Adapter (`codex-plugin-dsh`)

- Upstream: `wingoo/codex-plugin-dsh`
- Source snapshot commit: `79fe7503390d641680bad8efade52782a3c31ced`
- Author: wingoo
- License: MIT

`codex-plugin-dsh` provides the `codex-app-server` provider adapter that communicates with the local Codex App Server. `nishi-dsh-codex` incorporates the reviewed source snapshot from commit `79fe7503390d641680bad8efade52782a3c31ced` (open-source by wingoo, MIT License, not an official OpenAI plugin).

## Google Antigravity

The Antigravity integration executes the official `agy` client boundary. Account authentication remains owned by that client. The current third-party-harness policy boundary is documented as provider-policy ambiguous rather than represented as Google-approved.