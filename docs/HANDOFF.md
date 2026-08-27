# `0.1.0-rc.3` — state, remaining work, and traps

Written at the end of the 2026-08-27 session, for whoever picks this up next. Everything here is either verified or explicitly marked as unverified.

## Goal

Working across subscription providers should be a **route change and nothing else** — same tools, same project memory, same limits surface, same profile. The pain was never "too few providers": it is that when a subscription limit runs out, switching providers means switching harnesses, and every harness brings its own tools and its own memory.

So the Suite is **one provider-independent core plugin plus one plugin per provider**:

- `nishi-dsh-core` owns everything true for every provider — the provider registry and connector, the shared vendor CLI runtime, the routed `web_search` tool, the normalized usage/limits domain and its browser surface — and names no provider.
- each provider is a plugin that injects the core's registry (`nishiProviders`) and contributes one descriptor plus its own protocol translation.

Providers are plugins for a plugin, through cordis injection rather than a plugin system of our own. Adding a provider must cost a descriptor and a protocol translation: no edit to the core, the composition, or the browser. That is a falsifiable claim, and Task 15 below is how it gets tested.

Contract: `docs/superpowers/specs/provider-bridge-design.md`. Plan with per-task records: `docs/superpowers/plans/2026-08-27-core-and-provider-plugins.md`. Stage list: `docs/ROADMAP.md`.

## Where it stands

Family: 6 packages at `0.1.0-rc.3`, in-repo and **unpublished** (`0.1.0-rc.1` is the published family on npm; rc.2 was parked unpublished).

| Package | Role |
|---|---|
| `nishi-dsh-core` | the core. Entries: `.` (host bundle row), `./web-search` (agent preset row), `./client` (browser), `./runtime` and `./usage` (libraries for provider packages) |
| `nishi-dsh-codex` | Codex primary + native search backend + rate-limits source |
| `nishi-dsh-antigravity` | Antigravity primary + native search backend + local usage source |
| `nishi-dsh-claude` | usage only — no model route, no search |
| `nishi-dsh-project-memory` | project memory as ordinary DSH tools |
| `nishi-dsh-suite` | composition bundle + Orchestrator preset bridge |

Done (Tasks 0–12 of the plan), each landed as its own commit:

1. Delegation removed in full — both vendor subagents, both memory transports, the two preset tools, ~1.9k lines of source and four test files.
2. Codex vendor-memory suppression moved to the primary invocation, where it had never been applied.
3. Canonical provider ids (`codex`, `antigravity`, `claude`) with the user-visible route strings kept as declared aliases.
4. Three packages merged into `nishi-dsh-core`, family bumped to rc.3.
5. Provider registry service; `registerProvider` is the single path and writes into it.
6. Web search inverted onto the registry, then folded into the core.
7. Usage became a descriptor capability; normalizers and sources moved to their providers; Claude became a plugin.
8. Presentation record; the browser's Usage & Limits half renders identity from data and derives its roster from registrations.

Verified: `pnpm verify:local` exit `0` (release family, package contracts, Orchestrator validation, build, typecheck, tests, pack — 6 tarballs) and `pnpm smoke:vendor-cli` exit `0`, 3/3, driving the production usage sources against installed `claude 2.1.246`, `codex-cli 0.150.0`, `agy 1.1.22`.

**Not verified: anything requiring a live DSH boot.** No rc.3 profile has been booted, no live turn has been run, and the browser surface has not been opened since it became data-driven. That is Task 16.

## Remaining work

### Task 13 — deduplicate what is left
- One `VendorFailure`: Codex's version is the richest (it appends HTTP status, exit code, signal); move those fields into the core's and delete the provider-local string builders.
- One copy each of `record`, `thrown`, `assertPositiveFinite`, `bounded`. `assertPositiveFinite` currently comes from `@deepseek-ai/dsh-subagent`, which is now an odd dependency for the core to keep for one helper — decide whether to inline it and drop the dependency.
- `project-memory/src/filesystem.ts` still hand-rolls temp+rename atomic writes while `@deepseek-ai/dsh-atomic-write` exists. Keep the symlink refusal behaviour and its tests.

### Task 14 — honest model catalog
Drop the family pattern in `antigravity-primary.ts` — `/^(?:gemini|claude|gpt|oss)[a-z0-9._-]*-[a-z0-9._-]+$/i` at `:132`, and the same families in the line-scanning regex at `:147`. Keep malformed-entry rejection, which is a different check from hiding unrecognised families. Cover the catalog parser with unit tests while you are there — that file is now the entire Antigravity integration and has no unit tests (risk R2).

### Task 15 — invariants as tests, and the falsifiable acceptance
1. No provider package calls `ctx.llm.registerAdapter`, registers a usage source directly, or registers a subagent provider; no vendor subagent tool exists in the tree.
2. `packages/core` contains no provider identifier in any file, browser half included — **with the documented exception** of the DSH authorization ids (see below), and with comments stripped before matching (see the trap about tests punishing documentation).
3. `packages/core` depends on no provider package; every descriptor with a `model` declares ≥1 route and every descriptor without one declares none.
4. Write a Grok descriptor on a scratch branch and confirm nothing in `core`, `project-memory`, the Suite composition or any browser file needed an edit. If it costs more than a plugin, fix the contract, not the descriptor. The descriptor does not ship in rc.3.
5. Break each invariant once and confirm the check fails. An invariant that has never failed has not been tested.

### Task 16 — gates and live acceptance
`pnpm install --frozen-lockfile`, `pnpm verify:local`, `pnpm smoke:vendor-cli`, `pnpm verify:bundle-install`, `pnpm check:npm-names` (needs network; two new names: `nishi-dsh-core`, `nishi-dsh-claude`). Then a live run recorded under `docs/acceptance/`:

- Codex primary: turn, memory read/write, routed `web_search`, and **no vendor memory or project-doc content reaching a turn** (the 2.A.2 fix has never been exercised live);
- Antigravity primary: turn, mid-conversation model switch, routed `web_search`;
- **provider switch Codex → Antigravity inside one session**, with project memory written before and read after — the case the product exists for, still uncovered;
- usage rows for all three providers, plus the dynamic-roster cases: all mounted; a profile without Antigravity; one mounted while the browser is already open;
- fresh-profile install/upgrade from local tarballs preserving the `dsh-chatgpt-web` link, `preset install` / `status` / `remove`, then Suite removal.

Then write `docs/release/2026-08-27-rc3-prerelease.md` and stop. Publication needs separate explicit approval, every time.

## Breaking changes to record in the release note

- `subagent_codex` and `subagent_antigravity` tools are gone; the Orchestrator preset delegates through DSH's own `subagent` / `subagent_fork` on the primary route.
- Config fields removed: Codex `providerName`, `permissionMode`; Antigravity `subagentProviderName`, `subagentModel`, `subagentEffort`; the web-search tool's four `antigravity*` fields (the vendor's knobs live on the vendor's plugin now, with `searchTimeoutMs` there).
- Package names `nishi-dsh-provider-kit`, `nishi-dsh-usage-limits`, `nishi-dsh-usage-limits-host`, `nishi-dsh-primary-web-search` no longer exist; `nishi-dsh-core` and `nishi-dsh-claude` are new. Deprecate the retired names on npm when publication is approved.
- `ctx.projectMemory` no longer exists: the service was deleted with the subagent memory view that was its only method.

## Mistakes made in this session, and what they cost

Recorded so they are not repeated, not for penance.

1. **Planned a four-package merge that could not build.** The plan had `primary-web-search` merging into the core in Task 7, but it value-imports the provider packages, which import the core — neither `pnpm -r build` nor `tsc` can order a cycle. The merge had to be split: three packages in Task 7, web-search in Task 9 together with the dependency inversion that removes the cycle. **Lesson: check the dependency direction before scheduling a merge.**
2. **Planned to move `routes` onto the descriptor before anything read it.** Deferred to the task that needed it. The same correction applied to `presentation`, `usage` and `webSearch`: each capability field was added by the task that consumes it, so no field sat in the type unread.
3. **Planned to delete `registerProvider`.** It stays: it is the single registration path and the subject of the grep invariant. What changed is that its first step now writes into the registry.
4. **Nearly deleted the only vendor-memory suppression in the repository.** The three Codex `-c` overrides existed solely in the subagent path being deleted, and the primary had never had them. Found while writing the plan, fixed *before* the deletion so parity was provable. **Lesson: before deleting a subsystem, grep for behaviour that exists only inside it.**
5. **Wrote a test that punished documenting an absence.** The web-search composition test forbade the strings `exa` and `perplexity` anywhere in the sources — it matched the word "exact" and would have failed on the comment explaining that those fallbacks are deliberately absent. It now strips comments and matches word boundaries.
6. **Named providers in the core's own comments** while explaining the inversion. The neutrality check caught it immediately; prose in the core is provider-neutral now.
7. **Trusted a stale roadmap item.** R7 claimed a mislabelled dispose effect in `antigravity-primary.ts`; it had already been fixed in `a0b3809`. Verify a finding still reproduces before scheduling it.

## Traps (environment and codebase)

**Node 24 lives in fnm.** `/usr/bin/node` is v22 and must not be used. Prefix commands with `PATH=$HOME/.local/share/fnm/node-versions/v24.19.0/installation/bin:$PATH`.

**Read exit codes, not output.** Several gates print cheerful text and still fail; `pnpm verify:local` is the only summary that matters, and `echo $?` is how you read it. Piping to `tail` loses the status — capture to a file and check `$?`.

**cordis serves a service through a `Proxy`, so a proxied `this` cannot read class `#private` fields.** A service that stores state in `#fields` throws `Cannot read private member` on first use through `ctx.<service>`. Both `UsageLimitsHostService` and `NishiProvidersService` bind every public method in the constructor for this reason. A test that constructs the service directly will *not* catch this — mount a real `Context` and reach the service through `ctx.<name>`.

**`pnpm -r check` type-checks provider packages against the core's built `lib/*.d.ts`, not its sources.** After changing a core type, rebuild the core (`pnpm --filter nishi-dsh-core build`) or provider checks fail with stale-type errors that look like your edit is wrong.

**tsdown had `clean: false` on every entry.** With hashed shared chunks that meant stale chunks accumulating in `lib/` and shipping in the tarball. The node config now cleans first and the client config must keep `clean: false`, or it erases the node output. If you add a fourth entry, keep that ordering.

**A preset row may be a package subpath.** `nishi-dsh-core/web-search` works because the cordis loader hands bare row names to a plain dynamic `import()` and DSH indexes composed rows by `id`, not by name. This was verified by loader/launcher source plus an isolated Node resolution test — **not** by a real profile boot. If a live mount ever fails, the fallback is a thin separate package that injects the registry.

**Registrations arrive after the core mounts.** cordis defers a provider's `apply` until `nishiProviders` exists, so anything that wants "the list of providers" cannot read it once at construction. `UsageLimitsService` had exactly this bug shape (roster as a constructor argument) and now has `register()` plus withdrawal; the usage host reconciles on every registry change.

**`agy` cannot run headless with tools.** The CLI auto-denies permissions it cannot prompt for. This killed the Antigravity subagent (R4b) and constrains anything that expects an interactive vendor agent.

**Antigravity's memory suppression is only half-enforced** — partly CLI config, partly prompt instructions, which is guidance to a model rather than enforcement. Now a primary-plane risk, not a delegated one (R4).

**The DSH authorization ids are a foreign id space.** `openai-codex`, `anthropic`, `openai` in `host/authorization-rpc.ts` and the Model Accounts surface are DSH's own, not ours, and the allowlist is a security control: those may be read, none may start OAuth, only legacy grants may be removed. Do not "clean it up" into the registry, and do not let the neutrality test fail on it — name it as an exception and assert it stays read/logout-only.

**The DSH launcher overwrites contributed preset roots** (upstream issue #2), which is why the Suite ships an explicit `preset install` bridge. Unchanged in rc.3.

**Vendor CLIs drift and nothing else catches it.** `pnpm smoke:vendor-cli` is the only gate that spawns real `claude`/`codex`/`agy`; it caught two missing exports during the merge that every unit test happily passed. Run it after any change to a usage source, a normalizer, or an export surface. Installed versions moved during this session (`agy 1.1.21` → `1.1.22`), so record the versions in acceptance notes.

**Live gates spend real subscription quota.** They were deliberately deferred to one deliberate run (Task 16) rather than spent piecemeal.
