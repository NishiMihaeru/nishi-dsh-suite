# Usage Limits migration acceptance

Status: **STATIC_COMPLETE / EXECUTION_PENDING**

## Public packages

- `nishi-dsh-usage-limits@0.1.0-rc.1`
- `nishi-dsh-usage-limits-host@0.1.0-rc.1`
- `nishi-dsh-codex-usage-source@0.1.0-rc.1`

All packages target the DeepSeek Harness `0.1.1-rc.2` compatibility train.

## Preserved boundaries

- provider-neutral normalized usage DTOs live in `nishi-dsh-usage-limits`;
- public browser projection excludes internal collector/source metadata;
- collector/source failures collapse into bounded public statuses rather than leaking raw provider errors;
- Codex rate limits use the package-local official `@openai/codex@0.147.0` app-server protocol;
- Claude usage continues through the official Claude Code package usage seam;
- Antigravity numeric usage is attach-only, loopback-only, read-only local observation;
- Model Accounts does not initiate ChatGPT/Claude subscription OAuth through DSH;
- vendor credentials, token databases, cookies, and OAuth payloads are not copied into browser DTOs;
- legacy DSH grants may be detected and explicitly removed, but are not reused as the supported vendor-auth path.

## Browser surfaces

The host package owns both accepted rc.2 browser surfaces:

- `sidebar.footer.action` / `settings.section` for Usage & Limits;
- `settings.section` for Model Accounts.

The browser module identity is `nishi-dsh-usage-limits-host`; the migrated build boundary does not intentionally depend on the private `@dsh-plugin/*` package family.

## Verification status

Static package/runtime/UI composition is present on `feat/market-migration`.

Executable verification remains pending because GitHub-hosted Actions are blocked by the account billing lock and the workspace lockfile still needs regeneration before a frozen install gate can be trusted.

Required execution gate after runner/local access is restored:

```text
pnpm install
pnpm --filter nishi-dsh-usage-limits check
pnpm --filter nishi-dsh-usage-limits test
pnpm --filter nishi-dsh-usage-limits-host check
pnpm --filter nishi-dsh-usage-limits-host test
pnpm --filter nishi-dsh-usage-limits-host build
pnpm --filter nishi-dsh-codex-usage-source check
pnpm --filter nishi-dsh-codex-usage-source test
pnpm --filter nishi-dsh-codex-usage-source build
```

Do not treat this document as evidence that those commands have already passed.
