# Local Validation Report: Core Registry Observer & Provider Registration Transaction

- **Result**: `PASS`
- **Branch**: `feat/core-provider-plugins-rc3`
- **Tested implementation HEAD**: `b925e2a328168e7c978126fc6474b7af11d7a63d`
- **Environment**:
  - Node: `v24.19.0` (`/home/acedia/.local/share/fnm/node-versions/v24.19.0/installation/bin/node`)
  - pnpm: `11.21.0`
  - Installed DSH baseline: `0.1.1-rc.2`
  - Upstream DSH target: tag `dsh-v0.1.2-alpha.1` / commit `cd5ef8148158c3a752a658978873241fdf8e2bbc`

---

## 1. Exact Files Reviewed

1. [`packages/core/src/registry/service.ts`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/core/src/registry/service.ts) — Provider registry service with non-vetoing observer announcements and best-effort diagnostics.
2. [`packages/core/src/usage/service.ts`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/core/src/usage/service.ts) — Runtime validation functions `parseUsageRefreshPolicy` and `parseUsageSnapshotCollector` preserving `UsageLimitsService.register()` contract.
3. [`packages/core/src/runtime/registration.ts`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/core/src/runtime/registration.ts) — Ordered registration sequence enforcing policy preflight and collector validation before registry mutation, maintaining post-record transactional rollback.
4. [`packages/core/src/host/composition.ts`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/core/src/host/composition.ts) — Host composition with preflight validation of `defaultRefreshPolicy` prior to observer registration.
5. [`packages/core/test/registry.test.ts`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/core/test/registry.test.ts) — Unit and regression test suite covering sync throwing observers, async rejecting observers, non-vetoing withdrawal, and Cordis proxy access.
6. [`packages/core/test/registration-policy.test.ts`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/core/test/registration-policy.test.ts) — Regression test suite verifying preflight rejection of malformed explicit policy, malformed collector, and validated detached copy propagation.
7. [`packages/core/test/composition-policy.test.ts`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/core/test/composition-policy.test.ts) — Regression test verifying early rejection of malformed host `defaultRefreshPolicy` prior to context service access.
8. Supporting canonical documentation: [`packages/core/README.md`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/core/README.md), [`docs/ARCHITECTURE.md`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/docs/ARCHITECTURE.md), [`docs/ROADMAP.md`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/docs/ROADMAP.md), [`docs/HANDOFF.md`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/docs/HANDOFF.md), [`docs/verification/README.md`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/docs/verification/README.md).

---

## 2. Lockfile Consistency & Gate Results

### 2.1 Frozen Lockfile
```bash
pnpm install --frozen-lockfile
```
- **Exit code**: `0`
- **Output**: `Scope: all 7 workspace projects; Already up to date; Done in 314ms`
- **Diff check** (`git diff --exit-code -- pnpm-lock.yaml packages/core/package.json`): Exit code `0` (clean, zero diffs).

### 2.2 Core Focused Gates
| Gate Command | Exit Code | Result | Details |
|---|---|---|---|
| `pnpm --filter nishi-dsh-core test` | `0` | **PASS** | 175 tests passed, 0 failed (duration: 985ms; +6 new regression tests) |
| `pnpm --filter nishi-dsh-core check` | `0` | **PASS** | `tsc -p tsconfig.json --noEmit` clean |
| `pnpm --filter nishi-dsh-core build` | `0` | **PASS** | `tsdown` built ESM node artifacts & CJS browser `lib/client.js` (120.92 kB) |

### 2.3 Full Monorepo Gates
| Monorepo Gate Command | Exit Code | Result | Details |
|---|---|---|---|
| `pnpm test` | `0` | **PASS** | All workspace packages pass unit and integration test suites |
| `pnpm check` | `0` | **PASS** | Typecheck clean across all workspace projects |
| `pnpm build` | `0` | **PASS** | All workspace packages build cleanly |

---

## 3. Architecture & Contract Verification

### 3.1 Non-Vetoing Registry Observers (`packages/core/src/registry/service.ts`)
- **Independent Notification Execution**: `#announce()` iterates through listeners in an isolated `try/catch` block.
- **Sync Throw Containment**: A synchronous exception thrown by an observer:
  - Is contained within `#announce()`;
  - Is logged to `this.ctx.logger.warn`;
  - Does not throw out of `record()`;
  - Does not starve subsequent observers from receiving the event;
  - Allows `record()` to return the withdrawal disposer callback.
- **Async Rejection Containment**: If an observer returns a `PromiseLike`, rejection is caught via `Promise.resolve(returned).then(undefined, error => this.#warnObserverFailure(error))`, preventing `unhandledRejection` events.
- **Disposer & Withdrawal**: `record()` returns `() => void`. Invoking the disposer removes the provider from `#byId` and `#byRoute`, and invokes `#announce()`, where withdrawal notifications follow the identical non-vetoing semantics.
- **Pre-Mutation Validation**: Duplicate provider IDs, duplicate routes, and non-canonical strings are validated before state changes, remaining strictly vetoing.
- **Proxy Compatibility**: All methods (`record`, `byId`, `byRoute`, `all`, `onChange`, `invalidate`, `onInvalidate`) are bound in the constructor to ensure correct operation through Cordis service proxies.

### 3.2 Runtime Validators (`packages/core/src/usage/service.ts`)
- **`parseUsageRefreshPolicy`**:
  - `minRefreshIntervalMs`: Validated as a non-negative safe integer (`Number.isSafeInteger(v) && v >= 0`).
  - `staleAfterMs`: Validated as a positive safe integer (`Number.isSafeInteger(v) && v > 0`).
  - Returns a detached object copy.
- **`parseUsageSnapshotCollector`**:
  - Asserts non-null plain object.
  - Asserts `collect` is a callable function.
  - Binds the receiver (`{ collect: collector.collect.bind(collector) }`), preserving `this` context for class instances (Codex, Antigravity, Claude collectors).
  - Preserves exact error messaging and contract compatibility with `UsageLimitsService.register()`.

### 3.3 Registration Sequence & Transaction Ordering (`packages/core/src/runtime/registration.ts`)
The execution order in `registerProvider()` is verified:
1. Canonical `providerId` validation (`canonicalProviderId`);
2. Canonical `presentation.id` validation and agreement with `providerId`;
3. Canonical and deduplicated `model.routes` validation;
4. Explicit `usage.refreshPolicy` preflight validation and detachment;
5. Provider `webSearch` capability factory invocation;
6. Provider `usage` capability factory invocation;
7. Usage collector preflight validation and binding (`parseUsageSnapshotCollector`);
8. `registry.record()` commit;
9. Cordis withdrawal effect registration (`ctx.effect()`);
10. Model adapter registration (`ctx.llm.registerAdapter`);
11. Provider-specific `descriptor.install?.(ctx, config)` execution;
12. Comprehensive transactional rollback on post-commit failures (`rollbackRegistration`).

### 3.4 Host Composition Preflight (`packages/core/src/host/composition.ts`)
- `defaultRefreshPolicy` is validated before any registry observers are installed.
- Invalid host default policy fails immediately without reading `ctx.nishiProviders`.
- `DEFAULT_USAGE_REFRESH_POLICY` (`minRefreshIntervalMs: 60000`, `staleAfterMs: 300000`) remains valid and immutable.
- Provider explicit policy takes precedence over host default policy during reconciliation.

---

## 4. Live Integration Probes & Results

A complete 6-phase integration probe was executed against a live Cordis runtime context with real service proxies and provider registration pipelines:

### 4.1 Probe 1: Synchronous Observer Throw Containment
- **Scenario**: Primary `onChange` listener synchronously throws an error during `registerProvider()`.
- **Result**: **PASS**
  - `registerProvider()` resolved cleanly without throwing;
  - Provider was accessible via `byId('synthetic-sync')`;
  - Model routes were accessible via `byRoute('synth-route-1')` and `byRoute('synth-route-2')`;
  - Second observer received the registration notification (count = 1);
  - Warning logged to `ctx.logger.warn`;
  - Plugin fiber disposal successfully withdrew provider and routes;
  - Second observer received the withdrawal notification (count = 2).

### 4.2 Probe 2: Async Observer Rejection Containment
- **Scenario**: Primary `onChange` listener returns a rejected Promise during `registerProvider()`.
- **Result**: **PASS**
  - Process-level `unhandledRejection` listener recorded **0** unhandled rejections;
  - Provider was committed and visible in registry;
  - Second observer was notified;
  - Warning logged to `ctx.logger.warn`;
  - Fiber disposal cleaned up state without unhandled rejections.

### 4.3 Probe 3: Post-Record Rollback Regression
- **Scenario**: Registry observer throws, `record()` commits and returns disposer, then `descriptor.install()` throws.
- **Result**: **PASS**
  - `registerProvider()` rejected with the original install error message;
  - Rollback cleared provider from `#byId` and `#byRoute`;
  - Adapter registration was cleanly disposed;
  - Contained observer error did not obscure or replace the install failure.

### 4.4 Probe 4: Usage Reconciliation & Preflight Validation
- **Scenario**: Host usage composition reconciled against dynamic provider registrations, default/explicit policies, and invalid inputs.
- **Result**: **PASS**
  - Invalid host `defaultRefreshPolicy` failed immediately before `nishiProviders` access;
  - Provider without explicit policy used `DEFAULT_USAGE_REFRESH_POLICY` (`staleAfterMs: 300000`);
  - Provider with explicit policy used its configured policy (`staleAfterMs: 40000`);
  - Snapshot collection and refresh operated cleanly;
  - Invalid explicit policy was rejected before usage capability factory invocation and before registry mutation;
  - Invalid collector was rejected after factory invocation but before registry mutation;
  - Teardown of provider fibers correctly updated the usage roster.

### 4.5 Probe 5: Stale Disposer & Replacement Provider Integrity
- **Scenario**: Provider generation 1 registered and withdrawn, generation 2 registered, stale disposer 1 invoked.
- **Result**: **PASS**
  - Invoking stale disposer 1 did not remove or affect generation 2 in `byId` or `byRoute`;
  - Live disposer 2 cleanly removed generation 2.

### 4.6 Probe 6: Logger Crash Containment
- **Scenario**: `ctx.logger.warn` throws an exception when reporting an observer failure.
- **Result**: **PASS**
  - Exception inside `#warnObserverFailure` was contained in its own `try/catch`;
  - Logger failure did not bubble out or restore observer veto power over committed registry state;
  - Disposer handle was returned and remained operable.

---

## 5. Upstream Semantic Comparison: DSH `v0.1.2-alpha.1`

### 5.1 Upstream Source Reference
- **Repository**: `deepseek-ai/deepseek-harness`
- **Tag**: `dsh-v0.1.2-alpha.1`
- **Commit**: `cd5ef8148158c3a752a658978873241fdf8e2bbc`
- **File**: `packages/llm/llm/src/index.ts`
- **Method**: `LlmRuntime.emitAdaptersUpdated()`

### 5.2 Upstream Alignment
In DSH alpha.1 `LlmRuntime.emitAdaptersUpdated()`:
```ts
private emitAdaptersUpdated(): void {
  let invariantFailure: unknown
  for (const listener of this.ctx.events.dispatch('emit', ['llm/adapters-updated']) as Array<() => unknown>) {
    try {
      const returned = listener()
      if (returned != null && typeof (returned as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(returned as PromiseLike<unknown>).then(undefined, (error: unknown) => {
          this.warnAdaptersListenerFailure(error)
        })
      }
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === 'INVARIANT') {
        invariantFailure ??= error
        continue
      }
      this.warnAdaptersListenerFailure(error)
    }
  }
  if (invariantFailure !== undefined) throw invariantFailure as Error
}
```

Both Core and DSH enforce the core architectural principle: **topology observers must not veto committed topology changes**. Both isolate listener executions, contain async promise rejections, and emit diagnostics via `ctx.logger.warn`.

### 5.3 Assessment of Core's Deliberate Distinction Regarding `INVARIANT` Rethrow
In DSH `LlmRuntime.emitAdaptersUpdated()`, `registerAdapter()` registers the adapter and returns an `AdapterRegistrationHandle`. However, `emitAdaptersUpdated()` is called from internal event dispatch where listeners are purely event subscribers.

In Nishi Core, `NishiProvidersService.record(entry)` commits internal state to `#byId` and `#byRoute`, calls `#announce()`, and **must return the withdrawal handle `() => void` to the caller (`registerProvider()`)**:
```ts
this.#byId.set(id, entry)
for (const route of routes) this.#byRoute.set(route, entry)
this.#announce()

return () => { ... }
```

If `#announce()` were to rethrow an `INVARIANT` or any other error:
1. `record()` would throw synchronously before reaching `return () => { ... }`;
2. The caller (`registerProvider()`) would catch the error in its outer `try/catch`, but `forgetRegistry` would be `undefined`;
3. `rollbackRegistration` would be unable to withdraw the provider;
4. The provider and routes would remain permanently committed in `#byId` and `#byRoute` as a **ghost provider**, causing subsequent duplicate registration errors.

Therefore, Core's design—containing all observer failures in `#announce()` with best-effort diagnostics to `this.ctx.logger.warn` and ensuring `record()` always returns the withdrawal handle—is **strictly correct** for this API. Validations that can legitimately veto registration are executed prior to registry commit.

---

## 6. Provider Package Impact Assessment

The provider collector implementations in the workspace were inspected and tested:
- **`nishi-dsh-codex`**: Uses `CodexUsageCollector` class instance.
- **`nishi-dsh-antigravity`**: Uses `AntigravityUsageCollector` class instance.
- **`nishi-dsh-claude`**: Uses `ClaudeUsageCollector` class instance.

`parseUsageSnapshotCollector` explicitly binds the `collect` method to the collector instance (`collect: collector.collect.bind(collector)`), preserving `this` access and private state across all provider implementations. All 31 provider package tests passed without modifications.

---

## 7. Git & Working Tree Status

```
HEAD: b925e2a328168e7c978126fc6474b7af11d7a63d
Branch: feat/core-provider-plugins-rc3
Working tree: clean (only docs/verification/gemini/LATEST.md modified)
```

---

## 8. Final Verdict

**`Result: PASS`**

The Core registry observer non-vetoing semantics, provider registration preflight validations, and post-record transactional rollback have passed all local verification gates, unit tests, and live Cordis integration probes with 100% compliance.
