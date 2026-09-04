# nishi-dsh-codex

Codex primary-provider plugin for Nishi DSH Suite.

## Declared capabilities

- canonical provider id: `codex`;
- primary model route: `codex-app-server`;
- external Codex App Server adapter and primary-history projection;
- Codex-native web-search backend;
- official rate-limits usage source.

Vendor-specific delegation was removed in `0.1.0-rc.3`. This package no longer registers a Codex subagent provider/tool and does not own Project Memory. DSH tools and Project Memory stay on the normal primary plane when the active provider route changes.

## Runtime boundary

The primary adapter is based on the reviewed MIT `wingoo/codex-plugin-dsh` source snapshot pinned at `79fe7503390d641680bad8efade52782a3c31ced`; it is not an official OpenAI plugin.

At runtime the package uses the user's installed official `codex` CLI/App Server, located through `DSH_CODEX_EXECUTABLE` or `PATH`. No `@openai/codex*` runtime package is bundled.

Native Codex authentication remains vendor-owned. The Suite does not copy credentials, API keys, session tokens or authentication databases.

The audited App Server contract is `0.150.0`, and that is enforced as a FLOOR: `0.150.0` or newer runs, anything older refuses. It was an exact pin until 2026-09-02, which meant every Codex release after the audited one broke this provider outright -- a certain cost on each upgrade against an uncertain protocol break that, when it happens, surfaces loudly as a JSON-RPC error on the method that changed. A version can tell us a runtime is too OLD to carry `experimentalApi`, `thread/inject_items` or the checkpoint calls, so that is all the gate claims; the handshake version is otherwise recorded rather than judged. A Codex CLI below the floor is a runtime-availability condition, not an internal fault: the usage source reports `UNAVAILABLE` rather than collapsing to `ERROR`, and the primary/search paths refuse to start.

### Vendor diagnostics

Raw vendor stderr never reaches a diagnostic, a DTO, or the model. Every place in this package that turns a failed Codex process into an error routes it through one authored recognizer list built on Core's `VendorFailure` contract. A recognized condition — sign-in required, stored-credential access denied, network unreachable — contributes only its own authored sentence; anything else is reported as an unattributed category plus safe exit/signal metadata. Local paths, home directories and vendor tokens therefore cannot escape through a `web_search` error or an unexpected App Server exit.

Native web search verifies the vendor runtime once per resolved executable and shares that verification across concurrent queries, rather than starting a throwaway App Server for every query in a batch.

## Project-memory policy

The current primary App Server invocation disables vendor-native memories and project-doc injection with these overrides:

```text
memories.use_memories=false
memories.generate_memories=false
project_doc_max_bytes=0
```

That keeps Nishi Project Memory as the durable project-memory surface used by the Suite primary plane.

`CODEX-GLOBAL-AGENTS-001` remains `ACCEPTED_WITH_KNOWN_UPSTREAM_DEBT` until a separately reviewed provider change replaces that policy.

## Core boundary

This package does not register the model-facing `web_search` tool itself. It contributes a native search backend through its provider descriptor; `nishi-dsh-core/web-search` owns tool registration, canonical route resolution, timeout/error taxonomy and result normalization.

Provider registration goes through shared `registerProvider()` rather than calling `ctx.llm.registerAdapter` directly.

Foundation behavior is not duplicated here: generic provider registration, shared vendor failure/runtime helpers, routed search dispatch and usage projection belong to Core.

## Current DSH declaration

The Codex manifest declares its provider-specific DSH peers at `0.1.2-rc.1` (`dsh-llm`, `dsh-session`, `dsh-subprocess`, `dsh-timeout`, `dsh-attachment`, `dsh-invariants`, `dsh-sdk-protocol` and `dsh-util-values`). Its direct `dsh-sdk-protocol` dependency is the same version.

`0.1.2-rc.1` is the only supported DSH generation for this suite. Codex's executable evidence — 15-scenario live acceptance against real `codex-cli 0.150.0` processes — was gathered on the **alpha.1** baseline and has not been repeated on rc.1; on rc.1 the package carries its unit suite only.

## Validation status — THAWED, PENDING RE-VALIDATION

`nishi-dsh-codex` previously passed independent validation, focused test gates, and live acceptance against official `codex-cli 0.150.0`. A follow-up audit then changed this package: vendor diagnostics are sanitized through Core's `VendorFailure` contract, native-search runtime verification is cached per executable instead of run per query, an unsupported App Server version reports `UNAVAILABLE` rather than `ERROR`, the Windows batch shim covers `codex exec`, cleanup failure no longer replaces the real diagnostic, a thread-less fatal `error` notification fails the turn instead of hanging, and — later in the same stage — the vendor thread is resumed instead of forked every turn (see *Vendor threads and prompt caching* below).

That original acceptance therefore describes a tree this one no longer matches. On the current tree, focused tests pass (81/81), `pnpm verify:local` exits `0` on three consecutive runs, and Codex live acceptance passes — re-run in full on 2026-08-31 at 78 tests, so the context-block projection fix for issue #4 is covered by a live run rather than by focused tests alone: primary, the full 15-scenario suite, and both web-search suites (`test:live:web-search`, `test:live:web-search-routed`). The two web-search suites require `DSH_LIVE_CODEX_SEARCH_MODEL` to be set and fail a precondition assertion — not a product defect — without it.

A defect found by a delegation run the same day is fixed: a turn whose first step ran on another provider and emitted tool calls used to fail on the step that consumed those results here, with `codex-plugin-dsh: the current Codex turn has no user input`. Such a turn now continues from the tool results — see *Codex tool-result continuation* in `docs/ARCHITECTURE.md` — with focused tests plus `pnpm --filter nishi-dsh-codex test:live:tool-result-continuation`, a live probe that asserts the model actually received the tool result.

What is still missing is independent validation by a party that did not write the code, and a live acceptance re-run on the rc.1 baseline.

Accepted evidence and verification history live in `docs/verification/README.md` and `docs/verification/gemini/LATEST.md`.

## Context blocks Codex input cannot carry

DSH's durable history is provider-neutral, so a `user` or `system` message may quote any block a producer emitted. App Server input carries only text and images. Where the two disagree — a stopped subagent's settlement notice repeats the interrupted child's terminal output, `tool-call` blocks included — the block is **projected to text** (`[dsh: tool call read({"path":"/etc/hosts"})]`) on the transient request, in history replay, in a dynamic tool's result, and in context steered into a live turn. Durable DSH history is never rewritten.

Rejecting those blocks instead is what this replaced: it failed the active turn and, because no App Server checkpoint was then written, every later replay of that session as well. One case is lossy and deliberately so: an image nested inside a projected `tool-result` becomes a marker, because no input item is being emitted to attach its bytes to.

This landed after the live acceptance run described above and has focused-test coverage only.

## Vendor threads and prompt caching

An ordinary DSH turn **resumes** the vendor thread rather than forking a new one every turn. `thread/start` runs only for the first turn; after that, `thread/resume { threadId, ... }` gets the tip from its own response, and `thread/rollback` realigns it if DSH's history has diverged from that tip. `thread/fork { threadId, lastTurnId }` is kept only for a checkpoint that is neither the tip nor an ancestor of it. Only the delta since the checkpoint is sent either way — prior turns are not re-transmitted.

Two consequences were measured facts, not estimates, against real `codex-cli 0.150.0`, and are why this design was chosen over the original fork-every-turn one:

- forking got **no** prompt-cache credit at all, so every turn re-billed the whole accumulated context as fresh input. Resuming a single thread instead gets credit for roughly 90% of input;
- forking left one vendor thread per DSH message persisted in the user's own vendor account. Resuming leaves one vendor thread **per session** instead. DSH still cannot clean these up, and threads created under the old per-message design still exist in the user's vendor account exactly as they were — this change does not retroactively remove them, and the maintainer has decided that cleaning up previously created threads is not worth doing.

The repository `docs/ARCHITECTURE.md` records the numbers and the protocol facts under *Codex vendor threads*, and `docs/ROADMAP.md` §7a records the decision. `thread/inject_items` is **verified** to reach the model (`pnpm test:live:inject-items`): it succeeds while being invisible through both `thread/read` and `thread/resume`, so its effect was unknown for a long time, and the probe puts a value where injection is the only path to it before asserting that the model reports it back.

A prior response with no usable checkpoint no longer ends the session. The scan continues backwards to an older usable one, which keeps the vendor's prompt cache, and rebuilds the conversation into a fresh thread only when there is none; `PreparedCodexHistory.skippedCheckpoints` reports how many were passed over.
