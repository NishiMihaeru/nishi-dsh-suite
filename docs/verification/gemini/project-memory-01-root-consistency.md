# Project Memory 01 — Root consistency

Tested commit: 80f1272d2a7a8bdee66303eb80d064a265106a25
Branch: feat/core-provider-plugins-rc3
Node: v24.19.0
Node path: /home/acedia/.local/share/fnm/node-versions/v24.19.0/installation/bin/node
pnpm: 11.21.0

## Commands

### test
Command: `pnpm --filter nishi-dsh-project-memory test`
Exit code: 0
Result: PASS

Output details:
- Total tests: 21
- Passed: 21
- Failed: 0
- Suites: 0, Skipped: 0, Todo: 0
- Duration: ~192ms

### check
Command: `pnpm --filter nishi-dsh-project-memory check`
Exit code: 0
Result: PASS

Output: `tsc -p tsconfig.json --noEmit` exited with code 0 and zero diagnostics.

### build
Command: `pnpm --filter nishi-dsh-project-memory build`
Exit code: 0
Result: PASS

Output: `tsc -p tsconfig.json` emitted compiled JavaScript and `.d.ts` declaration files into `packages/project-memory/lib/`.

## Root contract

Resolution analysis between context injection and tool execution:

1. **Context injection** (`packages/project-memory/src/runtime.ts`):
   - Receives raw session working directory from `payload.agent?.session?.header?.cwd`.
   - Validates that `rawCwd` is a non-empty absolute path string.
   - Discovers project root via `findProjectRoot(rawCwd, payload.signal)`.
   - Ensures initialization and reads context from discovered `projectRoot`.

2. **Memory tools** (`packages/project-memory/src/tools.ts`):
   - Helper `projectRootFromToolExecution(exec)` extracts `exec.agent?.session?.header?.cwd`.
   - Fails closed if session `cwd` is absent or empty.
   - Discovers project root via the shared `findProjectRoot(cwd, exec.signal)`.
   - Forwards `exec.signal` directly into root discovery for cancellation propagation.

3. **Tool operations scoping**:
   - `memory_read`: reads `readProjectMemoryBootstrap(projectRoot)` or `readTopicMemory(projectRoot, args.topic)` using discovered `projectRoot`.
   - `memory_write`: writes `writeProjectMemoryBootstrap(projectRoot, args.content)` or `writeTopicMemory(projectRoot, args.topic, args.content)` and updates map via `ensureMemoryMapEntry(projectRoot, args.topic)` on `projectRoot`.
   - `memory_edit`: edits `editProjectMemoryBootstrap(projectRoot, ...)` or `editTopicMemory(projectRoot, ...)` and updates map via `ensureMemoryMapEntry(projectRoot, args.topic)` on `projectRoot`.

4. **Consistency**:
   - For a git repository located at `repo/.git` with session cwd `repo/packages/feature/src`, both context injection and all memory tools resolve to `repo`.
   - Memory is strictly read and written under `repo/.dsh/memory/`.
   - Nested `.dsh/memory/` directories (e.g. `repo/packages/feature/src/.dsh/memory`) are never created.

## Actual tool execution

Direct runtime probe executed registered tool instances with a live Cordis registration harness and simulated nested session cwd (`repo/packages/foo/src` inside a git repository root `repo/`):

1. **`memory_write` probe**:
   - Input: `{ topic: "architecture", content: "# Architecture\nLayered design." }` with session cwd `repo/packages/foo/src`.
   - Result: successfully created `repo/.dsh/memory/architecture.md` (30 bytes).
   - Bootstrap map: automatically created/updated `repo/.dsh/memory/MEMORY.md` containing `- \`architecture\` → \`.dsh/memory/architecture.md\``.
   - Filesystem verification: confirmed `repo/packages/foo/src/.dsh/` was NOT created.

2. **`memory_read` probe**:
   - Input: `{ topic: "architecture" }` with session cwd `repo/packages/foo/src`.
   - Result: returned `{ topic: "architecture", exists: true, content: "# Architecture\nLayered design." }`.

3. **`memory_edit` probe**:
   - Input: `{ topic: "architecture", old_text: "Layered design.", new_text: "Modular layered design." }`.
   - Result: updated `repo/.dsh/memory/architecture.md` atomically; subsequent read confirmed updated content.

4. **Bootstrap topic probe**:
   - Reading/writing special topic `"memory"` operates on `repo/.dsh/memory/MEMORY.md`.

5. **Concurrent tool executions**:
   - Concurrent writes from different nested subpackages (`repo/packages/pkg-a/src` and `repo/packages/pkg-b/src`) resolved to identical root and updated `MEMORY.md` atomically without race corruption.

## Git behavior

Verification of upward directory walk in `findProjectRoot`:

1. **`.git` directory**:
   - Standard git repository roots (`repo/.git/` directory) are detected by `lstat` during upward traversal.

2. **`.git` regular file (git worktree / submodule)**:
   - Verified with `.git` created as a regular file containing `gitdir: /path/to/worktree`.
   - `lstat` successfully identifies the entry; root is correctly resolved to the worktree directory without parsing git internals.

3. **Nearest nested repository**:
   - For nested repositories (`outer/.git` and `outer/packages/inner/.git`), upward walk from `outer/packages/inner/src` stops at the nearest marker `outer/packages/inner`.

4. **No-git fallback**:
   - For workspaces without a `.git` marker up to the filesystem root, `findProjectRoot` returns normalized original cwd, maintaining workspace-scoped memory for non-git environments.

5. **Cancellation**:
   - `signal?.throwIfAborted()` is invoked before traversal, at each directory level, and after `lstat` failures.

## Security

1. **Input validation**:
   - `findProjectRoot` rejects non-string, empty, whitespace-only, and non-absolute cwd paths.
   - `projectRootFromToolExecution` fails closed when session header cwd is unavailable.

2. **Error sanitization**:
   - All tool errors thrown from `execute()` are sanitized via `sanitizeToolError(operation, topic)` into `Project memory <operation> failed for topic "<topic>".`
   - Raw filesystem paths and internal error messages never leak to the model or user.

3. **Filesystem confinement**:
   - All paths resolved via `resolveProjectMemoryPaths(projectRoot)`.
   - Operations pass through `ensureCanonicalDirectory`, `validateCanonicalDirectory`, and `writeSafeFileAtomically`.
   - Symlinks or junctions on `.dsh`, `.dsh/memory`, or individual memory files are rejected.
   - Topic identifiers are strictly validated against `TOPIC_IDENTIFIER_REGEX`, maximum 64 characters, and reserved Windows device names / bootstrap identifier.

## Public API

1. **Visibility**:
   - `projectRootFromToolExecution` is exported from `src/tools.ts` for internal/test consumption.
   - `src/index.ts` explicitly exports `{ name, inject, apply } from './tools.js'`, alongside modules `paths`, `bootstrap`, `topics`, `context`, and `init`.
   - Generated declaration `lib/index.d.ts` does NOT export `projectRootFromToolExecution`.
   - Package `package.json` exports map `.` to `./lib/index.d.ts` and `./lib/index.js`.

## Additional review

A full codebase search for `header.cwd`, `projectRoot`, `resolveProjectMemoryPaths`, and `.dsh` across `packages/project-memory/src/` confirmed:
- Every extraction of `agent.session.header.cwd` is resolved through `findProjectRoot(cwd, signal)`.
- No raw cwd path building or secondary root discovery implementations exist.
- Mutex map (`mapMutexes`) in `bootstrap.ts` serializes memory map updates per normalized project root.
- Core packages (`packages/core`) remain frozen and untouched.

NO BLOCKING ISSUES FOUND.

## Working tree

Clean working tree on `feat/core-provider-plugins-rc3` at commit `80f1272d2a7a8bdee66303eb80d064a265106a25` prior to verification document creation.

## Verdict

PASS
