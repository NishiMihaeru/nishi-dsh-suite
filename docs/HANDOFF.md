# Handoff

Updated for `0.1.0-rc.3` during the final Core + Project Memory supported-family re-freeze.

This is the **only session handoff file**. Update it in place when the active task changes. Do not create dated session-summary or handoff documents.

## Current branch/state

Development branch:

```text
feat/core-provider-plugins-rc3
```

Current family: six packages at `0.1.0-rc.3`.

`0.1.0-rc.3` is in-repo and unpublished. Published `0.1.0-rc.1` remains the public npm family. No publish, merge, tag or release is authorized by this handoff.

The reopened audit uses two DSH generations:

```text
local installed baseline: 0.1.1-rc.2
upstream compatibility target: dsh-v0.1.2-alpha.1
upstream commit: cd5ef8148158c3a752a658978873241fdf8e2bbc
```

For DSH compatibility questions, actual upstream source/runtime contracts at that exact tag/commit are primary truth; documentation may lag implementation.

## Read before editing

1. `docs/README.md`
2. this file
3. `docs/ROADMAP.md`
4. `docs/ARCHITECTURE.md`
5. target package README, then exact source/tests being changed

## Reopened audit status

Every source/runtime blocker found in Core and Project Memory is now individually corrected and accepted.

### Core 15 — Connection/client compatibility

Accepted implementation HEAD `59512d51e55f8121eccdb934e01523e4436b289c`, Gemini report commit `c991bb6ece48acb02d5c15bce3b2b970c3da391a`.

- rc.2 three-argument trusted-host Connection registration PASS;
- alpha.1 authenticated two-argument Connection registration PASS;
- host/client mount-unmount-remount and security probes PASS;
- retired `dsh-host-apiproxy` / `dsh-client-runtime` removed from production Core boundary.

### Core 16 — registry transaction integrity

Accepted implementation HEAD `b925e2a328168e7c978126fc6474b7af11d7a63d`, Gemini report commit `e17c809ce72060f8a5e0627b1a7d2c8d58c263e9`.

- 175/175 Core tests PASS;
- non-vetoing registry observers;
- no unhandled async observer rejection;
- post-record rollback and stale-disposer safety PASS;
- expected usage contract errors preflight before registry visibility.

### PM03 — maintenance route timing

Accepted through `b3948f3443fc7d0418b64c688865fb7c0ec9eebf`, report commit `10020983856a1137f286c83f9ed68c0a62605f58`.

The exact maintenance inbox message activates model selection before prompt assembly snapshots the first maintenance request.

### PM04 — inter-process RMW integrity

Accepted implementation HEAD `eae9caf03f8896f344d7c73b2f67d67cb9f86e9c`, report commit `02e0dca62f49fc2ef6bba8626ae028c7da3986e2`.

- 29/29 Project Memory tests PASS;
- same-file RMW serialization for `MEMORY.md`, topics and `.gitignore`;
- real multi-process stress, foreign-lock preservation, symlink safety and alpha.1 lock probe PASS.

### PM05 — compound topic + Memory-map integrity

Accepted implementation HEAD `dbe1b7a3894bc05c1c4863148060bff59166bc17`, report commit `8e8c1980a34d6c9b0cbd020f0d0166e7c4c00e01`.

- 39/39 Project Memory tests PASS;
- 277/277 full workspace tests PASS;
- fixed lock order `MEMORY.md -> topic.md`;
- deterministic Memory-map errors preflight before topic mutation;
- late map failure rolls back new/existing topic under held topic lock;
- exact-byte restore and rollback-failure `AggregateError` PASS;
- actual model-facing `memory_write` / `memory_edit` path and sanitization PASS.

## Immediate task: final Core + Project Memory supported-family re-freeze

Production manifests now declare only the two DSH generations with direct evidence:

```text
0.1.1-rc.2 || 0.1.2-alpha.1
```

Affected manifests:

- `packages/core/package.json`
- `packages/project-memory/package.json`

Contract:

1. Every production `@deepseek-ai/dsh-*` peer in Core/Project Memory uses exactly that explicit union.
2. Do not replace it with a broad `>=`, caret or prerelease range: untested versions are not supported by implication.
3. Local DSH `devDependencies` remain exactly `0.1.1-rc.2` for reproducible maintainer validation.
4. Core retired seams `@deepseek-ai/dsh-client-runtime` and `@deepseek-ai/dsh-host-apiproxy` remain rc.2-only dev fixtures, absent from production dependencies/peers/client injection.
5. Alpha.1 validation stays disposable against official source/tag; the main workspace lock graph is not migrated to an unpublished/unpinned source snapshot.
6. Peer-only changes should not require `pnpm-lock.yaml` drift.
7. This foundation range does not broaden provider package ranges; Codex/Antigravity/Claude are handled in their own subsequent blocks.

The final validation must prove both generations using the complete corrected Core + Project Memory, not isolated API snippets only.

## Required final validation shape

### Installed rc.2 baseline

- frozen install;
- Core test/check/build;
- Project Memory test/check/build;
- full workspace test/check/build;
- preferably `pnpm verify:local` if it is quota-free and does not invoke prohibited hosted CI;
- real/disposable Suite/Core/Memory boot/lifecycle smoke sufficient to catch peer/manifest mistakes.

### Disposable official alpha.1

Using tag `dsh-v0.1.2-alpha.1` / commit `cd5ef8148158c3a752a658978873241fdf8e2bbc`, without rewriting the main working tree dependency graph:

- install/build Core against alpha.1 packages/source;
- install/build Project Memory against alpha.1 packages/source;
- Core host Connection + registry lifecycle smoke;
- Core browser/client apply smoke where practical;
- Project Memory actual tool registration + named write/edit/read smoke;
- maintenance model-selection first-request probe;
- RMW/compound transaction smoke including lock acquisition;
- unload/dispose cleanup;
- verify no removed alpha.1 package is a production requirement.

If both generations pass, Core and Project Memory are re-frozen and provider cleanup resumes with Codex.

## Invariants to preserve

- providers register through shared `registerProvider()`;
- Core has no provider-package dependency;
- Core has no production `dsh-authorization`, `dsh-host-apiproxy` or `dsh-client-runtime` dependency;
- web search follows the exact route with no fallback;
- registry observers cannot veto committed topology changes;
- Project Memory context/tools use one root policy;
- Project Memory filesystem confinement remains fail-closed;
- same-file RMW writers use the same target lock;
- compound named-topic lock order is `MEMORY.md -> topic.md`;
- normal map failure cannot leave the topic mutated;
- rollback failure is explicit;
- vendor-specific delegation tools remain absent;
- no vendor credential/session/token stores are copied, parsed, migrated or deleted.

## Development workflow

The assistant edits GitHub; Gemini validates on the maintainer's local machine.

For each narrow issue:

1. Fetch current target file + SHA before editing.
2. Make one logically complete change.
3. Provide one complete Gemini validation prompt.
4. Gemini uses:

   ```bash
   export PATH="$HOME/.local/share/fnm/node-versions/v24.19.0/installation/bin:$PATH"
   ```

5. Gemini validates but does not repair implementation unless explicitly authorized.
6. Gemini overwrites only `docs/verification/gemini/LATEST.md`.
7. Gemini commits/pushes `LATEST.md` even on FAIL.
8. Maintainer replies `готово`.
9. Assistant reads fresh `LATEST.md`; FAIL -> fix exact cause, PASS -> fold durable evidence and continue.

## Hard constraints

- GitHub Actions/hosted CI are not used. Do not inspect or edit `.github/workflows/*`.
- No publish / merge / tag / release without explicit maintainer approval.
- Do not copy, parse, migrate or delete vendor credential/session/token stores.
- `@openai/codex*` and `@anthropic-ai/*` stay absent from the Suite runtime lock graph.
- Windows remains **NOT TESTED**.
- Read command exit codes directly; avoid pipelines that mask failures.

## After foundation PASS

Resume the fixed sequence:

1. Codex
2. Antigravity
3. Claude
4. repository-wide provider invariants
5. cross-provider/product live acceptance
6. install/profile lifecycle
7. release gate
