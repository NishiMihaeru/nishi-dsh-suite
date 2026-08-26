# Project Memory Runtime Acceptance

Status: implementation present; executable verification blocked externally.

The public package is `nishi-dsh-project-memory@0.1.0-rc.1` under `packages/project-memory`.

Product boundary:

- memory is project-scoped under `DSH.md` and `.dsh/memory/`;
- `.dsh/local/` remains transient local state;
- no cross-OS/cross-machine synchronization, reconciliation, or migration is implemented;
- provider integrations consume the read-only `projectMemory` service rather than owning filesystem paths;
- uninstall/update acceptance must preserve project files and `.dsh/memory/`.

Verification gate still required before release:

```text
pnpm install
pnpm check
pnpm test
pnpm build
```

GitHub Actions cannot currently start because of the account billing lock. Do not interpret this document as evidence that those commands pass.
