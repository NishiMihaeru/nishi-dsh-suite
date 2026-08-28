# nishi-dsh-project-memory

Project-scoped durable memory for Nishi DSH Suite / DeepSeek Harness.

This package is provider-agnostic. Memory lives in the project and is exposed through ordinary DSH tools, so switching the primary provider does not switch memory implementations.

## Canonical project state

Under the discovered project root the package owns:

- `DSH.md` — stable project contract;
- `.dsh/project.json` — DSH project metadata (`schemaVersion: 1`);
- `.dsh/memory/MEMORY.md` — bounded bootstrap summary;
- `.dsh/memory/<topic>.md` — durable topic memories;
- `.dsh/local/` — transient local state, kept out of version control by the initializer.

For Git workspaces, session `cwd` is walked upward to the nearest `.git` marker. A `.git` directory and a worktree-style `.git` file are both accepted. Context injection and all memory tools use the same root resolver, so starting a session in a nested directory cannot create a second nested `.dsh/memory` tree.

For a non-Git workspace, the normalized absolute session `cwd` is the project root. An explicit workspace root may itself be represented by a symlink path; the package binds operations to the resolved directory inode while keeping the owned `.dsh`, `.dsh/memory`, and `.dsh/local` final components as real directories.

## Tools

The package registers:

- `memory_read` — read `MEMORY.md` through special topic `memory`, or one named topic;
- `memory_write` — create/replace a topic or bootstrap;
- `memory_edit` — deterministic exact-text replacement requiring exactly one match.

For named topics, `memory_write` and `memory_edit` use a journaled compound transaction that keeps the topic file and its canonical `MEMORY.md` map entry consistent across ordinary errors and process death. Bootstrap topic `memory` remains a single-file operation.

Topic ids are flat lowercase ASCII identifiers containing letters, digits and hyphens, at most 64 characters. `memory` and Windows reserved device names are rejected, which keeps topic paths inside `.dsh/memory`.

Limits:

- bootstrap: at most 25 KiB and 200 lines;
- topic file: at most 256 KiB.

Reads do not silently create missing memory files.

Every model-facing memory operation forwards the DSH `ToolRunContext.signal` through project-root discovery, recovery, lock acquisition, reads and commit boundaries. Cancellation while waiting for a writer lock rejects before the mutation runs; cancellation is checked again immediately before atomic commit points. If cancellation is the cause of failure, the tool rethrows the caller's cancellation reason rather than sanitizing it into an ordinary Project Memory error.

If cancellation or another failure happens after the first participant has already been durably replaced, rollback is mandatory settlement rather than new user work. Settlement reuses the already-opened directory identities and writer locks but deliberately stops consulting the caller's already-fired `AbortSignal` until exact pre-images and WAL state are restored. This prevents a cancelled compound mutation from leaving a known partial state merely because the cancellation itself would otherwise abort rollback.

## Context injection

On `agent/pre-step` the runtime lazily initializes the project, reads `DSH.md` plus the bounded `MEMORY.md`, and adds a deterministic plugin instruction message when context is not already visible.

Topic files are never concatenated automatically. The bootstrap Memory map is the discovery surface; detailed topics are read on demand with `memory_read`.

Successfully initialized roots are cached in-process. Concurrent first-use initialization is intentionally not represented by one shared promise because one agent's cancellation must not cancel another agent's initialization. The filesystem protocol is idempotent and cross-process serialized instead, and each pre-step owns its own `AbortSignal`.

## Maintenance commands

When both DSH `commands` and `llm` services are available, the package registers:

```text
/memory <provider>/<model>
/consolidate <provider>/<model>
```

Registration uses Cordis `ctx.inject(['commands', 'llm'], ...)`, so command handlers have authorized access to both services.

The exact steered maintenance message activates the temporary provider/model selection on `agent/inbox/claimed`, before DSH prompt assembly snapshots model selection for the step. This guarantees that the first maintenance request uses the requested route. Selection is scoped to the maintenance turn and cleaned on idle, matching stop/error or steering failure. A second maintenance command on the same agent is rejected while one is pending/active.

Maintenance directives permit only durable project facts. They explicitly reject secrets, credentials, quota/usage snapshots, raw chain-of-thought, transient logs and personal facts about the operator because project memory is committed and shared with the repository.

There is currently no `memory_delete` tool; consolidation is rewrite/edit based, and the directives explicitly forbid substituting shell deletion for a missing memory operation.

## Filesystem safety and transactions

Canonical `.dsh`, `.dsh/memory`, and `.dsh/local` final path components must be real directories, not symlinks/junctions. Existing canonical file targets must be regular files. The explicit project root or DSH home may be a symlink path, but that allowance does not extend to package-owned canonical components.

On POSIX, Project Memory does not reopen package-owned descendants from a complete replaceable pathname. The storage layer opens the explicit project root first, then opens `.dsh` as a direct real child of that root, then opens `memory` and `local` as direct real children of the already-opened `.dsh`. Each level verifies device/inode identity and uses `/proc/self/fd/<fd>` or `/dev/fd/<fd>` when available. As a result, replacing an intermediate `.dsh` pathname with a symlink/junction cannot redirect a later `.dsh/memory` or `.dsh/local` operation outside the directory generation that was actually opened.

File reads open the final file once, use `O_NOFOLLOW` where available, validate the opened inode against the visible final entry, then read bytes from that handle. Replacement writes, temp-file creation, hard-link publication and rename all occur relative to the same opened parent-directory identity.

Read-modify-write operations go further: lock acquisition and every read/write performed by that critical section share one `SafeDirectoryScope` backed by the same opened parent directory. Named-topic compound mutations open `memory` and `local` as siblings of one pinned `.dsh` scope; `MEMORY.md.lock`, the nested topic lock, participant snapshots, participant commits and rollback stay on the same memory scope, while WAL publication/phase change/cleanup stay on the paired local scope. Successful scopes are post-validated against their logical pathnames, so namespace replacement cannot silently redirect I/O and still be reported as success.

Windows has no equivalent Node directory-fd/openat surface in this implementation; it uses the fallback path plus identity revalidation and remains **NOT TESTED** for rc.3. No strong Windows TOCTOU claim is made.

Replacement writes create a complete sibling temp inode and rename it through the anchored parent. First publication of `DSH.md`, `.dsh/project.json`, `MEMORY.md`, and a newly created `.gitignore` entry is also complete-before-visible: the package writes a sibling temp inode first, then publishes it with a no-clobber hard-link commit. A concurrent external creator is preserved rather than overwritten, and a process death cannot leave a canonical zero/partial file merely because the pathname was opened with `wx` before its content finished writing.

These guarantees cover process-level interruption and atomic namespace publication. The implementation does not `fsync` file contents and parent directories, so sudden power-loss/storage-durability guarantees are explicitly out of scope.

Every Project Memory read-modify-write target uses the same `<target>.lock` namespace as `@deepseek-ai/dsh-atomic-write`. Lock acquisition is cross-process and `AbortSignal`-aware, and the lock covers the complete read/render/atomic-commit cycle. Whole-file writers of the same target honor that same namespace.

Current serialized shared writers are:

- `.dsh/memory/MEMORY.md`: bootstrap create/write/edit and Memory-map updates;
- `.dsh/memory/<topic>.md`: whole-file writes and exact edits;
- root `.gitignore`: initializer create/update of the `.dsh/local/` rule.

Named-topic tool mutations additionally use a fixed lock order:

```text
MEMORY.md -> <topic>.md
```

Before either participant changes, the transaction writes `.dsh/local/project-memory-transaction.json` with the exact pre-images of the topic and `MEMORY.md`. The journal has two phases:

- `pending` — the transaction is not committed; recovery restores both exact pre-images (or removes a file that did not previously exist);
- `committed` — both participant writes completed and the journal itself was atomically changed to `committed` while both participant locks were still held; recovery preserves the new participants and only removes stale protocol locks/journal metadata.

The journal phase change is the logical commit point. Cleanup after lock release is best-effort and idempotent: a surviving committed journal is safe and is settled by the next Memory-map critical section or crash recovery. A dead owner is never inferred from file age; recovery checks the recorded PID and only removes lock files whose recorded owner is no longer alive. If the recorded owner process is still alive, recovery first waits until it can acquire `MEMORY.md.lock`; a `pending` journal that still exists after that lock barrier is no longer an active compound transaction and is rolled back under the normal `MEMORY.md -> topic.md` lock order.

Recovery is fail-closed after unresolved WAL state has been observed. If a journal changes from the expected dead owner to another live owner before recovery can claim it, recovery rejects instead of returning an ordinary "nothing recovered" result. Likewise, disappearance or incompatible mutation of the journal after the recovery protocol has begun is treated as an error because coherent participant state can no longer be proven from the captured pre-images.

The Memory-map render is preflighted while `MEMORY.md.lock` is held, before topic mutation. Ordinary pre-commit failures restore both exact pre-images before the locks are released. A missing `MEMORY.md` is modeled using the approved initial bootstrap during preflight and is not published as a side effect of a failed topic operation.

Readers remain lock-free because replacement publication is atomic and reads are handle-based. Project memory never owns vendor credentials or authentication state.

## Supported DSH peer family

The production DSH peers are restricted to the two generations with direct source/runtime validation:

```text
0.1.1-rc.2 || 0.1.2-alpha.1
```

The explicit union deliberately avoids claiming untested intermediate or future prereleases. Local `devDependencies` remain pinned to the reproducible installed `0.1.1-rc.2` baseline; official `dsh-v0.1.2-alpha.1` compatibility is established from the upstream source/runtime contracts and should additionally be exercised in the project's disposable alpha.1 verification environment before re-freeze.

## Acceptance status

The historical PM01-PM05 acceptance records remain useful history, but the independent `dsh-v0.1.2-alpha.1` audit reopened Project Memory after finding filesystem TOCTOU, first-publication crash safety, cooperative cancellation, and cross-file crash-consistency defects.

The current remediation line addresses those findings with the full POSIX descriptor chain `projectRoot -> .dsh -> memory/local`, stable lock/RMW scopes, complete-before-visible first publication, end-to-end `AbortSignal` propagation, mandatory settlement after a durable partial commit, and the `pending`/`committed` recovery journal described above. Regression coverage now includes static symlinks, symlinked explicit roots, replacement of the locked parent directory, replacement of intermediate `.dsh` with an external symlink, cancellation while waiting for locks, settlement after cancellation, multi-process serialization, pending/committed crash recovery, abandoned live-PID recovery, recovery ownership transfer, and idempotent concurrent cleanup.

This README deliberately does **not** re-declare Project Memory `FROZEN` yet. A fresh local package test/typecheck/build plus the repository verification gates must pass on the final remediation HEAD before the foundation is re-frozen. No such executable verification is inferred from source review alone.

Windows remains **NOT TESTED** for rc.3.
