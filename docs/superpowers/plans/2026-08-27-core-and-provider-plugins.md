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
- [ ] 0.1 Mount a scratch package's subpath (`pkg/sub`) as a preset row in a scratch profile and confirm the plugin applies.
- [ ] 0.2 Confirm plugin identity/dedup keys off the resolved module, not a bare package-name assumption, so `nishi-dsh-core` and `nishi-dsh-core/web-search` can both be mounted in one process.
- [ ] 0.3 Record the outcome in this file under the task.

**Decision gate:** if a subpath row does not mount, the fallback is a separate thin package `nishi-dsh-web-search` that injects `nishiProviders` — family becomes 7 instead of 6, and the rest of the plan is unchanged. Do not work around it inside the loader.

---

### Task 1: Move the Codex vendor-memory suppression to the primary invocation

The three overrides `memories.use_memories=false`, `memories.generate_memories=false`, `project_doc_max_bytes=0` exist only at `codex/src/run.ts:105` — the delegated path. The primary spawns `codex app-server --stdio` with none of them (`codex-plugin-dsh/adapter.ts:178`), so the product's central guarantee ("one project memory, the vendor's own is off") has never held on the primary plane. Deleting `run.ts` in Task 2 would remove the flags from the repository entirely.

**Files:**
- Modify: `packages/codex/src/codex-plugin-dsh/adapter.ts` (`codexAppServerInvocation`)
- Modify: `packages/codex/test/argv.test.ts`
- Modify: `packages/codex/README.md` (the claim `packages/codex/test/package.test.ts:29-31` asserts)

**Steps:**
- [ ] 1.1 Inject the three `-c` overrides into both branches of `codexAppServerInvocation` — the direct argv and the Windows `cmd.exe` argv — ahead of `app-server`, exactly once each.
- [ ] 1.2 Retarget the `argv.test.ts` assertions (presence, exactly-once, ordering before `app-server`) from the subagent argv builder to `codexAppServerInvocation`.
- [ ] 1.3 Update the README sentence so it describes the primary invocation, keeping the three literal strings `package.test.ts` matches.

**Verify:**
- [ ] `pnpm --filter nishi-dsh-codex test`; `echo $?` must be `0`.
- [ ] Live: one Codex primary turn in a project containing an `AGENTS.md`-style project doc and a vendor memory entry; neither reaches the turn. Record as Stage 3.5 evidence.

---

### Task 2: Delete Codex delegation

**Files:**
- Delete: `packages/codex/src/run.ts`, `packages/codex/src/wire.ts`, `packages/codex/src/memory.ts`, `packages/codex/test/memory.test.ts`
- Modify: `packages/codex/src/index.ts`, `packages/codex/test/registration.test.ts`, `packages/codex/test/lifecycle.test.ts`, `packages/codex/package.json`, `packages/codex/README.md`

**Steps:**
- [ ] 2.1 Remove the `CodexProvider` subagent class, its `SubagentProvider` imports, and the `subagent` entry of the Codex descriptor.
- [ ] 2.2 Delete the three modules and the memory test; move anything the primary still needs (only if a real consumer remains) into the primary's own module rather than keeping a file alive for one symbol.
- [ ] 2.3 Drop `@deepseek-ai/dsh-subagent` from `package.json` if nothing else imports it, and remove the delegation sentences from the README.
- [ ] 2.4 Retarget `registration.test.ts`: the package registers exactly one adapter (`codex-app-server`) and **no** subagent provider.

**Verify:**
- [ ] `pnpm --filter nishi-dsh-codex test`; `echo $?` must be `0`.
- [ ] `grep -rn "registerProvider\|SubagentProvider" packages/codex/src` returns nothing.

---

### Task 3: Delete Antigravity delegation

**Files:**
- Delete: `packages/antigravity/src/antigravity-subagent.ts`, `packages/antigravity/src/memory.ts`, `packages/antigravity/test/antigravity-subagent.test.ts`, `packages/antigravity/test/headless-permission.test.ts`, `packages/antigravity/test-live/subagent.test.ts`
- Modify: `packages/antigravity/src/index.ts`, `packages/antigravity/test/registration.test.ts`, `packages/antigravity/package.json`, `packages/antigravity/README.md`

**Steps:**
- [ ] 3.1 Remove `AntigravityProvider`, the `subagent` descriptor entry, and the `projectMemory` / `subagents` entries from `inject`.
- [ ] 3.2 Delete the ephemeral-workspace usage that existed only for the subagent run; the primary and the search backend keep theirs.
- [ ] 3.3 Remove the `test:live:subagent` script from `package.json` and the delegation section from the README, including the R4b headless limitation note.

**Verify:**
- [ ] `pnpm --filter nishi-dsh-antigravity test`; `echo $?` must be `0`.
- [ ] `grep -rn "projectMemory" packages/antigravity/src packages/codex/src` returns nothing — after this task no provider package touches project memory at all.

---

### Task 4: Delete the project-memory subagent surface

**Files:**
- Delete: `packages/project-memory/src/subagent.ts`, `packages/project-memory/test/subagent-context.test.ts`, `packages/project-memory/test/subagent-service.test.ts`
- Modify: `packages/project-memory/src/service.ts`, `packages/project-memory/src/index.ts`, `packages/project-memory/README.md`

**Steps:**
- [ ] 4.1 Remove `ProjectMemoryService.createSubagentContext` and the `export * from './subagent.js'` re-export.
- [ ] 4.2 Keep `SUBAGENT_MEMORY_GUIDANCE` only if a live consumer remains; otherwise delete it with the module.
- [ ] 4.3 Drop the "read-only subagent view" paragraph from the README.

**Verify:**
- [ ] `pnpm --filter nishi-dsh-project-memory test`; `echo $?` must be `0`.

---

### Task 5: Canonical ids and the config break

**Files:**
- Modify: `packages/codex/src/index.ts`, `packages/antigravity/src/index.ts`, `packages/antigravity/src/antigravity-primary.ts`, both packages' tests and READMEs
- Modify: `packages/provider-kit/src/registration.ts` (until Task 7 moves it)

**Steps:**
- [ ] 5.1 Rename plugin ids `subagent-codex` → `codex` and `subagent-antigravity` → `antigravity`. These strings are diagnostic prefixes and the cordis plugin `name`; update every assertion that matches them.
- [ ] 5.2 Fix the mislabelled dispose effect at `antigravity-primary.ts:784` (`'subagent-codex: ...'`) — the R7 half that survives.
- [ ] 5.3 Drop `subagentProviderName`, `subagentModel`, `subagentEffort` from the Antigravity `Config` schema, its defaults and its resolved type.
- [ ] 5.4 Remove the `subagent` field and its registration step from `ProviderDescriptor` / `registerProvider`; add `routes` to the descriptor itself (`readonly routes: readonly string[]`) so the registry can index a provider before building its adapter.

**Verify:**
- [ ] `pnpm check` then `pnpm test`; `echo $?` must be `0` after each.
- [ ] `grep -rn "subagent-codex\|subagent-antigravity" packages` returns nothing outside `docs/acceptance` history.

---

### Task 6: Preset and top-level docs

**Files:**
- Modify: `packages/suite/presets/orchestrator/agent.cordis.yml`, `packages/suite/presets/orchestrator/preset.yml`, `packages/suite/test/bundle-patch.test.ts`, `scripts/validate-orchestrator.mjs`
- Modify: `README.md`, `packages/suite/README.md`

**Steps:**
- [ ] 6.1 Remove the `tool-subagent-codex` and `tool-subagent-antigravity` rows and rewrite the delegation comment block so it no longer describes fixed product delegation tools. `tool-subagent` (spawn) and `tool-subagent-fork` stay.
- [ ] 6.2 Update `preset.yml` `description` — it still names "Codex, Claude Code, and Antigravity delegation tools".
- [ ] 6.3 Update `scripts/validate-orchestrator.mjs` expectations and `bundle-patch.test.ts`.
- [ ] 6.4 Root `README.md`: the Modules list ("primary/subagent integration"), the Orchestrator fixed-tools list, and the rc.2 breaking-change wording.

**Verify:**
- [ ] `pnpm test:orchestrator`; `echo $?` must be `0`.
- [ ] `grep -rn "subagent_codex\|subagent_antigravity" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=acceptance` returns nothing.

---

### Task 7: Create `nishi-dsh-core`

Mechanical merge, no behaviour change. Land it as its own commit so the next tasks read as design rather than as a move.

**Files:**
- Create: `packages/core/` — `package.json`, `tsconfig.json`, `tsdown.config.ts`, `README.md`, `LICENSE`, `THIRD_PARTY_NOTICES.md`, `src/`, `test/`
- Delete: `packages/provider-kit/`, `packages/primary-web-search/`, `packages/usage-limits/`, `packages/usage-limits-host/`
- Modify: `pnpm-workspace.yaml`, `packages/suite/package.json`, `packages/suite/cordis.patch.yml`, `packages/codex/package.json`, `packages/antigravity/package.json`
- Modify: `scripts/check-npm-names.mjs`, `scripts/pack-local.mjs`, `scripts/verify-bundle-install.mjs`, `scripts/verify-release-family.mjs`, `scripts/verify-package-contracts.mjs`

**Steps:**
- [ ] 7.1 Move sources into one tree with the merged boundaries visible in the layout: `src/registry/`, `src/runtime/` (executable, process, stderr, workspace, failure), `src/web-search/`, `src/usage/` (domain, collectors, projection, service), `src/host/` (composition, rpc, authorization-rpc), `src/client/`.
- [ ] 7.2 Exports: `.` (host plane), `./client` (browser, carrying the `dsh.client` manifest block verbatim), `./web-search` (agent plane), `./package.json`.
- [ ] 7.3 Build with **tsdown** for the whole package — the CSS-module client half already requires it; the plain-`tsc` packages being merged in do not. Keep `check` as `tsc --noEmit`.
- [ ] 7.4 Union the dependency sets: peer deps from all four, `react` and the client UI peers from the host half, and the `test` script's `--import ./test/register-css.mjs` so CSS-module tests keep running. Merge the test trees keeping filenames distinct.
- [ ] 7.5 Update the five scripts' family lists, the bundle patch row, and the Suite's dependencies. Bump every package to `0.1.0-rc.3`.
- [ ] 7.6 Do not change the web-search dependency inversion yet — the core still imports the provider packages at the end of this task, and Task 9 removes that.

**Verify:**
- [ ] `pnpm install`, then `pnpm verify:local`; `echo $?` must be `0`.
- [ ] `pnpm check:npm-names` for `nishi-dsh-core`; `echo $?` must be `0`.

---

### Task 8: The registry service

**Files:**
- Create: `packages/core/src/registry/service.ts`, `packages/core/src/registry/descriptor.ts`, `packages/core/test/registry.test.ts`
- Modify: `packages/core/src/index.ts`, `packages/codex/src/index.ts`, `packages/antigravity/src/index.ts`, both registration tests

**Steps:**
- [ ] 8.1 Define the final `ProviderDescriptor` from the spec: `id`, `routes`, `presentation`, `executable`, optional `model` / `usage` / `webSearch`, optional `install`.
- [ ] 8.2 Implement the service on the host plane: `register(descriptor, config)` stores the descriptor, registers the adapter under `descriptor.routes`, registers the usage source, runs `install`; `byId`, `byRoute`, `all`, and a change signal for the usage projection. Reject a duplicate `id` or a duplicate route with a diagnostic naming both providers.
- [ ] 8.3 Unregister on plugin disposal so a provider plugin can be unloaded without leaving a dead row.
- [ ] 8.4 Providers: `inject: ['nishiProviders', 'subprocess', 'llm']`, `apply` resolves shared config and calls `ctx.nishiProviders.register`. Delete the now-unused `registerProvider` free function.
- [ ] 8.5 Tests: registration order, duplicate rejection, disposal, and a descriptor with no `model` registering no route.

**Verify:**
- [ ] `pnpm test`; `echo $?` must be `0`.
- [ ] `grep -rn "ctx.llm.registerAdapter" packages/codex/src packages/antigravity/src` returns nothing.

---

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
