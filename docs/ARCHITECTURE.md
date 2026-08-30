# Architecture

Status: canonical `0.1.0-rc.3` architecture. This document describes the current tree, which is **no longer the frozen accepted checkpoint**: a follow-up audit of Core, Project Memory and Codex found and fixed defects in all three, so Foundation and Codex are thawed and pending re-validation. See *Current implementation state* at the end for exactly what changed and what evidence does and does not exist.

The only supported DSH generation is official `0.1.2-alpha.1` (`cd5ef8148158c3a752a658978873241fdf8e2bbc`). `0.1.1-rc.2` and earlier are **not supported** and carry no compatibility claim. The manifests do not yet match that policy; `docs/README.md` owns the policy statement and the list of gaps still to be closed.

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

Supported DSH generation: `0.1.2-alpha.1` only. rc.2 and earlier are unsupported.

Core and Project Memory still publish the wider peer union:

```text
0.1.1-rc.2 || 0.1.2-alpha.1
```

That range is now wider than the support policy and is retained only because upstream has not published alpha.1 to npm; the local devDependency and test graph is still rc.2 for the same reason. Narrowing it is a published-contract change with its own gate. The alpha.1 side of the claim rests on the disposable exact-commit probe against the official alpha.1 checkout/runtime; the rc.2 side is now unsupported compatibility surface, not a supported target. Provider packages do not inherit alpha.1 compatibility automatically and have never been probed against it.

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

The Connection compatibility boundary still accepts both shapes:

- rc.2: three-argument `rpc.handle(channel, handler, { authority: 'trusted-host' })`;
- alpha.1: authenticated two-argument `rpc.handle(channel, handler)`.

alpha.1 is the only supported generation, so the `Function.length` probe is no longer retained compatibility — it is removal debt. It stays until the peer range that justifies it is narrowed, and removing it is that change, not a separate cleanup.

### Model Accounts

The roster is registry-derived, exactly like Usage. A provider declares an optional `account` capability — credential scope, credential id, human-facing label — and Core builds one row per live provider that declares one. Core names no vendor, keeps no label table, and holds no credential namespace of its own; a provider that declares nothing gets no row, which is a legal declared state rather than a gap. Row identity is the canonical Nishi provider id, and the credential key is assembled from the provider's own declaration.

`account` is pure data: no factory, no secret, nothing executable. It is validated at registration alongside identity and routes, before any Core state is mutated.

Credential backend failure is not ordinary account absence. A failed status read becomes a sanitized `ERROR` state, and credential/backend secret material does not cross RPC. The DTO carries only provider identity, label, whether a record is configured, its kind, and a status — the credential key itself no longer crosses the boundary.

Direct subscription OAuth initiation is disabled, and the surface that once expressed it is gone rather than disabled in place: no begin/submit/cancel/logout endpoints, no client state machine, and in particular no secret-carrying prompt channel that could only ever end in a refusal.

Legacy grants are read-only compatibility state. In-app destructive logout is disabled because the alpha.1 credential contract provides no atomic compare-and-delete operation. A separate `describeRecord()` kind check followed by unconditional `deleteRecord()` can erase a newer API-key record written by another process. Core therefore fails closed and does not expose a destructive Sign Out action for legacy grants.

### Provider registration

Providers inject `nishiProviders` plus only required DSH services and call shared `registerProvider(ctx, descriptor, config)`.

Registration validates canonical identity/routes/presentation, constructs optional capabilities on the provider context, records the provider, registers model routes, runs provider install hooks, and rolls back Core-owned state if a later transaction stage fails.

Capability descriptors are shape-checked before their factories run, so a malformed `webSearch`/`usage` declaration fails as a named registration error rather than a bare `TypeError`. The rollback boundary is exactly the Core-owned registry entry and LLM adapter. Capability *instances* are built on the provider's own context and are not rolled back here — they carry no dispose contract, so a provider owning a resource must bind it to its own `ctx.effect`.

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

A backend error keeps its own message when Core re-shapes it into the tool taxonomy, so whatever a provider puts in that message reaches the model. That is why the `VendorFailure` contract in `nishi-dsh-core/runtime` is the required construction path for a provider diagnostic built from a failed vendor process: raw vendor stderr is never forwarded, only a recognized and provider-authored sentence, or an unattributed category with exit/signal metadata. Codex is the reference consumer of that contract.

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

The same discipline covers the two user-facing files initialization rewrites: `.dsh/project.json` is read under a 64 KiB bound and `.gitignore` under 1 MiB. Neither is package-owned, so neither may be materialized without a bound just because it is small in practice.

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

A queued waiter gets a 10 s budget before it reports a lock timeout. The number is sized for what the holder actually does under one lock — a WAL publish plus two atomic participant writes — rather than for the uncontended case. The budget is overridable per scope through `lockWaitMs`; there is no public package configuration for it yet.

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
- a journal may only be claimed after its owner is proven dead by a read taken under the journal lock;
- every pre-claim mismatch between that locked read and the caller's earlier unlocked read — journal gone, generation or phase replaced, owner transferred in either direction, owner alive again — is a stale observation, not lost proof, because no participant has been touched yet. Recovery re-observes from scratch, bounded, and the fresh read decides again whether to await a live owner or claim a dead one;
- ownership/WAL mutation that destroys proof *after* this recovery wrote its own claim -> fail closed.

Concurrent recovery of one abandoned journal is therefore an ordinary outcome: one caller settles it and reports `true`, the others report `false`. Recovery never fails a caller's unrelated read or write just because that caller lost the race. If observations keep churning past the bound, recovery reports `false` rather than looping; that is safe because a genuinely unresolved journal still blocks the next `createPendingProjectMemoryTransaction` through its exclusive create.

### Recovery ownership layer

Recovery is owned by Project Memory domain operations. Tool wrappers do not run a redundant pre-dispatch recovery and then invoke a domain operation that immediately recovers again. This reduces I/O and recovery interleavings without changing the tool contract.

## Architectural overcomplexity disposition

The audit distinguished correctness complexity from removable complexity.

Simplified and accepted:

- duplicate tool-layer Project Memory recovery;
- implicit PID/pathname ownership replaced by explicit lock/transaction generations;
- the Core authorization begin/submit/cancel/logout state machine, host and client alike. It was previously retained while disabled; a disabled mutation path that still carries a secret-typed prompt channel is a liability rather than compatibility, so it was removed instead of kept inert;
- the hardcoded Model Accounts vendor roster, replaced by the provider-declared `account` capability.

Intentionally retained until a separate compatibility review:

- rc2/alpha Connection `Function.length` compatibility shim, now reclassified as removal debt: rc.2 is unsupported, and the shim survives only until the peer range is narrowed;
- usage invalidation generation tokens, because they fence real in-flight observation races;
- one fixed Project Memory journal pathname, because generation identity + lock order closes the audited race without requiring a larger WAL-directory migration.

The accepted follow-up review found no reason to replace these with a larger Foundation rewrite. Further cleanup must remove a concrete invariant/API burden rather than merely shorten code.

## Invariants

1. Providers register through shared `registerProvider()`.
2. Core has no provider-package dependency, and no vendor identity anywhere in its source: every provider-shaped surface — model routes, usage, presentation, Model Accounts — is derived from registry declarations.
3. Provider ids/routes are canonical before mutation.
4. Model capability implies at least one route; capability absence is legal.
5. Browser provider identity comes from serialized presentation data.
6. Web search follows the exact current route with no vendor fallback.
7. Usage invalidation cannot leave host cached reads serving vendor-superseded state.
8. Stale browser async work cannot resurrect old provider generations.
9. Credential backend failure is not ordinary account absence.
10. Legacy grant deletion is disabled unless a future credential contract supplies an atomic-safe mutation, and the mutation surface is absent rather than inert.
11. A provider diagnostic built from a failed vendor process is constructed through `VendorFailure`; raw vendor stderr never reaches a diagnostic, a DTO, or the model.
12. Project Memory root selection/storage confinement is provider-independent.
13. POSIX package-owned descendants use one pinned `projectRoot -> .dsh -> memory/local` descriptor chain.
14. Project Memory RMW read/render/write stays on one opened directory scope.
15. Current lock ownership has a unique generation token; delayed release/recovery must not remove a replacement owner.
16. Lock publication collision classification must not depend on the lock pathname still existing after the failed publication syscall.
17. Persisted process identity prevents PID reuse from proving false ownership where the OS seam is available.
18. Named-topic mutations hold `MEMORY.md` then topic lock.
19. WAL generations distinguish transactions that reuse the fixed journal pathname.
20. Legacy WAL generation identity excludes mutable owner identity; ownership is validated separately.
21. `pending` is rollback state; `committed` is preserve-and-clean state.
22. Journal phase replacement preserves owner-only permissions.
23. Caller cancellation applies to ordinary work; mandatory settlement may ignore an already-fired signal only to restore already-durable state.
24. Concurrent canonical unlink after successful file open is absence, not permission to expose stale unlinked bytes. Replacement by a symlink or other non-regular entry still fails closed with the original error; replacement by a different regular file is surfaced as a distinguishable error type so a caller reading without a lock can choose to re-observe instead of failing outright.
25. A journal is claimed only after a lock-held read proves its owner dead; a stale pre-claim observation — including the fixed journal pathname being atomically replaced by a different regular file — is re-observed, never failed, and never lets an unrelated caller's operation fail. That re-observation is bounded and applies only to the unlocked pre-claim probe: replacement by a symlink or other non-regular entry still fails closed there, and any change to the journal after this process has durably claimed it still fails closed regardless of shape.
26. Losing a recovery race is a normal outcome; only mutation of a claim this process already wrote fails closed.
27. Every Project Memory read-modify-write path bounds the bytes it materializes, package-owned and user-owned files alike.
28. `0.1.2-alpha.1` is the only supported DSH generation; rc.2 and earlier carry no compatibility claim. The declared Core and Project Memory peer union is still `0.1.1-rc.2 || 0.1.2-alpha.1` because upstream has not published alpha.1 to npm, and narrowing it is a published-contract change with its own gate.
29. Windows remains NOT TESTED.

## Current implementation state — THAWED, PENDING RE-VALIDATION

The previously accepted implementation and its PASS report were:

```text
implementation: 7cd4d5b17625f9b3a21b741555df6597fd9cb889
raw PASS report: d1cbac7094488ded52d9ab83891531bc01197090
```

That evidence no longer describes this tree. A follow-up audit of Core, Project Memory and Codex reproduced defects in all three, and the remediation changed behavior in each. **The old PASS must not be promoted to the current implementation.** Core, Project Memory and Codex are no longer frozen; they need their own validation run before any freeze claim is restored.

What changed since the accepted checkpoint:

- Project Memory recovery no longer fails a caller that loses a benign pre-claim race; the fail-closed boundary moved to post-claim mutation only. Invariants 25 and 26 are new and one previously documented invariant was deliberately weakened.
- Project Memory bounds the two user-owned files initialization rewrites, and the writer-lock wait budget moved from 2 s to 10 s and became overridable per scope.
- Core validates capability descriptors before their factories run, and the registration rollback boundary is now stated precisely rather than implied.
- Core's browser usage controller can no longer strand an in-flight refresh record, and it disposes.
- Model Accounts became registry-derived; the hardcoded vendor roster and the whole disabled authorization mutation surface — host and client — were removed. This is a public-surface removal in an unpublished `0.1.0-rc.3`.
- Codex routes every vendor-process diagnostic through `VendorFailure`, closing a path that put raw vendor stderr in front of the model. Its native search verifies the vendor runtime once per executable instead of once per query.

Local gate on the current tree: PASS. `pnpm verify:local` 5/5 exit `0`; Core `209`, Project Memory `77`, Codex `61`, Claude `7`, Antigravity `7`, Suite `12`. It took one fix to get there: the first re-validation gave FAIL, PASS, PASS on a load-sensitive Project Memory recovery read race that violated invariant 25, and `HANDOFF.md` carries the reproduction and the remediation. A green local gate is not an acceptance: no independent validation, no live acceptance run, and no alpha.1 runtime probe has been repeated against this tree.

Windows remains NOT TESTED, and `packages/antigravity` still carries the raw-vendor-stderr pattern that Codex just had removed.
