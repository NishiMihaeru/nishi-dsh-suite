# Verification reports

This directory contains validation evidence, not the active roadmap.

Gemini reports under `docs/verification/gemini/` record a specific tested commit, environment, commands, targeted review and PASS/FAIL verdict. They are intentionally kept after later fixes so the sequence of failures and corrections remains auditable.

Do not infer current implementation state by reading an old report in isolation. Use:

- `docs/HANDOFF.md` for current state;
- `docs/ROADMAP.md` for remaining work;
- `docs/superpowers/plans/2026-08-27-core-and-provider-plugins.md` for execution order.

Current final provider-independent reports:

```text
docs/verification/gemini/core-14-final-acceptance.md
docs/verification/gemini/project-memory-02-final-acceptance.md
```

Core and Project Memory are DONE / FROZEN after those PASS results.

A report may legitimately contain an earlier FAIL that was later superseded. Do not edit historical report text to make it appear that the failure never happened.
