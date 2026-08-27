# Nishi DSH Suite Roadmap

> **For agentic workers:** Stages 0–7 are ordered by implementation dependency. The Risk track is deliberately unsequenced. Steps use checkbox (`- [ ]`) syntax.

**Goal:** One relatively universal bridge between DSH and a provider, so that working across subscription providers is a *route* change and nothing else — same tools, same project memory, same limits surface, same profile.

**Thesis:** The pain is not "too few providers". The pain is that when a subscription limit runs out, switching providers means switching harnesses, and every harness carries its own tools and its own memory. A provider must become a thin adapter behind a fixed contract, never an environment you move into.

**Architecture (decided 2026-08-27):** one core plugin, `nishi-dsh-core`, owns everything provider-independent — the provider registry and connector, the shared vendor runtime, the routed `web_search` tool, the usage domain and its UI — and names no provider. Each provider is a separate plugin that injects the core's registry and contributes one descriptor plus its protocol translation. Providers are plugins for a plugin, through cordis injection rather than a plugin system of our own. Delegation to vendor CLI agents is removed; if it returns, it returns through DSH's own child agents on the primary route. Spec: `docs/superpowers/specs/provider-bridge-design.md`.

**Tech:** TypeScript 5.9, Node.js 24.19.0 (fnm — `/usr/bin/node` is v22 and must not be used), pnpm 11.21.0, DeepSeek Harness `0.1.1-rc.2`.

## Standing constraints

- No GitHub-hosted CI: `BLOCKED_BILLING`. No hosted-CI PASS may be claimed.
- No publish and no merge without the maintainer's explicit approval, every time.
- No vendor credential/session/token store is copied, parsed, migrated, or deleted.
- `@openai/codex*` and `@anthropic-ai/*` stay absent from the runtime lock graph.
- Windows remains NOT TESTED.

## What is already true (verified 2026-08-27)

Stated plainly because it removes work people assume is needed.

- **Interchangeability exists at the seam.** Both providers implement `LlmAdapter` and register via `ctx.llm.registerAdapter` (`codex-plugin-dsh/adapter.ts:305`, `antigravity-primary.ts:394`). DSH resolves `provider:model` routes itself.
- **Shared memory already works.** `memory_read` / `memory_write` / `memory_edit` are ordinary DSH tools (`project-memory/src/tools.ts:223`), provider-agnostic by construction. Confirmed live by the maintainer with both Codex and Antigravity.
- **Vendor-native memory is suppressed — on the delegated plane only.** The three Codex overrides `memories.use_memories=false`, `memories.generate_memories=false`, `project_doc_max_bytes=0` are injected in `codex/src/run.ts:105`, the subagent path; the primary spawns `codex app-server --stdio` with none of them (`codex-plugin-dsh/adapter.ts:178`). Antigravity's suppression (`inheritCustomizations: false` plus a primary tool allowlist of `finish` alone) does cover the primary, but rests partly on prompt instructions — see R4. Scheduled as 2.A.2.
- **The usage domain is normalized**, with a capability taxonomy that treats "this provider exposes no machine-readable usage" as a legal state rather than an error.

The gap is not the contract. It is that the code behind it is written three times, and that the shared packages know each provider by name.

---

## Stage 0 — Ship `0.1.0-rc.2`

*Everything except the publication gate is complete. `pnpm verify:local` green; nine tarballs pack; lock graph clean. Live acceptance run against real CLIs: Codex primary + subagent 2/2, Antigravity primary 8/8 including model switch and shared memory, `smoke:vendor-cli` 3/3.*

- [x] **0.1** Commit the Claude cut as three reviewable commits: `feat(claude)!: replace Claude Code subagent with a usage-only source package`, `fix(release): build before check in verify:local`, `docs: describe external CLI runtimes instead of bundled vendor SDKs`.
- [x] **0.2** Write `docs/release/2026-08-27-rc2-prerelease.md`. Record the breaking change explicitly: upgrading from rc.1 removes the `subagent_claude_code` tool. Claude usage/limits remain visible. Name the accepted CLI versions (`claude 2.1.246`, `codex-cli 0.150.0`, `agy 1.1.21`).
- [x] **0.3** Extend `scripts/verify-bundle-install.mjs` to assert no foreign-platform vendor binaries appear in the installed closure.
- [x] **0.4** Live acceptance: Codex primary + routed `web_search` + memory read/write; Antigravity primary + mid-conversation model switch + `agy search_web`; three usage rows render; Claude row degrades explicitly when the `claude` CLI is absent.
- [x] **0.5** `pnpm check:npm-names`.
- [ ] **0.6 — PARKED (maintainer decision, 2026-08-27): rc.2 is not published.** It stays in-repo. Nine tarballs are built and reproducible from `pnpm verify:local`; publication can resume from here unchanged whenever wanted.
- [ ] **0.7 — parked with 0.6.** `npm deprecate nishi-dsh-claude-code@0.1.0-rc.1` → `nishi-dsh-claude-usage-source`.
- [ ] **0.8 — parked with 0.6** (could still run from local tarballs via `--local-pack-dir`). Upgrade `~/.dsh/profiles/web` rc.1 → rc.2 **preserving the `dsh-chatgpt-web` link**; run `preset update`; confirm nothing unrelated was touched.

## Stage 1 — Close the memory leak boundary

*Small, cheap, and a present exposure rather than a future one. May ride inside rc.2 if preferred.*

`MEMORY_MAINTENANCE_DIRECTIVE` (`project-memory/src/commands.ts:5`) forbids saving secrets, credentials, quota values, and transient state — but says nothing about personal facts, because there is nowhere else to put them. A durable fact about the operator's shell, platform, or working preferences legitimately matches the approved category "durable workflows", and therefore lands in a committed file that ships to every collaborator with the repository.

- [x] **1.1** Extend the NEVER list so personal facts about the operator are dropped rather than silently committed, until the personal store of Stage 6 exists.

## Stage 2 — Core and provider plugins

**Architecture decided 2026-08-27.** Two kinds of package. `nishi-dsh-core` owns everything provider-independent — the provider registry and connector, the shared vendor runtime, the routed `web_search` tool, the usage domain and its UI — and names no provider. Each provider is a plugin that injects the core's registry and contributes one descriptor plus its protocol translation. Providers are plugins for a plugin, using cordis injection rather than a plugin system of our own. Spec: `docs/superpowers/specs/provider-bridge-design.md`. Plan: `docs/superpowers/plans/2026-08-27-core-and-provider-plugins.md`.

**Done in the rc.2 wave** (`HEAD` = `218f8cc`, `pnpm verify:local` exit 0, live smoke 3/3): 2.1 the contract spec; 2.2 the shared vendor runtime; 2.3 one usage input contract; 2.4 both providers rewritten on it; 2.6 the two usage-source packages folded in (10 → 8 packages); 2.7 one registration path, with the "no direct `ctx.subagents.registerProvider` / `ctx.llm.registerAdapter` in a provider package" invariant greping clean for the first time.

The rc.3 wave is below. Order matters: delete first, unify second — otherwise we unify code we then throw away. Items that supersede an rc.2-wave number say so.

### 2.A — Remove delegation

Vendor subagents go entirely. Delegation returns later through DSH's own child agents on the primary route, which inherit the core's tools and memory for free; `tool-subagent` with `provider: spawn` / `fork` already sits in the Orchestrator preset and is the path to verify when that time comes.

- [ ] **2.A.1** Delete `codex/src/run.ts` (407), `codex/src/wire.ts` (802), `codex/src/memory.ts` (53), `antigravity/src/antigravity-subagent.ts` (429), `antigravity/src/memory.ts` (45), `project-memory/src/subagent.ts` and `ProjectMemoryService.createSubagentContext`, and the four test files that cover only them (`antigravity/test/antigravity-subagent.test.ts`, `antigravity/test/headless-permission.test.ts`, `antigravity/test-live/subagent.test.ts`, `codex/test/memory.test.ts`). Drop the `subagent` field and its registration step from the descriptor. Supersedes **2.8**, which unified this code instead.
- [ ] **2.A.2** **Move the Codex vendor-memory suppression to the primary invocation.** The three overrides `memories.use_memories=false`, `memories.generate_memories=false`, `project_doc_max_bytes=0` exist only in `run.ts:105`, the delegated path. The primary spawns `codex app-server --stdio` with none of them (`codex-plugin-dsh/adapter.ts:178`), so the "vendor-native memory is suppressed" claim has never been true on the plane that matters, and 2.A.1 would remove the flags from the repository entirely. Inject them in `codexAppServerInvocation`, retarget the existing `codex/test/argv.test.ts` assertions, keep the README claim the `package.test.ts` check asserts.
- [ ] **2.A.3** Remove the `tool-subagent-codex` and `tool-subagent-antigravity` rows from `packages/suite/presets/orchestrator/agent.cordis.yml` and the delegation wording from its header comment and `preset.yml` description.
- [ ] **2.A.4** Config break: drop `subagentProviderName`, `subagentModel`, `subagentEffort` from the Antigravity `Config`. Rename plugin ids `subagent-codex` → `codex` and `subagent-antigravity` → `antigravity`, which is also what every diagnostic prefix says. Record both in the rc.3 release note as breaking for rc.1 installs.
- [ ] **2.A.5** Docs: drop "primary/subagent integration" from `README.md`, both provider READMEs and the Suite package README; drop the delegation tools from the Orchestrator section of `README.md`. This roadmap and the contract spec are already updated — the *Deprioritized — subagents* section, R4a and R4b are gone, and *Out of scope* now records the removal. Acceptance records under `docs/acceptance/` are historical and stay as written.

### 2.B — The core package

- [x] **2.B.1** Merged `provider-kit`, `usage-limits` and `usage-limits-host` into `nishi-dsh-core`; `primary-web-search` follows in 2.C, once the inversion removes the cycle that blocks it (the core cannot depend on the provider packages that depend on the core). Two mount points, not one: `nishi-dsh-core` on the host plane (bundle row — registry, usage domain, RPC, browser half) and `nishi-dsh-core/web-search` on the agent plane (preset row). Collapsing them into one mount would either give every agent `web_search` without a preset choice or make the usage registry come and go with mounted presets.
- [x] **2.B.2** The registry service. `ctx.nishiProviders.register(descriptor, config)` records the descriptor, registers the model adapter under `descriptor.routes`, registers the usage source, and runs `install`. Provider plugins declare `inject: ['nishiProviders', ...]`; cordis owns load order, deferral and teardown.
- [x] **2.B.3** Canonical identity: `id: 'codex'` / `routes: ['codex-app-server']`, `id: 'antigravity'` / `routes: ['antigravity-cli']`. Route strings are unchanged — they are user-visible in saved session headers and the profile default.

### 2.C — Web search on the registry

- [x] **2.C.1** Resolve `route.provider` through the registry instead of the `switch` in `primary-web-search/src/providers.ts:52`, and drop the `nishi-dsh-codex` / `nishi-dsh-antigravity` dependencies — the core must not depend on a provider package. Unsupported-primary behaviour is unchanged.
- [x] **2.C.2** One backend contract plus shared helpers in the core; argv construction, event parsing and result extraction stay provider-owned. Supersedes **2.10**. No size promise.

### 2.D — Usage on descriptors

- [x] **2.D.1** Registration iterates descriptors: delete the per-provider `Host*Source` classes and branches in `usage-limits-host/src/composition.ts`.
- [ ] **2.D.2** `ProviderPresentation` crosses the existing usage RPC as data. Delete `client/roster.ts`, the per-id branches in `client/ui/ProviderLogo.tsx`, and the substring grouping at `client/usage-group-model.ts:71`; the browser renders from data with a supported neutral mark. Supersedes **2.12**.
- [x] **2.D.3** The roster becomes dynamic (landed early: a static roster was unimplementable once providers mount after the core) — derived from registrations rather than a fixed list of three. A provider mounted late must appear; a provider not mounted must leave no placeholder and no grey blank. This is a real behaviour change in the browser half, so it carries its own live check (bring up a profile without Antigravity).

### 2.E — Claude as a provider plugin

- [x] **2.E.1** Moved the Claude usage source out of the core into `nishi-dsh-claude`, a plugin whose descriptor declares `usage` alone — no `model`, no `routes`, no `webSearch`. This deliberately reverses **2.6** for Claude: the unit is one package per provider, and a single-capability provider is the honest test that the connector holds. Family: 8 → 6 packages (`core`, `project-memory`, `codex`, `antigravity`, `claude`, `suite`).

### 2.F — Deduplicate what is left

- [ ] **2.F.1** One `VendorFailure`. Codex's version is the richest (it appends HTTP status, exit code and signal); move those fields into the core's and delete the local implementations. Supersedes **2.9**, shrunk by 2.A.
- [ ] **2.F.2** One copy each of `record`, `thrown`, `assertPositiveFinite`, `bounded` — including the two copies inside the core's own usage sources, which is the package that exists to prevent exactly this. Supersedes **2.11**.
- [ ] **2.F.3** Reuse the harness where it already solves the problem: `@deepseek-ai/dsh-atomic-write` instead of the hand-rolled temp+rename in `project-memory/src/filesystem.ts` (part of R6).

### 2.G — Honest model catalog

- [ ] **2.G.1** Drop the `^(gemini|claude|gpt|oss)` filter at `antigravity-primary.ts:132`. For a product whose value is provider choice, silently hiding models attacks the value directly. Was **2.5**.

### 2.H — Invariants and acceptance

Falsifiable, each as a test rather than a review habit.

- [ ] **2.H.1** No provider package calls `ctx.llm.registerAdapter` or registers a usage source directly; no `subagents` registration and no vendor subagent tool exists anywhere in the tree.
- [ ] **2.H.2** `nishi-dsh-core` contains no provider identifier (`codex`, `antigravity`, `claude`, `gpt`, `gemini`) in any file, browser half included, with the test spelling out the prose-comment exceptions.
- [ ] **2.H.3** `nishi-dsh-core` has no dependency on any provider package; every descriptor with a `model` declares at least one route and every descriptor without one declares none.
- [ ] **2.H.4** **The real acceptance test:** write a descriptor for a provider the repository does not have (Grok), and confirm that nothing in `core`, `project-memory`, `suite` composition or any browser file needed an edit. If it costs more than a plugin, the abstraction did not hold and this stage is not done. The descriptor itself does not ship in rc.3 — Stage 7 does that.
- [ ] **2.H.5** `pnpm verify:local` exit 0 (read `$?`, not the output), `pnpm smoke:vendor-cli` green, `pnpm check:npm-names` for the two new package names.

## Stage 3 — Prove interchangeability live

*A unified core never exercised across a live provider switch has delivered plumbing, not the goal.*

- [ ] **3.1** Model switch within one provider mid-conversation; history, memory, and tools survive. `antigravity/test-live/primary.test.ts:281` already asserts a nonce survives — extend it.
- [ ] **3.2** **Provider switch mid-session** (Codex → Antigravity) in one conversation. This is the case the product exists for and nothing covers it today.
- [ ] **3.3** Project memory written before the switch is readable after it.
- [ ] **3.4** Usage & Limits makes "this provider is nearly exhausted" legible at a glance, since that is the moment a route change is needed.
- [ ] **3.5** Codex primary with 2.A.2 in place: confirm no vendor-native memory or project-doc content reaches a turn, on the plane where it previously was not suppressed at all.
- [ ] **3.6** The dynamic roster live: a profile with all providers, then one without Antigravity, then Antigravity mounted while the browser is already open.
- [ ] **3.7 — DECISION: automatic failover.** Recommendation is **manual first**. Automatic failover mid-turn is not a small feature: usage snapshots are deliberately cached (`staleAfterMs: 300_000`), an in-flight tool call may not be resumable on another provider, and a silent switch changes cost and behaviour without consent. Ship the manual path, learn where it actually hurts, then automate that case. Record the outcome before building either.

## Stage 4 — The profile

- [ ] **4.1** Decide: extend the existing `web` profile or create a dedicated one. `web` carries `dsh-chatgpt-web` as a link and must keep it.
- [ ] **4.2** Compose the profile: the core with every configured provider plugin, project memory, the Usage & Limits surface.
- [ ] **4.3** Handle the core's `"platform": "web"` declaration — it has a browser half, so a non-web profile must handle that rather than assume it mounts.
- [ ] **4.4** Document the one-action route switch.

## Stage 5 — Ship `0.1.0-rc.3`

- [ ] **5.1** Carries Stages 1–4. Breaking against rc.1: the `subagent_codex` / `subagent_antigravity` tools are gone, three Antigravity config fields are gone, and the package family changes from eight names to six. rc.2 stays unpublished, so there is no rc.2 consumer to disturb.
- [ ] **5.2** Same gate discipline as Stage 0: live acceptance, explicit publish approval, leaves-first, real profile upgrade.
- [ ] **5.3** `npm deprecate` the names that stop existing (`nishi-dsh-provider-kit`, `nishi-dsh-primary-web-search`, `nishi-dsh-usage-limits`, `nishi-dsh-usage-limits-host` → `nishi-dsh-core`) once publication is approved, alongside the parked 0.7 deprecation.

## Stage 6 — Personal memory store

*Decided in principle (maintainer, 2026-08-27): project memory travels with the project and stays exactly as built. A separate personal store is wanted but is planned, not scheduled.*

- [ ] **6.1** Home outside any project (`$DSH_HOME` alongside profiles), never committed.
- [ ] **6.2** Precedence when both stores speak to one topic — project memory authoritative for project facts, personal for preferences.
- [ ] **6.3** Bootstrap composition from two sources such that personal content cannot physically reach a project file. `MEMORY.md` is currently one file; naive concatenation recreates the exact leak the split exists to prevent.

## Stage 7 — Grok

- [ ] **7.1** Ship Grok as a real provider plugin, using the descriptor written for 2.H.4. Stage 2 proves the cost; this stage pays it.

---

## Risk track — unsequenced

Not gated on anything above; each is worth doing whenever it is cheapest.

- [x] **R1 — No regression net against vendor protocol drift.** Every integration rides a private wire protocol with no stability guarantee, and **no test in `pnpm test` spawns a real `claude`/`codex`/`agy`**. A patch release of any vendor CLI can break the product silently. `pnpm smoke:vendor-cli` drives the production source objects against the installed CLIs and pipes each response through the real normalizer. It found a live regression on its first run — the Claude usage source waiting for an init line CLI 2.1.246 never sends, deadlocking until timeout while every unit test stayed green. Still to do: make it a required manual gate in the publish runbook, and extend it beyond usage sources and model listing.
- [ ] **R2 — Untested surface.** `antigravity-primary.ts` is 791 lines with zero unit tests (schema validation, concatenated-JSON parsing, catalog heuristics, effort-unsupported detection). Cover the pure functions at minimum. Rises in priority with 2.A: after delegation is removed, this file is the whole Antigravity integration.
- [ ] **R3 — Memory has no deletion path.** Only read/write/edit are registered; `commands.ts:44` instructs the model not to substitute shell deletion for the missing operation. A wholly obsolete topic can be emptied but never removed. Decide: a guarded `memory_delete`, or declare consolidation-by-rewrite the only sanctioned pruning path.
- [ ] **R4 — Antigravity memory suppression is half-enforced.** Codex's is enforced by CLI config; Antigravity's rests partly on config (`inheritCustomizations: false`, a `finish`-only tool allowlist) and partly on prompt instructions, which is guidance to a model, not enforcement. Determine whether `agy` offers a config-level guarantee; if not, record it as an accepted risk rather than leaving it to read as enforced. This is now a primary-plane risk, not a delegated-plane one.
- [ ] **R5 — Preventive tool control.** Antigravity's `BLOCKED_NATIVE_TOOLS` audit runs *after* the turn. Evaluate `@deepseek-ai/dsh-sandbox-policy` and `dsh-user-approval` for real prevention.
- [ ] **R6 — Reuse the harness.** `project-memory/src/filesystem.ts` hand-rolls symlink checks and temp+rename atomic writes while `@deepseek-ai/dsh-atomic-write` exists (scheduled as 2.F.3). The `(ctx as any).projectMemory` casts in `codex` and `antigravity` disappear with 2.A — after it, no provider package touches `projectMemory` at all.
- [ ] **R7 — Leftover review findings.** `antigravity-primary.ts:784` dispose effect is labelled `'subagent-codex: ...'` — fixed by the id rename in 2.A.4. The unexplained `(settleRunResult as any)` at `codex/src/run.ts:351` dies with the file.

## Out of scope

- Windows support.
- Delegation to vendor CLI agents. Removed in 2.A; if delegation returns it returns through DSH child agents on the primary route.

## Self-review

- Stage 0 ships work already verified green and is blocked by nothing below it.
- Stage 1 sits before the core work only because it is a present data-exposure and costs almost nothing.
- Stage 2 deletes before it unifies, which is the only order that does not pay twice.
- 2.A.2 was found while planning 2.A: the deletion would have silently removed the repository's only vendor-memory suppression, on a plane that never had it.
- Stage 2's success test (2.H.4) is falsifiable rather than aspirational, and it does not require shipping a new provider to run.
- Stage 3 is separate from Stage 2 on purpose: plumbing is not the goal.
- R2 rises with 2.A rather than staying where it was, because removing delegation makes `antigravity-primary.ts` the entire integration.
