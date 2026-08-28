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
- `memory_write` — create/replace a topic or bootstrap;
- `memory_edit` — deterministic exact-text replacement requiring exactly one match.

For named topics, `memory_write` and `memory_edit` use a compound transaction that keeps the topic file and its canonical `MEMORY.md` map entry consistent. Bootstrap topic `memory` remains a single-file operation.

Topic ids are flat lowercase ASCII identifiers containing letters, digits and hyphens, at most 64 characters. `memory` and Windows reserved device names are rejected, which keeps topic paths inside `.dsh/memory`.

Limits:

- bootstrap: at most 25 KiB and 200 lines;
- topic file: at most 256 KiB.

Reads do not silently create missing memory files.

## Context injection

On `agent/pre-step` the runtime lazily initializes the project once per canonical root, reads `DSH.md` plus the bounded `MEMORY.md`, and adds a deterministic plugin instruction message when context is not already visible.

Topic files are never concatenated automatically. The bootstrap Memory map is the discovery surface; detailed topics are read on demand with `memory_read`.

Concurrent initialization of one root is deduplicated inside one process; shared file writers are also serialized across DSH processes as described below.

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

Canonical `.dsh` and `.dsh/memory` path components must be real directories, not symlinks/junctions. Existing memory targets must be regular files.

Replacement writes use `@deepseek-ai/dsh-atomic-write`. The package revalidates the canonical parent and target before atomic replacement, so a pre-existing symlink target is rejected rather than followed. Initialization keeps exclusive-create (`wx`) behavior for absent user-visible files where overwriting a non-cooperating external creator would be unsafe.

Every Project Memory file that participates in read-modify-write uses DSH's `withFileLock()` with the exact target path as its lock namespace (`<target>.lock`). The lock covers the complete read/render/atomic-commit cycle, and whole-file writers of the same target honor that same lock.

Current serialized shared writers are:

- `.dsh/memory/MEMORY.md`: bootstrap create/write/edit and Memory-map updates;
- `.dsh/memory/<topic>.md`: whole-file writes and exact edits;
- root `.gitignore`: initializer create/update of the `.dsh/local/` rule.

Named-topic tool mutations additionally use a bounded two-file transaction with a fixed lock order:

```text
MEMORY.md -> <topic>.md
```

The Memory-map render is preflighted while `MEMORY.md.lock` is held, before the topic changes. The topic mutation then runs under its own lock. The map commit happens while both locks are still held. If that late map commit fails, an existing topic is restored to its exact previous bytes or a newly created topic is removed before either lock is released. If rollback itself fails, the original map failure and rollback failure are surfaced together as an `AggregateError` at the storage layer.

A missing `MEMORY.md` is represented in-memory by the approved initial bootstrap during preflight and is not created until the successful map commit, so a failed topic operation does not leave a new bootstrap behind.

Readers remain lock-free because the final replacement is atomic. `DSH.md` and `.dsh/project.json` are create-if-absent state rather than read-modify-write and retain exclusive-create conflict handling.

Project memory never owns vendor credentials or authentication state.

## Supported DSH peer family

The production DSH peers are restricted to the two generations with direct source/runtime validation:

```text
0.1.1-rc.2 || 0.1.2-alpha.1
```

The explicit union deliberately avoids claiming untested intermediate or future prereleases. Local `devDependencies` remain pinned to the reproducible installed `0.1.1-rc.2` baseline; official `dsh-v0.1.2-alpha.1` is exercised in disposable source/runtime probes instead of replacing the main workspace dependency graph.

## Acceptance status

PM01 root consistency and PM02 rc.2-baseline acceptance remain valid.

PM03 maintenance route timing is accepted through `b3948f3443fc7d0418b64c688865fb7c0ec9eebf` with actual alpha.1 model-selection lifecycle proof.

PM04 inter-process per-file RMW serialization is accepted on implementation HEAD `eae9caf03f8896f344d7c73b2f67d67cb9f86e9c`: real multi-process contention/stress, foreign-lock preservation, symlink safety and alpha.1 locking behavior PASS.

PM05 compound named-topic + Memory-map transaction integrity is accepted on implementation HEAD `dbe1b7a3894bc05c1c4863148060bff59166bc17`: fixed lock order, deterministic map preflight, late-map rollback for new/existing topics, exact-byte restore, explicit rollback-failure aggregation and actual model-facing tool-path coverage PASS.

The final foundation re-freeze passed on implementation HEAD `0c7a177d2f4fceab58513cbd0d87fcf9c31b025b`: Project Memory `39/39`, full workspace `270/270`, frozen install and `pnpm verify:local` PASS, with actual rc.2 + official alpha.1 runtime/tool/locking/maintenance evidence. Project Memory is **FROZEN** for provider work. Reopen it only for a new reproducible memory regression or an explicitly scoped future DSH compatibility generation.

Windows remains **NOT TESTED** for rc.3.
