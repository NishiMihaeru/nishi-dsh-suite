# Provider Package Split Design

## Status

Approved in chat on 2026-08-26. This design replaces the earlier `codex-antigravity` combined package boundary in the public migration branch.

## Goal

Split provider implementations into independent npm packages while keeping one shared primary-routed `web_search` tool and preserving already accepted provider behavior.

## Package layout

```text
packages/
├─ codex/
│  └─ nishi-dsh-codex
├─ antigravity/
│  └─ nishi-dsh-antigravity
├─ claude-code/
│  └─ nishi-dsh-claude-code
└─ primary-web-search/
   └─ nishi-dsh-primary-web-search
```

The aggregate Market-visible Suite remains a separate composition package and depends on these runtime packages.

## `nishi-dsh-codex`

Owns only Codex-specific runtime behavior:

- Codex subagent provider `codex`;
- Codex primary compatibility/history bridge for provider `codex-app-server`;
- package-local managed `@openai/codex@0.147.0` runtime resolution;
- Codex Project Memory read-only bridge;
- Codex-native web-search backend implementation exported for the shared search package;
- Codex deterministic and live tests.

It must not register Antigravity and must not contain Antigravity CLI integration.

## `nishi-dsh-antigravity`

Owns only Antigravity-specific runtime behavior:

- Antigravity primary provider `antigravity-cli`;
- Antigravity subagent provider `antigravity`;
- official `agy` process boundary;
- Antigravity Project Memory bootstrap/read-only behavior;
- Antigravity-native `search_web` backend exported for the shared search package;
- Antigravity deterministic and live tests.

It must not depend on `@openai/codex` or `@openai/codex-sdk`.

## `nishi-dsh-claude-code`

Remains an independent Claude Code subagent package:

- provider ID `claude-code`;
- `@anthropic-ai/claude-agent-sdk@0.3.220`;
- default model `claude-sonnet-5`;
- default effort `high`;
- default permission mode `auto`;
- read-only Project Memory MCP bridge;
- official SDK/process ownership boundary.

## `nishi-dsh-primary-web-search`

Owns the single model-facing tool `web_search`.

Responsibilities:

- resolve the active primary provider/model from the current DSH session on every call;
- dispatch `codex-app-server` routes to the Codex backend;
- dispatch `antigravity-cli` routes to the Antigravity backend;
- return `WEB_SEARCH_UNSUPPORTED` for all other providers;
- preserve current result normalization, presentation, source dedupe, truncation, query batching, and error semantics;
- never call `ctx.web.search`;
- never use DeepSeek, Exa, Perplexity, or `DEEPSEEK_API_KEY` as fallback.

The package must not duplicate provider implementations. It consumes backend interfaces from the provider packages and registers exactly one `web_search` tool.

## Dependency direction

The dependency graph is intentionally one-way:

```text
nishi-dsh-primary-web-search
  ├─ depends on nishi-dsh-codex
  └─ depends on nishi-dsh-antigravity

nishi-dsh-codex        ─┐
nishi-dsh-antigravity  ├─ do not depend on primary-web-search
nishi-dsh-claude-code  ┘
```

Provider packages remain independently installable and testable. Installing only a provider package must not register `web_search`.

The Suite package later composes all four packages plus Project Memory and Usage Limits.

## Public exports

### Codex

```text
nishi-dsh-codex
nishi-dsh-codex/invariant
nishi-dsh-codex/web-search-backend
nishi-dsh-codex/package.json
```

### Antigravity

```text
nishi-dsh-antigravity
nishi-dsh-antigravity/invariant
nishi-dsh-antigravity/web-search-backend
nishi-dsh-antigravity/package.json
```

### Primary web search

```text
nishi-dsh-primary-web-search
nishi-dsh-primary-web-search/package.json
```

Backend exports are implementation seams for the Suite/search composition, not model-facing tools.

## Behavior preservation

This split is a packaging/refactoring change, not a provider behavior rewrite.

Preserve:

- provider IDs and model IDs;
- Codex managed runtime resolution and memory suppression policy;
- accepted global `AGENTS` upstream debt;
- Antigravity official `agy` boundary and no dangerous permission skip;
- DSH-owned cancellation/process-tree semantics;
- Project Memory read-only behavior;
- current web-search routing and no-fallback semantics;
- vendor-owned authentication and credentials.

No provider package installs vendor clients, copies credentials, parses token databases, or manages alternate vendor homes.

## Tests

The existing combined package tests are split by ownership:

- Codex-only tests move to `packages/codex/test` and `test-live`;
- Antigravity-only tests move to `packages/antigravity/test` and `test-live`;
- routing/presentation/composition tests move to `packages/primary-web-search/test`;
- Orchestrator integration assertions remain deferred to the Orchestrator migration task;
- package-distribution tests assert the new package names and that Antigravity has no OpenAI dependency.

The deterministic acceptance gate is:

```text
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
```

GitHub Actions being blocked by the account billing lock is an external verification blocker, not permission to claim these gates passed.

## Migration rule

The existing `packages/codex-antigravity` package is transitional and must be removed after its owned files/tests have been redistributed. The final Suite dependency graph must contain no `nishi-dsh-codex-antigravity` package and no compatibility wrapper with that name.
