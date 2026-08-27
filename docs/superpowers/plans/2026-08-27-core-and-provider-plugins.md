# Core and Provider Plugins Implementation Plan (`0.1.0-rc.3`)

> **For agentic workers:** implement task-by-task, in order. Steps use checkbox (`- [ ]`) syntax. Every verification step is judged by the command's exit code read from `$?`, never by output that looks green.

**Goal:** two kinds of package. `nishi-dsh-core` owns everything provider-independent — the provider registry and connector, the shared vendor runtime, the routed `web_search` tool, the usage domain and its UI — and names no provider anywhere, browser half included. Each provider is a plugin contributing one descriptor plus its protocol translation. Adding a provider costs a plugin and nothing else.

**Architecture:** providers are plugins for a plugin, using cordis injection: the core provides a `nishiProviders` service, each provider declares `inject: ['nishiProviders', ...]`, and cordis owns load order, deferral and teardown. Delegation to vendor CLI agents is removed outright; DSH's own child agents (`tool-subagent` with `provider: spawn` / `fork`) already ride the primary route and are the path if delegation returns.

**Tech Stack:** TypeScript 5.9, Node.js 24.19.0 through fnm (`/usr/bin/node` is v22 and must not be used), pnpm 11.21.0, DeepSeek Harness `0.1.1-rc.2`, tsdown for the core's bundled build, Node test runner via `tsx --test`.

**Spec:** `docs/superpowers/specs/provider-bridge-design.md`
**Roadmap:** `docs/ROADMAP.md` Stage 2 (2.A–2.H) and Stage 3

## Global constraints

- All packages in the family move together to exactly `0.1.0-rc.3`.
- No publish, no merge, no tag without the maintainer's explicit approval, every time.
- No vendor credential/session/token store is copied, parsed, migrated, or deleted.
- `@openai/codex*` and `@anthropic-ai/*` stay absent from the runtime lock graph.
- Windows remains NOT TESTED; no Windows claim may be added.
- GitHub Actions remain `BLOCKED_BILLING`; no hosted-CI PASS may be claimed.
- Published `0.1.0-rc.1` artifacts are immutable and must not be unpublished.
- Route strings `codex-app-server` and `antigravity-cli` do not change. They are user-visible in saved session request headers and in the profile default.
- Sequencing rule: **delete before unifying, and prove parity before deleting.** Task 1 exists because Task 2 would otherwise remove behaviour that was never covered elsewhere.

---

### Task 0: Verify the two-mount-point packaging assumption

The core needs a host-plane entry and an agent-plane entry from one package. The agent-plane entry is intended to be a preset row named `nishi-dsh-core/web-search`. `@deepseek-ai/cordis-plugin-loader@1.0.2` imports a bare row name with a plain dynamic `import(name)` (`lib/index.js:269`), so Node subpath-export resolution should apply — but this has never been exercised in this repository and every existing row is a bare package name.

**Files:**
- Read: `node_modules/.pnpm/@deepseek-ai+cordis-plugin-loader@1.0.2*/node_modules/@deepseek-ai/cordis-plugin-loader/lib/index.js`
- Scratch only: a throwaway package exporting a subpath plugin, mounted as a preset row

**Steps:**
- [x] 0.1 Subpath resolution through a real pnpm install: a probe package exporting `.` and `./web-search` was installed into a scratch app as a `file:` dependency, and both entries imported by specifier under Node 24.19.0. Exit `0`.
- [x] 0.2 Row identity does not assume a bare package name. The launcher composes patch layers and indexes rows by `id` — `rows.set(row.id, row)` in `dsh/lib/profile-boot-DG5t9aNs.js` — and the row `name` is only ever handed to the cordis loader, which imports anything not starting with `.` or `cordis:` with a plain `import(name)` (`cordis-plugin-loader@1.0.2/lib/index.js:269`). Nothing in the boot path validates the shape of a row name, and the *dependency* the Suite declares stays the bare `nishi-dsh-core`.
- [x] 0.3 Outcome recorded here.

**Outcome (2026-08-27): two mount points from one package are viable.** The plan proceeds with `nishi-dsh-core` (host bundle row) and `nishi-dsh-core/web-search` (preset row).

**Residual risk:** this was verified by loader/launcher source plus an isolated Node resolution test, not by a full DSH profile boot — no rc.3 profile exists yet to boot. The first real mount happens in Task 16.4, and the fallback below stays available until then.

**Decision gate:** if a subpath row does not mount, the fallback is a separate thin package `nishi-dsh-web-search` that injects `nishiProviders` — family becomes 7 instead of 6, and the rest of the plan is unchanged. Do not work around it inside the loader.

---

### Task 1: Move the Codex vendor-memory suppression to the primary invocation

The three overrides `memories.use_memories=false`, `memories.generate_memories=false`, `project_doc_max_bytes=0` exist only at `codex/src/run.ts:105` — the delegated path. The primary spawns `codex app-server --stdio` with none of them (`codex-plugin-dsh/adapter.ts:178`), so the product's central guarantee ("one project memory, the vendor's own is off") has never held on the primary plane. Deleting `run.ts` in Task 2 would remove the flags from the repository entirely.

**Files:**
- Modify: `packages/codex/src/codex-plugin-dsh/adapter.ts` (`codexAppServerInvocation`)
- Modify: `packages/codex/test/argv.test.ts`
- Modify: `packages/codex/README.md` (the claim `packages/codex/test/package.test.ts:29-31` asserts)

**Steps:**
- [x] 1.1 Injected as one frozen `CODEX_MEMORY_POLICY_OVERRIDES` list, spread into both branches of `codexAppServerInvocation` ahead of `app-server`. The vendored file's header now carries a Custom Policy Delta block, matching the convention `run.ts` used for the same three overrides.
- [x] 1.2 `argv.test.ts` retargeted to `codexAppServerInvocation`, plus two cases the old test could not have: the Windows batch-shim branch carries the same suppression before `app-server`, and the override list is exactly the three documented pairs.
- [x] 1.3 README updated; the three literal strings `package.test.ts:29-31` matches are kept.

**Verify:**
- [x] `pnpm --filter nishi-dsh-codex test` exit `0` (35 tests), `pnpm --filter nishi-dsh-codex check` exit `0`.
- [ ] Live: one Codex primary turn in a project containing an `AGENTS.md`-style project doc and a vendor memory entry; neither reaches the turn. Record as Stage 3.5 evidence.

---

### Task 2: Delete Codex delegation

**Files:**
- Delete: `packages/codex/src/run.ts`, `packages/codex/src/wire.ts`, `packages/codex/src/memory.ts`, `packages/codex/test/memory.test.ts`
- Modify: `packages/codex/src/index.ts`, `packages/codex/test/registration.test.ts`, `packages/codex/test/lifecycle.test.ts`, `packages/codex/package.json`, `packages/codex/README.md`

**Also removed here (was 5.3's shape, found dead in this task):** `providerName` and `permissionMode` only ever configured the delegated child, so both leave `Config`. Corrected a stale descriptor comment that claimed "there is no `model` entry here" directly above the entry.

**Steps:**
- [x] 2.1 Remove the `CodexProvider` subagent class, its `SubagentProvider` imports, and the `subagent` entry of the Codex descriptor.
- [x] 2.2 Deleted, plus `test/lifecycle.test.ts` — it covered only `textTask`, `startCodexRun`, `disposeCodexChild` and the wire protocol. `DEFAULT_DISPOSE_GRACE_MS` moved into `index.ts`, the one symbol the primary still uses.
- [x] 2.3 Drop `@deepseek-ai/dsh-subagent` from `package.json` if nothing else imports it, and remove the delegation sentences from the README.
- [x] 2.4 Retarget `registration.test.ts`: the package registers exactly one adapter (`codex-app-server`) and **no** subagent provider.

**Verify:**
- [x] `pnpm --filter nishi-dsh-codex test` exit `0` (27 tests), `check` exit `0`.
- [x] `grep -rn "registerProvider\|SubagentProvider" packages/codex/src` returns nothing.

---

### Task 3: Delete Antigravity delegation

**Files:**
- Delete: `packages/antigravity/src/antigravity-subagent.ts`, `packages/antigravity/src/memory.ts`, `packages/antigravity/test/antigravity-subagent.test.ts`, `packages/antigravity/test/headless-permission.test.ts`, `packages/antigravity/test-live/subagent.test.ts`
- Modify: `packages/antigravity/src/index.ts`, `packages/antigravity/test/registration.test.ts`, `packages/antigravity/package.json`, `packages/antigravity/README.md`

**Also done here (plan step 5.3, inseparable from the deletion):** `subagentProviderName`, `subagentModel` and `subagentEffort` leave `Config`, with `DEFAULT_ANTIGRAVITY_SUBAGENT_PROVIDER_NAME`. The `--dangerously-skip-permissions` guard test now reads the primary and the search backend instead of the deleted runner, so it still covers every file that spawns `agy`.

**Steps:**
- [x] 3.1 Remove `AntigravityProvider`, the `subagent` descriptor entry, and the `projectMemory` / `subagents` entries from `inject`.
- [x] 3.2 Delete the ephemeral-workspace usage that existed only for the subagent run; the primary and the search backend keep theirs.
- [x] 3.3 Remove the `test:live:subagent` script from `package.json` and the delegation section from the README, including the R4b headless limitation note.

**Verify:**
- [x] `pnpm --filter nishi-dsh-antigravity test` exit `0` (5 tests), `check` exit `0`.
- [x] `grep -rn "projectMemory" packages/antigravity/src packages/codex/src` returns nothing — after this task no provider package touches project memory at all.

---

### Task 4: Delete the project-memory subagent surface

**Files:**
- Delete: `packages/project-memory/src/subagent.ts`, `packages/project-memory/test/subagent-context.test.ts`, `packages/project-memory/test/subagent-service.test.ts`
- Modify: `packages/project-memory/src/service.ts`, `packages/project-memory/src/index.ts`, `packages/project-memory/README.md`

**Steps:**
- [x] 4.1 Went one step further: `ProjectMemoryService` itself is deleted, not just its method. Its one method *was* the subagent view, nothing injects `ctx.projectMemory` any more, and an empty service that nothing resolves is dead surface. Stage 6 can reintroduce one when it has a real method. This also settles the second half of R6 — there are no `(ctx as any).projectMemory` casts left to type.
- [x] 4.2 No consumer remained; deleted with the module. Two dead `projectMemory` stubs also left the Codex primary fixtures.
- [x] 4.3 Drop the "read-only subagent view" paragraph from the README.

**Verify:**
- [x] `pnpm --filter nishi-dsh-project-memory test` exit `0` (19 tests), `check` exit `0`.

---

### Task 5: Canonical ids and the config break

**Files:**
- Modify: `packages/codex/src/index.ts`, `packages/antigravity/src/index.ts`, `packages/antigravity/src/antigravity-primary.ts`, both packages' tests and READMEs
- Modify: `packages/provider-kit/src/registration.ts` (until Task 7 moves it)

**Steps:**
- [x] 5.1 Renamed across plugin `name`, descriptor id, executable-descriptor id, invariant plugin names, `resolveSharedProviderConfig` prefixes, the two Codex primary-history diagnostics, and the tests that assert them.
- [x] 5.2 Nothing to fix: the label was already corrected in `a0b3809`, so R7's first half was stale when it was written into the roadmap. The label was renamed with 5.1 like every other id.
- [x] 5.3 Done in Task 3, where the fields and their runner were deleted together.
- [x] 5.4 The `subagent` field and its registration step are gone, and the kit's fake context now *throws* if a provider registers a subagent provider, so the invariant is enforced by the suite rather than by grep alone. The `routes` hoist is deferred to Task 8: until the registry exists there is no consumer, and a second copy of `model.routes` would be a field nothing reads.

**Verify:**
- [x] `pnpm -r check` exit `0`, `pnpm --filter nishi-dsh-provider-kit test` exit `0`.
- [x] `grep -rn "subagent-codex\|subagent-antigravity" packages` returns nothing outside `docs/acceptance` history.

---

### Task 6: Preset and top-level docs

**Files:**
- Modify: `packages/suite/presets/orchestrator/agent.cordis.yml`, `packages/suite/presets/orchestrator/preset.yml`, `packages/suite/test/bundle-patch.test.ts`, `scripts/validate-orchestrator.mjs`
- Modify: `README.md`, `packages/suite/README.md`

**Steps:**
- [x] 6.1 Remove the `tool-subagent-codex` and `tool-subagent-antigravity` rows and rewrite the delegation comment block so it no longer describes fixed product delegation tools. `tool-subagent` (spawn) and `tool-subagent-fork` stay.
- [x] 6.2 Update `preset.yml` `description` — it still names "Codex, Claude Code, and Antigravity delegation tools".
- [x] 6.3 `validate-orchestrator.mjs` now asserts the two vendor tool names are **absent** (alongside the already-retired `subagent_claude_code`) and that DSH-native `subagent` / `subagent_fork` are present. `bundle-patch.test.ts` needed no change: it covers host rows, and the delegation tools were preset rows.
- [x] 6.4 Root `README.md` and `packages/suite/README.md`: the Modules lists now say "primary provider", and the Orchestrator section lists routed `web_search`, shared memory and DSH-native delegation.

**Verify:**
- [x] `pnpm test:orchestrator` exit `0` (28 unique rows); `pnpm verify:local` exit `0` for the whole deletion arc.
- [x] `grep` for `subagent_codex` / `subagent_antigravity` returns only the retired-name guards that assert their absence.

---

### Task 7: Create `nishi-dsh-core`

Mechanical merge, no behaviour change. Landed as its own commit so the next tasks read as design rather than as a move.

**Scope correction made while implementing: three packages merged, not four.** `primary-web-search` value-imports `nishi-dsh-codex` and `nishi-dsh-antigravity`, which import the core — merging it now would make the core depend on the packages that depend on it, and neither `pnpm -r build` nor `tsc` can order a cycle. It stays a separate package until Task 9 inverts that dependency, then folds in. Family is 6 packages now (`core`, `codex`, `antigravity`, `primary-web-search`, `project-memory`, `suite`), 6 again after Task 9 folds web-search in and Task 12 adds `claude`.

**Files:**
- Create: `packages/core/` — `package.json`, `tsconfig.json`, `tsdown.config.ts`, `README.md`, `LICENSE`, `THIRD_PARTY_NOTICES.md`, `src/`, `test/`
- Delete: `packages/provider-kit/`, `packages/usage-limits/`, `packages/usage-limits-host/`
- Modify: `packages/suite/{package.json,cordis.patch.yml,src/index.ts,test/*}`, `packages/codex/package.json`, `packages/antigravity/package.json`
- Modify: `scripts/{check-npm-names,pack-local,verify-bundle-install,verify-release-family,verify-package-contracts,smoke-vendor-cli}.mjs`

**Steps:**
- [x] 7.1 One tree with the merged boundaries visible: `src/runtime/` (executable, process, stderr, workspace, failure, registration, and the two vendor usage sources until Tasks 10/12 move them out), `src/usage/` (contract, collectors, service, projection), `src/host/` (composition, rpc, authorization-rpc, and the Antigravity local source until Task 10), `src/client/`. `src/registry/` arrives with Task 8.
- [x] 7.2 Exports: `.` (host plane), `./client` (browser, carrying the `dsh.client` manifest block verbatim), `./package.json`, plus **`./runtime`** — added beyond the plan: provider packages need the vendor runtime and the registration contract, and importing `.` would drag them into the host graph and its browser-adjacent peer set. `./web-search` arrives with Task 9. The host entry also re-exports the usage domain, which the live smoke and the tests consume across what used to be a package boundary.
- [x] 7.3 tsdown builds the whole package (`index`, `runtime`, `client`); `check` stays `tsc --noEmit`. The client purity gate lost its `nishi-dsh-usage-limits` exception — no `nishi-dsh-*` value import is legal in the browser bundle now — and the CSS/module-loader plugin ids became `nishi-dsh-core`.
- [x] 7.4 Dependency sets unioned; the merged package has **no** runtime dependencies at all, since its three former inter-package edges were internal. Test trees merged with no filename collisions; the CSS-module import hook is kept in the `test` script.
- [x] 7.5 Family lists, bundle row (`nishi-usage-limits-host` → `nishi-core`), Suite dependencies and `NISHI_DSH_SUITE_PACKAGES` updated; the three retired names were added to the retired-boundary guards so they cannot reappear. Everything bumped to `0.1.0-rc.3`.
- [x] 7.6 The web-search dependency inversion is untouched, as planned — it now happens in its own package, in Task 9.

**Verify:**
- [x] `pnpm install` exit `0`, `pnpm verify:local` exit `0` — 6 tarballs at `0.1.0-rc.3`.
- [x] `pnpm smoke:vendor-cli` exit `0`, 3/3 against the installed CLIs (`claude 2.1.246`, `codex-cli 0.150.0`, `agy 1.1.22`) — the check that catches a normalizer broken by the move. It first failed on missing exports, which is exactly what it exists for.
- [ ] `pnpm check:npm-names` for `nishi-dsh-core` — deferred to Task 12, which adds the other new name.

### Task 8: The registry service

**Files:**
- Created: `packages/core/src/registry/descriptor.ts`, `packages/core/src/registry/service.ts`, `packages/core/test/registry.test.ts`
- Modified: `packages/core/src/{index.ts,runtime/{index,registration}.ts}`, `packages/codex/src/index.ts`, `packages/antigravity/src/index.ts`, three provider test fixtures

**Steps:**
- [x] 8.1 `ProviderDescriptor` moved into `registry/descriptor.ts` with `id`, `executable`, `model?` (routes live on the capability, where the adapter that serves them is) and `install?`. **Deviation:** `presentation`, `usage` and `webSearch` are *not* added yet. Each is added by the task that consumes it — 11, 10 and 9 — so no field here is one nothing reads.
- [x] 8.2 `NishiProvidersService` provides `ctx.nishiProviders`: `record`, `byId`, `byRoute`, `all`, `onChange`. A duplicate id is refused, and a duplicate route is refused with a diagnostic naming the provider that already owns it — a silent second registration would mean one route quietly answering from the wrong vendor.
- [x] 8.3 Withdrawal is bound to the provider plugin's own lifetime: `registerProvider` puts the forget-callback in `ctx.effect` on the *provider's* context, so unloading the provider removes its entry along with its adapter's session listeners and dispose effect. A stale disposer cannot evict a re-registered entry (covered by a test).
- [x] 8.4 Both providers declare `inject: ['nishiProviders', ...]`, so cordis defers their `apply` until the core row is mounted, and a missing core row produces an actionable diagnostic rather than a `TypeError`. **Deviation:** the plan said to delete the `registerProvider` free function; it stays. It *is* the single registration path — the grep invariant's subject — and now writes into the registry as its first step. Deleting it would scatter the same three steps back into each provider.
- [x] 8.5 Tests: registration order, duplicate id, duplicate route, usage-only provider with no route, withdrawal, stale-disposer safety, listener unsubscribe, empty id, model-without-route refusal, and the unmounted-core diagnostic.

**Found while implementing:** cordis serves a service to consumers through a `Proxy`, and a proxied `this` cannot read class `#private` fields — the service throws `Cannot read private member` on first use. `UsageLimitsHostService` already worked around this by binding its methods in the constructor; that was undocumented, so the same fix here says why. The registry test mounts a real `Context` and reaches the service through `ctx.nishiProviders` precisely so the proxy path is exercised rather than bypassed.

**Verify:**
- [x] `pnpm --filter nishi-dsh-core test` exit `0` (99 tests); `pnpm verify:local` exit `0`.
- [x] `grep -rn "ctx.llm.registerAdapter" packages/codex/src packages/antigravity/src` returns nothing.

### Task 9: Web search on the registry

**Files:**
- Modify: `packages/core/src/web-search/*` (from `primary-web-search`), `packages/core/package.json`
- Modify: `packages/codex/src/web-search-backend.ts`, `packages/antigravity/src/web-search-backend.ts`
- Modify: `packages/core/test/web-search*.test.ts`, both providers' backend tests

**Steps:**
- [ ] 9.1 Replace the provider `switch` (was `primary-web-search/src/providers.ts:52`) with `registry.byRoute(route.provider)?.webSearch`. Absent descriptor and absent capability both produce the existing `WEB_SEARCH_UNSUPPORTED` error, with the message no longer built from a hardcoded provider list.
- [ ] 9.2 Remove `nishi-dsh-codex` and `nishi-dsh-antigravity` from the core's dependencies.
- [ ] 9.3 Move the shared backend contract and helpers into the core: the error class with its code, `record`, `bounded`, `promptFor`, effort encoding, and `search(route, request, signal)`. Argv construction, event parsing and result extraction stay in each provider.
- [ ] 9.4 Keep both providers' live search suites pointed at their own backends so the objects production builds are the ones exercised.

**Verify:**
- [ ] `pnpm test`; `echo $?` must be `0`.
- [ ] `node -e "const p=require('./packages/core/package.json');process.exit(Object.keys({...p.dependencies,...p.peerDependencies}).some(d=>d.startsWith('nishi-dsh-'))?1:0)"`; `echo $?` must be `0`.
- [ ] Live: routed `web_search` on Codex primary and on Antigravity primary; unsupported primary yields the explicit error.

---

### Task 10: Usage on descriptors

The usage domain itself is already provider-neutral: `contract.ts`, `service.ts`, `public-projection.ts` and `collectors/vendor-collector.ts` contain no provider name. Provider identity lives in exactly two places — the three per-provider collector files, and the host's hand-written registration branches. Both move.

**Files:**
- Modify: `packages/core/src/host/composition.ts`, `packages/core/src/usage/service.ts`, `packages/core/src/usage/index.ts`
- Move to `packages/codex/src/usage.ts`: `usage-limits/src/collectors/codex.ts` (178) — its identity constants, `CodexRateLimitsSourceError`, and its normalizer
- Move to `packages/antigravity/src/usage.ts`: `usage-limits/src/collectors/antigravity.ts` (187) plus `usage-limits-host/src/antigravity-local-source.ts` (533)
- Move to `packages/claude/src/usage.ts` in Task 12: `usage-limits/src/collectors/claude.ts` (174)
- Keep in the core: `contract.ts`, `collectors/vendor-collector.ts`, `service.ts`, `public-projection.ts`
- Modify: `packages/core/test/collector-failures.test.ts`, `packages/core/test/rpc.test.ts`; move the per-provider normalization cases into each provider's tests

**Steps:**
- [ ] 10.1 Move each provider's normalizer into its own package, exposed as the descriptor's `usage.normalize` alongside `read`, `refreshPolicy` and `capabilityClass`. The generic `VendorUsageCollector` stays in the core and is constructed from the descriptor.
- [ ] 10.2 Replace the per-provider `Host*Source` classes and registration branches in `composition.ts` with one iteration over registered descriptors, defaulting `refreshPolicy` to the single shared default.
- [ ] 10.3 Keep the capability taxonomy exactly as it is: a provider declaring no usage, or declaring it unsupported, produces an honest row and never an error. `NO_SUPPORTED_MACHINE_READABLE_SOURCE` behaviour must be unchanged.
- [ ] 10.4 Split each collector's tests so provider-specific payload cases live with the provider and only contract/projection cases stay in the core.

**Verify:**
- [ ] `pnpm test`; `echo $?` must be `0`.
- [ ] `pnpm smoke:vendor-cli`; `echo $?` must be `0` — it drives the real sources against the installed CLIs and through the real normalizers, which is the check that catches a normalizer broken by the move.
- [ ] `grep -rniE "codex|antigravity|claude" packages/core/src/usage` returns nothing.

---

### Task 11: Presentation record and the dynamic roster

**Files:**
- Modify: `packages/core/src/usage/public-projection.ts`, `packages/core/src/host/rpc.ts`
- Delete: `packages/core/src/client/roster.ts`
- Modify: `packages/core/src/client/ui/ProviderLogo.tsx`, `packages/core/src/client/usage-group-model.ts`, `packages/core/src/client/view-model.ts`, `packages/core/src/client/index.ts`
- Modify: `packages/codex/src/index.ts`, `packages/antigravity/src/index.ts` (each declares its own presentation)
- Modify: `packages/core/test/view-model.test.ts`, `packages/core/test/rpc.test.ts`

**Steps:**
- [ ] 11.1 Add `ProviderPresentation` to the descriptor and project it through the existing usage RPC as data.
- [ ] 11.2 `ProviderLogo` renders `brandColor` + `iconPath` from the payload, with the neutral mark as a supported outcome rather than a visual bug.
- [ ] 11.3 Replace the substring grouping at `usage-group-model.ts:71` (`'claude'` / `'gpt'` / `'external'`, and the `'gemini'` branch above it) with `groupLabel` from the payload, and the `providerId === 'antigravity'` special case with a declared flag on the presentation or the usage snapshot.
- [ ] 11.4 Derive the roster from the projection instead of the deleted static list: a provider mounted late appears, a provider never mounted leaves no placeholder row and no grey blank.

**Verify:**
- [ ] `pnpm test`; `echo $?` must be `0`.
- [ ] Live (Stage 3.6): all providers mounted; then a profile without Antigravity; then Antigravity mounted while the browser is already open.

---

### Task 12: Claude as a provider plugin

**Files:**
- Create: `packages/claude/` — `package.json`, `tsconfig.json`, `README.md`, `LICENSE`, `THIRD_PARTY_NOTICES.md`, `src/index.ts`, `src/usage-source.ts`, `test/`
- Delete: `packages/core/src/runtime/claude-usage.ts` and its test (moved, not dropped)
- Modify: `packages/suite/cordis.patch.yml`, `packages/suite/package.json`, the five family scripts

**Steps:**
- [ ] 12.1 Move the Claude usage source into the new package; its descriptor declares `usage` alone — no `model`, no `routes`, no `webSearch`, and an executable descriptor for the `claude` CLI.
- [ ] 12.2 Register it as a bundle row. A missing `claude` CLI must degrade to an explicit row, exactly as today.
- [ ] 12.3 `pnpm check:npm-names` for `nishi-dsh-claude`.

**Verify:**
- [ ] `pnpm verify:local`; `echo $?` must be `0`.
- [ ] `pnpm smoke:vendor-cli`; `echo $?` must be `0`.
- [ ] Live: the Claude usage row renders with the CLI installed, and degrades explicitly with `DSH_CLAUDE_EXECUTABLE` pointed at a nonexistent path.

---

### Task 13: Deduplicate what is left

**Files:**
- Modify: `packages/core/src/runtime/failure.ts`, `packages/core/src/runtime/*`, `packages/core/src/usage/*`
- Modify: `packages/codex/src/*`, `packages/antigravity/src/*`
- Modify: `packages/project-memory/src/filesystem.ts`

**Steps:**
- [ ] 13.1 One `VendorFailure`: fold Codex's richer fields (HTTP status, exit code, signal) into the core's and delete the provider-local string builders.
- [ ] 13.2 One copy each of `record`, `thrown`, `assertPositiveFinite`, `bounded`, including the two copies inside the core's own usage sources.
- [ ] 13.3 Replace the hand-rolled temp+rename atomic write in `project-memory/src/filesystem.ts` with `@deepseek-ai/dsh-atomic-write`, keeping the symlink refusal behaviour and its tests.

**Verify:**
- [ ] `pnpm test`; `echo $?` must be `0`.
- [ ] `grep -rn "^function record(\|^function thrown(\|function assertPositiveFinite(" packages/*/src` shows one definition each.

---

### Task 14: Honest model catalog

**Files:**
- Modify: `packages/antigravity/src/antigravity-primary.ts` (the `^(gemini|claude|gpt|oss)` filter at `:132`)
- Modify/Create: `packages/antigravity/test/catalog.test.ts`

**Steps:**
- [ ] 14.1 Remove the family filter; keep whatever parsing is needed to reject malformed entries, which is a different check from hiding unrecognised families.
- [ ] 14.2 Cover the catalog parser with unit tests — this is also the cheapest first bite of R2, now that this file is the whole Antigravity integration.

**Verify:**
- [ ] `pnpm --filter nishi-dsh-antigravity test`; `echo $?` must be `0`.
- [ ] Live: `listModels` returns a family the old pattern would have hidden, or record that the account exposes none.

---

### Task 15: Invariants and the falsifiable acceptance test

**Files:**
- Create: `packages/core/test/invariants.test.ts`, `scripts/verify-core-neutrality.mjs`
- Modify: `package.json` (`verify:local` chain)

**Steps:**
- [ ] 15.1 No provider package calls `ctx.llm.registerAdapter`, registers a usage source directly, or registers a subagent provider; no vendor subagent tool exists in the tree.
- [ ] 15.2 `packages/core` contains no provider identifier — `codex`, `antigravity`, `claude`, `gpt`, `gemini` — in any file, browser half included. The test enumerates its own exceptions explicitly; an unexplained match fails.
- [ ] 15.3 `packages/core` depends on no `nishi-dsh-*` provider package; every descriptor with a `model` declares ≥1 route and every descriptor without one declares none.
- [ ] 15.4 **The acceptance test.** Write a Grok descriptor on a scratch branch and confirm zero edits were needed in `core`, `project-memory`, the Suite composition, or any browser file. If any were needed, the abstraction did not hold — fix the contract, not the descriptor. The descriptor does not ship in rc.3; it is Stage 7's starting point.
- [ ] 15.5 Wire `verify:core-neutrality` into `verify:local`.

**Verify:**
- [ ] `pnpm verify:local`; `echo $?` must be `0`.
- [ ] Deliberately break each invariant once and confirm the check fails — an invariant that has never failed has not been tested.

---

### Task 16: Gates and live acceptance

**Steps:**
- [ ] 16.1 `pnpm install --frozen-lockfile`, `pnpm verify:local`, `pnpm smoke:vendor-cli`, `pnpm verify:bundle-install`; read `$?` after each.
- [ ] 16.2 Confirm the lock graph still excludes `@openai/codex*` and `@anthropic-ai/*`.
- [ ] 16.3 Live acceptance, recorded in `docs/acceptance/`: Codex primary with memory read/write and routed search; Antigravity primary with a mid-conversation model switch and routed search; **provider switch Codex → Antigravity inside one session** with memory written before and read after (Stage 3.2/3.3); usage rows for all providers including the dynamic-roster cases; vendor memory suppressed on Codex primary (Stage 3.5).
- [ ] 16.4 Fresh-profile install/upgrade from local tarballs preserving the `dsh-chatgpt-web` link, `preset install` / `status` / `remove`, then normal Suite removal.
- [ ] 16.5 Write `docs/release/2026-08-27-rc3-prerelease.md`: the family goes from eight names to six, `subagent_codex` / `subagent_antigravity` are gone, three Antigravity config fields are gone, and the four merged package names are superseded by `nishi-dsh-core`. Stop there — publication needs separate explicit approval.

**Done when:** every task above is checked, `pnpm verify:local` exits `0`, the live acceptance record exists, and the rc.3 release note is written but unpublished.
