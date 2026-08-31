# Roadmap

Status updated for `0.1.0-rc.3` after accepted Foundation revalidation against official DSH `dsh-v0.1.2-alpha.1` (`cd5ef8148158c3a752a658978873241fdf8e2bbc`), which is the only supported DSH generation; rc.2 and earlier are unsupported. `docs/README.md` owns that policy.

This file owns task status and order only. Architecture belongs in `ARCHITECTURE.md`; immediate execution details belong in `HANDOFF.md`; release/Market gates belong in `RELEASE.md`.

## 1. Foundation — THAWED, PENDING RE-VALIDATION

A follow-up audit of Core, Project Memory and Codex reopened this freeze again. It reproduced a Project Memory recovery race that failed unrelated memory operations, a Codex path that put raw vendor stderr in front of the model, and a set of smaller correctness and architecture defects. All were remediated; see `docs/HANDOFF.md` for the itemized list.

Local re-validation of this tree first returned FAIL — `pnpm verify:local` gave FAIL, PASS, PASS over three runs, on a load-sensitive Project Memory recovery read race that failed an unrelated caller's memory operation. That defect is fixed and the gate is now green: `pnpm verify:local` passes on three consecutive runs; current focused test counts are Core `200`, Project Memory `77`, Codex `81`, Claude `6`, Antigravity `99`, Suite `16` (the `209`/`61` figures recorded right after that fix are themselves superseded by the Model Accounts removal and the Codex thread-resume redesign since). A single `build`/`check`/`test` pass exited `0` throughout, which is why the Project Memory race was missed — treat that as the weaker signal it is. See `docs/HANDOFF.md`. Codex and Antigravity live acceptance now both pass on this tree (see §2 and §3), but there is still **no** independent validation by a party that did not write the code, and no alpha.1 runtime probe has been repeated against this tree. The freeze claim below is history.

Previously accepted implementation, now superseded:

```text
7cd4d5b17625f9b3a21b741555df6597fd9cb889
```

Raw PASS report commit:

```text
d1cbac7094488ded52d9ab83891531bc01197090
```

Accepted Foundation gates:

- [x] Project Memory journal-generation cleanup race fixed;
- [x] Project Memory stale-lock replacement/finalizer race fixed;
- [x] Project Memory PID-reuse ownership hardening implemented for Linux/macOS;
- [x] Core unsafe legacy credential read-kind-then-delete mutation removed/fail-closed;
- [x] Project Memory bootstrap ingestion bounded before whole-file materialization;
- [x] Core usage invalidation made authoritative for host cache and browser reconciliation;
- [x] Project Memory journal phase replacement preserves `0600` on POSIX;
- [x] writer-lock publication collision handoff race fixed;
- [x] concurrent journal open/unlink recovery preflight handled as current absence;
- [x] legacy transaction generation separated from mutable owner state;
- [x] duplicate tool-layer Project Memory recovery removed;
- [x] deterministic regression coverage retained/extended for the audited interleavings;
- [x] `pnpm install --frozen-lockfile` PASS;
- [x] Core focused tests `182/182`, check/build PASS;
- [x] Project Memory focused tests `64/64`, check/build PASS;
- [x] full workspace test/check/build PASS;
- [x] `pnpm verify:local` PASS;
- [x] three concurrency-sensitive PM suites repeated 20/20 iterations PASS;
- [x] zero unexpected lock/WAL residue after exercised success/recovery paths;
- [x] bidirectional `@deepseek-ai/dsh-atomic-write` lock interoperability PASS;
- [x] disposable official DSH `0.1.2-alpha.1` runtime validation at exact upstream commit PASS;
- [x] independent Gemini follow-up code review found no new blocking Foundation defect;
- [x] durable evidence folded into `docs/verification/README.md`.

Windows remains **NOT TESTED**. Unsupported process-identity seams remain conservative.

Supported DSH generation: `0.1.2-alpha.1` only.

Foundation production DSH peers declare exactly that:

```text
0.1.2-alpha.1
```

The devDependency graph matches, so the alpha.1 claim rests on the whole workspace suite running against alpha.1, not on a one-off probe.

## Architectural overcomplexity disposition

### Simplified and accepted

- [x] duplicate Project Memory recovery at the tool wrapper removed; domain operations remain the single recovery boundary;
- [x] implicit PID/pathname ownership replaced with explicit transaction ids, lock tokens and process identities;
- [x] Core authorization begin/submit/cancel/polling state machine removed entirely, host and client alike, rather than kept inert — a disabled mutation path that still carried a secret-typed prompt channel was a liability, not compatibility;
- [x] `registerConnectionRpcChannel()` `Function.length` rc2/alpha compatibility probe removed together with the rc.2 branch it selected, when the peer range was narrowed to `0.1.2-alpha.1`.

### Intentionally retained

- [ ] Usage invalidation generation token: retain; it fences pre-invalidation observations.
- [ ] Project Memory fixed journal pathname: retain; explicit transaction generation + locking closes the audited cross-generation race without a larger WAL-directory migration.

Do not perform aesthetic Foundation refactors during provider work.

## 2. Codex — THAWED, PENDING RE-VALIDATION

Independent from-scratch audit, remediation, and live acceptance testing completed:

- [x] independently audit current Codex source/runtime seams against official Codex 0.150.0 and DSH 0.1.1-rc.2;
- [x] reconcile provider-specific DSH dependencies/peers to proven generations;
- [x] remove deprecated feature flags and redundant code-mode-host flags;
- [x] fix stream error on concurrent connection close in App Server connection lifecycle;
- [x] preserve vendor protocol translation and the reviewed Codex App Server adapter boundary inside the provider package;
- [x] preserve registry-first provider registration and canonical `codex-app-server` route;
- [x] preserve absence of vendor-specific subagent registrations/tools;
- [x] focused test/check/build PASS (48/48 tests);
- [x] live primary turn PASS (`test:live:primary`);
- [x] routed native `web_search` PASS (`test:live:web-search`, `test:live:web-search-routed`);
- [x] full 15-scenario live acceptance test suite PASS (`test:live:acceptance`), re-run in full on 2026-08-31 against the current tree at Codex 78 tests, together with `test:live:primary` and both web-search suites;
- [x] prove vendor-native persistent memory/project-doc injection is suppressed;
- [x] prove adversarial isolation against forbidden host capabilities;
- [x] prove zero process residue;
- [x] fresh accepted Codex validation evidence folded into `docs/verification/README.md`;
- [x] stop rejecting producer-supplied context blocks App Server input cannot carry (issue #4). A subagent stopped mid-tool-call put a `tool-call` block into a `user` notice; the plugin threw, which killed the live turn and — with no checkpoint written — every later replay of that session. Those blocks are projected to text instead, at all five sites that handled them. Codex 72 -> 78 tests; `verify:local` exits `0`, live suites not re-run. See *Codex history projection* in `ARCHITECTURE.md` and invariant 31;
- [x] **fixed: a mid-turn route switch into Codex no longer fails the turn.** Found live on 2026-08-31: when a turn's first step ran on another provider and emitted tool calls, the step that consumed those results on `codex-app-server` threw `codex-plugin-dsh: the current Codex turn has no user input`, because current-turn input is decided by position and a tool result is never that input. `prepareCodexHistory` now continues from a pending tail of tool results instead of rejecting it: the results stay in the imported history, where they pair with the `function_call` items of the step that made them, and they are also projected into the turn input behind one harness-authored line saying why. Sending them twice is deliberate — it costs one repetition and keeps the turn working whether or not `thread/inject_items` reaches the model, which is still unverified (see `HANDOFF.md`). Codex 78 -> 81 tests, plus `test:live:tool-result-continuation`, a live probe against real `codex-cli 0.150.0` that asserts the model actually saw the tool result rather than merely that the turn survived;
- [ ] freeze Codex — reverted: the follow-up Foundation audit found and fixed a Codex defect (raw vendor stderr reaching the model, among others) after this stage was originally frozen on the evidence above. A fresh freeze needs its own validation run against the current tree; see `docs/HANDOFF.md`.

## 3. Antigravity — ACTIVE

Next stage:

- [x] provider-specific audit of source, tests and manifest;
- [x] regression net before changing anything: 7 -> 26 unit tests, driven through the public seam with a fake subprocess, characterizing catalog, vendor-diagnostic and native-tool behaviour;
- [x] route every vendor-process diagnostic through `VendorFailure`; raw stderr and stdout no longer reach a message (30 tests);
- [x] remove hardcoded model-family catalog filtering while preserving malformed-entry rejection. The speculative JSON object-walker was deleted outright — it looked for `slug`/`id`/`model_id` keys the vendor never emits, so the JSON path yielded zero models against the real CLI and the text fallback always ran. Both paths now share one parser over the real `id\tname` format: any id is accepted regardless of family, and rejection is by shape — no tab, empty id, or whitespace inside an id. The `Fetching available models...` progress line is skipped by those rules, not by matching its wording. A non-`SUCCESS` envelope is now an authoritative failure instead of a silent fallback, and its vendor-authored `error` string is sanitized through `VendorFailure` like every other vendor output;
- [x] remove intra-package duplication: `record()`, `nativeToolNames()` and the executable/Windows-shim resolution moved into one internal `src/agy-vendor.ts` and used by both vendor call sites. Justified by a concrete hazard rather than tidiness — Codex once applied its `.cmd`/`.bat` wrap to one invocation path and not the other, and two copies in one package invite the same drift. The two Antigravity copies turned out to be behaviourally equivalent, so no latent bug was found, only removed the room for one. Cross-package extraction into `nishi-dsh-core` was deliberately not attempted: that is an architectural decision nobody has taken;
- **accepted debt — no vendor runtime version verification.** Codex pins `0.150.0` and enforces it from the App Server handshake; Antigravity runs whatever `agy` is installed, at any version. `agy` exposes no handshake, so an equivalent gate would mean parsing `agy --version` and gating on a known-good range. Deliberately not done for now: the maintainer accepted the risk on 2026-08-30. Revisit if a vendor upgrade ever breaks a contract silently;
- **accepted debt — `usage-source.ts` trust model.** It sets `rejectUnauthorized = false` for loopback HTTPS quota probes and discovers the port and CSRF token by scanning process command lines; 534 lines with no unit tests. Any local process that binds the same loopback port with a self-signed certificate would be believed. Bounded blast radius — loopback only, read-only quota reporting — and the maintainer accepted it as-is on 2026-08-30. Revisit if usage ever carries anything beyond quota numbers;
- [x] live acceptance: primary 8/8 (catalog, real turn, tool loop, shared memory, session reopen, model switch, isolation, failure semantics), routed search 1/1, native search 1/1 — all against the real `agy 1.1.22` with no permission-config changes; re-run and still PASS on 2026-08-31;
- [x] reasoning efforts separated from model ids (`5d74408`): a family with two or more effort variants collapses into one advertised model with `low`/`medium`/`high`, the suffixed ids stay as aliases, and invocation maps back to `--model <base> --effort <level>`. A base id resolved without an explicit effort defaults to `high` — the strongest tier, chosen deliberately by the maintainer on 2026-08-31 rather than inherited from the vendor, which states no default;
- [x] that mapping resolves through discovery instead of peeking at the model cache. The cache-peek version silently degraded once `modelCacheMs` had elapsed between route resolution and the turn, and could hand the vendor a suffixed id together with a contradicting `--effort`. Discovery failure still falls back to invoking the requested id verbatim, so a catalog outage cannot lose an otherwise valid turn. Antigravity 62 -> 73 tests, and live primary re-run 8/8 against real `agy 1.1.22` after the change;
- [x] **one live `agy` child per DSH session instead of one process per step.** Every step was a whole process — primary, subagent and routed search alike — which guaranteed a fresh vendor conversation, a guaranteed prefix-cache miss, a cold CLI start in the critical path, and a model reading its own past actions as JSON quoted back at it rather than as its own turns. The vendor already supported the alternative: `--input-format stream-json` runs one turn per NDJSON line, and `--json-schema` is enforced on each of those turns rather than only the last, which was verified against real `agy 1.1.22` before any code was written. Measured on the same binary, a continuation inside one child read 20418 of a 23496-token prefix from cache and paid for ~3.3k new tokens instead of ~23.5k; below roughly 20k of prefix the vendor's cache does not engage at all, so the saving lands where it matters and not on toy exchanges. The adapter keys the child by `sessionId`, opens with a `full` envelope and continues with `delta` envelopes. Reuse is allowed only when the request extends exactly the message ids already delivered; divergent history, a changed system prompt/catalog/model/effort, and any `purpose`-carrying auxiliary call all rebuild instead. Reported usage became a difference rather than the vendor's running conversation total — left unsubtracted it would have re-counted the same tokens once per remaining step and tripped compaction early. Antigravity 73 -> 87 tests, plus a new `test:live:session-continuation` that asserts on real `agy` both that one child served both steps and that the model's answer contains a value only obtainable from the tool result;
- [x] **DSH mints tool-call ids instead of trusting the model's.** The vendor's ids are model-authored and routinely repeated — `call_1` on every step is normal — and nothing upstream rejects a reuse across steps, since the session invariant tracks pending calls only within a step. The result was a history full of results the model could not match to their calls, which is a direct generator of repeated tool calls. The vendor's own id is kept in a per-session map and restored on the wire so the model still recognises its own call;
- [x] **the route advertises a context capacity (`contextWindowTokens`, default `200_000`).** Without one, `compaction-basic` refuses automatic pressure compaction and `agent/pre-step` swallows the refusal as a single warning per target, so an Antigravity session never compacted and had no bound of any kind on its history — unlike Codex, which at least reports `contextWindowExceeded` and ends the turn as `max-tokens`. The figure is deployment-owned rather than discovered: `agy models` discloses an id and a display name and nothing else;
- [x] **the forced output schema now types each tool's arguments.** It declared `arguments: {"type":"object"}` for every call, which an empty object satisfies, so a call carrying none of the tool's required fields was well-formed to the vendor, failed in DSH, and got retried by a model that could not see why. Each variant now pins `name` to one tool and `arguments` to that tool's own schema. `anyOf` plus an `enum`-of-one discriminator was chosen because that is what the vendor's subset accepted when probed on real `agy 1.1.22`, not from its documentation. DSH schemas are rewritten into that subset first: annotations (`format`, `title`, `pattern`, `$schema`) are dropped, `const` becomes a one-member `enum`, and a composite keyword (`$ref`, `oneOf`, `if`) abandons that ONE tool to the old untyped object rather than the whole catalog — a composite cannot be dropped without changing what the schema means, but one exotic tool must not disable typing for its neighbours;
- [x] **live acceptance re-run on the changed tree**: primary 8/8 and `test:live:session-continuation` 1/1 against real `agy 1.1.22`. Search suites not repeated, deliberately — neither change touches the search backend;
- [x] **three defects found by reading real session logs rather than tests**, all of which the session-lived conversation either introduced or exposed. `maxTokens` was refused on every request, so once a context capacity existed compaction ran and failed 35 consecutive times in one session, each failure swallowed by `agent/pre-step` as a warning; it is now accepted and ignored for `purpose`-carrying auxiliary calls only. The divergence check compared message ids, but the tool-result pruner rewrites content while carrying the id over, so 80k tokens pruned in DSH never reached the vendor, which kept serving the originals; the check now digests content. And a delta echoed the conversation's own replies back at it, doubling the density of every action in the transcript -- one session ended with 43 identical `todo_write` calls after the work was already finished. Antigravity 92 -> 96 tests;
- [x] **an auxiliary call may only answer in prose** (`e7d7fe5`). Typing tool arguments in the forced schema regressed compaction, and only once compaction could run at all was it visible. Compaction deliberately replays the conversation's own system prompt and tool catalog so its request stays a genuine prefix of the last routed one and keeps the vendor's cache warm — which, with arguments typed, made the summarization request indistinguishable from an ordinary turn holding 29 tools and a half-finished task. The model answered it with a tool call: `kind` came back `tool_calls`, `text` was empty, and compaction failed with `summarization produced no text summary content` on 7 of 8 attempts in one real session, the single success arriving at step 158 of 175. A `purpose`-carrying request now gets a schema permitting `kind: "message"` with no `tool_calls` property at all — removing the property rather than bounding it makes the wrong answer unexpressible using only keywords the vendor was probed to accept on real `agy 1.1.22`, and the envelope still carries the tools, so the prefix alignment compaction wants is untouched. A reply with no `tool_calls` key is read as an empty list. Antigravity 96 -> 99 tests; the gate and `test:live:session-continuation` both exit `0`;
- **investigated and costed — DSH tools through agy's own MCP client.** The bridge switches off everything that makes `agy` an agent (`inheritCustomizations: false`, `tools: [finish]`, an ephemeral workspace, forced structured output) and DSH supplies a much thinner harness in its place. Reaching the vendor's own harness while keeping DSH's tools means handing them over as MCP tools. Google's own forum thread confirms the shape of the problem this would solve: combining tools with a strict response schema is a documented cause of endless identical tool calls, acknowledged by Google staff as the model detecting a conflict between the tool data and the schema constraints. Probed end to end against real `agy 1.1.22` before any code:
  - a **globally registered** server (`agy mcp add`) is required. A workspace-scoped plugin at `.agents/plugins/<name>/mcp_config.json` launches the server and completes the MCP handshake, but its tools are never injected into the model's toolset — verified with both a custom agent and the default one;
  - the permission grant is **narrow, not blanket**: `mcp(<server>/*)` in `userSettings.globalPermissionGrants.allow` of `~/.gemini/config/config.json` is sufficient on its own. `toolPermission` stays at its strict default; no `always-proceed`, no `--dangerously-skip-permissions`. The documented syntax is `mcp(server/tool)` / `mcp(server/*)` / `mcp(*)` across Deny > Ask > Allow lists, so a grant can name individual tools;
  - a trusted workspace is **not** required (removing the entry changed nothing);
  - a tool call that **blocks for 45 seconds** completes normally, which is what makes the Codex-shaped design viable: the vendor asks for a tool, DSH executes it with its own permissions and durable history however long that takes, and the next `stream()` resolves the pending call.
  Not adopted, and the reason is no longer permissions. Two costs remain: a globally registered server is reachable by every `agy` session on the machine rather than only by the bridge, and — the one nothing compensates for — `agy` runs several internal turns per input line (measured: `num_turns: 4` for one line), so its own loop would proceed inside a single DSH step and `session.jsonl` would stop being the complete record of what the model did. That last point is a contract decision for the maintainer, not an implementation detail;
- [ ] **open — a real context window for Codex.** Codex discloses no `context.contextWindow` either, so its automatic pressure compaction is equally dead; it is less severe only because its overflow backstop exists. Deliberately not fixed by guessing: a per-`gpt-5.x` figure needs evidence or a maintainer decision, not an adapter default;
- [ ] freeze Antigravity.

## 4. Claude

Claude remains usage-only for rc.3.

- [ ] provider-specific DSH compatibility audit;
- [ ] remove genuinely provider-neutral duplication where applicable;
- [ ] focused test/check/build;
- [ ] official CLI usage-source smoke;
- [ ] confirm descriptor remains model-route/search-free;
- [ ] freeze Claude.

## 5. Repository-wide provider invariants

- [ ] provider packages use shared `registerProvider()`;
- [ ] vendor-specific subagent registrations/tools remain absent;
- [ ] Core remains independent of provider packages;
- [ ] model capability always has at least one canonical route;
- [ ] capability absence remains legal;
- [ ] synthetic fourth-provider extension remains green;
- [ ] DSH dependency declarations match package-specific validation evidence.

## 6. Product-level live acceptance

- [ ] Codex primary + Project Memory + routed search;
- [ ] Antigravity primary + routed search;
- [ ] Antigravity model switch in one conversation;
- [ ] Codex -> Antigravity provider switch in one session;
- [x] cross-route delegation: a child on the other vendor's primary route, both directions, plus two concurrent Codex children (see §7c);
- [ ] memory written before the switch is readable after it;
- [ ] Usage & Limits with all providers mounted;
- [ ] late/absent provider browser behavior;
- [ ] vendor sign-in stays in each vendor's own CLI, with no Core surface reading or mutating a credential record. Model Accounts was removed outright in rc.3, so this is a check that nothing reintroduced it, not a check that it works.

Automatic failover remains deferred.

## 7. Install/profile lifecycle

- [ ] fresh disposable rc.3 tarball install;
- [ ] same-profile reconciliation/update;
- [ ] preserve unrelated existing links/state;
- [ ] managed Orchestrator preset install/status/update/remove;
- [ ] Suite removal preserves unrelated profile/session/project/vendor state.

## 7a. Codex thread handling — decision taken and implemented

Measured against real `codex-cli 0.150.0`; the numbers and the protocol facts are in `ARCHITECTURE.md` under *Codex vendor threads*.

The former fork-per-turn design got **zero** prompt-cache credit on every turn, while resuming one thread gets cache credit for ~90% of input, and a partial `thread/rollback` does not disturb it. Forking also left one persisted vendor thread per DSH message in the user's own vendor account, each carrying that turn's runtime context and project contract.

- [x] decide whether to replace fork-per-turn with `thread/resume` plus `thread/rollback` for divergence, and implement it (`perf(codex)!: resume the vendor thread instead of forking every turn`). An ordinary turn resumes; `thread/rollback` realigns when DSH's history has diverged from the vendor thread's tip; `thread/fork` is kept only for a checkpoint that is neither the tip nor an ancestor of it. This keeps the cache, keeps exact-turn semantics, and leaves one vendor thread per session instead of one per message. Codex 61 -> 69 tests; `verify:local` and live acceptance (primary + full 15-scenario suite) pass;
- [x] record the reason for the chosen thread strategy in the code — the shared start/fork/resume configuration and the resume/rollback/fork decision are now commented at the call site in `packages/codex/src/codex-plugin-dsh/adapter.ts`;
- [x] decide whether this suite should clean up the vendor threads it creates (`thread/delete` / `thread/archive` exist). Decided: no. Deletion touches data in the user's vendor account and the maintainer has said old sessions do not matter, so no cleanup is implemented and none is planned against previously created threads. Threads created before this change (one per message, under the old fork-per-turn design) still exist in the user's vendor account exactly as they were;
- [ ] verify that `thread/inject_items` actually reaches the model. It succeeds but is invisible through `thread/read` and `thread/resume`, and the adapter still depends on it for history that follows a checkpoint. This remains the one open gap and is worth knowing regardless of any future thread-handling change.

Note on cost framing: the measurements are token counts the vendor reports. ChatGPT/Codex subscription limits are message-weighted rather than token-metered, so a large cached-token saving does not automatically translate into the same saving on the user's `5h`/`Weekly` counters. Do not promise that it does.

## 7b. DSH support boundary — alpha.1 only — DONE except the upstream blocker

`0.1.2-alpha.1` is the only supported DSH generation, and the repository now says so everywhere rather than only in policy.

- [x] Foundation devDependency/test baseline moved from rc.2 to alpha.1, resolved from the local upstream checkout through `pnpm-workspace.yaml` overrides;
- [x] Core and Project Memory peers narrowed to `0.1.2-alpha.1`;
- [x] provider peers (`codex`, `antigravity`, `claude`) moved to `0.1.2-alpha.1`, each on its own evidence — Codex 81 unit tests plus the full 15-scenario live acceptance suite, re-run on 2026-08-31 when the package stood at 78 tests, Antigravity 73 unit tests plus 10 live scenarios (8 primary, 1 native search, 1 routed search), Claude 6 unit tests only and correspondingly weaker;
- [x] the Suite's `dsh-authorization` dependency and `DSH_COMPATIBILITY_VERSION` moved;
- [x] `registerConnectionRpcChannel()`'s `Function.length` arity probe removed with the rc.2 branch it selected; the named seam stays because it records that Connection owns the disposer;
- [x] Core's retired rc.2 dev fixtures (`dsh-client-runtime`, `dsh-host-apiproxy`) dropped; the invariant that they stay out of `dependencies`/`peerDependencies` and out of production imports remains;
- [ ] **blocked on upstream**: publish `0.1.2-alpha.1` to npm. Until then the declared ranges are uninstallable from the registry, which gates publication rather than development;
- [ ] once published, replace the local-checkout overrides in `pnpm-workspace.yaml` with ordinary registry versions and delete the *Local setup* note in `docs/README.md`.

Three rc.2 literals survive on purpose, all of them historical facts rather than compatibility claims: the migration-baseline line in the repository-root `THIRD_PARTY_NOTICES.md`, the provenance line in `packages/codex/THIRD_PARTY_NOTICES.md`, which records what the code was derived from, and a comment in `packages/suite/cordis.patch.yml` describing an rc.2 launcher bug. That second one is worth re-checking: if alpha.1 preserves third-party preset roots, the Suite's managed preset bridge is obsolete and should be removed rather than carried forward.

## 7c. Subagent model routes — composed, live validation pending

Any registered primary route is usable as a subagent model, the Suite's own included, because a spawned child is an ordinary DSH agent reaching its model through `ctx.llm`. See *Subagent model routes* in `ARCHITECTURE.md`.

- [x] Orchestrator preset mounts `subagent` with `modelSelectionSettings: true`, so a child may run on a route other than its parent's. `subagent_fork` deliberately keeps it off (KV Cache reuse of the inherited prefix). Covered by `packages/suite/test/preset-delegation.test.ts`; Suite 12 -> 16 tests;
- [x] the Suite bundle patch continues to leave `@deepseek-ai/dsh-tool-subagent/model-selection-settings` to the surrounding profile — it is a host singleton and the official web-app bundle mounts it. Asserted by the same test;
- [x] **live** (2026-08-31, real `web` profile): one delegation each way — parent `codex-app-server/gpt-5.6-sol` -> child `antigravity-cli/gemini-3.7-flash-medium`, and the reverse. Each child's route is evidenced by its own session `request/header`, and the parent's sampled `subagent/model-selection-policy` event is in its log;
- [x] **live**: one parent turn with two concurrent background children on `codex-app-server`, both settled and reported. Six concurrent `codex app-server` processes at peak, no residue after the run;
- [ ] a child's own `web_search` route and its project-memory access were not asserted separately in that run — the children were deliberately told to use no tools. Worth one more delegation that makes the child search;
- [x] `antigravity-cli` now advertises reasoning efforts, so a child can pick one. It did not when this list was first written — the vendor encodes effort in the model id, and the catalog was passed through as three separate models. `feat(antigravity): separate model reasoning efforts` collapses each family into one model advertising `low`/`medium`/`high`; see *Antigravity model catalog and reasoning efforts* in `ARCHITECTURE.md`. Note for allowlists: the catalog advertises base ids only, so an entry naming a suffixed id no longer shows up in `list_subagent_models`;
- [ ] decide on a dynamic allowlist. The user setting is a static list of exact provider/model pairs, so a vendor's new model is not selectable until the user authorizes it. A drop-in `subagentModelSelection` service publishing the live `ctx.llm` catalog and refreshing on `llm/adapters-updated` would remove that step, at the cost of weakening a deliberate authorization boundary over someone's subscription quota. Not implemented; the maintainer chose the composed-and-documented path on 2026-08-31.

## 8. Release gate

- [ ] final `pnpm install --frozen-lockfile`;
- [ ] `pnpm verify:local`;
- [ ] `pnpm smoke:vendor-cli`;
- [ ] `pnpm verify:bundle-install`;
- [ ] `pnpm check:npm-names`;
- [ ] `RELEASE.md` updated with final evidence;
- [ ] breaking changes reviewed;
- [ ] explicit maintainer publication approval.

Current release state: **NOT READY TO PUBLISH**.

## Deferred after rc.3

- Personal memory store under `$DSH_HOME` with hard separation from repository memory.
- Real Grok provider plugin.
- Decision on guarded `memory_delete` vs rewrite/edit-only pruning.
- Stronger Antigravity native-memory/tool enforcement if vendor APIs allow it.
- Windows acceptance before any Windows compatibility claim.
- Core's `tsdown` build is not reproducible: two builds of an unchanged tree emit a different `lib/client.js`, differing only in CSS-module key order. Harmless today, but it makes byte-level artifact comparison useless.
