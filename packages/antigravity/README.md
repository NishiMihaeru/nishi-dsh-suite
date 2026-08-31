# nishi-dsh-antigravity

Antigravity primary-provider plugin for Nishi DSH Suite, backed by the user's installed official `agy` CLI.

## Declared capabilities

- canonical provider id: `antigravity`;
- primary model route: `antigravity-cli`;
- native web-search backend: `agy search_web`;
- local usage visibility, with numeric quota remaining unsupported when no official machine-readable quota is available.

The distinction between provider id and route is intentional: `antigravity` is the provider identity, while `antigravity-cli` is the DSH model route retained for saved-session compatibility.

Vendor-specific delegation was removed in `0.1.0-rc.3`. Project Memory remains on the normal DSH primary plane and this package does not own or prefix its own memory implementation.

### Model catalog and reasoning efforts

The vendor names effort tiers inside the model id — `gemini-3.7-flash-low`, `-medium`, `-high`. This package presents such a family as one model, `gemini-3.7-flash`, advertising `low`/`medium`/`high` as reasoning efforts, and keeps the suffixed ids as aliases so saved sessions and existing configuration keep resolving. A model with only one suffixed variant is left as the vendor named it and advertises no efforts.

An invocation maps back to `--model <base> --effort <level>`; an effort in the request wins over the one an alias implies. A base id resolved without an explicit effort reports `high` as its default, which is a deliberate choice of the strongest tier rather than a vendor-stated default — name an effort on the route to get another. `docs/ARCHITECTURE.md` carries the reasoning and the allowlist consequence.

## Runtime boundary

The package owns Antigravity-specific protocol translation and process behavior. Shared registration, executable/runtime helpers, routed web-search dispatch and Usage & Limits projection live in `nishi-dsh-core`.

The package:

- uses the installed official `agy` executable rather than installing/managing it;
- does not copy Google/Antigravity credentials;
- never passes `--dangerously-skip-permissions`;
- does not register the model-facing `web_search` tool itself, only its native backend;
- does not bundle OpenAI/Anthropic vendor SDK runtimes.

Antigravity provider-policy status remains technically supported by the integration but policy-ambiguous; this package does not claim Google approval or Terms compliance.

## Core boundary

Provider registration goes through shared `registerProvider()`. Provider-neutral failure/runtime helpers and search routing belong to Core; vendor-specific `agy` request/response parsing and process semantics remain here.

Project Memory and DSH-native child-agent delegation are external to this provider package, so switching to or from `antigravity-cli` does not create a second memory/delegation plane.

## Current DSH declaration

The Antigravity manifest declares its provider-specific DSH peers at `0.1.2-alpha.1` (`dsh-invariants`, `dsh-llm`, `dsh-session`, `dsh-subprocess`, `dsh-timeout`).

`0.1.2-alpha.1` is the only supported DSH generation for this suite. Antigravity's own evidence for it is executable, not inherited: 73 unit tests plus 10 live scenarios (8 primary, 1 native search, 1 routed search) against the real `agy 1.1.22` binary, both on the alpha.1 baseline.

## Validation status — PENDING PROVIDER STAGE

Core and Project Memory are **THAWED, pending re-validation** (see `docs/HANDOFF.md`), not frozen. Antigravity is not frozen for rc.3 either, but its own provider-specific audit/cleanup and live acceptance are complete rather than queued behind Codex: catalog parsing was rewritten, every vendor-process diagnostic routes through `VendorFailure`, intra-package duplication was removed, and live acceptance passes (primary 8/8, native search 1/1, routed search 1/1). The only outstanding item is the freeze declaration itself (`docs/ROADMAP.md` §3), which needs the same independent validation the rest of the tree is waiting on.

Historical tests or live probes remain checkpoint-specific evidence only. The authoritative remaining work is maintained in `docs/ROADMAP.md` and the current operational task in `docs/HANDOFF.md`; this README intentionally describes the package boundary rather than duplicating that checklist.