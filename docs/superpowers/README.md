# Superpowers documents — status index

Updated 2026-08-28.

This directory contains both **current architecture/planning documents** and dated historical plans/specs that describe earlier package layouts. Do not treat every unchecked box in a dated file as current work.

## Canonical current documents

### Architecture

`specs/provider-bridge-design.md`

Current rc.3 connector contract, updated after Core 14 and Project Memory 02 acceptance. It describes:

- final registry-first Core Cordis lifecycle;
- actual `ProviderDescriptor` shape;
- `registerProvider()` as the provider registration API;
- model routes on `descriptor.model.routes`;
- routed search/usage/presentation contracts;
- Core neutrality/fourth-provider proof;
- current Project Memory root/atomic/command behavior;
- what adding a provider may and may not require.

### Execution plan

`plans/2026-08-27-core-and-provider-plugins.md`

Despite the date in its filename, this file is the canonical remaining rc.3 execution plan. It was rewritten on 2026-08-28 after Core and Project Memory were frozen. It now contains only:

- completed architecture summary;
- Codex remaining work;
- Antigravity remaining work;
- Claude remaining work;
- repository/provider invariants;
- cross-provider live acceptance;
- install/profile/release gates.

## Historical / superseded documents

These are retained because they explain why the architecture changed. Their package names, code paths, task status and assumptions are historical.

### `specs/2026-08-26-provider-package-split-design.md`

Historical package-split design from before the provider-independent Core consolidation.

### `plans/2026-08-26-provider-package-split.md`

Historical implementation plan paired with the package-split design above.

### `specs/2026-08-27-vendor-cli-runtime-design.md`

Historical design for the shared vendor CLI runtime. The accepted provider-neutral runtime now lives under `nishi-dsh-core/runtime`; use the current Core README/spec for present package boundaries.

### `plans/2026-08-27-vendor-cli-runtime.md`

Historical implementation plan for that runtime work. It is evidence of the migration, not the remaining rc.3 task list.

## Other canonical status documents

Outside this directory:

- `../HANDOFF.md` — shortest next-session state/constraints/workflow;
- `../ROADMAP.md` — current stages and remaining work;
- `../SESSION-SUMMARY-2026-08-28.md` — detailed summary of the Core/Memory stabilization session;
- `../release/2026-08-28-rc3-prerelease.md` — current rc.3 release draft and open release gates.

## Rule for future updates

When architecture changes:

1. update the canonical current spec;
2. update HANDOFF + ROADMAP + current execution plan;
3. add a new dated historical document only when preserving a meaningful design/implementation snapshot is useful;
4. do not silently rewrite old acceptance/release evidence to pretend it described the new architecture.
