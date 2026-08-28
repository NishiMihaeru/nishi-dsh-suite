# Final Foundation Core + Project Memory Re-freeze Validation Report

- **Result**: `FAIL` (Gate 6: `pnpm install --frozen-lockfile` exit code `1` due to outdated lockfile specifiers in `packages/core`)
- **Branch**: `feat/core-provider-plugins-rc3`
- **Tested implementation HEAD**: `2bca8164759bccbc5e1aac9fdc3e73a93a57ed6a`
- **Environment**:
  - Node: `v24.19.0` (`/home/acedia/.local/share/fnm/node-versions/v24.19.0/installation/bin/node`)
  - pnpm: `11.21.0`
  - Installed DSH baseline: `0.1.1-rc.2`
  - Upstream DSH target: tag `dsh-v0.1.2-alpha.1` / commit `cd5ef8148158c3a752a658978873241fdf8e2bbc`
  - Operating System: Linux (CachyOS / 6.18 kernel, x86_64)
  - Hosted CI / GitHub Actions: Not used; local machine execution only
  - Windows: **NOT TESTED**

---

## Executive Summary

A comprehensive source, manifest, contract, and runtime verification of the **Nishi DSH Suite foundation** (`nishi-dsh-core` and `nishi-dsh-project-memory`) was conducted against both the **installed baseline (`0.1.1-rc.2`)** and the **official upstream generation tag `dsh-v0.1.2-alpha.1` (commit `cd5ef8148158c3a752a658978873241fdf8e2bbc`)**.

### Findings Summary
1. **Manifest Contract & Semver Evaluation**: **PASS**. All 12 Core and 4 Project Memory `@deepseek-ai/dsh-*` peer dependencies declare exact `0.1.1-rc.2 || 0.1.2-alpha.1`. All DSH `devDependencies` remain pinned exact `0.1.1-rc.2`.
2. **Upstream Alpha.1 Package Existence & Seams**: **PASS**. All 14 production peer packages exist at `0.1.2-alpha.1` in upstream checkout `cd5ef8148158c3a752a658978873241fdf8e2bbc`. Retired seams (`@deepseek-ai/dsh-client-runtime` and `@deepseek-ai/dsh-host-apiproxy`) are verified absent in alpha.1 and have zero runtime import requirements in Core.
3. **Core & Memory Runtime Probes (rc.2 & alpha.1)**: **PASS**. Both packages pass all compilation, registration, transaction rollback, RPC handling, lifecycle event ordering, and file lock serialization probes on both DSH generations.
4. **Focused & Full Workspace Test Suites**: **PASS**. Core has 176/176 tests passing (including new package-boundary test), Project Memory has 39/39 tests passing, and the full workspace has 270/270 tests passing. `pnpm verify:local` completes with exit code `0`.
5. **Frozen Lockfile Gate**: **FAIL (Exit code `1`)**. `pnpm install --frozen-lockfile` failed because `pnpm-lock.yaml` still records `@deepseek-ai/dsh-system-prompt` and `@deepseek-ai/dsh-tools` under `packages/core.dependencies` with specifier `0.1.1-rc.2` instead of `0.1.1-rc.2 || 0.1.2-alpha.1`. Under strict foundation gate rules, automatic lockfile migration was not performed.

---

## 1. Changed Files Reviewed (`2bca8164759bccbc5e1aac9fdc3e73a93a57ed6a`)

- [`packages/core/package.json`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/core/package.json)
- [`packages/core/test/package-boundary.test.ts`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/core/test/package-boundary.test.ts)
- [`packages/core/README.md`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/core/README.md)
- [`packages/project-memory/package.json`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/project-memory/package.json)
- [`packages/project-memory/test/package.test.ts`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/project-memory/test/package.test.ts)
- [`packages/project-memory/README.md`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/project-memory/README.md)
- [`docs/ARCHITECTURE.md`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/docs/ARCHITECTURE.md)
- [`docs/HANDOFF.md`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/docs/HANDOFF.md)
- [`docs/RELEASE.md`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/docs/RELEASE.md)
- [`docs/ROADMAP.md`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/docs/ROADMAP.md)
- [`docs/verification/README.md`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/docs/verification/README.md)

---

## 2. Peer & Dev Dependency Contract Review

### 2.1 Core Peer Dependencies (`0.1.1-rc.2 || 0.1.2-alpha.1`)
- `@deepseek-ai/dsh-client-connection`: `0.1.1-rc.2 || 0.1.2-alpha.1`
- `@deepseek-ai/dsh-client-locale`: `0.1.1-rc.2 || 0.1.2-alpha.1`
- `@deepseek-ai/dsh-client-ui-primitives`: `0.1.1-rc.2 || 0.1.2-alpha.1`
- `@deepseek-ai/dsh-client-ui-settings`: `0.1.1-rc.2 || 0.1.2-alpha.1`
- `@deepseek-ai/dsh-client-ui-sidebar`: `0.1.1-rc.2 || 0.1.2-alpha.1`
- `@deepseek-ai/dsh-client-ui-slots`: `0.1.1-rc.2 || 0.1.2-alpha.1`
- `@deepseek-ai/dsh-credentials`: `0.1.1-rc.2 || 0.1.2-alpha.1`
- `@deepseek-ai/dsh-llm`: `0.1.1-rc.2 || 0.1.2-alpha.1`
- `@deepseek-ai/dsh-subprocess`: `0.1.1-rc.2 || 0.1.2-alpha.1`
- `@deepseek-ai/dsh-system-prompt`: `0.1.1-rc.2 || 0.1.2-alpha.1`
- `@deepseek-ai/dsh-timeout`: `0.1.1-rc.2 || 0.1.2-alpha.1`
- `@deepseek-ai/dsh-tools`: `0.1.1-rc.2 || 0.1.2-alpha.1`

### 2.2 Project Memory Peer Dependencies (`0.1.1-rc.2 || 0.1.2-alpha.1`)
- `@deepseek-ai/dsh-agent`: `0.1.1-rc.2 || 0.1.2-alpha.1`
- `@deepseek-ai/dsh-atomic-write`: `0.1.1-rc.2 || 0.1.2-alpha.1`
- `@deepseek-ai/dsh-llm`: `0.1.1-rc.2 || 0.1.2-alpha.1`
- `@deepseek-ai/dsh-tools`: `0.1.1-rc.2 || 0.1.2-alpha.1`

### 2.3 Dev Dependencies Assessment
All local `@deepseek-ai/dsh-*` devDependencies in Core and Project Memory are pinned to exact `0.1.1-rc.2`. Core maintains backward-compatibility test fixtures `@deepseek-ai/dsh-client-runtime` and `@deepseek-ai/dsh-host-apiproxy` strictly in `devDependencies` pinned to `0.1.1-rc.2`. Neither appears in `dependencies`, `peerDependencies`, production source imports, or browser injection manifests (`dsh.client.inject`).

---

## 3. Semver Acceptance / Rejection Probe

The exact peer range string `0.1.1-rc.2 || 0.1.2-alpha.1` was evaluated using the node `semver` parser across multiple release specifiers:

| Version Tested | Satisfies Range | Evaluation Result |
|---|---|---|
| `0.1.1-rc.2` | `true` | **ACCEPTED** (Current local baseline) |
| `0.1.2-alpha.1` | `true` | **ACCEPTED** (Supported second generation) |
| `0.1.1-rc.1` | `false` | **REJECTED** |
| `0.1.1` | `false` | **REJECTED** |
| `0.1.2-alpha.0` | `false` | **REJECTED** |
| `0.1.2-alpha.2` | `false` | **REJECTED** |
| `0.1.2` | `false` | **REJECTED** |
| `0.1.0` | `false` | **REJECTED** |
| `0.2.0` | `false` | **REJECTED** |

---

## 4. Upstream Alpha.1 Package Existence & Retired Seam Review

From official upstream repository checkout `deepseek-ai/deepseek-harness` (tag `dsh-v0.1.2-alpha.1`, commit `cd5ef8148158c3a752a658978873241fdf8e2bbc`):

| Package Name | Upstream Status | Package Version | Location in Upstream Repo |
|---|---|---|---|
| `@deepseek-ai/dsh-client-connection` | Present | `0.1.2-alpha.1` | `packages/client/connection` |
| `@deepseek-ai/dsh-client-locale` | Present | `0.1.2-alpha.1` | `packages/client/locale` |
| `@deepseek-ai/dsh-client-ui-primitives` | Present | `0.1.2-alpha.1` | `packages/client/ui-primitives` |
| `@deepseek-ai/dsh-client-ui-settings` | Present | `0.1.2-alpha.1` | `packages/client/ui-settings` |
| `@deepseek-ai/dsh-client-ui-sidebar` | Present | `0.1.2-alpha.1` | `packages/client/ui-sidebar` |
| `@deepseek-ai/dsh-client-ui-slots` | Present | `0.1.2-alpha.1` | `packages/client/ui-slots` |
| `@deepseek-ai/dsh-credentials` | Present | `0.1.2-alpha.1` | `packages/credentials/credentials` |
| `@deepseek-ai/dsh-llm` | Present | `0.1.2-alpha.1` | `packages/llm/llm` |
| `@deepseek-ai/dsh-subprocess` | Present | `0.1.2-alpha.1` | `packages/subprocess/subprocess` |
| `@deepseek-ai/dsh-system-prompt` | Present | `0.1.2-alpha.1` | `packages/core/system-prompt` |
| `@deepseek-ai/dsh-timeout` | Present | `0.1.2-alpha.1` | `packages/util/timeout` |
| `@deepseek-ai/dsh-tools` | Present | `0.1.2-alpha.1` | `packages/core/tools` |
| `@deepseek-ai/dsh-agent` | Present | `0.1.2-alpha.1` | `packages/core/agent` |
| `@deepseek-ai/dsh-atomic-write` | Present | `0.1.2-alpha.1` | `packages/util/atomic-write` |
| `@deepseek-ai/dsh-client-runtime` | **Absent / Retired** | N/A | Removed in alpha.1 UI architecture |
| `@deepseek-ai/dsh-host-apiproxy` | **Absent / Retired** | N/A | Merged into `dsh-client-connection` |

---

## 5. Local Baseline (rc.2) Validation Results

### 5.1 Lockfile & Frozen Install Gate
- `pnpm install --frozen-lockfile`: **FAIL (Exit code `1`)**
  ```text
  [ERR_PNPM_OUTDATED_LOCKFILE] Cannot install with "frozen-lockfile" because pnpm-lock.yaml is not up to date with <ROOT>/packages/core/package.json
  * 2 dependencies are mismatched:
    - @deepseek-ai/dsh-system-prompt (lockfile: 0.1.1-rc.2, manifest: 0.1.1-rc.2 || 0.1.2-alpha.1)
    - @deepseek-ai/dsh-tools (lockfile: 0.1.1-rc.2, manifest: 0.1.1-rc.2 || 0.1.2-alpha.1)
  ```
- `git diff --exit-code -- pnpm-lock.yaml`: Exit code `0`.
- `git diff --exit-code -- packages/core/package.json packages/project-memory/package.json pnpm-lock.yaml`: Exit code `0`.

### 5.2 Focused Core & Project Memory Gates
| Gate Command | Exit Code | Result | Details |
|---|---|---|---|
| `pnpm --filter nishi-dsh-core test` | `0` | **PASS** | 176 tests executed: **176 passed**, 0 failed (+1 test: `package-boundary.test.ts`) |
| `pnpm --filter nishi-dsh-core check` | `0` | **PASS** | TypeScript check clean |
| `pnpm --filter nishi-dsh-core build` | `0` | **PASS** | `tsdown` build emitted all ESM/CJS bundles and declaration files |
| `pnpm --filter nishi-dsh-project-memory test` | `0` | **PASS** | 39 tests executed: **39 passed**, 0 failed |
| `pnpm --filter nishi-dsh-project-memory check` | `0` | **PASS** | TypeScript check clean |
| `pnpm --filter nishi-dsh-project-memory build` | `0` | **PASS** | `tsc` compilation clean |

### 5.3 Full Workspace Tests
| Package | Tests Passed | Tests Failed | Check Exit Code | Build Exit Code |
|---|---|---|---|---|
| `packages/core` | 176 | 0 | 0 | 0 |
| `packages/project-memory` | 39 | 0 | 0 | 0 |
| `packages/codex` | 31 | 0 | 0 | 0 |
| `packages/antigravity` | 7 | 0 | 0 | 0 |
| `packages/claude` | 5 | 0 | 0 | 0 |
| `packages/suite` | 12 | 0 | 0 | 0 |
| **Workspace Total** | **270** | **0** | **0** | **0** |

### 5.4 Quota-Free Local Contract Gate (`verify:local`)
- `pnpm verify:local`: **PASS (Exit code `0`)**
  - Release-family verification: PASS
  - Package contracts verification: PASS
  - Orchestrator lifecycle validation: PASS
  - Workspace build & check: PASS
  - Workspace test suite (270/270): PASS
  - Packed tarballs generated for all 6 packages into `.artifacts/packs/`: PASS

---

## 6. Packed Tarball Metadata Verification

From `.artifacts/packs/nishi-dsh-core-0.1.0-rc.3.tgz` and `.artifacts/packs/nishi-dsh-project-memory-0.1.0-rc.3.tgz`:

### Core (`nishi-dsh-core-0.1.0-rc.3.tgz`)
- `dependencies`:
  - `@deepseek-ai/schemastery`: `^3.18.1`
- `peerDependencies`:
  - `@deepseek-ai/cordis`: `^4.0.1`
  - `@deepseek-ai/dsh-client-connection`: `0.1.1-rc.2 || 0.1.2-alpha.1`
  - `@deepseek-ai/dsh-client-locale`: `0.1.1-rc.2 || 0.1.2-alpha.1`
  - `@deepseek-ai/dsh-client-ui-primitives`: `0.1.1-rc.2 || 0.1.2-alpha.1`
  - `@deepseek-ai/dsh-client-ui-settings`: `0.1.1-rc.2 || 0.1.2-alpha.1`
  - `@deepseek-ai/dsh-client-ui-sidebar`: `0.1.1-rc.2 || 0.1.2-alpha.1`
  - `@deepseek-ai/dsh-client-ui-slots`: `0.1.1-rc.2 || 0.1.2-alpha.1`
  - `@deepseek-ai/dsh-credentials`: `0.1.1-rc.2 || 0.1.2-alpha.1`
  - `@deepseek-ai/dsh-llm`: `0.1.1-rc.2 || 0.1.2-alpha.1`
  - `@deepseek-ai/dsh-subprocess`: `0.1.1-rc.2 || 0.1.2-alpha.1`
  - `@deepseek-ai/dsh-system-prompt`: `0.1.1-rc.2 || 0.1.2-alpha.1`
  - `@deepseek-ai/dsh-timeout`: `0.1.1-rc.2 || 0.1.2-alpha.1`
  - `@deepseek-ai/dsh-tools`: `0.1.1-rc.2 || 0.1.2-alpha.1`
  - `react`: `^18.2.0`
- Retired packages (`dsh-client-runtime`, `dsh-host-apiproxy`, `dsh-subagent`, `dsh-authorization`): **ABSENT from dependencies and peerDependencies**.

### Project Memory (`nishi-dsh-project-memory-0.1.0-rc.3.tgz`)
- `dependencies`: Empty / undefined.
- `peerDependencies`:
  - `@deepseek-ai/cordis`: `^4.0.1`
  - `@deepseek-ai/dsh-agent`: `0.1.1-rc.2 || 0.1.2-alpha.1`
  - `@deepseek-ai/dsh-atomic-write`: `0.1.1-rc.2 || 0.1.2-alpha.1`
  - `@deepseek-ai/dsh-llm`: `0.1.1-rc.2 || 0.1.2-alpha.1`
  - `@deepseek-ai/dsh-tools`: `0.1.1-rc.2 || 0.1.2-alpha.1`

---

## 7. Disposable Alpha.1 Environment Runtime Evidence

### 7.1 Method & Setup
- Source: Fresh upstream clone of `deepseek-ai/deepseek-harness` checked out at tag `dsh-v0.1.2-alpha.1` (`cd5ef8148158c3a752a658978873241fdf8e2bbc`).
- Built all upstream packages using upstream build pipeline.
- Packed required 14 alpha.1 packages via `pnpm pack`.
- Executed comprehensive integration test suite linking compiled Nishi Core and Project Memory against actual alpha.1 packages.

### 7.2 Alpha.1 Core Verification Results
- **Compile & Import**: `nishi-dsh-core` root, `/runtime`, `/usage`, `/web-search`, and `/client` load without error.
- **Host Connection RPC Registration**: Connection compatibility layer [`registerConnectionRpcChannel`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/core/src/host/connection-compat.ts#L30-L43) successfully detected the native alpha.1 two-argument `rpc.handle(channel, handler)` signature and registered `/usage-limits` and `/authorization` channels.
- **Registry & Transaction Integrity**: Provider registration (`record`), route resolution (`byRoute`), withdrawal, non-vetoing sync broken observers, and async observer rejection containment all passed.
- **Usage Roster RPC**: `get-roster` RPC handler executed successfully against alpha.1 host and rejected unexpected request fields with `bad-request`.
- **Clean Remount**: Unmounting and remounting Core plugin on alpha.1 Cordis Context executed without duplicate service or channel collision errors.
- **Client Surface**: Client plugin loaded via browser ModuleLoader and mounted onto alpha.1 client Context with `slots`, `locale`, and `connection`.

### 7.3 Alpha.1 Project Memory Verification Results
- **Compile & Import**: `nishi-dsh-project-memory` imported cleanly.
- **File Lock Invariant**: `@deepseek-ai/dsh-atomic-write` exported `withFileLock` and `writeFileAtomic` with identical PM04 contract.
- **Model-Facing Memory Tools**:
  - `memory_write({ topic: architecture, content: ... })` successfully wrote topic file and updated `.dsh/memory/MEMORY.md` with `- \`architecture\` → \`.dsh/memory/architecture.md\``.
  - `memory_read({ topic: architecture })` returned exact written topic content.
  - `memory_edit({ topic: architecture, old_text: ..., new_text: ... })` updated topic content byte-for-byte.
  - Zero lingering `.lock` files remained after completion.
  - Corrupted `MEMORY.md` preflight rejected `memory_write` without creating `.dsh/memory/new-topic.md` on disk.
- **Maintenance Selection & Lifecycle Timing**:
  - Confirmed lifecycle ordering: `agent/inbox/claimed` triggers before `system-prompt/assemble`.
  - Confirmed `installModelSelection` from alpha.1 `@deepseek-ai/dsh-agent` propagates provider/model selection on first maintenance request and unhooks cleanly upon disposal.

---

## 8. Provider Packages & Suite Compatibility Scope Notice

- **Explicit Foundation Scope**: Only `nishi-dsh-core` and `nishi-dsh-project-memory` declare dual generation compatibility (`0.1.1-rc.2 || 0.1.2-alpha.1`).
- **Provider Packages Status**: `nishi-dsh-codex`, `nishi-dsh-antigravity`, and `nishi-dsh-claude` remain pinned to exact `0.1.1-rc.2` and are scheduled for subsequent provider-specific passes.
- **Suite Status**: `nishi-dsh-suite` dependencies remain pinned to rc.2 baseline. Whole-family alpha.1 release compatibility is not yet claimed.

---

## 9. Final Status & Conclusion

```text
Foundation result: FAIL
Core: RE-FREEZE BLOCKED BY FROZEN LOCKFILE MISMATCH
Project Memory: RE-FREEZE BLOCKED BY FROZEN LOCKFILE MISMATCH
```

### Reproducible Reason for FAIL
`pnpm install --frozen-lockfile` exited with code `1` due to outdated entries in `pnpm-lock.yaml` for `packages/core` (`@deepseek-ai/dsh-system-prompt` and `@deepseek-ai/dsh-tools`). Per validation instructions, implementation, manifests, and lockfiles were not modified during this audit. Once the maintainer reconciles `pnpm-lock.yaml` to match the updated `packages/core/package.json` peer declarations, the foundation is ready for immediate PASS.
