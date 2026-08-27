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

Registration uses Cordis `ctx.inject(['commands', 'llm'], ...)`, so command handlers have authorized access to both services. Model selection is scoped to the scheduled maintenance turn and cleaned on idle, stop, error or steering failure. A second maintenance command on the same agent is rejected while one is pending/active.

Maintenance directives permit only durable project facts. They explicitly reject secrets, credentials, quota/usage snapshots, raw chain-of-thought, transient logs and personal facts about the operator because project memory is committed and shared with the repository.

There is currently no `memory_delete` tool; consolidation is rewrite/edit based, and the directives explicitly forbid substituting shell deletion for a missing memory operation.

## Filesystem safety

Canonical `.dsh` and `.dsh/memory` path components must be real directories, not symlinks/junctions. Existing memory targets must be regular files.

Replacement writes use `@deepseek-ai/dsh-atomic-write`. The package revalidates the canonical parent and target before the atomic replacement, so a pre-existing symlink target is rejected rather than followed. Initialization uses exclusive-create (`wx`) for files that are absent.

Project memory never owns vendor credentials or authentication state.

## Acceptance status

Project Memory completed PM01 root-consistency validation and PM02 Final Acceptance:

- package test/check/build PASS;
- full workspace `pnpm verify:local` PASS;
- nested-cwd actual tool read/write/edit resolves to the project root;
- `.git` directory/file, nearest nested repo and no-Git fallback behavior verified;
- symlink/junction external-target protection PASS;
- shared atomic writer resolves in a disposable installed Suite profile;
- real Cordis deferred `commands + llm` injection PASS;
- real disposable DSH host boot and HTTP readiness PASS.

The package is treated as **DONE / FROZEN** for the remainder of rc.3 unless a new reproducible blocker requires reopening it.

Windows remains **NOT TESTED** for rc.3.
