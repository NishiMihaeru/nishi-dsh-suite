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

For a non-Git workspace, the normalized absolute session `cwd` is the project root.

## Tools

The package registers:

- `memory_read` — read `MEMORY.md` through special topic `memory`, or one named topic;
- `memory_write` — create/replace a topic or bootstrap and update the Memory map for new topics;
- `memory_edit` — deterministic exact-text replacement requiring exactly one match.

Topic ids are flat lowercase ASCII identifiers containing letters, digits and hyphens, at most 64 characters. `memory` and Windows reserved device names are rejected, which keeps topic paths inside `.dsh/memory`.

Limits:

- bootstrap: at most 25 KiB and 200 lines;
- topic file: at most 256 KiB.

Reads do not silently create missing memory files.

## Context injection

On `agent/pre-step` the runtime lazily initializes the project once per canonical root, reads `DSH.md` plus the bounded `MEMORY.md`, and adds a deterministic plugin instruction message when context is not already visible.

Topic files are never concatenated automatically. The bootstrap Memory map is the discovery surface; detailed topics are read on demand with `memory_read`.

Concurrent initialization of one root is deduplicated.

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

## Filesystem safety

Canonical `.dsh` and `.dsh/memory` path components must be real directories, not symlinks/junctions. Existing memory targets must be regular files.

Replacement writes use `@deepseek-ai/dsh-atomic-write`. The package revalidates the canonical parent and target before atomic replacement, so a pre-existing symlink target is rejected rather than followed. Initialization uses exclusive-create (`wx`) for files that are absent.

Atomic replacement guarantees old-or-new replacement of an individual target, but it is not by itself a multi-process read-modify-write transaction. Inter-process RMW serialization and compound topic/Memory-map mutation failure semantics are currently reopened integrity work and are tracked in `docs/ROADMAP.md`.

Project memory never owns vendor credentials or authentication state.

## Acceptance status

PM01 root consistency and PM02 rc.2-baseline final acceptance remain valid:

- package test/check/build PASS at accepted checkpoints;
- full workspace `pnpm verify:local` PASS;
- nested-cwd actual tool read/write/edit resolves to the project root;
- `.git` directory/file, nearest nested repo and no-Git fallback behavior verified;
- symlink/junction external-target protection PASS;
- shared atomic writer resolves in a disposable installed Suite profile;
- real Cordis deferred `commands + llm` injection PASS;
- real disposable DSH host boot and HTTP readiness PASS.

PM03 maintenance route timing is also accepted:

- implementation `0297fcc4eaecd4aace5c06b20000ea4539a7b3e1`;
- regression test `b3948f3443fc7d0418b64c688865fb7c0ec9eebf`;
- 25/25 package tests PASS;
- typecheck/build PASS;
- disposable runtime probe against official DSH `dsh-v0.1.2-alpha.1` (`cd5ef8148158c3a752a658978873241fdf8e2bbc`) PASS;
- compatibility with installed `0.1.1-rc.2` `agent/inbox/claimed` contract confirmed.

The package is **REOPENED**, not frozen, until the remaining integrity/compatibility items in `docs/ROADMAP.md` pass.

Windows remains **NOT TESTED** for rc.3.
