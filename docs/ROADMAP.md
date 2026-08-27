# Nishi DSH Suite Roadmap

Updated 2026-08-28 after Core 14 and Project Memory 02 final acceptance.

## Product goal

Switching subscription providers should be a route change, not an environment change: same DSH tools, same project memory, same Usage & Limits surface, same profile and session context.

Current architecture:

- one provider-independent `nishi-dsh-core`;
- one plugin per provider;
- separate provider-agnostic `nishi-dsh-project-memory`;
- `nishi-dsh-suite` as declarative composition + managed Orchestrator preset bridge.

Canonical contract: `docs/superpowers/specs/provider-bridge-design.md`.

## Standing constraints

- [x] Node 24.19.0 / pnpm 11.21.0 / DSH 0.1.1-rc.2 are the rc.3 development baseline.
- [x] GitHub-hosted CI/Actions are not part of this workflow; no hosted-CI PASS is claimed.
- [x] Vendor credential/session/token stores are outside Suite ownership.
- [x] `@openai/codex*` and `@anthropic-ai/*` are absent from the Suite runtime lock graph.
- [ ] Windows acceptance. Current status: **NOT TESTED**.
- [ ] Publication. Requires separate explicit approval after all rc.3 release gates.

---

## Stage A — Provider-independent foundation

### A1. Delegation removal

- [x] Remove vendor-specific Codex/Antigravity subagent providers and memory transports.
- [x] Remove vendor-specific preset delegation tools.
- [x] Keep DSH-native `subagent` / `subagent_fork` on the current primary route.
- [x] Move Codex vendor-memory/project-doc suppression onto the primary App Server invocation before deleting the delegated path.

### A2. Core architecture

- [x] Create `nishi-dsh-core` and fold provider-kit / usage-limits / usage-limits-host / primary-web-search into it.
- [x] Add provider registry and single `registerProvider()` transaction.
- [x] Separate canonical provider ids from preserved DSH model routes.
- [x] Move native web search behind provider descriptor capabilities.
- [x] Move usage sources/normalizers to provider packages.
- [x] Make Claude an honest usage-only provider.
- [x] Move browser identity/presentation into serialized provider data.
- [x] Make provider roster dynamic.

### A3. Core stabilization

Core 01–14 complete. Important accepted fixes include:

- [x] Usage lifecycle generation/race safety.
- [x] UTF-8 split-chunk stream decoding.
- [x] Canonical provider ids/routes.
- [x] Workspace confinement.
- [x] Transactional provider registration rollback.
- [x] Registered provider without usage capability stays visible as `UNSUPPORTED`.
- [x] Browser stale-async protection.
- [x] Shared `VendorFailure` contract and deterministic regex recognition.
- [x] Remove direct core `dsh-subagent` dependency.
- [x] Provider-neutral core boundary + unfamiliar fourth-provider (`nebula`) proof.
- [x] Root lifecycle dependency cleanup.
- [x] Remove direct core `dsh-authorization` dependency.
- [x] Canonical/fail-closed Web Search request-header routing.
- [x] Real DSH boot exposed and fixed the `nishiProviders` lifecycle bug.
- [x] Final registry-first lifecycle: outer `nishi-core` publishes the registry, inner `nishi-core-host` injects registry/connection/credentials.
- [x] Real installed core subpath and agent-plane `/web-search` mount acceptance.
- [x] Real DSH boot + unload/remount acceptance.

**State: CORE DONE / FROZEN.**

Do not schedule further core cleanup unless a new reproducible blocker requires reopening it.

---

## Stage B — Project Memory

### B1. Data boundary

- [x] Reject secrets/credentials/quota snapshots/transient logs/raw chain-of-thought from maintenance directives.
- [x] Reject operator-personal facts because project memory is repository-shared.
- [x] Keep Project Memory provider-independent after vendor delegation removal.

### B2. Root and filesystem correctness

- [x] Context injection and tools share `findProjectRoot()`.
- [x] Nested Git cwd resolves to nearest `.git` root.
- [x] Worktree-style `.git` files supported.
- [x] Non-Git workspace falls back to explicit normalized absolute cwd.
- [x] No split-brain nested `.dsh/memory` tree.
- [x] Canonical `.dsh` paths reject symlink/junction/non-regular components.
- [x] Replacement writes use `@deepseek-ai/dsh-atomic-write` while preserving target/path refusal checks.

### B3. Maintenance lifecycle

- [x] `/memory` and `/consolidate` inject both `commands` and `llm` through Cordis.
- [x] Maintenance model selection is scoped/cleaned with the maintenance turn.
- [x] Concurrent maintenance request on one agent is rejected while one is active.

### B4. Acceptance

- [x] PM01 root consistency PASS.
- [x] PM02 full package/workspace gate PASS.
- [x] Atomic-write peer resolves in a disposable installed Suite profile.
- [x] Real Cordis command-service probe PASS.
- [x] Real disposable DSH boot + HTTP readiness PASS.

**State: PROJECT MEMORY DONE / FROZEN.**

Do not schedule further memory cleanup for rc.3 unless a new reproducible blocker appears.

---

## Stage C — Finish provider packages

Complete in this order so each package can be frozen before moving on.

### C1. Codex

- [ ] Replace remaining Codex-local failure classes/string builders with the core `VendorFailure` contract.
- [ ] Reuse core generic helpers where provider-local copies still duplicate a provider-neutral contract.
- [ ] Focused `test` / `check` / `build` PASS.
- [ ] Live primary turn PASS.
- [ ] Live routed `web_search` PASS.
- [ ] Live proof that vendor-native memory/project-doc content is suppressed on the primary invocation.
- [ ] Freeze Codex.

### C2. Antigravity

- [ ] Replace remaining provider-local failure helpers with core contracts.
- [ ] Remove the hardcoded model-family allow pattern from catalog discovery.
- [ ] Keep malformed-entry rejection independent from family-name filtering.
- [ ] Add catalog/model-list parser coverage.
- [ ] Focused `test` / `check` / `build` PASS.
- [ ] Live primary turn PASS.
- [ ] Mid-conversation model switch PASS.
- [ ] Routed native `web_search` PASS.
- [ ] Freeze Antigravity.

### C3. Claude

- [ ] Migrate any remaining provider-local failure/helper duplication that belongs to core contracts.
- [ ] Focused `test` / `check` / `build` PASS.
- [ ] Official CLI usage-source smoke PASS.
- [ ] Confirm usage-only descriptor remains route/search-free.
- [ ] Freeze Claude.

---

## Stage D — Repository invariants

Core-specific provider neutrality is already tested; do not duplicate Core10 as a new feature task.

Before final rc.3 acceptance:

- [ ] Confirm provider packages do not directly call `ctx.llm.registerAdapter` outside the shared registration path.
- [ ] Confirm no vendor subagent provider/tool has returned.
- [ ] Confirm core still has no provider-package dependency.
- [ ] Confirm every model capability has at least one canonical route.
- [ ] Confirm providers without a model capability serve no model route.
- [ ] Confirm capability absence remains supported (Claude usage-only is the shipping proof).
- [ ] Keep the synthetic fourth-provider extension test green.

A new **shipping** provider is expected to require a Suite dependency/bundle row and release-family entry. Those declarative packaging edits are not a core-neutrality failure.

---

## Stage E — Product-level live acceptance

This is the product promise, not another unit-test sweep.

- [ ] Codex primary + memory + routed search.
- [ ] Antigravity primary + routed search.
- [ ] Antigravity model switch inside one conversation while history/tools/memory survive.
- [ ] **Codex → Antigravity provider switch inside one session.**
- [ ] Project memory written before the provider switch is readable after it.
- [ ] Usage & Limits is usable with all three providers mounted.
- [ ] Dynamic roster: profile without Antigravity leaves no placeholder.
- [ ] Dynamic roster: provider mounted after browser/client initialization appears without provider-specific browser edits.
- [ ] Validate the Model Accounts compatibility surface without starting Nishi-managed vendor OAuth.

Recommendation remains **manual provider switching first**. Automatic failover is a separate product decision because in-flight tools, stale usage snapshots, behavior/cost changes and consent all make silent mid-turn failover non-trivial.

---

## Stage F — Profile / install lifecycle

- [ ] Decide final rc.3 target profile/update procedure for the existing `web` setup.
- [ ] Preserve the existing `dsh-chatgpt-web` link during upgrade tests.
- [ ] Fresh disposable profile install from rc.3 tarballs PASS.
- [ ] Same-profile update/reconciliation PASS.
- [ ] Managed Orchestrator `preset install` / `status` / `update` / `remove` PASS.
- [ ] Normal Suite removal leaves unrelated profile/session/project/vendor state untouched.

The explicit preset bridge remains required while DSH 0.1.1-rc.2 overwrites third-party contributed preset roots.

---

## Stage G — `0.1.0-rc.3` release gate

Before proposing publication:

- [ ] `pnpm install --frozen-lockfile` exit 0.
- [ ] `pnpm verify:local` exit 0.
- [ ] `pnpm smoke:vendor-cli` exit 0.
- [ ] `pnpm verify:bundle-install` exit 0.
- [ ] `pnpm check:npm-names` exit 0 (network-dependent).
- [ ] Final live acceptance record written under `docs/acceptance/`.
- [ ] `docs/release/2026-08-28-rc3-prerelease.md` updated with final evidence.
- [ ] Breaking changes reviewed.
- [ ] Explicit maintainer publish approval obtained.
- [ ] Publish leaves-first / Suite-last only after approval.
- [ ] Deprecate retired package names only after publication approval.

Current state: **NOT READY TO PUBLISH**, because provider-specific and product-level live acceptance remain open.

---

## Deferred / future

### Personal memory store

- [ ] Personal store under `$DSH_HOME`, never committed with projects.
- [ ] Clear precedence between project facts and operator preferences.
- [ ] Composition that makes it physically impossible to write personal context back into project memory.

### Grok

- [ ] Add as a real provider plugin after rc.3. Core extension mechanics are already proven by the synthetic fourth-provider acceptance; Stage Grok should exercise a real vendor protocol, not reopen the core abstraction without evidence.

### Project Memory deletion

- [ ] Decide whether to add guarded `memory_delete` or keep rewrite/edit-only consolidation as the sanctioned pruning model.

### Antigravity enforcement/security

- [ ] Determine whether `agy` offers stronger config-level native-memory suppression.
- [ ] Evaluate preventive tool policy instead of post-turn blocked-tool audit where supported by DSH.

### Windows

- [ ] Windows acceptance remains intentionally deferred and must be completed before making a Windows support claim.

---

## Canonical state docs

- `docs/HANDOFF.md`
- `docs/superpowers/specs/provider-bridge-design.md`
- `docs/superpowers/plans/2026-08-27-core-and-provider-plugins.md`
- `docs/SESSION-SUMMARY-2026-08-28.md`
- `docs/release/2026-08-28-rc3-prerelease.md`

Older dated plans, release records and acceptance reports are historical evidence and may intentionally describe retired package names or earlier architecture.
