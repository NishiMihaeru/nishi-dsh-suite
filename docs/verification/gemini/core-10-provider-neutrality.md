# Core 10 — Provider neutrality validation

Tested commit: 7b5ddcf25034fca87f74ffdf88e8aaf78dbc3fee
Branch: feat/core-provider-plugins-rc3
Node: v24.19.0
Node path: /home/acedia/.local/share/fnm/node-versions/v24.19.0/installation/bin/node
pnpm: 11.21.0

## Commands

### test
Command: `pnpm --filter nishi-dsh-core test`
Exit code: 1
Result: FAIL

Output details:
- Total tests: 161
- Passed: 160
- Failed: 1
- Failing test: `core source never imports provider packages or hardcodes provider ids as string literals` in `packages/core/test/package-boundary.test.ts:61`
- Failure diagnostic:
  ```
  AssertionError [ERR_ASSERTION]: runtime/executable.ts must not hardcode provider id codex as a string literal
  true !== false
      at TestContext.<anonymous> (packages/core/test/package-boundary.test.ts:84:14)
  ```
- Root cause: `packages/core/src/runtime/executable.ts` contains `'codex'`, `'antigravity'`, and `'claude'` as example string literals inside JSDoc comments (lines 23 and 25). The static guard in `package-boundary.test.ts` scans raw source code via `source.includes("'codex'")` without stripping comments, triggering an assertion failure.

### check
Command: `pnpm --filter nishi-dsh-core check`
Exit code: 0
Result: PASS

Output: `tsc -p tsconfig.json --noEmit` completed without errors.

### build
Command: `pnpm --filter nishi-dsh-core build`
Exit code: 0
Result: PASS

Output: `tsdown` built all entries (`src/index.ts`, `src/runtime/index.ts`, `src/usage/index.ts`, `src/web-search/index.ts`, `src/client/index.ts`) generating both CJS/ESM targets and TypeScript declaration bundles (`.d.ts`) cleanly.

## Package boundary

1. **Manifest dependencies (`packages/core/package.json`)**:
   - `dependencies`: No provider packages (`nishi-dsh-codex`, `nishi-dsh-antigravity`, `nishi-dsh-claude`) or `@deepseek-ai/dsh-subagent`.
   - `peerDependencies`: Clean of any provider packages or retired subagent packages.
   - `devDependencies`: Clean of any provider packages or retired subagent packages.

2. **Source imports (`packages/core/src/`)**:
   - No imports of `nishi-dsh-codex`, `nishi-dsh-antigravity`, `nishi-dsh-claude`, or `@deepseek-ai/dsh-subagent`.

3. **Relative cross-package imports**:
   - No relative import reaching sibling workspace packages (e.g. `../../codex`, `../../antigravity`, `../../claude`, `../codex`, etc.).
   - All relative imports in `packages/core/src` are internal within the package boundary (e.g. `../../index.js`, `../../usage/index.js`).

4. **Identity string literals & comments**:
   - No provider identity string literals (`'codex'`, `"codex"`, `'antigravity'`, `"antigravity"`, `'claude'`, `"claude"`) are used in executable code.
   - In `packages/core/src/runtime/executable.ts` lines 23 and 25, JSDoc comments contain `'codex'`, `'antigravity'`, and `'claude'` within type docstrings (`/** Stable provider id used in diagnostics, e.g. 'codex', 'antigravity', 'claude'. */` and `/** Non-Windows PATH lookup name, e.g. 'codex', 'agy', 'claude'. */`), causing the raw static string checker in `package-boundary.test.ts` to fail.

5. **Vendor-specific branching**:
   - No `switch(providerId)` or `switch(route)` with provider vendor cases in core runtime, host, registry, web search, or client.
   - DeepSeek platform authorization code (`packages/core/src/host/authorization-rpc.ts`, `packages/core/src/client/authorization/`) references DeepSeek Desktop shell built-in account providers (`openai-codex`, `anthropic`, `openai`), which are distinct from Nishi subscription CLI plugins and do not violate provider neutrality.

6. **Provider-owned artifacts**:
   - Core does not import or contain vendor-specific normalizers, usage collectors, model adapters, or CLI process executors.

7. **Executable names**:
   - Core runtime does not hardcode binary names (`codex`, `claude`, `agy`, `jetski`) in routing or resolution logic; names are provided via `VendorExecutableDescriptor` data structures (`defaultName`, `windowsName`, `envOverride`).

## Fourth-provider proof

Analysis of `packages/core/test/provider-extension.test.ts`:
- Uses fictional provider: `id: 'nebula'`, `route: 'nebula-chat'`, `displayName: 'Nebula CLI'`, `envOverride: 'DSH_NEBULA_EXECUTABLE'`.
- Production codebase verification: `rg -n "nebula|nebula-chat|DSH_NEBULA" packages/core/src` returned 0 matches.
- Verification lifecycle steps:
  1. Registry context initialized without prior knowledge of `nebula`.
  2. `composeUsageLimitsHost` mounted BEFORE provider registration.
  3. `ctx.nishiProviders.record(...)` registers `nebula` with custom `PrimarySearchBackend` and `UsageSnapshotCollector`.
  4. Registry lookups verified: `byId('nebula')` returns provider record, `byRoute('nebula-chat')` resolves the same provider, and `webSearch` backend is correctly exposed.
  5. `service.getRegisteredProviderIds()` automatically updates to include `['nebula']` via `onChange` listener.
  6. `facade.refreshProvider('nebula', { force: true })` invokes the registered collector, producing a valid public DTO (`providerId: 'nebula'`, `displayName: 'Nebula CLI'`, `status: 'AVAILABLE'`).
  7. Provider withdrawal: calling `forget()` removes provider from registry (`byId('nebula') === undefined`, `byRoute('nebula-chat') === undefined`) and updates usage host (`service.getRegisteredProviderIds() === []`).

## Registry and routing

- **Canonical identity enforcement**: `canonicalProviderId` and `canonicalProviderRoute` enforce formatting and prevent whitespace/trimming discrepancies.
- **Collision rejection**: Duplicate provider IDs, duplicate routes across providers, and duplicate routes within a single provider are rejected before mutating state.
- **Route resolution**: `NishiProvidersService.byRoute(route)` maps DSH model routes directly to `RegisteredProvider`.
- **Web search binding**: `RegisteredProvider.webSearch` stores the `PrimarySearchBackend` provided during registration, queried dynamically per search call with no fixed provider map or fallback.
- **Open-ended providers**: Core operates entirely without an enum or fixed list of supported provider IDs.

## Usage composition

- **Dynamic lifecycle**: `composeUsageLimitsHost` dynamically reconciles registered usage collectors against `ctx.nishiProviders.all()` whenever `onChange` fires.
- **Late registration**: Providers mounted after core host startup are immediately incorporated into the usage service roster without requiring a host restart.
- **Snapshot contract**: Registered collectors return snapshots conformant to `ProviderUsageSnapshot`, projected into `PublicProviderUsage` without vendor-specific transformations.
- **Capability withdrawal & rollback**: When a provider unloads, `reconcile` cleanly invokes the withdrawal callback, removing the provider from `UsageLimitsService`.

## Browser neutrality

- **Dynamic roster**: Browser UI receives provider roster dynamically via `get-roster` RPC (`ProviderRosterRow[]`), not from a static client bundle list.
- **Generic presentation model**: `ProviderPresentation` transports presentation metadata as pure data (`id`, `displayName`, `brandColor`, `iconPath`, `bucketsAsPools`).
- **Icon rendering**: `ProviderLogo` renders SVG path from `presentation.iconPath` or falls back to a neutral circular mark (`<circle cx="12" cy="12" r="8" />`) when absent.
- **Accent colors**: `usageGroupAccent` uses `presentation.brandColor` or defaults to `#6B7280` (`NEUTRAL_BRAND_COLOR`).
- **Pool grouping**: Pools are derived from window `scope.id` and `scope.label` when `presentation.bucketsAsPools === true`, rather than hardcoded vendor name matching.

## Model/runtime neutrality

- **Model registration**: `registerProvider` coordinates capability registration: validates identity, instantiates capabilities via descriptor factories, records in `nishiProviders`, registers LLM routes via `ctx.llm.registerAdapter(routes, adapter)`, and executes optional `install()`.
- **Transactional rollback**: If model creation or install fails, registrations in `nishiProviders` and `ctx.llm` are rolled back.
- **Usage-only support**: Providers without model capabilities are fully valid and register usage without claiming model routes.
- **Executable resolution**: `resolveVendorExecutable` resolves paths using `VendorExecutableDescriptor` parameters (`defaultName`, `windowsName`, `envOverride`) against explicit config, environment overrides, and `PATH` without vendor hardcoding.
- **Error categorization**: `VendorFailure` encapsulates vendor CLI failures with generic `product`, `stage`, `category`, and sanitized `detail` rather than a closed vendor enum.

## Static guard review

- **Portability**: `sourceFiles` in `package-boundary.test.ts` uses URL objects for directory traversal and file reading, ensuring cross-platform portability.
- **Scope**: Scans only `packages/core/src/` (`.ts` and `.tsx` files), excluding `packages/core/test/` to avoid false triggers on test fixtures.
- **False positives**: The guard checks `source.includes("'codex'")` / `source.includes('"codex"')` directly on raw file content. This creates a false positive when provider names are mentioned in JSDoc comments or docstrings as examples (e.g. `runtime/executable.ts:23,25`), causing test failure despite zero provider-specific executable code.
- **False negatives**: Simple string searching cannot detect obfuscated or dynamically constructed strings (e.g. string concatenation), but combined with architectural review and automated extension tests (`provider-extension.test.ts`), the boundary is effectively enforced.

## Additional review

No architectural regressions or provider coupling found in core runtime, host, registry, web search, or client.

NO BLOCKING ISSUES FOUND.

## Working tree

Clean working tree on branch `feat/core-provider-plugins-rc3` at commit `7b5ddcf25034fca87f74ffdf88e8aaf78dbc3fee` prior to verification report generation.

## Verdict

FAIL

Summary:
- Node: v24.19.0 (PASS)
- check: exit 0 (PASS)
- build: exit 0 (PASS)
- test: exit 1 (FAIL — 1 failing test in `packages/core/test/package-boundary.test.ts` due to JSDoc comment false positive in `packages/core/src/runtime/executable.ts`)
- Provider packages are not dependencies of core (PASS)
- Nebula extension proof passes (PASS)
- Late registration and withdrawal work as expected (PASS)
- Architecture is provider-neutral (PASS)
