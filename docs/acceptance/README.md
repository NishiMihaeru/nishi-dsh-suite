# Acceptance evidence index

Files in this directory are historical evidence snapshots: they describe what was tested at the date/version named in each file. Older records may mention retired packages, vendor-specific subagents or rc.1/rc.2 architecture because those were real at the time.

Do not rewrite historical acceptance records merely to make their wording match current rc.3 code.

## Current rc.3 state

Core and Project Memory stabilization evidence is under:

```text
docs/verification/gemini/core-14-final-acceptance.md
docs/verification/gemini/project-memory-02-final-acceptance.md
```

Both packages are DONE / FROZEN.

The final provider/product rc.3 live acceptance record has not yet been written. It must still cover Codex primary/search/vendor-memory suppression, Antigravity primary/model switch/search, Codex -> Antigravity switching with project-memory continuity, live dynamic Usage & Limits roster behavior, and final profile/preset lifecycle.

When that run is completed, add a new dated rc.3 acceptance file rather than rewriting older evidence.

Current planning sources:

- `docs/HANDOFF.md`
- `docs/ROADMAP.md`
- `docs/release/2026-08-28-rc3-prerelease.md`
