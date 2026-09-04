# Project documentation index

This index covers the 30 project documentation files currently selected by the repository documentation glob. `.dsh/memory/MEMORY.md` is excluded because it is the generated bootstrap/map. Source files remain canonical; memory topics are durable digests unless explicitly marked as mirrors.

## Root documentation
1. `DSH.md` — mirrored in `doc-project-contract`; workflow/delegation additions also live in `delegation-policy`.
2. `README.md` — mirrored in `doc-root-readme`; current architectural/product digest in `architecture`.
3. `SECURITY.md` — mirrored in `doc-security-policy`; durable constraints repeated in `architecture` and `workflow-and-release`.
4. `THIRD_PARTY_NOTICES.md` — mirrored in `doc-root-third-party-notices`; package/license digest in `packages`.

## Canonical and supporting docs
5. `docs/ARCHITECTURE.md` — `architecture`.
6. `docs/HANDOFF.md` — `workflow-and-release`.
7. `docs/README.md` — `workflow-and-release`.
8. `docs/RELEASE.md` — `workflow-and-release`.
9. `docs/ROADMAP.md` — `workflow-and-release`.
10. `docs/prior-art.md` — `workflow-and-release`.

## Verification docs
11. `docs/verification/README.md` — `verification`.
12. `docs/verification/agy-cli-contract.md` — `verification`.
13. `docs/verification/claude-code-cli-contract.md` — `verification`.
14. `docs/verification/grok-cli-contract.md` — `verification`.
15. `docs/verification/gemini/LATEST.md` — `verification`.
16. `docs/verification/rc3-review.md` — `verification`.

## Package docs
17. `packages/antigravity/README.md` — `packages`, with transport/session behavior in `architecture` and evidence in `verification`.
18. `packages/antigravity/THIRD_PARTY_NOTICES.md` — `packages`.
19. `packages/claude/README.md` — `packages`, with future-route findings in `verification`.
20. `packages/claude/THIRD_PARTY_NOTICES.md` — `packages`.
21. `packages/codex/README.md` — `packages`, with thread/stepped-turn invariants in `architecture`.
22. `packages/codex/THIRD_PARTY_NOTICES.md` — `packages`.
23. `packages/core/README.md` — `packages`, with registry/usage/search invariants in `architecture`.
24. `packages/core/THIRD_PARTY_NOTICES.md` — `packages`.
25. `packages/grok/README.md` — `packages`, with route/isolation/search behavior in `architecture` and vendor evidence in `verification`.
26. `packages/grok/THIRD_PARTY_NOTICES.md` — `packages`.
27. `packages/project-memory/README.md` — `packages`, with storage/transaction invariants in `architecture`.
28. `packages/project-memory/THIRD_PARTY_NOTICES.md` — `packages`.
29. `packages/suite/README.md` — `packages`, with composition/delegation behavior in `architecture`.
30. `packages/suite/THIRD_PARTY_NOTICES.md` — `packages`.

## Topic guide
- `architecture` — product/package boundaries, four provider routes, Project Memory, and cross-provider runtime invariants.
- `workflow-and-release` — canonical read order, current state, immediate priorities, release gates, hard constraints, known documentation drift, and durable operational lessons.
- `packages` — all seven package READMEs and all seven package notices.
- `verification` — evidence discipline, three vendor contracts, adversarial review, and maintainability review.
- `delegation-policy` — no nested delegation; explicitly select only currently allowed provider/model/effort routes.
- `doc-project-contract`, `doc-root-readme`, `doc-security-policy`, `doc-root-third-party-notices` — direct root-document mirrors.

## Maintenance rule
When a canonical document changes, update its owning digest topic in the same logical change or treat the mismatch as a documentation-memory bug. When canonical sources conflict, preserve the conflict explicitly and prefer the newest/current architecture and verification evidence rather than silently merging incompatible claims. Do not copy secrets, credential material, current quota snapshots, raw chain-of-thought, transient command logs, or personal operator facts into memory.