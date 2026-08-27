# Core 11 — Root injection validation

Tested commit: e17c734314465e2192f57b50776e38358ab832b0
Branch: feat/core-provider-plugins-rc3
Node: v24.19.0
Node path: /home/acedia/.local/share/fnm/node-versions/v24.19.0/installation/bin/node
pnpm: 11.21.0

## Commands

### test
Command: `pnpm --filter nishi-dsh-core test`
Exit code: 0
Result: PASS

Output details:
- Total tests: 162
- Passed: 162
- Failed: 0
- Suites: 0, Skipped: 0, Todo: 0
- Duration: ~820ms

### check
Command: `pnpm --filter nishi-dsh-core check`
Exit code: 0
Result: PASS

Output: `tsc -p tsconfig.json --noEmit` completed with 0 errors.

### build
Command: `pnpm --filter nishi-dsh-core build`
Exit code: 0
Result: PASS

Output: `tsdown` built all entries (`src/index.ts`, `src/runtime/index.ts`, `src/usage/index.ts`, `src/web-search/index.ts`, `src/client/index.ts`) generating CJS/ESM bundles and TypeScript declaration files (`.d.ts`).

## Root dependency graph

Inspection of `packages/core/src/index.ts` confirmed the exact set of services required by the root plugin lifecycle:

1. **`apply(ctx, config)` entry execution**:
   - `ctx.plugin(NishiProvidersService)`: instantiates and mounts the provider registry service directly on the context (`ctx.nishiProviders`). This service is hosted internally by Core; it is not an external prerequisite injection.
   - `new UsageLimitsHostService(ctx, config)`: composes host usage limits and derives live roster/status from `ctx.nishiProviders`. It requires no external services beyond `ctx.nishiProviders`.
   - `ctx.connection.rpc.handle(USAGE_LIMITS_CHANNEL, ...)`: registers the `/usage-limits` RPC channel handlers directly on `ctx.connection.rpc`. Requires `connection`.
   - `new AuthorizationHostController(ctx)`: handles Model Accounts status and legacy grant deletion via `ctx.credentials`. Requires `credentials`.
   - `ctx.connection.rpc.handle(AUTHORIZATION_RPC_CHANNEL, ...)`: registers the `/authorization` RPC channel handlers directly on `ctx.connection.rpc`. Requires `connection`.

2. **Absence of unused services**:
   - Root `apply()` and its host services (`UsageLimitsHostService`, `AuthorizationHostController`, `NishiProvidersService`) never access `ctx.subprocess`.
   - `AuthorizationHostController` never accesses `ctx.authorization`.

3. **Contract declaration**:
   - `export const inject = ['connection', 'credentials'] as const`
   - `export const NishiCorePlugin = { name, inject, apply }`
   - `NishiCorePlugin.inject` accurately mirrors `inject`.

## Subprocess distinction

- **Package/Type dependency vs Cordis service injection**:
  - `packages/core/src/runtime/process.ts` and `packages/core/src/runtime/stderr.ts` expose reusable vendor CLI runtime utilities (`outputLines`, `disposeVendorChild`, `settledStderr`).
  - These utilities import TypeScript interfaces (`SubprocessHandle`, `SubprocessOutcome`) from `@deepseek-ai/dsh-subprocess`.
  - `@deepseek-ai/dsh-subprocess` correctly remains in `packages/core/package.json` under `peerDependencies` and `devDependencies` to supply type contracts and dev environment typings.
  - The runtime helper functions operate purely on standard streams, timers, and promises without resolving `ctx.subprocess`.
  - Service injection (`inject: [...]`) governs Cordis plugin mounting prerequisites. Root `nishi-core` does not consume `ctx.subprocess`, so omitting `subprocess` from root `inject` is architecturally correct.

## Authorization distinction

- **Authorization host behavior (`packages/core/src/host/authorization-rpc.ts`)**:
  - Direct subscription OAuth login via DSH is disabled (`MUTATING_PROVIDER_IDS = new Set<string>()`; `beginLogin`, `submitPrompt`, `cancelLogin` reject with bad-request or error).
  - Model Accounts status (`describeProviderPublic`) queries existing credential records using `this.ctx.credentials.describeRecord(key)`.
  - Legacy grant removal (`logout`) deletes stored credential records using `this.ctx.credentials.deleteRecord(key)`.
  - `AuthorizationHostController` interacts exclusively with `ctx.credentials` and never calls `ctx.authorization`.
  - No source file in `packages/core/src/` contains static or dynamic imports of `@deepseek-ai/dsh-authorization`.
  - Removing `authorization` from root injection is safe and avoids holding the core plugin back for an unneeded service.

## Provider compatibility

- **Provider plugin inspection**:
  - **Codex** (`packages/codex/src/index.ts`): declares `inject = ['nishiProviders', 'subprocess', 'llm', 'sessions', 'attachments']`. Spawns processes via `ctx.subprocess.spawn`.
  - **Antigravity** (`packages/antigravity/src/index.ts`): declares `inject = ['nishiProviders', 'subprocess', 'llm']`. Spawns processes via `ctx.subprocess.spawn`.
  - **Claude** (`packages/claude/src/index.ts`): declares `inject = ['nishiProviders', 'subprocess']`. Spawns processes via `ctx.subprocess.spawn`.
- **Independent lifecycle**:
  - Every provider that requires `subprocess` explicitly declares `'subprocess'` in its own plugin `inject` array.
  - No provider relied on `nishi-core` indirectly enforcing a `subprocess` service mount.
  - In `packages/suite/cordis.patch.yml`, providers declare `inject: ['nishiProviders', ...]`, ensuring they mount after `nishi-core` registers `NishiProvidersService`.
  - All workspace tests across `nishi-dsh-codex` (31/31), `nishi-dsh-antigravity` (7/7), `nishi-dsh-claude` (31/31), and `nishi-dsh-suite` (12/12) pass.

## Cordis semantics

- Evaluated on `@deepseek-ai/cordis` 4.0.1:
  - In Cordis 4.x, a plugin fiber's lifecycle is guarded by its `inject` table. The fiber stays inactive (`state === 0` / `epoch === INACTIVE`) until all declared dependencies transition to loaded state (`state === 2`).
  - By pruning unconsumed services (`subprocess`, `authorization`) from `inject`, `nishi-core` is unblocked and mounts immediately once `connection` and `credentials` are available.
  - Type-level imports and Cordis service injection are strictly decoupled: sharing runtime types across packages does not require declaring those packages as runtime Cordis service prerequisites.

## Test review

- `packages/core/test/root-inject.test.ts`:
  - Enforces exact match: `assert.deepEqual(inject, ['connection', 'credentials'])`.
  - Enforces plugin export symmetry: `assert.deepEqual(NishiCorePlugin.inject, inject)`.
  - Explicitly asserts non-presence of removed services: `inject.includes('subprocess' as never) === false` and `inject.includes('authorization' as never) === false`.
  - Casting to `as never` is sound in TypeScript given the `readonly ['connection', 'credentials']` tuple signature, preventing compilation issues while guaranteeing runtime exclusion.

## Future cleanup candidates

- **`@deepseek-ai/dsh-authorization` in `packages/core/package.json`**:
  - Declared under `peerDependencies` and `devDependencies`.
  - Confirmed 0 imports across `packages/core/src/`.
  - Candidate for manifest cleanup in a subsequent dependency-pruning task.

## Additional review

NO BLOCKING ISSUES FOUND.

## Working tree

Clean working tree on branch `feat/core-provider-plugins-rc3` at commit `e17c734314465e2192f57b50776e38358ab832b0` prior to writing this verification document.

## Verdict

PASS

Summary:
- Node: v24.19.0 (PASS)
- test: exit 0 (162/162 pass) (PASS)
- check: exit 0 (0 errors) (PASS)
- build: exit 0 (bundle generated cleanly) (PASS)
- Root inject narrowed strictly to `['connection', 'credentials']` (PASS)
- Providers explicitly manage their own `subprocess` injections (PASS)
- Subprocess runtime helper functions and types intact (PASS)
- Authorization RPC operates purely over `credentials` (PASS)
- No blocking issues found (PASS)
