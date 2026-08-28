# Handoff

Updated for `0.1.0-rc.3` during Core and Project Memory compatibility/integrity remediation against DSH `0.1.2-alpha.1`.

This is the **only session handoff file**. Update it in place when the active task changes. Do not create dated session-summary or handoff documents.

## Current branch/state

Development branch:

```text
feat/core-provider-plugins-rc3
```

Current family: six packages at `0.1.0-rc.3`.

`0.1.0-rc.3` is in-repo and unpublished. Published `0.1.0-rc.1` remains the public npm family. No publish, merge, tag or release is authorized by this handoff.

The previous Core and Project Memory acceptance remains valid for the installed DSH `0.1.1-rc.2` baseline, but both packages are **REOPENED** after reproducible findings against official DSH tag:

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

### Project Memory maintenance route

Accepted:

- implementation `0297fcc4eaecd4aace5c06b20000ea4539a7b3e1`;
- regression test `b3948f3443fc7d0418b64c688865fb7c0ec9eebf`;
- Gemini report commit `10020983856a1137f286c83f9ed68c0a62605f58`;
- 25/25 package tests PASS;
- typecheck/build PASS;
- disposable alpha.1 `installModelSelection` probe PASS.

The exact maintenance message activates provider/model selection on `agent/inbox/claimed`, before prompt assembly snapshots the first step.

### Core Connection/client compatibility

Accepted implementation HEAD:

```text
59512d51e55f8121eccdb934e01523e4436b289c
```

Gemini report commit:

```text
c991bb6ece48acb02d5c15bce3b2b970c3da391a
```

Accepted result:

- 169/169 Core tests PASS;
- check/build/frozen-lockfile PASS;
- actual rc.2 `rpc.handle.length === 3` and alpha.1 `=== 2` verified;
- rc.2 trusted-host and alpha.1 authenticated Connection registration both PASS;
- Core host mount/unload/remount PASS on both generations;
- retired `dsh-host-apiproxy` / `dsh-client-runtime` removed from production Core boundary;
- browser client apply and alpha.1 Host/Origin + browser-auth security probes PASS.

## Immediate task: validate Core registry observer/transaction correction

The implementation is already on the branch. Do not mix Project Memory changes into this validation.

The corrected contract is:

1. Provider/route identity and expected provider-owned usage contract errors are validated before registry mutation.
2. Explicit `usage.refreshPolicy` is validated/detached before capability factories.
3. The collector returned by `usage.create()` is validated/wrapped before registry mutation.
4. Host `defaultRefreshPolicy` is validated before registry observers are installed.
5. `NishiProvidersService.onChange` callbacks are non-vetoing observers:
   - one synchronous throw cannot make `record()` throw after commit;
   - one async rejection is contained;
   - later observers still run;
   - `record()` still returns the withdrawal handle;
   - withdrawal notifications obey the same non-vetoing rule.
6. Later transactional failures after `record()` (effect binding/model registration/install) keep the existing explicit rollback behavior.

Focused tests were added for throwing observers, async observer rejection, invalid provider policy, invalid collector and invalid host default policy.

After this block passes, move to Project Memory inter-process RMW integrity.

## Remaining confirmed foundation blockers

1. Project Memory read-modify-write paths need inter-process serialization where atomic replacement alone can lose concurrent updates.
2. Project Memory topic + Memory-map compound mutations need explicit failure/partial-commit handling and tests.
3. DSH peer/dev version declarations must be reconciled only after source compatibility is proven.
4. Core + Project Memory must then be re-frozen against the intended supported DSH family.

`ROADMAP.md` owns completion status and order.

## Invariants to preserve

- providers register through the shared `registerProvider()` path;
- Core has no provider-package dependency;
- outer `nishi-core` publishes `NishiProvidersService` before the inner host child;
- Core does not depend on `dsh-authorization`;
- web search follows the exact current request route and never silently falls back;
- capability absence is legal;
- registry observers cannot veto committed topology changes;
- provider-owned usage contract errors that can reject registration happen before registry mutation;
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

Compatibility source target:

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
