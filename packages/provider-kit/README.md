# nishi-dsh-provider-kit

Shared vendor-CLI runtime consumed by Nishi DSH Suite subscription-provider packages (Codex, Antigravity, Claude, and future providers). A library, not a Cordis plugin — provider packages import it directly.

It exists because process lifecycle, stream decoding, and workspace provisioning were the same code written three or more times across `codex`, `codex-usage-source`, `claude-usage-source`, and `antigravity`. This package is that code, written once.

## What it provides

- `resolveVendorExecutable(descriptor, options)` — the single executable resolver. Precedence: an explicit config value, then the provider's `envOverride` environment variable, then a `PATH` walk. Fails closed with a diagnostic that names the provider; never silently falls back past an invalid explicit value.
- `outputLines(stream, maxBytes)` — bounded newline-delimited decoding of a Node `Readable`. CRLF-tolerant, rejects a line (or unterminated remainder) larger than `maxBytes` instead of buffering without limit, and yields any trailing partial line once the stream ends.
- `disposeVendorChild(handle)` — terminate the managed subprocess tree, wait for exit, and await settlement. Handles the `pid <= 0` (spawn-failed) case and best-effort stdin closure before escalating.
- `settledStderr(handle, graceMs)` — vendor CLIs commonly write their explanation to stderr *after* the terminal protocol frame, so reading stderr the instant that frame arrives sees an empty buffer. Waits up to `graceMs` for the process to settle, then reads the collected stderr tail.
- `ephemeralAgentWorkspace(spec)` — creates the temporary `<tmp>/.agents/agents/<name>/agent.md` tree (plus any additional root-relative files a provider needs, such as a JSON schema) as one unit, and returns a `dispose()` that removes it. Cleanup runs even when workspace creation itself fails partway through.
- `vendorFailure(spec)` / `recognizeVendorStderr(text, recognizers)` — one error shape with a `product`/`stage`/`category` diagnostic. Raw vendor stderr is never forwarded into a message: only conditions a caller has explicitly recognized (via a regular expression) become part of the diagnostic, so local paths and vendor output cannot leak into error text or DTOs.

## Non-goals

This package does not talk to any specific vendor protocol, does not know about `ctx.llm` / `ctx.subagents` / usage normalization, and does not make delegated vendor subagents interchangeable with one another. It is transport and lifecycle plumbing only; providers still own their own protocol translation.

See `docs/superpowers/specs/provider-bridge-design.md` in the repository root for the design this package implements ("The kit" section).
