# Handoff

Updated for `0.1.0-rc.3` after reopening Core and Project Memory for compatibility/integrity remediation against DSH `0.1.2-alpha.1`.

This is the **only session handoff file**. Update it in place when the active task changes. Do not create dated session-summary or handoff documents.

## Current branch/state

Development branch:

```text
feat/core-provider-plugins-rc3
```

Current family: six packages at `0.1.0-rc.3`.

`0.1.0-rc.3` is in-repo and unpublished. Published `0.1.0-rc.1` remains the public npm family. No publish, merge, tag or release is authorized by this handoff.

The previous Core and Project Memory acceptance remains valid for the installed DSH `0.1.1-rc.2` baseline, but both packages are now **REOPENED** after reproducible findings against official DSH tag:

```text
dsh-v0.1.2-alpha.1
cd5ef8148158c3a752a658978873241fdf8e2bbc
```

Do not resume provider cleanup until the foundation remediation in `ROADMAP.md` is complete.

## Read before editing

1. `docs/README.md`
2. this file
3. `docs/ROADMAP.md`
4. `docs/ARCHITECTURE.md`
5. target package README, then exact source/tests being changed

For DSH compatibility questions, use actual upstream source/contracts at the exact tag/commit above as primary truth. Documentation may lag implementation.

## Completed remediation in this audit

Project Memory maintenance-route timing is fixed and accepted:

- implementation: `0297fcc4eaecd4aace5c06b20000ea4539a7b3e1`;
- regression test: `b3948f3443fc7d0418b64c688865fb7c0ec9eebf`;
- Gemini report commit: `10020983856a1137f286c83f9ed68c0a62605f58`;
- package tests: 25/25 PASS;
- typecheck/build PASS;
- disposable probe using alpha.1 `installModelSelection` PASS.

Maintenance selection now activates when the exact maintenance message is emitted through `agent/inbox/claimed`, before `system-prompt/assemble`, so the first maintenance request uses the requested provider/model.

## Immediate next task: Core DSH alpha.1 Connection/client migration

Keep this as one narrow compatibility block before touching the registry transaction bug.

Target outcomes:

- remove Core's retired `@deepseek-ai/dsh-host-apiproxy` type boundary;
- import the RPC result/error/handler contracts from current `@deepseek-ai/dsh-client-connection` instead;
- migrate host `connection.rpc.handle` registration from the rc.2 three-argument form to the alpha.1 two-argument form while preserving effect-scoped cleanup and the Connection-owned Host/Origin + browser-auth fence;
- remove the retired `@deepseek-ai/dsh-client-runtime` browser dependency/import;
- type the browser plugin context through Cordis plus the actual client service augmentation packages, matching first-party alpha.1 client plugins;
- preserve existing `connection`, locale and slots behavior;
- add/update compatibility tests so retired DSH package seams cannot silently return;
- focused Core `test` / `check` / `build`, then disposable alpha.1 compatibility probe.

Do not mix the Core ghost-provider listener/transaction fix into this block. That gets its own change and validation after Connection/client migration passes.

## Remaining confirmed foundation blockers

After the immediate Core migration:

1. Core registry listener failure can leave a ghost provider after a failed registration transaction.
2. Project Memory read-modify-write paths need inter-process serialization where atomic replacement alone can lose concurrent updates.
3. Project Memory topic + Memory-map compound mutations need explicit failure/partial-commit handling and tests.
4. DSH peer/dev version declarations must be reconciled only after source compatibility is proven.

`ROADMAP.md` owns completion status and order.

## Invariants to preserve

- providers register through the shared `registerProvider()` path;
- Core has no provider-package dependency;
- outer `nishi-core` publishes `NishiProvidersService` before the inner host child;
- Core does not depend on `dsh-authorization`;
- web search follows the exact current request route and never silently falls back;
- capability absence is legal;
- Project Memory context/tools use one root policy;
- Project Memory canonical path/symlink confinement remains fail-closed;
- vendor-specific delegation tools stay removed;
- no vendor credential/session/token stores are copied, parsed, migrated or deleted.

## Development workflow

The assistant edits GitHub; Gemini validates on the maintainer's local machine.

For each narrow issue:

1. Fetch the current target file and SHA from `feat/core-provider-plugins-rc3` immediately before editing.
2. Make one logically complete change with focused tests.
3. Provide one complete Gemini validation prompt.
4. Gemini uses:

   ```bash
   export PATH="$HOME/.local/share/fnm/node-versions/v24.19.0/installation/bin:$PATH"
   ```

5. Gemini validates but does not repair implementation unless explicitly authorized.
6. Gemini overwrites only `docs/verification/gemini/LATEST.md`.
7. Gemini commits/pushes `LATEST.md` even on FAIL.
8. Maintainer replies `готово`.
9. Assistant reads fresh `LATEST.md`; on FAIL fix the exact cause, on PASS fold durable evidence into `docs/verification/README.md` and continue.

## Validation baselines

Local installed baseline:

- Node `v24.19.0` through fnm;
- pnpm `11.21.0`;
- DSH `0.1.1-rc.2`.

Compatibility source target for this reopened foundation audit:

- DSH tag `dsh-v0.1.2-alpha.1`;
- upstream commit `cd5ef8148158c3a752a658978873241fdf8e2bbc`.

Do not update the main working copy to alpha.1 merely to probe compatibility. Prefer disposable environments until package dependency migration is intentionally part of the scoped change.

## Hard constraints

- GitHub Actions/hosted CI are not used. Do not inspect or edit `.github/workflows/*`.
- No publish / merge / tag / release without explicit maintainer approval.
- Do not copy, parse, migrate or delete vendor credential/session/token stores.
- `@openai/codex*` and `@anthropic-ai/*` stay absent from the Suite runtime lock graph.
- Windows remains **NOT TESTED**.
- Read command exit codes directly; avoid pipelines that mask failures.

## After foundation remediation

Resume the fixed product sequence:

1. Codex
2. Antigravity
3. Claude
4. repository-wide provider invariants
5. cross-provider/product live acceptance
6. install/profile lifecycle
7. release gate

`ROADMAP.md` owns exact status.
