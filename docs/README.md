# Documentation map

This directory has one rule: **current state lives in a small set of files that are updated in place**. Old plans, session summaries, acceptance notes and validation reports belong in git history, not beside current instructions.

## Read order for a development session

1. `HANDOFF.md` — exact current state, immediate task, workflow and hard constraints.
2. `ROADMAP.md` — ordered remaining work and completed/pending areas.
3. `ARCHITECTURE.md` — current provider/core/memory contract implemented by the code.
4. Target package `README.md`, source and tests.
5. `RELEASE.md` only when the task touches packaging, live acceptance, Market or publication.
6. `verification/README.md` only when checking evidence already accepted for an exact earlier checkpoint.

The repository root `README.md` is product/user documentation, not an implementation plan.

## Canonical documents

| File | Owns | Must not own |
|---|---|---|
| `ARCHITECTURE.md` | current technical contract and invariants | task diary |
| `ROADMAP.md` | task order/status and deferred work | implementation diary |
| `HANDOFF.md` | immediate task, branch/state, agent workflow, operational traps | long history |
| `RELEASE.md` | current rc.3 release/Market state and release gates | development task details |
| `verification/README.md` | compact accepted validation ledger | active roadmap |
| `verification/gemini/LATEST.md` | one rolling local Gemini validation report | historical archive |

If canonical documents disagree, treat that as a documentation bug and fix the disagreement before continuing development.

## Rules for agents

- Do not create a new plan/spec/session-summary/handoff file for ordinary work.
- Update `ROADMAP.md`, `HANDOFF.md` or `ARCHITECTURE.md` in place when their facts change.
- Do not create dated Gemini report files. Gemini overwrites `docs/verification/gemini/LATEST.md`.
- After a new PASS is accepted, fold durable evidence into `verification/README.md`; `LATEST.md` remains only the most recent raw validation.
- Historical PASS evidence validates only the exact implementation checkpoint it was produced against.
- Use git history when old detail is genuinely needed.
- Package README files describe only their package's current public/runtime boundary.
- Source comments describe only active code; historical reasoning belongs in git history unless it explains a still-relevant invariant.

## Change discipline

For code changes:

1. read current `HANDOFF.md` and `ROADMAP.md`;
2. fetch the current target file/commit before editing;
3. make one logically complete change;
4. add/adjust deterministic regression coverage for the concrete failure;
5. validate on the current tree;
6. update canonical docs when behavior/status changes;
7. do not promote an old PASS to the changed tree.

## Compatibility discipline

- Official `dsh-v0.1.2-alpha.1` at `cd5ef8148158c3a752a658978873241fdf8e2bbc` is the source/runtime truth for the current independent Foundation audit and remediation.
- Core and Project Memory still publish the exact peer union `0.1.1-rc.2 || 0.1.2-alpha.1`, but their local devDependency graph remains rc.2. Normal local tests on that graph are therefore not alpha.1 compatibility evidence by themselves.
- Core and Project Memory are currently **REOPENED / PENDING VERIFICATION** after new concrete defects were found and fixed. They must not be called frozen again until the changed head passes the new local/Gemini and disposable official alpha.1 gates.
- Provider packages do not inherit Foundation compatibility automatically.
- Actual upstream source/runtime contracts at the exact tested tag/commit take priority over documentation when they disagree.

## Hard project constraints

- Development baseline: Node `24.19.0`, pnpm `11.21.0`.
- GitHub Actions/hosted CI are not used for this work. Do not inspect or edit `.github/workflows/*`.
- No publish, merge, tag or release without explicit maintainer approval.
- Vendor credential/session/token stores remain outside Suite ownership.
- Windows remains **NOT TESTED** until a dedicated acceptance run says otherwise.
