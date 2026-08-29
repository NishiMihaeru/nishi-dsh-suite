# nishi-dsh-antigravity

Antigravity primary-provider plugin for Nishi DSH Suite, backed by the user's installed official `agy` CLI.

## Declared capabilities

- canonical provider id: `antigravity`;
- primary model route: `antigravity-cli`;
- native web-search backend: `agy search_web`;
- local usage visibility, with numeric quota remaining unsupported when no official machine-readable quota is available.

The distinction between provider id and route is intentional: `antigravity` is the provider identity, while `antigravity-cli` is the DSH model route retained for saved-session compatibility.

Vendor-specific delegation was removed in `0.1.0-rc.3`. Project Memory remains on the normal DSH primary plane and this package does not own or prefix its own memory implementation.

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

The current Antigravity manifest declares its provider-specific DSH peers at `0.1.1-rc.2` (`dsh-invariants`, `dsh-llm`, `dsh-session`, `dsh-subprocess`, `dsh-timeout`).

The Foundation's accepted `0.1.2-alpha.1` compatibility does **not** automatically validate this provider package. Antigravity compatibility must be established independently when its provider stage begins, and dependency/peer changes should be made only for generations proven by that audit and executable validation.

## Validation status — PENDING PROVIDER STAGE

Core and Project Memory are frozen. Antigravity is not frozen for rc.3; its provider-specific audit/cleanup and live acceptance follow the active Codex stage.

Historical tests or live probes remain checkpoint-specific evidence only. The authoritative remaining work is maintained in `docs/ROADMAP.md` and the current operational task in `docs/HANDOFF.md`; this README intentionally describes the package boundary rather than duplicating that checklist.