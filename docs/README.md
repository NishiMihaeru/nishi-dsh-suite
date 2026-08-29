# Documentation map

This directory keeps current state in a small set of files updated in place. Old plans, session summaries, acceptance notes and raw validation reports belong in git history, not beside current instructions.

## Read order for a development session

1. `HANDOFF.md` — exact current state, immediate task, workflow and hard constraints.
2. `ROADMAP.md` — ordered remaining work and completed/pending areas.
3. `ARCHITECTURE.md` — current provider/Core/Project Memory contract implemented by the code.
4. Target package `README.md`, source and tests.
5. `RELEASE.md` when the task touches packaging, live acceptance, Market or publication.
6. `verification/README.md` when checking accepted evidence for an exact checkpoint.

The repository root `README.md` is product/user documentation, not an implementation plan.

## Canonical documents

| File | Owns |
|---|---|
| `ARCHITECTURE.md` | current technical contract and invariants |
| `ROADMAP.md` | task order/status and deferred work |
| `HANDOFF.md` | immediate task, branch/state and operational constraints |
| `RELEASE.md` | current rc.3 release/Market state and release gates |
| `verification/README.md` | compact durable accepted validation ledger |
| `verification/gemini/LATEST.md` | one rolling raw Gemini validation report |

If canonical documents disagree, treat that as a documentation bug and fix the disagreement before continuing development.

## Rules for agents

- Do not create ordinary dated plan/spec/session-summary/handoff files.
- Update `ROADMAP.md`, `HANDOFF.md` or `ARCHITECTURE.md` in place when their facts change.
- Gemini overwrites `docs/verification/gemini/LATEST.md`; do not create dated Gemini report files.
- After an accepted PASS, fold durable evidence into `verification/README.md`.
- Historical PASS evidence validates only the exact implementation checkpoint it was produced against.
- Package README files describe only their package's current public/runtime boundary.
- Use git history when superseded detail is genuinely needed.

## Compatibility discipline

Official DSH compatibility truth for the accepted Foundation is:

```text
dsh-v0.1.2-alpha.1
cd5ef8148158c3a752a658978873241fdf8e2bbc
```

Core and Project Memory publish:

```text
0.1.1-rc.2 || 0.1.2-alpha.1
```

Their normal local devDependency graph remains rc.2, so alpha.1 support is accepted only because the changed Foundation was also exercised in a disposable environment against the exact official alpha.1 commit.

Current Foundation acceptance:

```text
accepted implementation: 7cd4d5b17625f9b3a21b741555df6597fd9cb889
raw PASS report commit: d1cbac7094488ded52d9ab83891531bc01197090
Core: FROZEN
Project Memory: FROZEN
```

The report commit changes only `docs/verification/gemini/LATEST.md`; it does not alter the tested implementation.

Provider packages do **not** inherit Foundation compatibility automatically. Codex is now the next active provider-specific stage.

## Change discipline

For code changes:

1. read current `HANDOFF.md` and `ROADMAP.md`;
2. fetch the current target file/commit before editing;
3. make one logically complete change;
4. add/adjust deterministic regression coverage for a concrete failure;
5. validate the changed current tree;
6. update canonical docs when behavior/status changes;
7. never promote an old PASS to a changed implementation tree.

## Hard project constraints

- Development baseline: Node `24.19.0`, pnpm `11.21.0`.
- GitHub Actions/hosted CI are not used for this work. Do not inspect or edit `.github/workflows/*`.
- No publish, merge, tag or release without explicit maintainer approval.
- Vendor credential/session/token stores remain outside Suite ownership.
- Windows remains **NOT TESTED** until a dedicated acceptance run says otherwise.
