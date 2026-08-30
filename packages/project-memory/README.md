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

For Git workspaces, session `cwd` is walked upward to the nearest `.git` marker. A `.git` directory and worktree-style `.git` file are both accepted. For a non-Git workspace, normalized absolute session `cwd` is the project root. Context injection and all memory tools use the same resolver.

An explicit workspace root may itself be represented by a symlink path. Package-owned canonical `.dsh`, `.dsh/memory`, and `.dsh/local` final components must remain real directories.

## Tools and bounds

The package registers:

- `memory_read` — read `MEMORY.md` through special topic `memory`, or one named topic;
- `memory_write` — create/replace a topic or bootstrap;
- `memory_edit` — deterministic exact-text replacement requiring exactly one match.

Named-topic model-facing writes/edits use a journaled compound transaction so topic content and the canonical `MEMORY.md` map entry move together across ordinary errors and process death.

There is intentionally no destructive `memory_delete` tool. Retiring or removing a topic is a two-step operation: remove the topic file under `.dsh/memory/<topic>.md`, and remove its mapping line from `## Memory map` in `.dsh/memory/MEMORY.md` using `memory_edit(topic="memory", ...)` (or run `/consolidate`).

Topic ids are flat lowercase ASCII identifiers containing letters, digits and hyphens, at most 64 characters. `memory` and Windows reserved device names are rejected.

Limits:

- bootstrap: at most 25 KiB and 200 lines;
- topic file: at most 256 KiB.

The bootstrap limit is also an ingestion bound. Read-only bootstrap retrieval reads only the bounded prefix needed to construct the 25 KiB/200-line projection. Read-modify-write bootstrap paths reject an oversized persisted `MEMORY.md` from file metadata before materializing it. Existence-only paths read zero content bytes.

Reads do not silently create missing memory files.

## Context injection and cancellation

On `agent/pre-step` the runtime lazily initializes the project, reads `DSH.md` plus bounded `MEMORY.md`, and adds deterministic plugin context when the same project context is not already visible. Topic files are read on demand.

Successfully initialized roots are cached in-process. Concurrent first-use initialization is not represented by one shared promise because one caller's cancellation must not cancel another caller's initialization; the filesystem protocol is idempotent and cross-process serialized instead.

Model-facing operations forward the DSH `ToolRunContext.signal` through root discovery, recovery, lock acquisition, reads and ordinary commit boundaries. Once a partial compound mutation has crossed a durable participant replacement boundary, rollback becomes mandatory settlement and deliberately stops consulting the already-fired caller signal until exact pre-images/WAL state are restored.

## Filesystem safety

On POSIX, package-owned descendants are opened through one pinned descriptor chain:

```text
projectRoot -> .dsh -> memory/local
```

Each level validates device/inode identity and uses `/proc/self/fd/<fd>` or `/dev/fd/<fd>` when available. Reads open the final file once, use `O_NOFOLLOW` where available, validate the opened inode against the visible entry, and then read from that handle. Replacement writes, first-publication temp files, hard-link publication and rename operate relative to the same opened parent-directory identity.

If a regular file was successfully opened but the canonical pathname is concurrently unlinked before the visible identity check, the read reports current namespace absence (`null`) rather than returning stale bytes from the now-unlinked inode. If the pathname instead resolves to another inode, a symlink or a non-file entry, the operation still fails closed.

Windows has no equivalent Node directory-fd/openat surface in this implementation; it uses fallback path operations plus identity revalidation and remains **NOT TESTED**. Strong descriptor-chain TOCTOU claims are POSIX-only.

The implementation does not `fsync` file contents or parent directories, so sudden power-loss/storage-durability guarantees are explicitly out of scope.

## Writer locking

Project Memory uses the DSH-compatible `<target>.lock` namespace for RMW serialization. Current writers publish a generation-safe populated lock directory containing one owner marker with:

- format version;
- owner PID;
- random per-acquisition owner token;
- OS process-birth identity when available.

The temp lock directory is populated before publication. Publication uses `rename(tempLockPath, lockPath)`. Structural destination-collision errno values (`EEXIST`, `ENOTEMPTY`, `ENOTDIR`, `EISDIR`) from that publication step are treated as authoritative contention and are not rechecked through a racy pathname `lstat()` after the holder may already have released the lock. Temp-directory/marker preparation errors remain ordinary failures rather than being swallowed as contention.

Release/removal verifies the exact observed owner generation. After the marker is removed, `rmdir()` succeeds only if the canonical pathname still points to the same now-empty directory; a replacement owner publishes a populated directory, so a delayed old finalizer cannot remove it.

Legacy numeric-PID regular `<target>.lock` files remain readable/removable only for recovery compatibility with pre-change state. Current Project Memory writers no longer create them.

The namespace is interoperable with `@deepseek-ai/dsh-atomic-write`: an upstream regular-file lock blocks current Project Memory acquisition, while upstream exclusive creation observes the current populated directory lock as contention. Both directions were exercised in the accepted Foundation validation.

A numeric PID alone is not accepted as current-generation ownership when persisted state carries a process identity. Linux uses `/proc/<pid>/stat` process start time; macOS uses `ps` process start time. This prevents PID reuse by an unrelated live process from indefinitely preserving a dead transaction/lock. When no reliable process-birth identity can be obtained, recovery fails closed and treats a live PID as live rather than guessing stale ownership.

## Named-topic crash transaction

Named-topic mutations use fixed participant lock order:

```text
MEMORY.md -> <topic>.md
```

Before either participant changes, `.dsh/local/project-memory-transaction.json` stores exact pre-images plus transaction metadata. Current journals contain:

- journal version;
- `pending` / `committed` phase;
- owner PID;
- optional process-birth identity;
- random transaction-generation id;
- topic id;
- exact pre-images for topic and `MEMORY.md`.

Older journals without the new generation/identity fields remain readable for one-way recovery compatibility.

Current journals use `transactionId` as generation identity. For legacy journals without `transactionId`, generation comparison is based on immutable transaction payload (`topic`, `topicBefore`, `memoryBefore`) while owner PID/identity is checked separately. Recovery therefore permits a legitimate claim rewrite of ownership, and re-observes rather than fails when ownership changed before it could claim.

Protocol:

1. open one pinned `projectRoot -> .dsh -> {memory, local}` generation;
2. hold `MEMORY.md` then topic lock;
3. capture bounded participant pre-images;
4. publish the `pending` journal mode `0600`;
5. replace topic participant;
6. replace Memory-map participant;
7. atomically replace the journal with `committed`, preserving mode `0600`;
8. while participant locks are still held, best-effort remove only that exact committed journal generation;
9. release locks/scopes.

The committed phase transition is the logical commit point. Cleanup is outside rollback semantics: cleanup failure after commit leaves preserve-and-clean recovery metadata rather than rolling participants back.

Generation checking prevents delayed cleanup from an earlier transaction from deleting a later transaction that reuses the fixed journal pathname.

Recovery semantics:

- dead `pending` -> claim, restore exact pre-images, remove that journal generation;
- dead `committed` -> preserve new participants, remove stale protocol metadata only;
- live matching owner -> cross the `MEMORY.md` writer barrier before deciding whether anything remains to settle;
- recycled PID with mismatched process identity -> owner is stale, not live;
- a journal is claimed only after a read taken under the journal lock proves its owner dead;
- any pre-claim disagreement between that locked read and the caller's earlier unlocked read — journal gone, generation or phase replaced, owner transferred either way, owner alive again — is a stale observation rather than lost proof, since no participant has been touched. Recovery re-observes from scratch, up to a small bound, and the fresh read decides again whether to await a live owner or claim a dead one;
- ownership/WAL mutation that makes coherent state unprovable *after* this process wrote its own claim -> fail closed.

Concurrent recovery of the same abandoned journal is an ordinary outcome, not an error: one caller settles it and returns `true`, the others return `false`. A caller never has its own unrelated read or write fail because it lost that race. Past the observation bound recovery returns `false` instead of looping, which stays safe because a journal that genuinely remains still blocks the next transaction through its exclusive create.

## Architectural simplification

Recovery is owned by the domain operations that require it. Tool wrappers no longer perform a redundant pre-dispatch recovery and then call domain functions that recover again. This reduces I/O and recovery interleavings without changing the tool contract.

The transaction/lock generation fields are intentional correctness complexity: they replace unsafe pathname/PID guesses with explicit ownership invariants and directly close durability races found by the audit.

## Supported DSH peer family

The only supported DSH generation is `0.1.2-alpha.1` (`cd5ef8148158c3a752a658978873241fdf8e2bbc`). `0.1.1-rc.2` and earlier are **not supported**: no compatibility claim, no fixes, no new evidence.

Declared production DSH peers are still wider than that:

```text
0.1.1-rc.2 || 0.1.2-alpha.1
```

Upstream has not published `0.1.2-alpha.1` to npm, so an alpha.1-only range would be uninstallable and the package devDependency graph stays pinned to rc.2. Narrowing the range is a published-contract change with its own gate; see the repository `docs/README.md`.

The alpha.1 side of the peer claim is accepted because the frozen Foundation was explicitly exercised against official `dsh-v0.1.2-alpha.1` at that commit.

## Current status — THAWED, PENDING RE-VALIDATION

A follow-up audit changed this package after the acceptance recorded below: benign pre-claim recovery races re-observe instead of failing an unrelated caller's operation, the two user-owned files initialization rewrites are read under explicit bounds, and the writer-lock wait budget is now 10 s and overridable per scope. The accepted evidence below therefore describes a tree this one no longer matches, and must not be cited for the current implementation.

Superseded accepted Foundation implementation:

```text
7cd4d5b17625f9b3a21b741555df6597fd9cb889
```

Raw follow-up PASS report commit:

```text
d1cbac7094488ded52d9ab83891531bc01197090
```

Accepted Project Memory evidence records:

- focused tests `64/64` PASS;
- Project Memory check/build PASS;
- full workspace test/check/build and `pnpm verify:local` PASS;
- 20/20 repeated iterations of `atomic-write`, `compound-transaction`, and `transaction-recovery` suites, 460 assertions total;
- zero unexpected lingering lock/WAL protocol state after exercised success/recovery paths;
- bidirectional upstream atomic-write lock interoperability PASS;
- disposable exact-commit alpha.1 `memory_read`, `memory_write`, `memory_edit`, cancellation and pending-recovery probes PASS;
- independent follow-up review found no new blocking Project Memory/Foundation defect.

Windows remains **NOT TESTED**.
