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

## Supported DSH generation

The only supported DSH generation is:

```text
dsh-v0.1.2-alpha.1
cd5ef8148158c3a752a658978873241fdf8e2bbc
```

`0.1.1-rc.2` and every earlier DSH generation are **not supported**. They carry no compatibility claim, receive no fixes, and no new evidence will be produced against them. A defect reproduced only on an unsupported generation is not a defect of this suite.

This is a support-policy statement about which DSH generation the suite targets. It is not a claim that the tree already matches it. The following gaps are known, deliberate, and each must be closed by its own gated change, not by editing this document:

- Core and Project Memory still declare the peer union `0.1.1-rc.2 || 0.1.2-alpha.1`; provider packages still declare provider-specific peers at `0.1.1-rc.2` alone. Narrowing either is a published-contract change and needs its own validation.
- `0.1.2-alpha.1` is not published to npm. The newest published DSH is `0.1.1-rc.2` (dist-tag `next`), so alpha.1 is reachable only as the upstream commit above. Until upstream publishes it, an alpha.1-only peer range would be uninstallable from the registry.
- The local devDependency and test baseline **has moved to alpha.1** and no longer matches the declared peer range. Core and Project Memory develop and test against `0.1.2-alpha.1`, resolved from the local upstream checkout through `pnpm-workspace.yaml` overrides — see *Bootstrap* below. Two packages stay pinned at rc.2 because they were retired before alpha.1 and exist nowhere else: `@deepseek-ai/dsh-client-runtime` and `@deepseek-ai/dsh-host-apiproxy`. Provider packages keep rc.2 peers and are not part of that move.
- The rc2/alpha `Function.length` Connection compatibility shim in Core is now removal debt rather than retained compatibility. It stays until the peer range that justifies it is narrowed.

Provider packages do **not** inherit Foundation compatibility automatically. Alpha.1 support for Core and Project Memory rests on the disposable exact-commit probe recorded in `verification/README.md`; no provider package has ever been probed against alpha.1.

## Bootstrap

`pnpm install` does not work from a clean clone on its own. The Foundation dev graph resolves `@deepseek-ai/dsh-*` through `pnpm-workspace.yaml` overrides that point into a local checkout of upstream DSH:

```text
.artifacts/upstream/dsh-alpha1
dsh-v0.1.2-alpha.1
cd5ef8148158c3a752a658978873241fdf8e2bbc
```

`.artifacts/` is git-ignored, so that checkout is **not** part of the repository. Before the first install:

1. clone upstream DSH into `.artifacts/upstream/dsh-alpha1` and check out exactly `cd5ef8148158c3a752a658978873241fdf8e2bbc`;
2. install and build it, so each package has its `lib/` output — the overrides link built packages, not sources;
3. only then run `pnpm install` in this repository.

Without step 1 the install fails on unresolvable link targets. This is the deliberate cost of developing against a generation upstream has not published to npm: the dev graph is reproducible only against that exact commit, not from the registry. It also applies to the release gate — `pnpm install --frozen-lockfile` has the same prerequisite.

When upstream publishes `0.1.2-alpha.1`, the overrides and this section should be replaced by ordinary registry versions. That is tracked in `ROADMAP.md` §7b together with narrowing the declared peer range.

## Compatibility discipline

Last Foundation acceptance, now superseded by a follow-up audit and its remediation:

```text
superseded implementation: 7cd4d5b17625f9b3a21b741555df6597fd9cb889
raw PASS report commit:    d1cbac7094488ded52d9ab83891531bc01197090
Core: THAWED, pending re-validation
Project Memory: THAWED, pending re-validation
Codex: THAWED, pending re-validation
```

That evidence describes a tree this one no longer matches. Do not cite it for the current implementation; see `HANDOFF.md` for what changed and `verification/README.md` for the durable ledger.

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
