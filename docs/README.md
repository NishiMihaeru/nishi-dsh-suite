# Documentation map

This directory has one rule: **current state lives in a small set of files that are updated in place**. Old plans, session summaries, acceptance notes and validation reports belong in git history, not beside current instructions.

## Read order for a new development session

1. `HANDOFF.md` — exact current state, next package/task, workflow and hard constraints.
2. `ROADMAP.md` — ordered remaining work and frozen/completed areas.
3. `ARCHITECTURE.md` — current provider/core/memory contract implemented by the code.
4. Target package `README.md`, source and tests.
5. `RELEASE.md` only when the task touches packaging, live acceptance, Market or publication.
6. `verification/README.md` only when checking what has already been validated.

The repository root `README.md` is product/user documentation, not an implementation plan.

## Canonical documents

| File | Owns | Must not own |
|---|---|---|
| `ARCHITECTURE.md` | current technical contract and invariants | task status, session notes |
| `ROADMAP.md` | completed/frozen areas, ordered remaining work, deferred work | implementation diary |
| `HANDOFF.md` | immediate next task, current branch/state, agent workflow, operational traps | long history |
| `RELEASE.md` | current rc.3 release/Market state and release gates | development task details |
| `verification/README.md` | compact validation ledger and validation rules | active roadmap |
| `verification/gemini/LATEST.md` | one rolling local Gemini validation report | historical report archive |

If two canonical documents disagree, treat that as a documentation bug and fix the disagreement before continuing development.

## Rules for agents

- Do not create a new plan/spec/session-summary/handoff file for ordinary work.
- Update `ROADMAP.md`, `HANDOFF.md` or `ARCHITECTURE.md` in place when their facts change.
- Do not create dated Gemini report files. Gemini overwrites `docs/verification/gemini/LATEST.md`.
- After a PASS, fold the durable result into `verification/README.md`; `LATEST.md` remains the most recent raw validation only.
- Use git history when old detail is genuinely needed: `git log -- <path>` and `git show <commit>:<path>`.
- Historical package names, old failures and superseded designs do not need permanent files in the current tree.
- Package README files describe only their package's current public/runtime boundary.
- Source comments describe only active code. Historical reasoning belongs in commit history unless it explains a still-relevant invariant.

## Change discipline

For code changes:

1. read current `HANDOFF.md` and `ROADMAP.md`;
2. fetch the current target file/commit before editing;
3. make one narrow change;
4. validate locally;
5. update the existing canonical docs only if behavior/status changed;
6. never duplicate the same fact into several documents unless each file genuinely needs it.

For documentation changes, prefer links to a canonical owner over copying paragraphs between files.

## Compatibility discipline

- Local development/validation baseline remains DSH `0.1.1-rc.2`.
- Official `dsh-v0.1.2-alpha.1` at `cd5ef8148158c3a752a658978873241fdf8e2bbc` is the compatibility source target currently used by rc.3 work.
- Core and Project Memory are frozen with exact production peer support for `0.1.1-rc.2 || 0.1.2-alpha.1`.
- Provider packages do **not** inherit that support automatically. Codex, Antigravity and Claude must each prove their own DSH compatibility before their dependency/peer ranges change.
- For compatibility decisions, actual upstream source/runtime contracts at the exact tested tag/commit take priority over documentation when they disagree.

## Hard project constraints

- Development baseline: Node `24.19.0`, pnpm `11.21.0`, DSH `0.1.1-rc.2`.
- GitHub Actions/hosted CI are not used for this work. Do not inspect or edit `.github/workflows/*`.
- No publish, merge, tag or release without explicit maintainer approval.
- Vendor credential/session/token stores remain outside Suite ownership.
- Windows remains **NOT TESTED** until a dedicated acceptance run says otherwise.
