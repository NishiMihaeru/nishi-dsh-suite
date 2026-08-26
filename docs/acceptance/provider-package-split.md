# Provider Package Split Verification Status

Date: 2026-08-26
Branch: `feat/provider-package-split-exec`

## Structural evidence collected through GitHub

- Head inspected: `7123f135ceaed2a28859d353bb778859401e595a`.
- Recursive tree contains these independent package roots:
  - `packages/codex`
  - `packages/antigravity`
  - `packages/claude-code`
  - `packages/primary-web-search`
- Recursive-tree search returned no `packages/codex-antigravity` path.
- Compare from pre-split commit `8485d78f6ffa45d451892a24bae8b2f7bdc2c0d8` to `7123f135ceaed2a28859d353bb778859401e595a` reports the transitional package removed and provider-owned files redistributed.
- `packages/codex/src/index.ts` registers Codex only and contains no Antigravity imports/registration.
- `packages/antigravity/package.json` contains no `@openai/codex` or `@openai/codex-sdk` dependency.
- `packages/primary-web-search/src/providers.ts` imports only the provider backend seams `nishi-dsh-codex/web-search-backend` and `nishi-dsh-antigravity/web-search-backend` and retains fail-closed provider routing.
- `packages/claude-code/package.json` pins `@anthropic-ai/claude-agent-sdk` to `0.3.220` and uses package identity `nishi-dsh-claude-code@0.1.0-rc.1`.

## Executable gates

Status: `BLOCKED_BILLING / LOCKFILE_PENDING`

The following commands have **not** been run successfully in this migration branch and therefore are not recorded as PASS:

```text
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
```

Reasons:

1. GitHub-hosted Actions jobs cannot currently start because the account is locked for a billing issue.
2. `pnpm-lock.yaml` is still the bootstrap lockfile with only the root importer, so it must be regenerated after the migrated workspace package manifests are present before a frozen install can be a valid deterministic gate.

No build/test success claim should be made until fresh command output exists.
