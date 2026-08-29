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

Topic ids are flat lowercase ASCII identifiers containing letters, digits and hyphens, at most 64 characters. `memory` and Windows reserved device names are rejected.

Limits:

- bootstrap: at most 25 KiB and 200 lines;
- topic file: at most 256 KiB.

The bootstrap limit is also an ingestion bound. Read-only bootstrap retrieval reads only a small bounded prefix needed to construct the 25 KiB/200-line projection. Read-modify-write bootstrap paths reject an oversized persisted `MEMORY.md` from file metadata before materializing it. Existence-only paths read zero content bytes.

Reads do not silently create missing memory files.

## Context injection and cancellation

On `agent/pre-step` the runtime lazily initializes the project, reads `DSH.md` plus bounded `MEMORY.md`, and adds deterministic plugin context when the same project context is not already visible. Topic files are read on demand.

Successfully initialized roots are cached in-process. Concurrent first-use initialization is not represented by one shared promise because one caller's cancellation must not cancel another caller's initialization; the filesystem protocol is idempotent and cross-process serialized instead.

Model-facing operations forward the DSH `ToolRunContext.signal` through root discovery, recovery, lock acquisition, reads and ordinary commit boundaries. Once a partial compound mutation has already crossed a durable participant replacement boundary, rollback becomes mandatory settlement and deliberately stops consulting the already-fired caller signal until exact pre-images/WAL state are restored.

## Filesystem safety

On POSIX, package-owned descendants are opened through one pinned descriptor chain:

```text
projectRoot -> .dsh -> memory/local
```

Each level validates device/inode identity and uses `/proc/self/fd/<fd>` or `/dev/fd/<fd>` when available. Reads open the final file once, use `O_NOFOLLOW` where available, validate the opened inode against the visible entry, and then read from that handle. Replacement writes, first-publication temp files, hard-link publication and rename operate relative to the same opened parent-directory identity.

Windows has no equivalent Node directory-fd/openat surface in this implementation; it uses fallback path operations plus identity revalidation and remains **NOT TESTED**. Strong descriptor-chain TOCTOU claims are POSIX-only.

The implementation does not `fsync` file contents or parent directories, so sudden power-loss/storage-durability guarantees are explicitly out of scope.

## Writer locking

Project Memory uses the DSH-compatible `<target>.lock` **namespace** for RMW serialization. Current Project Memory writers publish a generation-safe populated lock directory at that path. The directory contains one owner marker with:

- format version;
- owner PID;
- a random per-acquisition owner token;
- an OS process-birth identity when available.

The canonical lock directory is published atomically only after its owner marker exists. Release/removal verifies the exact observed owner generation. After the marker is removed, `rmdir` can succeed only if the canonical pathname still points to that same now-empty directory; a replacement owner publishes a populated directory, so a delayed old finalizer cannot remove it.

Legacy numeric-PID regular `<target>.lock` files remain readable/removable only for recovery compatibility with pre-change state. Current Project Memory writers no longer create them.

The namespace remains interoperable with `@deepseek-ai/dsh-atomic-write`: an upstream regular-file lock blocks current Project Memory acquisition, while upstream exclusive creation observes the current populated directory lock as contention. Regression coverage exists for both directions; executable confirmation is pending the new validation run.

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

Protocol:

1. open one pinned `projectRoot -> .dsh -> {memory, local}` generation;
2. hold `MEMORY.md` then topic lock;
3. capture bounded participant pre-images;
4. publish the `pending` journal mode `0600`;
5. replace topic participant;
6. replace Memory-map participant;
7. atomically replace the journal with `committed`, preserving mode `0600`;
8. while the participant locks are **still held**, best-effort remove only that exact committed journal generation;
9. release locks/scopes.

The committed phase transition is the logical commit point. Cleanup is deliberately outside rollback semantics: cleanup failure after commit leaves preserve-and-clean recovery metadata rather than rolling participants back.

Generation checking prevents delayed cleanup from an earlier transaction from deleting a later transaction that happens to reuse the one fixed journal pathname.

Recovery semantics:

- dead `pending` -> claim, restore exact pre-images, remove that journal generation;
- dead `committed` -> preserve new participants, remove stale protocol metadata only;
- live matching owner -> cross the `MEMORY.md` writer barrier before deciding whether anything remains to settle;
- recycled PID with mismatched process identity -> owner is stale, not live;
- ownership/WAL mutation that makes coherent state unprovable after recovery has begun -> fail closed.

## Architectural simplification

Recovery is owned by the domain operations that require it. Tool wrappers no longer perform a redundant pre-dispatch recovery and then call domain functions that recover again. This reduces I/O and recovery interleavings without changing the tool contract.

The transaction/lock generation fields are intentional complexity: they replace unsafe pathname/PID guesses with explicit ownership invariants and are retained because they directly close durability races found by the audit.

## Supported DSH peer family

Production DSH peers remain restricted to:

```text
0.1.1-rc.2 || 0.1.2-alpha.1
```

The package devDependency graph remains pinned to rc.2, so normal local tests alone are not proof of alpha.1 compatibility. The changed tree must be explicitly exercised against official `dsh-v0.1.2-alpha.1` at commit `cd5ef8148158c3a752a658978873241fdf8e2bbc`.

## Current status — REOPENED / PENDING VERIFICATION

The fresh independent alpha.1 audit reopened Project Memory and found journal-generation cleanup, stale-lock replacement, PID-reuse recovery, unbounded bootstrap ingestion and journal permission defects. The current branch implements generation-safe journal/lock ownership, process-birth identity where supported, bounded bootstrap ingestion and owner-only journal phase replacement, with targeted regression tests for the concrete interleavings.

The changed code has been statically reviewed against the exact upstream alpha.1 filesystem/atomic-write contracts, but it has **not yet received the new executable Gemini/local validation run**. Earlier PASS counts apply only to their earlier implementation checkpoint and must not be treated as validation of this head.

Windows remains **NOT TESTED**.
