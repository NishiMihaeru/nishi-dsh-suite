# Architecture

Status: canonical `0.1.0-rc.3` architecture after the independent Core + Project Memory audit/remediation against DSH `0.1.2-alpha.1`. The implementation contract below is current; foundation re-freeze is pending fresh executable validation and belongs to `ROADMAP.md` / `HANDOFF.md`.

## Product contract

Switching subscription providers should be a route change, not an environment change. DSH keeps the same tools, project memory, Usage & Limits surface, profile and session context while provider packages translate only vendor-specific protocols.

The runtime family has four architectural roles:

- `nishi-dsh-core` — provider-independent registry/registration, shared vendor CLI runtime, routed `web_search`, normalized usage/limits, host RPC and browser surfaces;
- one plugin per provider — vendor protocol translation and only the capabilities that provider actually exposes;
- `nishi-dsh-project-memory` — provider-agnostic project memory tools/context;
- `nishi-dsh-suite` — declarative composition and managed Orchestrator preset bridge.

A new provider must not require edits to Core, Project Memory, generic usage/search logic or browser provider identity logic. Shipping it still requires ordinary declarative packaging changes.

## Current package family

`0.1.0-rc.3` contains exactly:

1. `nishi-dsh-core`
2. `nishi-dsh-codex`
3. `nishi-dsh-antigravity`
4. `nishi-dsh-claude`
5. `nishi-dsh-project-memory`
6. `nishi-dsh-suite`

Canonical provider identities and model routes:

- `codex` -> `codex-app-server`
- `antigravity` -> `antigravity-cli`
- `claude` -> no model route; usage-only

Vendor-specific subagent integrations are removed. Orchestrator delegation uses DSH-native `subagent` / `subagent_fork` on the current primary route.

## Supported DSH foundation family

Core and Project Memory publish an explicit peer union for every production `@deepseek-ai/dsh-*` peer:

```text
0.1.1-rc.2 || 0.1.2-alpha.1
```

The main development graph stays pinned to DSH `0.1.1-rc.2`. Official `dsh-v0.1.2-alpha.1` at `cd5ef8148158c3a752a658978873241fdf8e2bbc` is the compatibility source target. Provider packages do not inherit this range automatically.

The independent alpha.1 audit found no broad Core DSH API/ABI migration requirement: Connection RPC, LLM adapter registration, session request-header routing, subprocess, browser ModuleLoader and UI slot composition remain compatible. The audit did reopen one Core correctness seam and the Project Memory storage layer; those remediations are described below.

## Core surfaces

| Entry | Plane | Role |
|---|---|---|
| `nishi-dsh-core` | host | publish registry and compose host services |
| `nishi-dsh-core/web-search` | agent | register routed `web_search` |
| `nishi-dsh-core/client` | browser | Usage & Limits + Model Accounts UI |
| `nishi-dsh-core/runtime` | library | shared vendor runtime + registration contract |
| `nishi-dsh-core/usage` | library | normalized usage contracts/service types |

The browser never imports provider packages. Provider identity and presentation cross RPC as serialized data.

## Core lifecycle and Model Accounts

The outer Core mounts `NishiProvidersService` before the internal host child. The internal child injects:

```ts
['nishiProviders', 'connection', 'credentials']
```

Core does not import or inject `@deepseek-ai/dsh-authorization`. Model Accounts reads DSH credentials directly.

The Connection boundary supports both known generations:

- rc.2 three-argument `rpc.handle(channel, handler, { authority: 'trusted-host' })`;
- alpha.1 two-argument authenticated `rpc.handle(channel, handler)`.

The compatibility helper isolates that transition; Connection remains transport/authentication/lifecycle owner.

Credential-store availability is a separate state from credential absence. A failed credential status read becomes a sanitized Model Accounts `ERROR` state. A failed durable legacy-grant deletion is not converted into a successful logout: rejection reaches the authorization RPC boundary and is reduced to the generic internal authorization error. Credential material and backend error text do not cross the browser contract.

## Provider contract

Providers inject `nishiProviders` plus only required DSH services and call shared `registerProvider(ctx, descriptor, config)`.

A provider descriptor declares:

- canonical provider identity and presentation;
- executable resolution metadata;
- optional model capability with one or more canonical routes;
- optional web-search capability;
- optional usage capability;
- optional provider-specific install hook.

`registerProvider()` owns validation, optional capability construction, registry record, adapter registration, install and rollback. Provider packages do not bypass it for model registration.

Registry change notifications are non-vetoing observers. Descriptor facts that can reject registration are validated before registry commit; observer failure cannot create ghost provider/route state by denying the caller its withdrawal handle.

### Usage

Usage source and normalization belong to the provider. Core owns generic caching, invalidation, public projection and browser lifecycle. A live provider without a usage capability remains visible as `UNSUPPORTED`.

### Web search

The provider owns vendor request/event/result translation. Core owns the model-facing tool and exact current-route dispatch:

1. read current agent request header;
2. validate route;
3. resolve `ctx.nishiProviders.byRoute(route)?.webSearch`;
4. dispatch only that backend.

Malformed/unavailable route -> `WEB_SEARCH_ROUTE_UNAVAILABLE`.

Valid route without backend -> `WEB_SEARCH_UNSUPPORTED`.

There is no vendor fallback.

## Project Memory root and context contract

Project Memory uses one project-root policy for context injection and tools:

- session `cwd` must be absolute;
- walk upward to the nearest `.git` marker, including worktree-style `.git` files;
- if no Git marker exists, use normalized explicit `cwd`;
- context injection and `memory_read` / `memory_write` / `memory_edit` use that same root.

An explicit workspace root or DSH home may be represented by a symlink path. Operations bind to the resolved directory identity rather than requiring the user-facing root pathname itself to be a real directory. Package-owned canonical `.dsh`, `.dsh/memory`, and `.dsh/local` final components remain real directories and may not be symlinks/junctions.

On `agent/pre-step`, successful initialized roots are cached. In-flight initialization is not shared between agents because one caller's `AbortSignal` must not cancel another caller. Initialization is instead idempotent and coordinated through the filesystem protocol.

`DSH.md` and bounded `MEMORY.md` are injected once when project context is not already visible. Topic files are read on demand only.

## Project Memory filesystem contract

### Path binding

On Linux/POSIX, the storage layer opens the target parent directory, verifies device/inode identity and uses an available descriptor path (`/proc/self/fd/<fd>` or `/dev/fd/<fd>`) for subsequent child lookup, temp-file creation, hard-link publication and rename. Reads open the final file once, use `O_NOFOLLOW` where available, validate the opened inode against the visible final entry, then read bytes from that handle.

A read-modify-write critical section does not reopen that parent pathname after taking its lock. `withSafeFileWriterLock()` supplies a `SafeDirectoryScope`, and the complete lock/read/render/write sequence uses that same opened directory identity. The named-topic compound path uses one memory scope for `MEMORY.md.lock`, the nested topic lock, participant snapshots, writes and rollback, plus one separate stable `.dsh/local` scope for its recovery journal. After a successful callback the logical directory pathname is revalidated against the opened inode; a parent replacement therefore cannot silently redirect the operation or still be reported as success.

This replaces the old `lstat(path)` -> later `readFile/writeFile(path)` check/use pattern for the supported POSIX path and prevents a concurrent parent/final-entry swap from redirecting actual RMW I/O after validation.

Windows has no equivalent Node directory-fd/openat surface here. It uses pathname operations plus identity revalidation and remains **NOT TESTED**. The stronger descriptor-anchored TOCTOU guarantee is therefore a POSIX claim only.

### Atomic replacement and first publication

Replacement writes create a complete sibling temp inode and rename it through the anchored parent.

First creation of canonical user-visible files is also complete-before-visible. A sibling temp inode is written in full first, then a hard-link no-clobber publication makes the canonical name visible. A concurrent external winner is preserved rather than overwritten. This applies to first publication of `DSH.md`, `.dsh/project.json`, `MEMORY.md`, and fresh `.gitignore` state.

These are process-interruption and atomic-namespace guarantees. The storage layer does not `fsync` file data or parent directories, so sudden power-loss/storage-durability guarantees are out of scope.

### Writer locking and cancellation

Every Project Memory RMW target uses the DSH-compatible `<target>.lock` namespace. The lock covers read/render/commit and whole-file writers honor the same target lock. Lock ownership and all operations performed under that lock share the same `SafeDirectoryScope`.

Lock acquisition is `AbortSignal`-aware. DSH tool execution and `agent/pre-step` signals are forwarded through root discovery, recovery, initialization, reads, lock waits and commit boundaries. An aborted waiter cannot later acquire the lock and commit a mutation merely because the current holder eventually released it. Model-facing tool wrappers also rethrow the caller's cancellation reason instead of converting cancellation into an ordinary sanitized Project Memory failure.

Writer domains:

- `.dsh/memory/MEMORY.md`: bootstrap create/write/edit plus Memory-map updates;
- `.dsh/memory/<topic>.md`: whole-file topic writes plus exact edits;
- root `.gitignore`: initializer create/update of `.dsh/local/` ignore state.

Cleanup removal is idempotent: concurrent recovery/cleanup that races after a successful regular-file validation treats a later `ENOENT` as an already-completed removal, not a new failure.

## Named-topic crash transaction

Model-facing named-topic `memory_write` / `memory_edit` use fixed lock order:

```text
MEMORY.md -> <topic>.md
```

While both participant locks are held, the transaction owns `.dsh/local/project-memory-transaction.json` containing:

- transaction version;
- `pending` or `committed` phase;
- owner PID;
- topic id;
- exact pre-image of the topic (or explicit absence);
- exact pre-image of `MEMORY.md` (or explicit absence).

Protocol:

1. preflight the next canonical Memory-map text while holding `MEMORY.md.lock`;
2. acquire topic lock on the same memory-directory scope;
3. capture exact participant pre-images through that scope;
4. atomically publish `pending` journal through one stable `.dsh/local` scope;
5. commit topic participant;
6. commit Memory-map participant;
7. atomically replace journal phase with `committed` while both participant locks still belong to this live transaction;
8. release participant locks/scopes;
9. remove committed journal best-effort.

The phase replace in step 7 is the logical commit point. It does not acquire a separate journal lock because any competing Project Memory operation that observes this live PID must wait on the already-held `MEMORY.md.lock`; avoiding a post-marker journal-lock cleanup means a successfully written `committed` marker cannot fall back into rollback because metadata-lock cleanup failed.

Recovery semantics:

- dead `pending` -> claim recovery, restore both exact pre-images under one stable memory scope with normal Memory/topic locks, remove journal;
- dead `committed` -> preserve both new participants, clean dead protocol locks and journal only;
- live recorded owner -> first wait until this process can acquire `MEMORY.md.lock`; if the journal then disappeared, nothing remains to recover; if it is `committed`, preserve participants and clean metadata; if it is still `pending`, the original compound critical section has ended and the abandoned state is rolled back under the normal Memory/topic lock order even though the process itself is still alive;
- committed journal left after an otherwise successful write -> next Memory-map critical section may remove it idempotently.

A missing `MEMORY.md` is modeled in-memory during map preflight and is not created as a side effect of a failed topic operation.

Low-level single-file topic helpers intentionally do not mutate the Memory map. Model-facing named-topic tools use the compound transaction helpers.

## Maintenance commands

`/memory` and `/consolidate` register only when both `commands` and `llm` are available. The selected provider/model is activated for the exact steered maintenance message on `agent/inbox/claimed`, before alpha.1 prompt assembly snapshots model selection, and is cleaned on idle/stop/error.

Project memory is repository-shared data. Maintenance policy rejects secrets, credential material, quota snapshots, raw chain-of-thought, transient logs and operator-personal facts.

## Provider-native memory policy

Project Memory is DSH-owned. A provider whose primary vendor runtime injects persistent vendor memory/project docs must suppress that behavior where the vendor boundary allows it.

Codex primary sets:

```text
memories.use_memories=false
memories.generate_memories=false
project_doc_max_bytes=0
```

Antigravity suppression remains partly configuration and partly prompt guidance; documentation must not overstate vendor guarantees.

## Invariants

1. Providers register through shared `registerProvider()`.
2. Core has no provider-package dependency.
3. Provider ids/routes are canonical before mutation.
4. Model capability implies at least one route; capability absence is legal.
5. Browser provider identity comes from serialized presentation data.
6. Web search follows the exact current route with no fallback.
7. Stale browser async work cannot resurrect withdrawn providers.
8. Vendor-specific subagent registration/tools are absent.
9. Project Memory root selection and filesystem confinement are provider-independent.
10. Explicit symlinked workspace roots are allowed; package-owned `.dsh` canonical final components are not symlinks/junctions.
11. On the POSIX path, Project Memory lock/read/write composition stays on one opened directory scope; separate validation/use pathname reopens are not used inside an RMW critical section.
12. All model-facing memory work forwards the caller cancellation signal through lock/commit boundaries and preserves the cancellation reason at the tool boundary.
13. Every writer that can race an RMW cycle honors the same per-target lock namespace.
14. Named-topic model-facing writes hold `MEMORY.md` then topic lock in that order on the same memory scope.
15. A `pending` journal is rollback state; a `committed` journal is preserve-and-clean state.
16. Credential backend failure is not represented as ordinary account absence, and failed durable logout is not reported as success.
17. Core and Project Memory production DSH peers accept only `0.1.1-rc.2` and `0.1.2-alpha.1` until another generation passes its own gate.

## Current implementation state

The independent audit reopened Core and Project Memory after the historical foundation freeze. The current branch contains targeted remediation for the five confirmed findings plus follow-up race hardening discovered during implementation. Canonical package and project docs intentionally do **not** declare the foundation frozen yet.

Fresh local package tests/typechecks/builds, workspace verification and the required disposable alpha.1 validation must run on the final remediation HEAD before Core and Project Memory are re-frozen. Provider-specific cleanup is paused until that gate completes.
