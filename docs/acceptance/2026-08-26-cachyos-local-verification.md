# CachyOS local deterministic verification — 2026-08-26

Status: **PASS (operator/Gemini local run)**

Accepted branch/head:

- branch: `feat/market-migration`
- start HEAD: `f1580e13c1d2d747fe6a36b6d2ccf9a3b0f5dc9f`
- final HEAD: `35778638efab1e809fdcb3f1fa7cb18a5e6d7c04`

Environment reported by the local operator run:

- OS: CachyOS Linux, kernel `7.2.0-1-cachyos`, x86_64
- Node.js: `v24.19.0`
- pnpm: `11.21.0`

## Result

`pnpm install`: **PASS**

`pnpm verify:local`: **PASS**

Reported verification coverage:

- 119/119 unit tests passed;
- 31 Orchestrator rows validated;
- 9 publishable package contracts verified;
- 9-package prerelease family verified at `0.1.0-rc.1`;
- TypeScript check passed;
- build passed;
- local package packing passed.

Packed Suite inspection reported:

- `lib/bin.js`: present;
- `cordis.patch.yml`: present;
- packaged Orchestrator preset: present;
- packed dependencies contain no `workspace:` protocol.

## Fixes required by the first executable run

1. `packages/project-memory/src/bootstrap.ts`: add the missing `writeFile` import from `node:fs/promises`.
2. `packages/primary-web-search/test/primary-web-search.test.ts`: correct imports from the removed transitional `src/primary-web-search/*` path to the package-local `src/*` paths.
3. `pnpm-workspace.yaml`: allow the required `esbuild` build script under pnpm v11 with `allowBuilds.esbuild: true`.
4. Regenerate and commit the real workspace `pnpm-lock.yaml`.

The resulting changes are committed as:

- `38b52019d96cd3f23ac8b2d12e7c50151dfa40ac` — `chore: regenerate workspace lockfile`
- `35778638efab1e809fdcb3f1fa7cb18a5e6d7c04` — `fix: resolve local verification failures`

## Remaining gates

This record does **not** prove DSH runtime acceptance. Still pending:

- fresh ordinary DSH `0.1.1-rc.2` profile install/reconciliation/uninstall;
- managed Orchestrator user-preset bridge execution;
- provider live gates;
- Project Memory runtime gate;
- Usage & Limits runtime/UI gate;
- independent Windows acceptance.

GitHub-hosted Actions remain externally blocked by the account billing issue. DSH rc.2 automatic third-party preset discovery remains tracked in issue #2; the explicit managed user-preset bridge is the accepted temporary path.
