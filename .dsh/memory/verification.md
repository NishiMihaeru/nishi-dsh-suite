# Verification documentation digest

Sources covered:
- `docs/verification/README.md`
- `docs/verification/agy-cli-contract.md`
- `docs/verification/claude-code-cli-contract.md`
- `docs/verification/grok-cli-contract.md`
- `docs/verification/gemini/LATEST.md`
- `docs/verification/rc3-review.md`

## Evidence discipline
- `docs/verification/README.md` is the compact durable ledger. Evidence is checkpoint-, DSH-baseline-, and vendor-build-specific; a changed tree or baseline invalidates a prior freeze/PASS claim.
- Foundation and Codex remain thawed pending independent re-validation even where local and live gates are green.
- The workspace moved to DSH `0.1.2-rc.1`; local workspace gates were rerun, but alpha.1-era live vendor/product-profile evidence must not be promoted to the rc.1 tree.
- Product claims are evidenced from durable session logs, request route headers, observed vendor processes, and planted markers—not from a model's narrative.
- Delegation recursion remains capped at depth 1. Exact provider/model permission is a user authorization and must not be inferred from the live catalog.
- Live suites consume real vendor quota and require confirmation before bulk runs.

## Antigravity / `agy` contract
- `docs/verification/agy-cli-contract.md` separates published contract, source observation, and measured behavior. Vendor self-update triggers rereading/reprobing the relevant behavioral rows and rerunning live suites.
- The shipping route depends on published stream-json, per-turn JSON schema, model catalog, native search, and `/usage`, plus explicitly recorded measured behavior.
- Forced JSON schema is parsed from a model-appended block rather than guaranteed constrained decoding. Every decision is turn-stamped; stale/missing output receives at most one repair restatement on the same live conversation.
- `agy -p "/usage" --output-format json` is a published, turn-free, zero-token quota channel. It replaced private loopback RPC, `/proc` scanning, socket matching, CSRF extraction, and that trust boundary.
- The MCP bridge was removed; its live suites and probes remain historical evidence only, not coverage of shipping behavior.
- Result statuses are typed as success, cancellation, unsettled protocol, or failure. Non-success abandons the live conversation; failure diagnostics record a sanitized vendor build when available.

## Grok CLI contract
- `docs/verification/grok-cli-contract.md` was written before implementation from bundled vendor docs, CLI help, public docs, terms, and targeted probes; `packages/grok` was built on it.
- The critical isolation trap is measured: `--tools ""` silently leaves the full native toolset, including shell/file tools. Shipping isolation uses one real tool name in both `--tools` and `--disallowed-tools`, plus MCP denial; unit and live-primary tests pin this exact shape.
- One short-lived process per DSH step is correct because cross-process `--resume` retains prefix cache and usage is per invocation rather than cumulative.
- The envelope travels through `--prompt-file` to avoid Linux argv `E2BIG`; DSH system text is inside the envelope. The decision schema pins tool names but intentionally leaves arguments untyped after a full per-tool schema failed in a real session.
- ACP `initialize` exposes the model catalog, context windows, and reasoning efforts without a session/turn. This shape is undocumented and pinned by a recorded-handshake test.
- ACP `_x.ai/billing` is the machine-readable usage channel. TUI `/usage` is not usable headlessly.
- Routed native web search is a separate headless process with a search-only allowlist and a Messages stream, pinned to `grok-4.5`/low.
- Vendor session residue is expected in `~/.grok/sessions`; there is no documented suppression flag.
- Published terms allow the direct official-client route but leave release policy actions: the current package name conflicts with the vendor brand guideline, and the competing-products clause requires a maintainer decision. Do not use Grok Build output to author this provider while that decision is open.
- Live-primary evidence is 4/4 against recorded `grok 1.0.13`; product-profile acceptance remains open.

## Claude CLI contract and terms
- `docs/verification/claude-code-cli-contract.md` is pre-implementation research for a possible primary route; nothing described there currently ships.
- A future route should be thin and stepped: one completed vendor turn per DSH step, structured output, vendor tools disabled, DSH-owned loop, and no vendor session persistence when possible.
- Repository isolation must be argv-expressed: user-only setting sources, strict MCP config, empty vendor tools, explicit system prompt file. Hostile project hooks/config/instructions otherwise load without a trust prompt.
- Never pass `--bare`; it breaks subscription authentication. Disable vendor auto-compaction and fail/rebuild on compact-boundary events. Subtract cumulative usage/cost between turns.
- Claude remains usage-only for rc.3. Publication still needs maintainer/legal action, including the shared provider package naming/branding decision.

## Whole-tree and maintainability review
- `docs/verification/gemini/LATEST.md` is one rolling raw report. Two models reviewed four areas independently; their disagreement exposed defects a green suite missed.
- Sixteen findings were dispositioned: fifteen confirmed/fixed, one rejected after checking the upstream contract, and one referred to the maintainer and decided. This is adversarial review, not fully independent acceptance, because the author supplied the charters and interpreted findings.
- `docs/verification/rc3-review.md` preserves quality/maintainability findings and subsequent bugfix history. Prefer code judo—delete an unnecessary category or surface—over merely relocating complexity. Refactors need concrete invariant/API value and their own validation.

## Standing constraints
- A green deterministic gate is necessary but insufficient for freeze.
- No old PASS may be promoted to a modified implementation or different DSH/vendor baseline.
- No verification artifact may contain credentials, raw vendor auth/session state, current quota snapshots, raw chain-of-thought, or unnecessary personal host details.
- Windows remains NOT TESTED.