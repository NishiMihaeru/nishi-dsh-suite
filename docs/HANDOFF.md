# Handoff

Updated for `0.1.0-rc.3` after the independent Core + Project Memory audit/remediation pass.

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

Official compatibility source target:

```text
dsh-v0.1.2-alpha.1
cd5ef8148158c3a752a658978873241fdf8e2bbc
```

For DSH compatibility questions, actual upstream source/runtime contracts at that exact tag/commit are primary truth. Documentation may lag implementation.

## Read before editing

1. `docs/README.md`
2. this file
3. `docs/ROADMAP.md`
4. `docs/ARCHITECTURE.md`
5. target package README
6. target package source/tests

Use `docs/verification/README.md` only to confirm already accepted evidence. `docs/verification/gemini/LATEST.md` is the rolling raw Gemini report, not the durable project state.

## Foundation status — GITHUB REMEDIATION COMPLETE, LOCAL VERIFICATION REQUIRED

The historical foundation freeze at implementation HEAD:

```text
0c7a177d2f4fceab58513cbd0d87fcf9c31b025b
```

and its old PASS report remain historical evidence only. An independent audit from branch HEAD `42203ca50ea2555cfcc675d9c73e52bb86a48324`, strictly against official DSH `0.1.2-alpha.1`, found one Core correctness defect and four Project Memory filesystem/cancellation/durability defects.

The GitHub remediation implementation is now complete for source review. Core and Project Memory are still **NOT FROZEN** because the final changed tree has not yet passed fresh local executable gates.

### Core remediation

- credential-store read failure projects a sanitized `ERROR` state instead of `NOT_CONFIGURED`;
- failed legacy-grant `deleteRecord()` is not swallowed as a successful logout;
- targeted authorization RPC regressions cover both failure paths;
- no broad alpha.1 Core API/ABI migration was required.

### Project Memory remediation

- POSIX package-owned descendants are opened through one canonical descriptor chain: `projectRoot -> .dsh -> memory/local`;
- explicit symlinked workspace roots remain supported while package-owned `.dsh`, `.dsh/memory`, and `.dsh/local` components must be real directories;
- RMW lock/read/render/write stays on one opened `SafeDirectoryScope`; compound memory/local scopes belong to the same pinned `.dsh` generation;
- initial canonical files are fully written before no-clobber publication;
- model-facing tools and lazy initialization forward `AbortSignal` through ordinary lock waits and commit boundaries;
- if cancellation/failure occurs after a durable participant write, exact rollback uses mandatory settlement on the already-opened scopes instead of being cancelled again;
- named-topic + Memory-map writes use a `pending`/`committed` WAL under `.dsh/local/` with exact pre-images;
- dead `pending` transactions roll back exactly; dead `committed` transactions preserve participant data and clean protocol debris;
- recovery ownership/WAL mutation ambiguity after dead unresolved state has been observed is fail-closed;
- cleanup is idempotent under concurrent recovery;
- regressions cover static symlinks, symlinked explicit roots, locked-parent replacement, intermediate `.dsh` replacement, cancellation, mandatory settlement, compound serialization, pending/committed recovery, live-PID abandoned recovery, and recovery ownership transfer.

Windows remains **NOT TESTED**. The descriptor-chain TOCTOU guarantee is a Linux/POSIX implementation guarantee; Windows uses the fallback identity-revalidation path and must not be described as equivalently proven.

Core and Project Memory production DSH peers remain intentionally restricted to:

```text
0.1.1-rc.2 || 0.1.2-alpha.1
```

Their local DSH dev graph remains pinned to `0.1.1-rc.2`.

## Immediate task — local foundation verification and re-freeze decision

Do **not** resume Codex cleanup and do not repair code during the validation run unless a failing seam is first reported back for review.

Required local gates on the exact checked-out final remediation HEAD:

1. record `git rev-parse HEAD` and ensure the working tree is clean;
2. `pnpm install --frozen-lockfile`;
3. Core focused `test`, `check`, `build`;
4. Project Memory focused `test`, `check`, `build`;
5. full workspace `test`, `check`, `build`;
6. `pnpm verify:local`;
7. disposable official `0.1.2-alpha.1` compatibility verification for the changed Core authorization seam and Project Memory tool/filesystem/cancellation contracts as applicable;
8. overwrite `docs/verification/gemini/LATEST.md` with exact commands, exit codes, failures/skips and final verdict;
9. commit/push only that verification report, even on FAIL.

If all gates PASS, the next assistant pass may fold durable evidence into `docs/verification/README.md` and re-freeze Core/Project Memory in canonical docs. A failing gate reopens only the concrete failing seam; do not paper over it by restoring old freeze wording.

## Next task after foundation re-freeze — Codex cleanup and freeze

The next provider package remains:

```text
packages/codex
```

Its prior task block is paused, not cancelled. Codex does not inherit foundation alpha.1 compatibility automatically.

## Invariants to preserve

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

1. Fetch the current target file + SHA immediately before editing.
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
9. Assistant reads fresh `LATEST.md`; FAIL -> fix the exact cause, PASS -> fold durable evidence into `docs/verification/README.md` and continue.

## Hard constraints

- GitHub Actions/hosted CI are not used. Do not inspect or edit `.github/workflows/*`.
- No publish / merge / tag / release without explicit maintainer approval.
- Do not copy, parse, migrate or delete vendor credential/session/token stores.
- Windows remains **NOT TESTED**.
- Read command exit codes directly; avoid pipelines that mask failures.

## Remaining sequence after foundation

1. Codex cleanup/compatibility/freeze
2. Antigravity cleanup/compatibility/freeze
3. Claude usage-only cleanup/compatibility/freeze
4. repository-wide provider invariants
5. cross-provider/product live acceptance
6. install/profile lifecycle
7. final release gate
