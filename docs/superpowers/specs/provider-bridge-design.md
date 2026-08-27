# Provider Bridge Design

**Status:** design, not yet implemented. Implements Stage 2 of `docs/ROADMAP.md`.

**Goal:** adding or maintaining a subscription provider costs a descriptor and a protocol translation. Everything else — discovery, process lifecycle, stream decoding, cancellation, error shaping, usage plumbing, registration — is written once.

**Success test, stated up front and negatively:** after Codex and Antigravity are rewritten on the kit, their combined source must be **smaller** than it is now. If the abstraction does not remove more code than it adds, it is the wrong abstraction and this design should be reconsidered rather than forced through.

## What already exists and is not being rebuilt

DSH owns the seams. The Suite is an on-ramp to them, not a second harness.

| Concern | Owner | Suite's part |
|---|---|---|
| Model interchangeability | `ctx.llm.registerAdapter`, `LlmAdapter`, `listModels` | implement the adapter |
| Tools and memory | `ctx.tools`, `ctx.projectMemory` | nothing — provider-agnostic already |
| Process lifetime | `ctx.subprocess` | use it |
| Delegation | `ctx.subagents`, `SubagentProvider`, `SubagentCapabilities` | implement where meaningful |
| Usage normalization | `nishi-dsh-usage-limits` | supply the raw payload |

Memory needs no provider-specific work on the primary plane: the memory tools execute inside DSH, and a provider there is only a model.

## The problem, concretely

Measured in the current tree:

- **Executable resolution is written three times** — `codex/src/resolver.ts`, `codex-usage-source/src/executable.ts`, `claude-usage-source/src/executable.ts`. Same env-override-then-PATH walk, same win32 branch, three copies.
- **Ephemeral agent-directory provisioning is written three times inside `antigravity` alone** — `antigravity-subagent.ts:113`, `web-search-backend.ts:145`, `antigravity-primary.ts:567`.
- **Bounded line decoding and child disposal** are duplicated across `codex`, `antigravity` and `claude-usage-source`.
- **Three usage-source interfaces for one concept**, with three different method names:

  ```
  CodexRateLimitsSource            .readRateLimits()
  AntigravityUsageCapabilitySource .readCapability()
  ClaudeUsageSource                .getUsage()
  ```

- **Three byte-identical refresh policies** (`60_000` / `300_000`) declared as three separate frozen constants, wired through three hand-written branches in `usage-limits-host/src/composition.ts`.
- **Configuration is inconsistent.** Codex and Claude take `DSH_CODEX_EXECUTABLE` / `DSH_CLAUDE_EXECUTABLE`; Antigravity takes a plugin config field and has no environment override at all.

None of this is a missing contract. It is the same contract implemented repeatedly.

## The descriptor

One object per provider. Every field beyond identity is optional, and **absence is a declaration**, never an omission.

```ts
interface ProviderDescriptor {
  readonly id: string                    // 'codex' | 'antigravity' | ...
  readonly displayName: string

  readonly executable: {
    readonly defaultName: string         // 'codex', 'agy', 'claude'
    readonly envOverride: string         // DSH_<PROVIDER>_EXECUTABLE, uniformly
    readonly windowsName?: string        // defaults to `${defaultName}.exe`
  }

  readonly model?: ModelCapability       // absent -> not selectable as a primary
  readonly usage?: UsageCapability       // absent -> reported UNSUPPORTED, never an error
  readonly webSearch?: WebSearchCapability
  readonly delegation?: DelegationCapability
}
```

Two consequences worth stating because they are the point:

1. **The environment override becomes uniform.** Every provider gets `DSH_<PROVIDER>_EXECUTABLE`. Antigravity's plugin config field stays as an additional, higher-precedence input, but the asymmetry stops being invisible.

2. **A missing capability is a first-class state.** The usage domain already proves the pattern with `ANTIGRAVITY_CAPABILITY_CLASS = 'UNSUPPORTED_NUMERIC_USAGE'` and `SOURCE_KIND = 'NO_SUPPORTED_MACHINE_READABLE_SOURCE'`. The descriptor generalises it: a provider that cannot report usage says so, and the UI shows an honest row instead of an error.

### Capabilities

```ts
interface ModelCapability {
  createAdapter(ctx: Context, resolved: ResolvedProvider): LlmAdapter
  readonly routes: readonly string[]     // passed to ctx.llm.registerAdapter
}

interface UsageCapability {
  read(run: VendorRun): Promise<unknown>          // raw vendor payload
  normalize(payload: unknown, observedAtMs: number): ProviderUsageSnapshot
  readonly refreshPolicy?: UsageRefreshPolicy     // defaults to the single shared default
}

interface DelegationCapability {
  readonly capabilities: SubagentCapabilities     // declared truthfully, see below
  start(request: SubagentStartRequest, resolved: ResolvedProvider): Promise<SubagentRun>
}
```

`UsageCapability` collapses the three interfaces into one `read()`. The collector stays in `nishi-dsh-usage-limits`; only the transport moves.

**Declared capabilities must be enforceable.** Both current providers declare `NO_START_CAPABILITIES`, which is at least honest. A capability may only be declared `true` where the Suite can actually enforce it — and the Antigravity managed agent definition's tool list is *not* honoured by the CLI (its live session announces the full native toolset), so `toolFilter` must stay `false` there until that changes. A capability the service cannot enforce is worse than one it refuses.

## The kit

`nishi-dsh-provider-kit`, consumed by every provider package. Not a Cordis plugin — a library.

- `resolveVendorExecutable(descriptor, { env, config })` — the single resolver. Precedence: explicit config value, then `envOverride`, then `PATH`. Fails closed with a provider-named diagnostic.
- `outputLines(stream, maxBytes)` — bounded newline-delimited decoding, CRLF tolerant, rejects an over-long line rather than buffering without limit.
- `disposeVendorChild(handle)` — terminate, await exit, await done.
- `settledStderr(handle, graceMs)` — vendor CLIs write their explanation *after* the terminal protocol frame; reading stderr at frame time sees an empty buffer. Bounded wait, then read.
- `ephemeralAgentWorkspace(spec)` — the temp `.agents/agents/<name>/` tree several CLIs need, created and removed as one unit.
- `vendorFailure(...)` — one error shape. Recognised conditions get named categories; **raw vendor stderr is never forwarded**, so local paths and vendor output cannot escape into diagnostics or DTOs.

## Composition

`usage-limits-host/src/composition.ts` stops hand-writing one branch per provider and iterates descriptors:

```ts
for (const descriptor of descriptors) {
  if (!descriptor.usage) continue
  register({
    providerId: descriptor.id,
    collector: collectorFor(descriptor),
    policy: descriptor.usage.refreshPolicy ?? DEFAULT_USAGE_REFRESH_POLICY,
  })
}
```

One default policy replaces the three identical constants.

## Package shape

`codex-usage-source` (379 src) and `claude-usage-source` (320 src) fold into the kit. Each currently carries a whole package's overhead — manifest, README, licence, notices, tsconfig, tests, an entry in six scripts, a lockfile row, a permanently reserved npm name — for a few hundred lines.

This changes the published family. It was deferred while rc.2 was heading for the registry; rc.2 is now parked unpublished, so there is no consumer to disturb.

## Migration order

1. Create the kit with the shared runtime, tested standalone.
2. Move usage sources into it, unify the input interface, collapse the policies, make composition data-driven.
3. Rewrite Codex on the kit; its suites must pass unchanged.
4. Rewrite Antigravity on the kit; same.
5. Drop the `^(gemini|claude|gpt|oss)` catalog filter — for a product whose value is provider choice, silently hiding unrecognised model families attacks the value directly.
6. Re-measure. If total source has not shrunk, stop and revisit this document.

## Non-goals

- Making delegated vendor subagents interchangeable with each other. They are not, and forcing it removes the reason to call them.
- Replacing anything DSH already provides.
- Supporting providers that are not subscription CLIs. An HTTP/API-key model belongs directly on `ctx.llm`, with no bridge in between.
