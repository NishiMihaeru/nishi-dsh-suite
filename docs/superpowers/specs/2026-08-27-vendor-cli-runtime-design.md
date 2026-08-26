# Vendor CLI Runtime Boundary Design

Date: 2026-08-27

Target release: `0.1.0-rc.2`

## Problem

`0.1.0-rc.1` installs `@openai/codex`, `@openai/codex-sdk`, and `@anthropic-ai/claude-agent-sdk` inside the DSH profile. During DSH/pnpm reconciliation this causes large optional platform artifacts for Windows, macOS, ARM, musl, and glibc targets to be fetched even on a CachyOS/Linux x64 host.

The Suite already treats vendor authentication and vendor product state as owned by the official clients. Installing a second product runtime inside the DSH profile is therefore both wasteful and inconsistent with the intended product boundary.

## Goals

1. `nishi-dsh-suite@0.1.0-rc.2` must not install vendor product binaries for Codex, Claude Code, or Antigravity.
2. Codex integrations must use the already installed official `codex` executable.
3. Claude Code integration must use the already installed official `claude` executable.
4. Antigravity continues to use the already installed official `agy` executable.
5. Missing vendor executables disable only their corresponding integration and do not prevent DSH startup.
6. Vendor authentication, sessions, config, keyrings, cookies, OAuth state, and homes remain vendor-owned and are never copied or modified by the Suite.
7. The release must include a real registry/profile upgrade acceptance from `0.1.0-rc.1` to `0.1.0-rc.2`.
8. Cleanup instructions must remove Suite-created duplicate/profile artifacts and temporary package caches without removing the user's global vendor CLIs or authentication state.

## Non-goals

- Do not install, update, downgrade, or manage `codex`, `claude`, or `agy`.
- Do not add a custom vendor downloader.
- Do not copy or migrate vendor credentials.
- Do not alter the user's global vendor installation.
- Do not change the Project Memory ownership model.
- Do not claim Windows validation for `0.1.0-rc.2` unless Windows acceptance is run separately.

## Runtime executable resolution

Each vendor boundary gets one small resolver with the same policy:

1. explicit Suite-specific environment override, when configured;
2. executable discovered from the current `PATH`;
3. otherwise return an unavailable result with a stable, user-actionable diagnostic.

Exact environment overrides:

- Codex: `DSH_CODEX_EXECUTABLE`
- Claude Code: `DSH_CLAUDE_EXECUTABLE`
- Antigravity keeps its existing `agy` lookup behavior; no new runtime dependency is introduced.

Resolvers must not search vendor home directories, npm global directories, shell history, package-manager databases, or credential stores. The process `PATH` plus explicit override is the entire discovery boundary.

## Codex primary and subagent

`packages/codex` must remove runtime dependencies on `@openai/codex` and `@openai/codex-sdk`.

The existing App Server protocol implementation remains owned by `nishi-dsh-codex`. The only runtime change is executable selection:

- replace package-local `require.resolve('@openai/codex/package.json')` resolution with `resolveCodexExecutable()`;
- invoke the discovered executable directly with the existing policy arguments and `app-server --stdio`;
- retain the existing DSH-owned subprocess lifecycle, JSON-RPC transport, history replay, attachments, dynamic tools, Project Memory behavior, search routing, permission policy, and safe diagnostics.

The plugin must not silently fall back to a bundled Codex package. If `codex` is unavailable, Codex primary/subagent registration must fail closed for that integration only with a stable missing-client diagnostic.

## Codex usage source

`packages/codex-usage-source` must also stop depending on `@openai/codex`.

It must use the same Codex executable resolver and launch the installed `codex app-server --stdio` for `account/rateLimits/read`. The existing bounded timeout, scrubbed environment, no-model-thread behavior, and graceful disposal remain unchanged.

## Claude Code subagent

`packages/claude-code` must remove runtime dependency on `@anthropic-ai/claude-agent-sdk`.

The provider will invoke the installed official `claude` CLI through the DSH subprocess service in non-interactive streaming mode. The adapter must preserve the accepted subagent contract:

- exact model remains `claude-sonnet-5` unless explicitly overridden by the existing provider configuration;
- effort remains `high`;
- permission mode remains the accepted unattended/automatic mode;
- prompt text and Project Memory context are supplied without writing vendor-owned config;
- streaming output is parsed into the existing DSH `SubagentRun` result model;
- cancellation interrupts/terminates the managed process tree;
- stderr and malformed protocol output are converted to safe fixed diagnostics;
- no Claude credentials or session files are read directly by the Suite.

The implementation should use the CLI's documented non-interactive streaming JSON interface rather than importing the Agent SDK package.

## Dependency graph contract

The release-family/package-contract verifier must reject these packages anywhere in Nishi runtime dependencies:

- `@openai/codex`
- `@openai/codex-sdk`
- any package whose name starts with `@openai/codex-`
- `@anthropic-ai/claude-agent-sdk`
- any package whose name starts with `@anthropic-ai/claude-agent-sdk-`

Dev-only test fixtures may not reintroduce them into packed manifests.

A packed Suite install in a fresh DSH profile must not place vendor platform packages for unrelated OS/CPU/libc targets into the profile lockfile or `node_modules` closure.

## Versioning and publication

All nine Nishi packages move together from `0.1.0-rc.1` to `0.1.0-rc.2`; no mixed internal version family is allowed.

Publication order remains leaves first and Suite last under the `next` dist-tag. The exact already-published `0.1.0-rc.1` artifacts are not mutated or unpublished.

## Upgrade acceptance

`0.1.0-rc.2` introduces the first real version-to-version acceptance gate.

On CachyOS/Linux with Node 24 and DSH `0.1.1-rc.2`:

1. create an isolated ordinary DSH profile;
2. install `nishi-dsh-suite@0.1.0-rc.1` from npm;
3. install the managed Orchestrator preset and verify `current`;
4. upgrade the registry package to `nishi-dsh-suite@0.1.0-rc.2`;
5. run `preset update` and verify `current`;
6. assert all nine Nishi packages resolve to exactly `0.1.0-rc.2`;
7. assert the profile graph contains no Nishi-owned dependency on the forbidden vendor runtime packages above;
8. run representative Codex, Claude Code, Antigravity, Project Memory, routed search, and Usage & Limits live checks using the already installed vendor clients;
9. remove the preset, uninstall the Suite, and verify unrelated DSH/vendor state remains intact.

## Cleanup of rc.1 duplicate artifacts

Cleanup is conservative and must never remove the user's global `codex`, `claude`, or `agy` installations or vendor authentication state.

For disposable smoke profiles, removing the disposable `DSH_HOME` is sufficient for profile-local packages. The previous registry smoke used a temporary DSH home and it was already removed.

The smoke also used `/tmp/.pnpm-store/v11` as a temporary content-addressable store. If it exists and the user confirms it is only the temporary smoke store, it may be removed as cache cleanup. This does not affect global vendor CLIs.

For a real DSH profile that has `0.1.0-rc.1` installed, do not manually delete nested `node_modules` entries. Upgrade to `0.1.0-rc.2` or remove `nishi-dsh-suite` through `dsh plugin`; allow pnpm reconciliation to prune the old Codex/Claude runtime closure. Then verify the profile lockfile and dependency listing no longer contain the forbidden vendor packages.

## Tests

Required deterministic coverage:

- executable resolver tests for override, PATH hit, missing executable, and invalid override;
- Codex primary/subagent argv tests proving the discovered executable is used and no package-local `@openai/codex` resolution remains;
- Codex usage-source tests using the same resolver;
- Claude CLI subprocess/stream parser tests for success, malformed events, stderr, cancellation, and missing client;
- package-contract tests rejecting forbidden vendor runtime dependencies/prefixes;
- pack-manifest tests proving all nine packages are `0.1.0-rc.2` and packed manifests contain no forbidden vendor runtime dependencies;
- fresh-profile registry install acceptance proving unrelated platform binaries are absent;
- real `rc.1 -> rc.2` registry upgrade acceptance on CachyOS/Linux.

GitHub Actions remain `BLOCKED_BILLING`; do not claim hosted CI PASS until jobs can actually run.
