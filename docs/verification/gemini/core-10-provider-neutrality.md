# Core 10 — Provider neutrality validation

Tested commit: 1804beadc85dd38a3c8ef1c391a2ff92b19f2df6
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
- Total tests: 161
- Passed: 161
- Failed: 0
- Suites: 0, Skipped: 0, Todo: 0
- Duration: ~900ms

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

## Static guard regression fix

Commit `1804beadc85dd38a3c8ef1c391a2ff92b19f2df6` resolved the false positive in `packages/core/test/package-boundary.test.ts`:
- **AST extraction**: The guard was updated to use TypeScript AST parser (`ts.createSourceFile`) via helper `executableStringLiterals(source, path)`.
- **Targeted node matching**: Traverses the syntax tree with `ts.forEachChild` collecting only `ts.isStringLiteralLike(node)` AST tokens (string literals, no-substitution template literals, template spans).
- **JSDoc/Comments excluded**: Trivia (JSDoc comments, block comments, line comments) are not AST syntax nodes, so docstrings containing example provider IDs in `packages/core/src/runtime/executable.ts` (`'codex'`, `'antigravity'`, `'claude'`) are ignored by the collector.
- **Precision on executable constructs**: Real executable string literals (`const p = 'codex'`, static/dynamic imports `import 'nishi-dsh-codex'`, `await import('nishi-dsh-codex')`, and relative import paths `'../../codex'`) are accurately captured as AST string literal nodes.
- **Dialect awareness**: Correctly assigns `ts.ScriptKind.TSX` to `.tsx` files and `ts.ScriptKind.TS` to `.ts` files.

## Package boundary

1. **Manifest dependencies (`packages/core/package.json`)**:
   - `dependencies`: No provider packages (`nishi-dsh-codex`, `nishi-dsh-antigravity`, `nishi-dsh-claude`) or `@deepseek-ai/dsh-subagent`.
   - `peerDependencies`: Clean of any provider packages or retired subagent packages.
   - `devDependencies`: Clean of any provider packages or retired subagent packages (`typescript` is present as devDependency).

2. **Source imports (`packages/core/src/`)**:
   - No static or dynamic imports of `nishi-dsh-codex`, `nishi-dsh-antigravity`, `nishi-dsh-claude`, or `@deepseek-ai/dsh-subagent`.

3. **Relative cross-package imports**:
   - No relative imports escaping the package boundary into sibling provider packages (e.g. `../../codex`, `../../antigravity`, `../../claude`).
   - All relative imports are package-internal (`../../index.js`, `../../usage/index.js`).

4. **Executable identity literals**:
   - No executable string literal or template literal in `packages/core/src` hardcodes provider IDs (`'codex'`, `'antigravity'`, `'claude'`).
   - DeepSeek platform authorization code references shell-level account provider keys (`openai-codex`, `anthropic`, `openai`) which are distinct from Nishi subscription CLI plugins and do not violate package neutrality.

## Fourth-provider proof

Verified via `packages/core/test/provider-extension.test.ts`:
- Demonstrates integration of an unfamiliar fourth provider (`id: 'nebula'`, `route: 'nebula-chat'`, `displayName: 'Nebula CLI'`, `envOverride: 'DSH_NEBULA_EXECUTABLE'`).
- `rg -n "nebula|nebula-chat|DSH_NEBULA" packages/core/src` confirmed 0 production occurrences.
- Full extension lifecycle verified:
  1. Registry initialized without prior knowledge of `nebula`.
  2. `composeUsageLimitsHost` mounted before `nebula` registration.
  3. `ctx.nishiProviders.record(...)` records provider with custom `PrimarySearchBackend` and `UsageSnapshotCollector`.
  4. Registry lookup: `byId('nebula')` returns provider, `byRoute('nebula-chat')` resolves provider and exposes `webSearch`.
  5. Dynamic usage reconciliation: `service.getRegisteredProviderIds()` reflects `['nebula']` via `onChange`.
  6. Collector invocation: `facade.refreshProvider('nebula', { force: true })` produces valid public DTO (`status: 'AVAILABLE'`).
  7. Withdrawal: invoking registration disposer removes registry records and cleans usage registrations.

## Architecture review

- **Registry & Routing**: Provider identity validation is canonical and collision-resistant. Model routes map directly to providers; no fixed provider list exists.
- **Web Search**: One routed `web_search` tool dynamically resolves `PrimarySearchBackend` from `ctx.nishiProviders.byRoute(route)`. Primary route follows session request headers without hardcoded vendor fallback.
- **Usage Limits Host**: Host composition reconciles providers dynamically via `nishiProviders.onChange`, supporting late-mounted plugins and cache invalidation signals.
- **Browser Neutrality**: Roster is served dynamically over RPC (`get-roster`). Presentation metadata (`brandColor`, `iconPath`, `bucketsAsPools`) is transported as data; neutral fallbacks handle missing icons and colors without provider-specific `switch` branching.
- **Model / Runtime Neutrality**: `registerProvider` coordinates adapter registration via `ctx.llm.registerAdapter` with transactional rollback. `resolveVendorExecutable` and `VendorFailure` operate purely on descriptor data without hardcoded executable catalogs.
- **Regression Safety**: All Core 01–09 invariants (identity bounds, registration rollback, usage absence, browser lifecycle, settled stderr, agent workspace) remain green (161/161 tests pass).

## Static guard limitations

- **Synthesized identifiers**: The static AST guard inspects string literal tokens; dynamically constructed identifiers (e.g. `'co' + 'dex'`) would not appear as a single literal. This is an expected static analysis trade-off, fully mitigated by architectural code review and extension seam tests.
- **DevDependency scope**: Using `typescript` within test files relies on the existing devDependency and has zero effect on the production core bundle or runtime dependencies.

## Additional review

NO BLOCKING ISSUES FOUND.

## Working tree

Clean working tree on branch `feat/core-provider-plugins-rc3` at commit `1804beadc85dd38a3c8ef1c391a2ff92b19f2df6` prior to updating the verification report.

## Verdict

PASS

Summary:
- Node: v24.19.0 (PASS)
- test: exit 0 (161/161 pass) (PASS)
- check: exit 0 (PASS)
- build: exit 0 (PASS)
- False-positive JSDoc regression resolved with AST analysis (PASS)
- Provider neutrality confirmed across host, runtime, browser, web-search, and registry (PASS)
- Fourth-provider extension proof passes cleanly (PASS)
- No blocking architecture issues (PASS)
