# CachyOS Codex primary acceptance — 2026-08-26

Status: **PASS**

Accepted commit under test: `c1b4b38cd3bf41ed72087e1990ac200e8dd0c969` (`fix: harden Codex primary release composition`).

Environment reported by the executed local acceptance:

- OS: CachyOS Linux x86_64
- Node.js: 24.19.0
- pnpm: 11.21.0
- DeepSeek Harness: 0.1.1-rc.2
- managed Codex runtime: `@openai/codex@0.147.0`
- primary provider id: `codex-app-server`

This note records executed local evidence supplied from the CachyOS test environment. It is not inferred from static repository inspection.

## Release-composition fix

The initial external Git dependency approach was rejected during release review. A clean packed-profile install demonstrated two problems:

1. pnpm v11 rejects the exotic Git dependency when it appears as a dependency of the published `nishi-dsh-codex` package (`ERR_PNPM_EXOTIC_SUBDEP`);
2. the upstream package's broad DSH ranges (`>=0.1.0-rc.5 <0.2.0`) resolve an older nested `@deepseek-ai/*@0.1.0-rc.8` graph outside the repository-root overrides.

The accepted composition therefore vendors the seven runtime source files from the reviewed MIT-licensed `wingoo/codex-plugin-dsh` snapshot at commit `79fe7503390d641680bad8efade52782a3c31ced` under `packages/codex/src/codex-plugin-dsh/` and compiles them inside `nishi-dsh-codex` against the Suite's DSH `0.1.1-rc.2` peer graph.

The repository-level broad DSH overrides were removed. `nishi-dsh-codex` explicitly declares the full Cordis service contract needed by the embedded adapter, including `sessions` and `attachments`, and pins `@deepseek-ai/dsh-session` plus `@deepseek-ai/dsh-attachment` peers to `0.1.1-rc.2`.

Provenance remains documented as:

- upstream: `wingoo/codex-plugin-dsh`
- source snapshot: `79fe7503390d641680bad8efade52782a3c31ced`
- license: MIT
- not an official OpenAI plugin

## Deterministic gate

Executed under Node 24:

```text
pnpm verify:local
```

Result: **PASS**.

The reported run included release-family verification, package contracts, Orchestrator validation, TypeScript checks, unit tests, builds, and all nine local tarball artifacts. The Codex package included 27 passing unit tests.

## Fresh Suite-only profile

A new disposable `DSH_HOME` was used. Only `nishi-dsh-suite-0.1.0-rc.1.tgz` was installed; no separate `codex-plugin-dsh` installation was performed.

Observed:

- `nishi-codex` mounted successfully;
- `codex-app-server` registration count: exactly 1;
- no `openai-codex` fallback owned by Nishi;
- the fresh profile lock graph contained no `codex-plugin-dsh` package and no nested `@deepseek-ai/*@0.1.0-rc.*` dependencies;
- DSH dependencies used by the installed Suite resolved to `0.1.1-rc.2`;
- `nishi-dsh-codex` resolved its package-managed `@openai/codex@0.147.0` runtime.

`dsh web --dump-config` completed successfully.

## Live Codex gates

### Primary

Provider: `codex-app-server`  
Model: `gpt-5.6-sol`

Prompt:

```text
Ответь ровно CODEX_PRIMARY_OK
```

Observed response:

```text
CODEX_PRIMARY_OK
```

Result: **PASS**.

The route used native Codex App Server product authentication. No DSH `openai-codex` OAuth/API-key fallback was used.

### Subagent

`subagent_codex` completed a bounded delegated prompt and returned `CODEX_SUBAGENT_OK` with `stopReason: completed`.

Result: **PASS**.

### Project Memory

A project-memory sentinel was read through the accepted child memory reader. The memory file SHA-256 before and after the child run was identical.

Result: **PASS for the Codex child path**.

### Routed web search

`DEEPSEEK_API_KEY` was unset. `CodexSearchBackend` returned eight structured sources and no DeepSeek/Exa/Perplexity fallback was observed.

Result: **PASS**.

### Usage source

`OfficialCodexRateLimitsSource` successfully read ChatGPT Plus rate-limit state from the local Codex App Server.

Result: **PASS**.

## Uninstall / preservation

The managed Orchestrator preset was removed, then `nishi-dsh-suite` was uninstalled from the disposable profile.

Observed:

- Suite-owned `nishi-*` rows removed;
- `codex-app-server` removed with the Suite;
- Project Memory unchanged;
- real user `~/.dsh` unchanged;
- vendor-owned Codex authentication/configuration unchanged;
- temporary profile deleted.

Result: **PASS**.

## Remaining scope

This acceptance closes the CachyOS Codex primary/subagent/search row. It does not mark Claude Code or Antigravity live gates as passing, and does not replace independent Windows acceptance. GitHub Actions remain blocked by the account billing issue, and automatic third-party packaged-preset discovery remains upstream issue #2.
