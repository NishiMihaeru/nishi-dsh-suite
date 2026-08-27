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

*In flight. `pnpm verify:local` passes end to end; 9 tarballs pack; lock graph clean. Work is staged but uncommitted.*

- [ ] **0.1** Commit the Claude cut as three reviewable commits: `feat(claude)!: replace Claude Code subagent with a usage-only source package`, `fix(release): build before check in verify:local`, `docs: describe external CLI runtimes instead of bundled vendor SDKs`.
- [ ] **0.2** Write `docs/release/2026-08-27-rc2-prerelease.md`. Record the breaking change explicitly: upgrading from rc.1 removes the `subagent_claude_code` tool. Claude usage/limits remain visible. Name the accepted CLI versions (`claude 2.1.246`, `codex-cli 0.150.0`, `agy 1.1.21`).
- [ ] **0.3** Extend `scripts/verify-bundle-install.mjs` to assert no foreign-platform vendor binaries appear in the installed closure.
- [ ] **0.4** Live acceptance: Codex primary + routed `web_search` + memory read/write; Antigravity primary + mid-conversation model switch + `agy search_web`; three usage rows render; Claude row degrades explicitly when the `claude` CLI is absent.
- [ ] **0.5** `pnpm check:npm-names`.
- [ ] **0.6 — GATE.** Present roster and evidence; **wait for explicit approval**. Then publish leaves-first under `next` and verify registry resolution at exact versions.
- [ ] **0.7** `npm deprecate nishi-dsh-claude-code@0.1.0-rc.1` → `nishi-dsh-claude-usage-source`.
- [ ] **0.8** Upgrade `~/.dsh/profiles/web` rc.1 → rc.2 **preserving the `dsh-chatgpt-web` link**; run `preset update`; confirm nothing unrelated was touched.

## Stage 1 — Close the memory leak boundary

*Small, cheap, and a present exposure rather than a future one. May ride inside rc.2 if preferred.*

`MEMORY_MAINTENANCE_DIRECTIVE` (`project-memory/src/commands.ts:5`) forbids saving secrets, credentials, quota values, and transient state — but says nothing about personal facts, because there is nowhere else to put them. A durable fact about the operator's shell, platform, or working preferences legitimately matches the approved category "durable workflows", and therefore lands in a committed file that ships to every collaborator with the repository.

- [ ] **1.1** Extend the NEVER list so personal facts about the operator are dropped rather than silently committed, until the personal store of Stage 6 exists.

## Stage 2 — The provider bridge

*The core of this roadmap. Target: a provider costs a descriptor and a protocol translation, nothing else.*

- [ ] **2.1** Write `docs/superpowers/specs/provider-bridge-design.md`: how to locate and launch the CLI; how to turn one turn into a `StreamChunk` stream; how to list models; how to read usage **or declare it unavailable**; which optional capabilities exist. Every capability must be declarable as absent and must degrade explicitly.
- [ ] **2.2** Extract the shared runtime. Provider configuration is inconsistent today: Codex and Claude take
  `DSH_CODEX_EXECUTABLE` / `DSH_CLAUDE_EXECUTABLE` environment overrides, while Antigravity takes a plugin
  config field and has no env override at all. One mechanism, declared once per provider. Executable resolution is written **3 times** (`codex/src/resolver.ts`, `codex-usage-source/src/executable.ts`, `claude-usage-source/src/executable.ts`); bounded NDJSON decoding and subprocess dispose several times; ephemeral agent-directory provisioning **3 times inside `antigravity` alone** (`antigravity-subagent.ts:113`, `web-search-backend.ts:145`, `antigravity-primary.ts:567`).
- [ ] **2.3** Unify the usage input contract. Three interfaces exist for one concept — `CodexRateLimitsSource.readRateLimits()`, `AntigravityUsageCapabilitySource.readCapability()`, `ClaudeUsageSource.getUsage()`. Collapse to one; collapse the three byte-identical `DEFAULT_*_REFRESH_POLICY` constants into one default; make registration in `usage-limits-host/src/composition.ts` iterate descriptors instead of one hand-written branch per provider.
- [ ] **2.4** Rewrite Codex and Antigravity on the kit. **Success test is negative: line count must go down.** If it does not, the abstraction is wrong and should be reconsidered rather than forced. Behaviour parity proven by the existing suites before and after.
- [ ] **2.5** Drop the hardcoded `^(gemini|claude|gpt|oss)` catalog filter at `antigravity-primary.ts:132`. For a product whose value is provider choice, silently hiding models attacks the value directly.
- [ ] **2.6** Fold `codex-usage-source` (379 src) and `claude-usage-source` (320 src) into the kit; each carries a full package's overhead for a few hundred lines. This changes the published family — it belongs to Stage 5, never a patch.

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

- [ ] **R1 — No regression net against vendor protocol drift.** Every integration rides a private wire protocol with no stability guarantee, and **no test in `pnpm test` spawns a real `claude`/`codex`/`agy`**. A patch release of any vendor CLI can break the product silently. Add an opt-in smoke script asserting response shape for each usage source and each primary, and make it a required manual gate before every publish. *This is the largest unmitigated risk in the project.*
- [ ] **R2 — Untested surface.** `antigravity-primary.ts` is 774 lines with zero unit tests (schema validation, concatenated-JSON parsing, catalog heuristics, effort-unsupported detection). Cover the pure functions at minimum.
- [ ] **R3 — Memory has no deletion path.** Only read/write/edit are registered; `commands.ts:44` instructs the model not to substitute shell deletion for the missing operation. A wholly obsolete topic can be emptied but never removed. Decide: a guarded `memory_delete`, or declare consolidation-by-rewrite the only sanctioned pruning path.
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
- Stage 2.6 is the only step that disturbs published consumers, and it is deferred into Stage 5 so rc.2 users are not disrupted twice.
- R1 remains owned by nobody until it is scheduled.
