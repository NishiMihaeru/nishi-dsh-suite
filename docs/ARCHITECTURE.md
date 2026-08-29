# Architecture

Status: canonical `0.1.0-rc.3` architecture after the independent Core + Project Memory audit/remediation and accepted follow-up validation against official DSH `0.1.2-alpha.1` (`cd5ef8148158c3a752a658978873241fdf8e2bbc`). Foundation is **FROZEN** at accepted implementation `7cd4d5b17625f9b3a21b741555df6597fd9cb889`.

## Product contract

Switching primary providers should be a route change, not an environment change. DSH keeps the same tools, Project Memory, Usage & Limits surface, profile and session context while provider packages translate vendor-specific protocols.

The runtime family has four architectural roles:

- `nishi-dsh-core` — provider-independent registry/registration, shared vendor CLI runtime, routed `web_search`, normalized usage/limits, host RPC and browser surfaces;
- one plugin per provider — vendor protocol translation and only the capabilities that provider actually exposes;
- `nishi-dsh-project-memory` — provider-agnostic project memory tools/context;
- `nishi-dsh-suite` — declarative composition and managed Orchestrator preset bridge.

A new provider must not require provider-specific Core, Project Memory or browser identity branches.

## Package family and DSH boundary

`0.1.0-rc.3` contains:

1. `nishi-dsh-core`
2. `nishi-dsh-codex`
3. `nishi-dsh-antigravity`
4. `nishi-dsh-claude`
5. `nishi-dsh-project-memory`
6. `nishi-dsh-suite`

Core and Project Memory publish:

```text
0.1.1-rc.2 || 0.1.2-alpha.1
```

Their local devDependency graph remains rc.2. The alpha.1 side of that peer claim is accepted because the frozen Foundation was separately exercised against the official exact alpha.1 checkout/runtime. Provider packages do not inherit that compatibility automatically.

## Core

### Surfaces

| Entry | Plane | Role |
|---|---|---|
| `nishi-dsh-core` | host | publish registry and compose host services |
| `nishi-dsh-core/web-search` | agent | routed `web_search` |
| `nishi-dsh-core/client` | browser | Usage & Limits + Model Accounts |
| `nishi-dsh-core/runtime` | library | shared vendor runtime + registration |
| `nishi-dsh-core/usage` | library | normalized usage service/contracts |

The browser never imports provider packages. Provider presentation crosses RPC as serialized data.

### Lifecycle and Connection

The outer Core publishes `NishiProvidersService`; the internal host child injects:

```ts
['nishiProviders', 'connection', 'credentials']
```

Core does not import or inject `@deepseek-ai/dsh-authorization`.

The Connection compatibility boundary currently supports:

- rc.2: three-argument `rpc.handle(channel, handler, { authority: 'trusted-host' })`;
- alpha.1: authenticated two-argument `rpc.handle(channel, handler)`.

The current `Function.length` compatibility probe is intentionally retained while rc.2 remains a supported peer. It is compatibility debt, but removing it before the support boundary changes is unrelated to current correctness.

### Model Accounts

Credential backend failure is not ordinary account absence. A failed status read becomes a sanitized `ERROR` state, and credential/backend secret material does not cross RPC.

Direct subscription OAuth initiation is disabled.

Legacy grants are read-only compatibility state. In-app destructive logout is disabled because the alpha.1 credential contract provides no atomic compare-and-delete operation. A separate `describeRecord()` kind check followed by unconditional `deleteRecord()` can erase a newer API-key record written by another process. Core therefore fails closed and does not expose a destructive Sign Out action for legacy grants.

### Provider registration

Providers inject `nishiProviders` plus only required DSH services and call shared `registerProvider(ctx, descriptor, config)`.

Registration validates canonical identity/routes/presentation, constructs optional capabilities on the provider context, records the provider, registers model routes, runs provider install hooks, and rolls back Core-owned state if a later transaction stage fails.

Registry observers are non-vetoing. Provider registration/withdrawal drives the live roster.

### Usage

Providers own usage collection/normalization. Core owns cache, invalidation, public projection and browser lifecycle.

`UsageCapabilityHooks.invalidate()` is an authoritative observation-generation boundary:

1. remove the provider's currently cached snapshot immediately;
2. advance an invalidation generation token;
3. cached host read APIs omit the invalidated provider;
4. refresh work that started before invalidation may resolve to its original caller but cannot republish into cache;
5. a post-invalidation refresh is not required to join superseded in-flight work;
6. successful refresh in the current generation publishes and clears that generation's invalidation token.

Browser `get-providers` is authoritative. If a provider is omitted, a prior browser-side `FRESH` snapshot is cleared so the next `ensureFresh()` can refresh it. There is no separate invalidation push channel; the guarantee begins at the next authoritative host/cache read.

Provider roster generations continue to fence stale browser async work so withdrawn/re-registered provider instances cannot be resurrected by old requests.

### Routed web search

Core reads the current session request header and dispatches only the backend registered for that exact route.

- malformed/unavailable route -> `WEB_SEARCH_ROUTE_UNAVAILABLE`;
- valid route without search capability -> `WEB_SEARCH_UNSUPPORTED`;
- no fallback to another vendor.

## Project Memory

### Root and context

Project Memory uses one root policy for context and tools:

- session `cwd` must be absolute;
- walk upward to nearest `.git` marker, including worktree-style `.git` files;
- if no Git marker exists, use normalized explicit `cwd`;
- context injection and memory tools use the same discovered root.

Explicit workspace roots may be symlink paths. Package-owned `.dsh`, `.dsh/memory`, and `.dsh/local` final components must be real directories.

`DSH.md` and bounded `MEMORY.md` are injected lazily on `agent/pre-step`; topic files are read on demand. Concurrent initialization does not share one cancellable promise between agents.

### Storage confinement

On POSIX, package-owned descendants are opened through one descriptor chain:

```text
projectRoot -> .dsh -> memory/local
```

Opened directories are bound to device/inode identity and descriptor paths where available. Final-file reads use `O_NOFOLLOW` where available and verify the opened file against the visible entry before consuming bytes. Atomic writes and first-publication operations are anchored to the same opened parent generation.

If a regular file is opened successfully and the canonical pathname is then concurrently unlinked before visible-identity recheck, `readRegularFile()` returns current namespace absence (`null`) instead of exposing bytes from the now-unlinked inode. If the pathname instead resolves to a different inode, symlink or non-file entry, the operation still fails closed.

Windows has no equivalent Node directory-fd/openat implementation here. It remains **NOT TESTED** and does not inherit the stronger POSIX TOCTOU claim.

The storage layer does not `fsync` file/parent-directory contents; sudden power-loss durability remains out of scope.

### Bootstrap bounds

`MEMORY.md` has a 25 KiB / 200-line model-facing bound.

The bound is also an ingestion boundary:

- read-only bootstrap projection reads only a bounded prefix sufficient for UTF-8-safe truncation;
- existence-only paths read zero content bytes;
- read-modify-write bootstrap/map operations reject an oversized persisted file from metadata before whole-file materialization.

Named topic files remain capped at 256 KiB.

### Writer locks

All Project Memory RMW targets use the same `<target>.lock` namespace as DSH atomic-write coordination.

Current Project Memory locks are generation-safe populated directories. One owner marker contains:

- lock format version;
- PID;
- random acquisition token;
- OS process-birth identity when available.

The populated temp directory is atomically published with `rename()` only after the owner marker exists. Structural destination-collision errno values from that publication step (`EEXIST`, `ENOTEMPTY`, `ENOTDIR`, `EISDIR`) are authoritative contention signals and are not reclassified through a racy post-failure pathname `lstat()`. Ambiguous permission-style codes retain conservative handling.

Lock release is conditional on the exact observed owner generation and opened directory identity. It removes the expected marker, then `rmdir()` succeeds only if the canonical pathname still refers to the same empty directory. A replacement live owner publishes a populated directory and cannot be deleted by the delayed old finalizer.

Legacy numeric-PID regular lock files remain readable for recovery/interoperability with older state; current Project Memory writers no longer create them.

The namespace is bidirectionally compatible with `@deepseek-ai/dsh-atomic-write`: an upstream regular lock blocks Project Memory, and upstream exclusive creation treats the Project Memory directory lock as contention. This was exercised in the accepted Foundation validation.

### Process ownership and PID reuse

PID liveness alone is insufficient because numeric PIDs are recycled.

New persisted journal/lock ownership carries process-birth identity where supported:

- Linux: `/proc/<pid>/stat` process start time;
- macOS: `ps` process start time.

A live numeric PID with a mismatched birth identity is not the original owner and does not keep dead recovery state alive indefinitely. When a reliable birth identity cannot be obtained, recovery fails closed and treats a live PID as live rather than guessing stale ownership.

### Cancellation and settlement

Caller `AbortSignal` propagates through root discovery, recovery, lock waits, reads and ordinary commit boundaries.

If failure/cancellation happens after a compound operation already durably replaced one participant, exact rollback becomes mandatory settlement. Settlement reuses the opened storage generation without consulting the already-fired caller signal until pre-images/WAL state are restored. This exception is limited to restoring already-durable partial state.

### Named-topic transaction

Model-facing named-topic writes/edits use fixed lock order:

```text
MEMORY.md -> <topic>.md
```

`.dsh/local/project-memory-transaction.json` records:

- journal version;
- `pending` / `committed` phase;
- owner PID;
- optional process-birth identity;
- random transaction-generation id for current writers;
- topic id;
- exact pre-images of topic and `MEMORY.md`.

Old journals without identity/generation fields remain readable for one-way recovery compatibility.

For current journals, `transactionId` is the generation identity. For legacy journals without `transactionId`, generation comparison uses immutable transaction payload (`topic`, `topicBefore`, `memoryBefore`); mutable owner PID/identity is checked separately. This permits explicit fail-closed owner-transfer handling instead of conflating ownership transfer with transaction replacement.

Protocol:

1. open one pinned `projectRoot -> .dsh -> {memory, local}` generation;
2. hold `MEMORY.md` then topic lock;
3. preflight/capture bounded participant state;
4. atomically publish `pending` WAL mode `0600`;
5. commit topic;
6. commit Memory map;
7. atomically replace WAL with `committed`, still mode `0600`;
8. while participant locks remain held, best-effort remove only that exact committed transaction generation;
9. release participant locks/scopes.

Step 7 is the logical commit point. Cleanup failure after it is preserve-and-clean metadata, never a reason to roll committed participants back.

Transaction generation identity plus cleanup under participant locks prevents delayed cleanup from transaction A from deleting pending transaction B at the fixed journal pathname.

Recovery semantics:

- dead `pending` -> claim and restore exact pre-images;
- dead `committed` -> preserve new participants and clean metadata;
- live matching owner -> cross the `MEMORY.md` barrier before deciding whether anything remains to settle;
- recycled PID with mismatched birth identity -> stale owner;
- owner transfer before claim is checked independently from generation and fails closed when ownership is no longer provably the observed dead owner;
- ownership/WAL mutation that destroys proof after recovery has begun -> fail closed.

### Recovery ownership layer

Recovery is owned by Project Memory domain operations. Tool wrappers do not run a redundant pre-dispatch recovery and then invoke a domain operation that immediately recovers again. This reduces I/O and recovery interleavings without changing the tool contract.

## Architectural overcomplexity disposition

The audit distinguished correctness complexity from removable complexity.

Simplified and accepted:

- duplicate tool-layer Project Memory recovery;
- implicit PID/pathname ownership replaced by explicit lock/transaction generations.

Intentionally retained until a separate compatibility review:

- exported Core authorization client state-machine methods even though current destructive host mutation flows are disabled;
- rc2/alpha Connection `Function.length` compatibility shim;
- usage invalidation generation tokens, because they fence real in-flight observation races;
- one fixed Project Memory journal pathname, because generation identity + lock order closes the audited race without requiring a larger WAL-directory migration.

The accepted follow-up review found no reason to replace these with a larger Foundation rewrite. Further cleanup must remove a concrete invariant/API burden rather than merely shorten code.

## Invariants

1. Providers register through shared `registerProvider()`.
2. Core has no provider-package dependency.
3. Provider ids/routes are canonical before mutation.
4. Model capability implies at least one route; capability absence is legal.
5. Browser provider identity comes from serialized presentation data.
6. Web search follows the exact current route with no vendor fallback.
7. Usage invalidation cannot leave host cached reads serving vendor-superseded state.
8. Stale browser async work cannot resurrect old provider generations.
9. Credential backend failure is not ordinary account absence.
10. Legacy grant deletion is disabled unless a future credential contract supplies an atomic-safe mutation.
11. Project Memory root selection/storage confinement is provider-independent.
12. POSIX package-owned descendants use one pinned `projectRoot -> .dsh -> memory/local` descriptor chain.
13. Project Memory RMW read/render/write stays on one opened directory scope.
14. Current lock ownership has a unique generation token; delayed release/recovery must not remove a replacement owner.
15. Lock publication collision classification must not depend on the lock pathname still existing after the failed publication syscall.
16. Persisted process identity prevents PID reuse from proving false ownership where the OS seam is available.
17. Named-topic mutations hold `MEMORY.md` then topic lock.
18. WAL generations distinguish transactions that reuse the fixed journal pathname.
19. Legacy WAL generation identity excludes mutable owner identity; ownership is validated separately.
20. `pending` is rollback state; `committed` is preserve-and-clean state.
21. Journal phase replacement preserves owner-only permissions.
22. Caller cancellation applies to ordinary work; mandatory settlement may ignore an already-fired signal only to restore already-durable state.
23. Concurrent canonical unlink after successful file open is absence, not permission to expose stale unlinked bytes; replacement identity still fails closed.
24. Core and Project Memory peer support remains exactly `0.1.1-rc.2 || 0.1.2-alpha.1` until another generation passes its own gate.
25. Windows remains NOT TESTED.

## Current implementation state — FROZEN

Accepted implementation:

```text
7cd4d5b17625f9b3a21b741555df6597fd9cb889
```

Raw PASS report commit:

```text
d1cbac7094488ded52d9ab83891531bc01197090
```

The accepted evidence includes Core `182/182`, Project Memory `64/64`, full workspace test/check/build, `pnpm verify:local`, 20 consecutive runs of the previously failing concurrency/recovery suites, zero unexpected lock/WAL residue, bidirectional atomic-write lock interoperability, and disposable exact-commit alpha.1 runtime probes.

Foundation should not be reopened during provider work without a concrete reproduced Foundation defect or a deliberate support-boundary change.
