# Handoff

Updated for `0.1.0-rc.3` after the independent Core + Project Memory audit/remediation and successful re-freeze validation.

This is the **only session handoff file**. Update it in place when the active task changes. Do not create dated session-summary, plan or handoff documents.

## Current branch/state

Development branch:

```text
feat/core-provider-plugins-rc3
```

Current family: six packages at `0.1.0-rc.3`.

`0.1.0-rc.3` is in-repo and unpublished. Published `0.1.0-rc.1` remains the public npm family. No publish, merge, tag or release is authorized by this handoff.

Local validation baseline:

```text
Node: 24.19.0
pnpm: 11.21.0
DSH: 0.1.1-rc.2
OS: Linux/CachyOS
Windows: NOT TESTED
```

Official compatibility source target used for foundation validation:

```text
dsh-v0.1.2-alpha.1
cd5ef8148158c3a752a658978873241fdf8e2bbc
```

For DSH compatibility questions, actual upstream source/runtime contracts at the exact target being audited are primary truth. Documentation may lag implementation.

## Read before editing

1. `docs/README.md`
2. this file
3. `docs/ROADMAP.md`
4. `docs/ARCHITECTURE.md`
5. target package README
6. target package source/tests

Use `docs/verification/README.md` only to confirm already accepted evidence. `docs/verification/gemini/LATEST.md` is the rolling raw Gemini report, not the durable project state.

## Foundation status — FROZEN

Core and Project Memory were reopened by an independent audit from branch HEAD:

```text
42203ca50ea2555cfcc675d9c73e52bb86a48324
```

strictly against official DSH `0.1.2-alpha.1`. The audit found one Core correctness defect and four Project Memory filesystem/cancellation/durability defects. Follow-up implementation review also found additional parent/intermediate-path, cancellation-settlement and recovery ownership races, which were remediated before final validation.

Accepted foundation implementation checkpoint:

```text
eb95ef6425c788f63339befd0c2437f78bc8dde1
```

Raw PASS report commit:

```text
f491d681390924a171211a5c0dd0c8991f6a7faf
```

Accepted final evidence:

- `pnpm install --frozen-lockfile` PASS;
- Core focused tests `178/178` PASS;
- Core check/build PASS;
- Project Memory focused tests `57/57` PASS;
- Project Memory check/build PASS;
- full workspace test/check/build PASS;
- `pnpm verify:local` PASS;
- disposable official `dsh-v0.1.2-alpha.1` runtime compatibility PASS for changed Core and Project Memory seams;
- real alpha.1 `memory_read`, `memory_write`, `memory_edit` PASS;
- changed descriptor-chain, cancellation, mandatory-settlement, WAL and recovery fail-closed regressions PASS;
- working-tree integrity PASS during the validation run;
- GitHub Actions/hosted CI NOT USED;
- Windows NOT TESTED.

Core and Project Memory are therefore **FROZEN** again. Do not change their contracts or implementation during provider cleanup unless a new concrete defect or compatibility failure proves the foundation must be reopened.

Their production DSH peer family remains:

```text
0.1.1-rc.2 || 0.1.2-alpha.1
```

Provider packages do not inherit that support automatically.

## Frozen Core contract to preserve

- credential-store failure is distinct from ordinary account absence;
- failed durable legacy-grant deletion is not reported as successful logout;
- browser/RPC projections do not expose credential/backend secret material;
- providers register through shared `registerProvider()`;
- registry observers are non-vetoing;
- routed web search follows the exact current route with no vendor fallback;
- Core remains provider-independent.

## Frozen Project Memory contract to preserve

- one provider-independent root policy for context and tools;
- POSIX package-owned descendants use the pinned `projectRoot -> .dsh -> memory/local` descriptor chain;
- RMW lock/read/render/write uses one stable `SafeDirectoryScope`;
- named-topic participant locks use `MEMORY.md -> topic.md` order;
- named-topic + Memory-map mutation uses the `pending`/`committed` WAL with exact pre-images;
- cancellation propagates through ordinary work and preserves caller cancellation reason;
- mandatory settlement may ignore an already-fired caller signal only to restore already-durable partial state;
- recovery is fail-closed when ownership/WAL state becomes ambiguous after recovery protocol begins;
- Windows remains NOT TESTED and must not inherit the stronger POSIX TOCTOU guarantee.

## Immediate task — Codex provider audit / cleanup / freeze

Target package:

```text
packages/codex
```

Start independently from the current code and actual upstream DSH contracts. Do not assume that earlier provider findings are exhaustive and do not inherit Core/Project Memory alpha.1 compatibility by association.

Required direction:

1. inspect current Codex README, source and tests after canonical project docs;
2. independently determine the Codex package's actual compatibility with installed DSH `0.1.1-rc.2` and official `0.1.2-alpha.1`;
3. reconcile Codex DSH dependencies/peers only to generations proven by that provider-specific audit;
4. move genuinely provider-neutral failure/helper logic onto the already-frozen Core contracts where appropriate, without moving Codex protocol translation into Core;
5. preserve the reviewed Codex App Server adapter boundary;
6. keep vendor-specific subagent integrations absent;
7. prove vendor-native memory/project-doc suppression for primary Codex invocation;
8. run focused test/check/build, then required local/live Codex acceptance;
9. freeze Codex only after its own validation evidence is accepted.

Historical Codex pre-work evidence exists in `docs/verification/README.md`, including a prior `31/31` focused PASS and live primary `CODEX_PRIMARY_OK`, but it is only a starting point and not a current Codex freeze.

## Invariants to preserve

- Core and Project Memory remain frozen unless a concrete new failure requires reopening them;
- providers register only through shared `registerProvider()`;
- Core remains provider-independent;
- Project Memory remains provider-independent;
- model capability implies at least one canonical route;
- capability absence is legal;
- web search follows the exact current route with no vendor fallback;
- registry observers are non-vetoing;
- vendor-specific subagent registrations/tools remain absent;
- provider-native persistent memory/project-doc injection must not replace DSH Project Memory;
- no vendor credential/session/token stores are copied, parsed, migrated or deleted;
- `@openai/codex*` and `@anthropic-ai/*` remain absent from the Suite runtime lock graph unless a separately reviewed design explicitly changes that boundary.

## Development workflow

The assistant edits GitHub; Gemini validates on the maintainer's local machine.

For each narrow issue:

1. fetch the current target file + SHA immediately before editing;
2. make one logically complete change;
3. provide one complete Gemini validation prompt;
4. Gemini uses:

   ```bash
   export PATH="$HOME/.local/share/fnm/node-versions/v24.19.0/installation/bin:$PATH"
   ```

5. Gemini validates but does not repair implementation unless explicitly authorized;
6. Gemini overwrites only `docs/verification/gemini/LATEST.md`;
7. Gemini commits/pushes `LATEST.md` even on FAIL;
8. maintainer replies `готово`;
9. assistant reads fresh `LATEST.md`; FAIL -> fix the exact cause, PASS -> fold durable evidence into `docs/verification/README.md` and continue.

## Hard constraints

- GitHub Actions/hosted CI are not used. Do not inspect or edit `.github/workflows/*`.
- No publish / merge / tag / release without explicit maintainer approval.
- Do not copy, parse, migrate or delete vendor credential/session/token stores.
- Windows remains **NOT TESTED**.
- Read command exit codes directly; avoid pipelines that mask failures.

## Remaining sequence

1. Codex cleanup/compatibility/freeze
2. Antigravity cleanup/compatibility/freeze
3. Claude usage-only cleanup/compatibility/freeze
4. repository-wide provider invariants
5. cross-provider/product live acceptance
6. install/profile lifecycle
7. final release gate
