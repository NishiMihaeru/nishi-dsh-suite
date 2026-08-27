# Nishi DSH Suite Roadmap

> **For agentic workers:** Stages 0–7 are ordered by implementation dependency. The Risk track and the Deprioritized section are deliberately unsequenced. Steps use checkbox (`- [ ]`) syntax.

**Goal:** One relatively universal bridge between DSH and a provider, so that working across subscription providers is a *route* change and nothing else — same tools, same project memory, same limits surface, same profile.

**Thesis:** The pain is not "too few providers". The pain is that when a subscription limit runs out, switching providers means switching harnesses, and every harness carries its own tools and its own memory. A provider must become a thin adapter behind a fixed contract, never an environment you move into.

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
- **Vendor-native memory is suppressed.** Codex via `memories.use_memories=false`, `memories.generate_memories=false`, `project_doc_max_bytes=0`; Antigravity via `inheritCustomizations: false` plus a primary tool allowlist of `finish` alone.
- **The usage domain is normalized**, with a capability taxonomy that treats "this provider exposes no machine-readable usage" as a legal state rather than an error.

The gap is not the contract. It is that the code behind it is written three times.

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

## Stage 2 — The provider bridge

**State at 2026-08-27, end of session.** 2.1, 2.2, 2.3, 2.4, 2.6 and 2.7 are done and committed. `HEAD` is `a0b3809`, tree clean, `pnpm verify:local` exit 0, live smoke 3/3, eight packages, all live suites green. The contract invariant holds for the first time: no provider package calls `ctx.subagents.registerProvider` or `ctx.llm.registerAdapter` directly.

Take the rest in this order: **2.8** (memory adaptation into the kit, granting the Antigravity subagent read access — approved by the maintainer), **2.9** (failure diagnostics, three implementations into one), **2.11** (copied helpers), **2.10** (web-search contract), **2.12** (presentation record, so the browser stops hardcoding three providers), **2.5** (model catalog honesty).


*The core of this roadmap. Target: a provider costs a descriptor and a protocol translation, nothing else.*

- [x] **2.1** Write `docs/superpowers/specs/provider-bridge-design.md`: how to locate and launch the CLI; how to turn one turn into a `StreamChunk` stream; how to list models; how to read usage **or declare it unavailable**; which optional capabilities exist. Every capability must be declarable as absent and must degrade explicitly.
- [x] **2.2** Extract the shared runtime. Provider configuration is inconsistent today: Codex and Claude take
  `DSH_CODEX_EXECUTABLE` / `DSH_CLAUDE_EXECUTABLE` environment overrides, while Antigravity takes a plugin
  config field and has no env override at all. One mechanism, declared once per provider. Executable resolution is written **3 times** (`codex/src/resolver.ts`, `codex-usage-source/src/executable.ts`, `claude-usage-source/src/executable.ts`); bounded NDJSON decoding and subprocess dispose several times; ephemeral agent-directory provisioning **3 times inside `antigravity` alone** (`antigravity-subagent.ts:113`, `web-search-backend.ts:145`, `antigravity-primary.ts:567`).
- [x] **2.3** Unify the usage input contract. Three interfaces exist for one concept — `CodexRateLimitsSource.readRateLimits()`, `AntigravityUsageCapabilitySource.readCapability()`, `ClaudeUsageSource.getUsage()`. Collapse to one; collapse the three byte-identical `DEFAULT_*_REFRESH_POLICY` constants into one default; make registration in `usage-limits-host/src/composition.ts` iterate descriptors instead of one hand-written branch per provider.
- [x] **2.4** Rewrite Codex and Antigravity on the kit. *(The "line count must go down" criterion that stood here was retired — see the spec: this design leaves protocol translation provider-owned, so total size was never the right measure. Checkable invariants replaced it.)* Behaviour parity proven by the existing suites before and after.
- [x] **2.7 — one registration path.** Both providers hand-write the same `apply()`: merge config with defaults, validate non-empty strings and positive-finite timers against `MAX_TIMER_DELAY_MS`, register the subagent provider, register the model adapter, install extras. Their `Config` types share six identical fields (`env`, `modelCacheMs`, `catalogTimeoutMs`, `turnTimeoutMs`, `disposeGraceMs`, `stderrMaxBytes`). The kit gains `resolveSharedProviderConfig`, `ProviderDescriptor` and `registerProvider`; each provider keeps only its schema, its descriptor, and a short `apply`. *This step was missing from the roadmap entirely — the spec described the descriptor and no step built it.*
- [ ] **2.8 — project-memory adaptation exists twice.** `codex/src/memory.ts` (53) and `antigravity/src/memory.ts` (45) are line-for-line identical apart from Codex's `CODEX_MEMORY_DYNAMIC_TOOL` block; roughly 40 lines are verbatim duplicate. Move the contract and factory into the kit. Unifying also gives the Antigravity subagent the `memory_read` tool it currently lacks — approved as a deliberate behaviour change, so delegated runs on both providers can read project memory. Writing stays out: subagents remain read-only.
- [ ] **2.9 — failure diagnostics exist three times.** The `Product subagent failure (product: …; stage: …; category: …)` string is produced by `codex/src/run.ts:58`, by three string literals in `antigravity-subagent.ts`, and already by the kit's `VendorFailure`. Codex's version is the richest (it appends HTTP status, exit code and signal), so move those fields into `VendorFailure` and delete both local implementations.
- [ ] **2.10 — one web-search contract.** `codex/src/web-search-backend.ts` (340) and `antigravity/src/web-search-backend.ts` (275) share their shape: an error class with a code, `record`, `bounded`, `promptFor`, effort encoding, and a class exposing `search(route, request, signal)`. Unify the contract and the helpers; argv construction, event parsing and result extraction stay provider-owned. No size promise.
- [ ] **2.11 — small helpers are copied.** `record(` in 6 files, `thrown(` in 5, `assertPositiveFinite(` in 3, `bounded` in 3 — including two copies inside the kit itself (`claude-usage.ts`, `codex-usage.ts`), which is the package that exists to prevent exactly this.
- [ ] **2.12 — the presentation record.** Adding a provider today requires editing browser code: `client/roster.ts` (id and display name), `client/ui/ProviderLogo.tsx` (brand colour and an inline SVG per id; unknown ids get grey and no mark), and `client/usage-group-model.ts:71` (group naming by substring match on `'claude'`/`'gpt'`/`'external'`). The client cannot import provider packages — they spawn processes — so identity must cross RPC as data. Add `ProviderPresentation` to the descriptor and project it through the usage RPC; the browser renders from data with a supported neutral fallback.
- [ ] **2.5** Drop the hardcoded `^(gemini|claude|gpt|oss)` catalog filter at `antigravity-primary.ts:132`. For a product whose value is provider choice, silently hiding models attacks the value directly.
- [x] **2.6** Fold `codex-usage-source` (379 src) and `claude-usage-source` (320 src) into the kit; each carries a full package's overhead for a few hundred lines. This changed the *published* family, which is why it was deferred to Stage 5 — with rc.2 unpublished there is no rc.2 consumer to disturb, so it can land with the rest of Stage 2. Both packages folded into `provider-kit` as `src/claude-usage.ts` / `src/codex-usage.ts`; family shrank from 10 to 8 packages. `pnpm verify:local` and `pnpm smoke:vendor-cli` both green.

## Stage 3 — Prove interchangeability live

*A unified bridge never exercised across a live provider switch has delivered plumbing, not the goal.*

- [ ] **3.1** Model switch within one provider mid-conversation; history, memory, and tools survive. `antigravity/test-live/primary.test.ts:281` already asserts a nonce survives — extend it.
- [ ] **3.2** **Provider switch mid-session** (Codex → Antigravity) in one conversation. This is the case the product exists for and nothing covers it today.
- [ ] **3.3** Project memory written before the switch is readable after it.
- [ ] **3.4** Usage & Limits makes "this provider is nearly exhausted" legible at a glance, since that is the moment a route change is needed.
- [ ] **3.5 — DECISION: automatic failover.** Recommendation is **manual first**. Automatic failover mid-turn is not a small feature: usage snapshots are deliberately cached (`staleAfterMs: 300_000`), an in-flight tool call may not be resumable on another provider, and a silent switch changes cost and behaviour without consent. Ship the manual path, learn where it actually hurts, then automate that case. Record the outcome before building either.

## Stage 4 — The profile

- [ ] **4.1** Decide: extend the existing `web` profile or create a dedicated one. `web` carries `dsh-chatgpt-web` as a link and must keep it.
- [ ] **4.2** Compose the profile: provider bridge with every configured provider, project memory, Usage & Limits host.
- [ ] **4.3** Handle `usage-limits-host`'s `"platform": "web"` declaration — it has a browser half, so a non-web profile must handle that rather than assume it mounts.
- [ ] **4.4** Document the one-action route switch.

## Stage 5 — Ship `0.1.0-rc.3`

- [ ] **5.1** Carries the family change from 2.6 and everything in Stages 1–4.
- [ ] **5.2** Same gate discipline as Stage 0: live acceptance, explicit publish approval, leaves-first, real profile upgrade.

## Stage 6 — Personal memory store

*Decided in principle (maintainer, 2026-08-27): project memory travels with the project and stays exactly as built. A separate personal store is wanted but is planned, not scheduled.*

- [ ] **6.1** Home outside any project (`$DSH_HOME` alongside profiles), never committed.
- [ ] **6.2** Precedence when both stores speak to one topic — project memory authoritative for project facts, personal for preferences.
- [ ] **6.3** Bootstrap composition from two sources such that personal content cannot physically reach a project file. `MEMORY.md` is currently one file; naive concatenation recreates the exact leak the split exists to prevent.

## Stage 7 — Grok

- [ ] **7.1** Add Grok through the descriptor alone. This is the real acceptance test of Stage 2: if it costs more than a descriptor, the abstraction did not hold.

---

## Risk track — unsequenced

Not gated on anything above; each is worth doing whenever it is cheapest.

- [x] **R1 — No regression net against vendor protocol drift.** Every integration rides a private wire protocol with no stability guarantee, and **no test in `pnpm test` spawns a real `claude`/`codex`/`agy`**. A patch release of any vendor CLI can break the product silently. `pnpm smoke:vendor-cli` drives the production source objects against the installed CLIs and pipes each response through the real normalizer. It found a live regression on its first run — the Claude usage source waiting for an init line CLI 2.1.246 never sends, deadlocking until timeout while every unit test stayed green. Still to do: make it a required manual gate in the publish runbook, and extend it beyond usage sources and model listing.
- [ ] **R2 — Untested surface.** `antigravity-primary.ts` is 774 lines with zero unit tests (schema validation, concatenated-JSON parsing, catalog heuristics, effort-unsupported detection). Cover the pure functions at minimum.
- [ ] **R3 — Memory has no deletion path.** Only read/write/edit are registered; `commands.ts:44` instructs the model not to substitute shell deletion for the missing operation. A wholly obsolete topic can be emptied but never removed. Decide: a guarded `memory_delete`, or declare consolidation-by-rewrite the only sanctioned pruning path.
- [ ] **R4a — The Antigravity managed agent's tool list is not enforced.** The definition names seven tools; the live session announces the full native toolset including `run_command`, `browser_*` and `invoke_subagent`. Confirmed in a real `agy 1.1.21` session. This is why the Suite cannot simply pass `--dangerously-skip-permissions` to make delegation work, and it undermines the isolation the primary adapter also relies on.
- [ ] **R4b — `subagent_antigravity` cannot use tools at all** in headless mode; the CLI auto-denies permissions it cannot prompt for. Delegation is limited to prompts needing no tools. Shipped as a documented limitation in rc.2.
- [ ] **R4 — Antigravity memory suppression is half-enforced.** Codex's is enforced by CLI config; Antigravity's rests partly on config and partly on prompt instructions, which is guidance to a model, not enforcement. Determine whether `agy` offers a config-level guarantee; if not, record it as an accepted risk rather than leaving it to read as enforced.
- [ ] **R5 — Preventive tool control.** Antigravity's `BLOCKED_NATIVE_TOOLS` audit runs *after* the turn. Evaluate `@deepseek-ai/dsh-sandbox-policy` and `dsh-user-approval` for real prevention.
- [ ] **R6 — Reuse the harness.** `project-memory/src/filesystem.ts` hand-rolls symlink checks and temp+rename atomic writes while `@deepseek-ai/dsh-atomic-write` exists. Replace `(ctx as any).projectMemory` in `codex` and `antigravity` with a typed context augmentation.
- [ ] **R7 — Leftover review findings.** `antigravity-primary.ts:784` dispose effect is labelled `'subagent-codex: ...'`; `codex/src/run.ts:351` carries an unexplained `(settleRunResult as any)`.

## Deprioritized — subagents

Vendor subagents (`subagent_codex`, `subagent_antigravity`) are left untouched and keep their current behaviour. Both declare `NO_START_CAPABILITIES`, and their memory access is unequal — Codex has a `memory_read` dynamic tool, Antigravity has only a bootstrap prefix. Recorded here and deliberately not fixed.

Separately: DSH ships in-process child agents (`@deepseek-ai/dsh-subagent`'s `child-agent` — parent's preset joined, parent's route overridable per child, depth accounting, approval pinned to `'never'`). If delegation ever becomes a priority, that is the path to verify first; it would make the vendor subagent question mostly moot. Known from type declarations only, never run.

## Out of scope

- Windows support.
- Making vendor subagents interchangeable with each other — they are not, and forcing it would remove the reason to call them.

## Self-review

- Stage 0 ships work already verified green and is blocked by nothing below it.
- Stage 1 sits before the bridge only because it is a present data-exposure and costs almost nothing, not because the bridge depends on it.
- Stage 2's success test is falsifiable rather than aspirational.
- Stage 3 is separate from Stage 2 on purpose: plumbing is not the goal.
- Stage 2.6 was deferred to Stage 5 to avoid disturbing rc.2 consumers twice. rc.2 is now parked unpublished, so that constraint is void and 2.6 belongs with the rest of Stage 2.
- R1 remains owned by nobody until it is scheduled.
