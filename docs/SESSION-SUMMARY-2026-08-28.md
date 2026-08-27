# Session Summary — Core and Project Memory stabilization

Date: 2026-08-28

Branch: `feat/core-provider-plugins-rc3`

## Outcome

This session took the rc.3 provider-core architecture from “structurally implemented but not trusted under real DSH lifecycle” to two frozen provider-independent packages:

- **`nishi-dsh-core`: DONE / FROZEN**
- **`nishi-dsh-project-memory`: DONE / FROZEN**

Both packages now have unit/integration gates, targeted regression coverage, disposable installed-package acceptance and real DSH boot evidence.

The remaining rc.3 work is intentionally provider-specific: Codex, then Antigravity, then Claude, followed by one product-level cross-provider/live acceptance and release gate.

## Architecture reached

The Suite now has six rc.3 packages:

1. `nishi-dsh-core`
2. `nishi-dsh-codex`
3. `nishi-dsh-antigravity`
4. `nishi-dsh-claude`
5. `nishi-dsh-project-memory`
6. `nishi-dsh-suite`

The provider-independent core owns:

- provider registry;
- the single registration/rollback path;
- shared vendor runtime helpers;
- routed `web_search`;
- usage/limits domain and cache;
- host RPC;
- browser Usage & Limits / Model Accounts surfaces.

Provider packages own:

- vendor-specific primary adapter protocol;
- provider-native search backend where available;
- provider usage source/normalizer where available;
- provider-specific install behavior.

Project Memory stays separate and provider-agnostic.

Vendor-specific delegated agent implementations were removed. The Orchestrator uses DSH-native child-agent delegation on the current primary route.

## Core stabilization work

The core was hardened issue-by-issue rather than through one large rewrite.

### Core 01 — Usage lifecycle generation race

Protected usage collection against old async work updating a new lifecycle generation.

### Core 02 — UTF-8 stream decoding

Replaced chunk-local decoding assumptions with streaming decoding so split multi-byte characters survive vendor stdout/stderr chunk boundaries.

### Core 03 — Canonical provider identities/routes

Introduced shared canonical identity validation for provider ids and routes. Registration and later Web Search routing use the same route rules.

### Core 04 — Workspace confinement

Hardened shared vendor workspace handling and path boundaries.

### Core 05 — Transactional provider registration rollback

`registerProvider()` now rolls back adapter + registry state when adapter registration/install fails. Rollback failures are aggregated with the original error rather than hiding it.

### Core 06 — Provider without usage capability

A registered provider without usage does not disappear and does not get a fake collector. It receives an explicit public `UNSUPPORTED` usage state.

### Core 07 — Browser lifecycle races

Added generation/request-serial protection so stale roster/usage promises cannot recreate withdrawn providers or overwrite newer state.

### Core 08 — Shared VendorFailure contract

Centralized provider-neutral vendor failure metadata and made stderr recognizers deterministic even with global/sticky regexes. Raw stderr does not automatically become user-facing text.

### Core 09 — Remove direct dsh-subagent helper dependency

The core stopped depending on `@deepseek-ai/dsh-subagent` for one generic validator. The package/lock boundary was regression-tested.

### Core 10 — Provider neutrality / fourth-provider proof

Added syntax-aware neutrality checks and an unfamiliar synthetic `nebula` provider that exercised:

- registry registration;
- route lookup;
- web-search backend exposure;
- late usage registration;
- public usage refresh;
- withdrawal.

No production core edit was required for the unfamiliar provider.

A first version of the static guard falsely matched provider names in JSDoc; it was replaced with a TypeScript AST-based guard so comments can document the architecture without becoming false executable coupling.

### Core 11–12 — Root dependencies / authorization cleanup

Removed stale root lifecycle dependencies and the direct core package dependency on `@deepseek-ai/dsh-authorization`.

The Model Accounts host now reads the DSH `credentials` service directly. The Suite still carries an authorization row as a surrounding-profile compatibility seam, but that is not a core dependency.

### Core 13 — Web Search request-header boundary

Hardened primary-route resolution:

- malformed/non-canonical route → `WEB_SEARCH_ROUTE_UNAVAILABLE`;
- valid canonical route without a backend → `WEB_SEARCH_UNSUPPORTED`;
- no trim/rewrite/fallback.

The resolver validates header shape before property access, avoiding uncontrolled TypeErrors from malformed config.

### Core 14 — Final acceptance and the important real-boot failure

The first Core 14 run was the most valuable validation event in the session.

All unit/check/build gates were green, but a real DSH profile boot failed with:

```text
cannot get property "nishiProviders" without inject
```

Root cause:

- outer `nishi-core` created `NishiProvidersService`;
- the same outer context then immediately accessed `ctx.nishiProviders` while its inject contract did not include that service;
- adding `nishiProviders` to outer inject would deadlock because the plugin itself publishes the service.

Final lifecycle fix:

```text
outer nishi-core
  inject: []
  -> mount NishiProvidersService
  -> mount nishi-core-host

nishi-core-host
  inject: [nishiProviders, connection, credentials]
  -> UsageLimitsHostService
  -> Usage Limits RPC
  -> Model Accounts RPC
```

The rerun proved:

- real DSH host boot + HTTP 200 readiness;
- no unauthorized `nishiProviders` access;
- installed core subpath imports;
- real agent-plane `nishi-dsh-core/web-search` mount;
- provider lifecycle without deadlock;
- unload/remount without duplicate registry/usage/RPC state.

After this PASS, Core was frozen.

## Project Memory stabilization work

### PM01 — One project root for context and tools

A real split-brain bug existed:

```text
session cwd: repo/packages/foo/src

context injection -> findProjectRoot() -> repo/.dsh/memory
memory tools      -> raw cwd           -> repo/packages/foo/src/.dsh/memory
```

`memory_read`, `memory_write` and `memory_edit` were changed to use the same `findProjectRoot(cwd, signal)` policy as context injection.

Acceptance proved:

- nested cwd resolves to one Git root;
- `.git` directory and worktree-style `.git` file work;
- nearest nested repository wins;
- non-Git workspaces use explicit normalized cwd;
- actual tool write/read/edit creates no nested `.dsh` tree.

### PM02 — Atomic writes + maintenance command lifecycle

Two final issues were closed before freezing memory.

#### Shared atomic writer

The hand-rolled temp-file + rename path was replaced with `@deepseek-ai/dsh-atomic-write`.

Project Memory retains its own preconditions:

- canonical parent must be a real directory;
- existing target must be a regular file;
- symlink/junction/non-regular targets fail closed.

Regression probes proved external symlink referents remain unchanged.

#### Correct Cordis injection for maintenance commands

`/memory` and `/consolidate` previously registered under:

```ts
ctx.inject(['commands'], ...)
```

but handlers read `commandCtx.llm`. In Cordis 4, a TypeScript `as any` does not bypass runtime service-access protection.

Final registration:

```ts
ctx.inject(['commands', 'llm'], ...)
```

A real Cordis deferred-service probe proved:

- commands register only after both services exist;
- handlers can call the LLM service without an injection violation;
- unknown-provider resolution returns the intended domain error rather than a Cordis access failure.

Final PM02 acceptance also proved:

- package test/check/build;
- full workspace gate;
- installed atomic-write peer resolution with `autoInstallPeers: false` environment expectations;
- disposable Suite install;
- real DSH host boot + HTTP readiness.

After this PASS, Project Memory was frozen.

## Why the validation workflow worked

The development environment was intentionally split:

- the assistant edits/reviews GitHub directly;
- Gemini runs the real local checkout, Node/DSH/vendor environment;
- verification evidence is committed back to GitHub as Markdown.

This avoided pretending that remote code review was equivalent to running the user's DSH installation.

### Workflow

For each issue:

1. Fetch the latest target file and blob SHA from GitHub.
2. Make one narrow implementation/test change on `feat/core-provider-plugins-rc3`.
3. Immediately produce a complete Gemini validation prompt.
4. Gemini pulls the branch and forces Node 24.19.0:

   ```bash
   export PATH="$HOME/.local/share/fnm/node-versions/v24.19.0/installation/bin:$PATH"
   ```

5. Gemini runs exact package/full gates and performs requested local probes/review.
6. Gemini normally does **not** modify implementation/tests. It writes only one designated report under:

   ```text
   docs/verification/gemini/
   ```

   A deterministic generated-file exception such as `pnpm-lock.yaml` is explicitly authorized only when needed.
7. Gemini commits/pushes the report even on FAIL.
8. The maintainer replies simply `готово`.
9. The assistant reads the report from GitHub and verifies:
   - tested commit;
   - branch;
   - Node version/path;
   - command exit codes;
   - targeted review/probe evidence;
   - blocking issues/verdict.
10. On FAIL: patch the concrete blocker and rerun.
11. On PASS: explicitly close the issue and move to the next one.

### Important behavior of this workflow

The workflow is not “Gemini says PASS, therefore done.” The report is treated as structured evidence and checked against the requested acceptance conditions.

It caught several problems that static review alone would not have provided confidence in, especially the real Core Cordis boot failure.

## Verification records created

Core reports:

```text
docs/verification/gemini/core-01-usage-lifecycle.md
...
docs/verification/gemini/core-14-final-acceptance.md
```

Project Memory reports:

```text
docs/verification/gemini/project-memory-01-root-consistency.md
docs/verification/gemini/project-memory-02-final-acceptance.md
```

The verification directory is evidence/history. Current planning state belongs in HANDOFF/ROADMAP/current plan, not in old report prose.

## Documentation sweep at session end

After freezing Core and Project Memory, the documentation was audited against actual source/package state.

Corrected examples of stale documentation:

- Codex/Antigravity package descriptions still said “primary/subagent” after delegation removal;
- root README omitted the current Claude provider package and said rc.3 had never live-booted;
- Suite README incorrectly said core injected `authorization`;
- Antigravity README called `antigravity-cli` the provider id instead of the route;
- provider bridge spec showed old direct registry registration and routes on the wrong descriptor level;
- roadmap/HANDOFF still treated completed Core/Memory work as open;
- Market submission copy still advertised vendor-specific subagents.

Current docs now distinguish canonical state from historical rc.1/rc.2/detailed-plan records.

## What the next session should do

Do **not** start by re-auditing Core or Project Memory.

Start from:

```text
docs/HANDOFF.md
docs/ROADMAP.md
docs/superpowers/plans/2026-08-27-core-and-provider-plugins.md
```

Then execute provider packages in order:

1. Codex cleanup + final provider acceptance → freeze.
2. Antigravity cleanup/catalog honesty + final provider acceptance → freeze.
3. Claude cleanup/release acceptance → freeze.
4. Repository-wide provider invariants.
5. One cross-provider product acceptance (Codex → Antigravity with memory continuity + dynamic roster).
6. Final install/profile/release gates.

Do not publish, merge, tag or deprecate packages without a separate explicit approval.

Windows remains NOT TESTED.
