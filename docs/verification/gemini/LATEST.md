# Final Foundation Core + Project Memory Re-freeze Validation Report

- **Result**: `PASS`
- **Branch**: `feat/core-provider-plugins-rc3`
- **Previous implementation HEAD**: `2bca8164759bccbc5e1aac9fdc3e73a93a57ed6a`
- **Lockfile reconciliation commit SHA**: `0c7a177e748cb36b940989ee52e46da8a9c3fb46`
- **Final tested implementation HEAD**: `0c7a177e748cb36b940989ee52e46da8a9c3fb46`
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

The final foundation re-freeze for **Core** (`nishi-dsh-core`) and **Project Memory** (`nishi-dsh-project-memory`) is **fully validated and ACCEPTED (PASS)**.

The single blocker from the initial verification run on HEAD `2bca8164759bccbc5e1aac9fdc3e73a93a57ed6a` (`ERR_PNPM_OUTDATED_LOCKFILE` during `pnpm install --frozen-lockfile`) was resolved in commit `0c7a177e748cb36b940989ee52e46da8a9c3fb46` via `pnpm install --lockfile-only`. The lockfile modification was strictly minimal (2 lines updating `packages/core.dependencies` specifiers for `@deepseek-ai/dsh-system-prompt` and `@deepseek-ai/dsh-tools` from `0.1.1-rc.2` to `0.1.1-rc.2 || 0.1.2-alpha.1`).

All package manifests, production source files, tests, and canonical documentation remain completely untouched. The local resolved DSH baseline remains strictly `0.1.1-rc.2`. Subsequent `pnpm install --frozen-lockfile` completed cleanly with exit code `0`.

All 176 Core focused tests, all 39 Project Memory tests, all 270 workspace tests, all TypeScript typechecks, package builds, and local contract packaging gates (`pnpm verify:local`) passed with zero errors or regressions. Dual-generation runtime compatibility against official upstream `dsh-v0.1.2-alpha.1` remains intact and proven.

---

## 1. Root Cause & Lockfile Reconciliation

### 1.1 Initial Failure Diagnosis
On implementation HEAD `2bca8164759bccbc5e1aac9fdc3e73a93a57ed6a`, running `pnpm install --frozen-lockfile` failed with:
```text
[ERR_PNPM_OUTDATED_LOCKFILE] Cannot install with "frozen-lockfile" because pnpm-lock.yaml is not up to date with <ROOT>/packages/core/package.json
* 2 dependencies are mismatched:
  - @deepseek-ai/dsh-system-prompt (lockfile: 0.1.1-rc.2, manifest: 0.1.1-rc.2 || 0.1.2-alpha.1)
  - @deepseek-ai/dsh-tools (lockfile: 0.1.1-rc.2, manifest: 0.1.1-rc.2 || 0.1.2-alpha.1)
```

### 1.2 Reconciliation Diff (`0c7a177e748cb36b940989ee52e46da8a9c3fb46`)
Executing `pnpm install --lockfile-only` produced the exact minimal semantic correction:
```diff
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index 22a7524..d61b0ea 100644
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -122,10 +122,10 @@ importers:
   packages/core:
     dependencies:
       '@deepseek-ai/dsh-system-prompt':
-        specifier: 0.1.1-rc.2
+        specifier: 0.1.1-rc.2 || 0.1.2-alpha.1
         version: 0.1.1-rc.2(@deepseek-ai/cordis@4.0.1)(@deepseek-ai/dsh-invariants@0.1.1-rc.2(@deepseek-ai/cordis@4.0.1))(@deepseek-ai/dsh-llm@0.1.1-rc.2(@deepseek-ai/cordis@4.0.1)(@deepseek-ai/dsh-attachment@0.1.1-rc.2(@deepseek-ai/cordis@4.0.1)(@deepseek-ai/dsh-brand@0.1.1-rc.2(@deepseek-ai/cordis@4.0.1)(@deepseek-ai/dsh-invariants@0.1.1-rc.2(@deepseek-ai/cordis@4.0.1)))(@deepseek-ai/dsh-invariants@0.1.1-rc.2(@deepseek-ai/cordis@4.0.1)))(@deepseek-ai/dsh-brand@0.1.1-rc.2(@deepseek-ai/cordis@4.0.1)(@deepseek-ai/dsh-invariants@0.1.1-rc.2(@deepseek-ai/cordis@4.0.1)))(@deepseek-ai/dsh-invariants@0.1.1-rc.2(@deepseek-ai/cordis@4.0.1))(@deepseek-ai/dsh-timeout@0.1.1-rc.2(@deepseek-ai/cordis@4.0.1)(@deepseek-ai/dsh-invariants@0.1.1-rc.2(@deepseek-ai/cordis@4.0.1))))(@deepseek-ai/dsh-scope@0.1.1-rc.2(@deepseek-ai/cordis@4.0.1)(@deepseek-ai/dsh-invariants@0.1.1-rc.2(@deepseek-ai/cordis@4.0.1)))
       '@deepseek-ai/dsh-tools':
-        specifier: 0.1.1-rc.2
+        specifier: 0.1.1-rc.2 || 0.1.2-alpha.1
         version: 0.1.1-rc.2(119bc70f73f8eddebfaa6b47561adeb3)
       '@deepseek-ai/schemastery':
         specifier: ^3.18.1
```

### 1.3 Immutability Checks
- `git diff --exit-code -- packages/core/package.json packages/project-memory/package.json`: Exit code `0` (zero manifest drift).
- Production source and test files: Completely unchanged.

---

## 2. Frozen Install & Local Baseline Verification

### 2.1 Frozen Install Gate
- Command: `pnpm install --frozen-lockfile`
- Result: **PASS** (Exit code `0`, `Already up to date in 428ms`).
- Post-install manifest & lockfile diff: **0 bytes drift** (`git diff --exit-code` exit 0).

### 2.2 Resolved Local DSH Baseline
Verified actual installed versions in local `node_modules`:
- `@deepseek-ai/dsh-client-connection`: `0.1.1-rc.2`
- `@deepseek-ai/dsh-llm`: `0.1.1-rc.2`
- `@deepseek-ai/dsh-tools`: `0.1.1-rc.2`
- `@deepseek-ai/dsh-system-prompt`: `0.1.1-rc.2`
- `@deepseek-ai/dsh-agent`: `0.1.1-rc.2`
- `@deepseek-ai/dsh-atomic-write`: `0.1.1-rc.2`

All installed runtime dependencies remain strictly on the reproducible `0.1.1-rc.2` baseline.

---

## 3. Package & Workspace Validation Gates

### 3.1 Focused Core Gates
| Gate Command | Exit Code | Result | Details |
|---|---|---|---|
| `pnpm --filter nishi-dsh-core test` | `0` | **PASS** | 176 tests executed: **176 passed**, 0 failed |
| `pnpm --filter nishi-dsh-core check` | `0` | **PASS** | TypeScript check clean |
| `pnpm --filter nishi-dsh-core build` | `0` | **PASS** | `tsdown` build emitted all ESM/CJS bundles and declaration files |

### 3.2 Focused Project Memory Gates
| Gate Command | Exit Code | Result | Details |
|---|---|---|---|
| `pnpm --filter nishi-dsh-project-memory test` | `0` | **PASS** | 39 tests executed: **39 passed**, 0 failed |
| `pnpm --filter nishi-dsh-project-memory check` | `0` | **PASS** | TypeScript check clean |
| `pnpm --filter nishi-dsh-project-memory build` | `0` | **PASS** | `tsc` compilation clean |

### 3.3 Full Workspace Tests
| Package | Tests Passed | Tests Failed | Check Exit Code | Build Exit Code |
|---|---|---|---|---|
| `packages/core` | 176 | 0 | 0 | 0 |
| `packages/project-memory` | 39 | 0 | 0 | 0 |
| `packages/codex` | 31 | 0 | 0 | 0 |
| `packages/antigravity` | 7 | 0 | 0 | 0 |
| `packages/claude` | 5 | 0 | 0 | 0 |
| `packages/suite` | 12 | 0 | 0 | 0 |
| **Workspace Total** | **270** | **0** | **0** | **0** |

### 3.4 Quota-Free Local Contract Gate (`verify:local`)
- Command: `pnpm verify:local`
- Result: **PASS** (Exit code `0`)
  - Release-family verification: PASS
  - Package contracts verification: PASS
  - Orchestrator lifecycle validation: PASS
  - Workspace build & check: PASS
  - Workspace test suite (270/270): PASS
  - Local packaging into `.artifacts/packs/`: PASS (6 tarballs generated)

---

## 4. Packed Tarball Metadata Verification

From `.artifacts/packs/nishi-dsh-core-0.1.0-rc.3.tgz` and `.artifacts/packs/nishi-dsh-project-memory-0.1.0-rc.3.tgz`:

### 4.1 Core Tarball Metadata
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

### 4.2 Project Memory Tarball Metadata
- `dependencies`: Empty / undefined.
- `peerDependencies`:
  - `@deepseek-ai/cordis`: `^4.0.1`
  - `@deepseek-ai/dsh-agent`: `0.1.1-rc.2 || 0.1.2-alpha.1`
  - `@deepseek-ai/dsh-atomic-write`: `0.1.1-rc.2 || 0.1.2-alpha.1`
  - `@deepseek-ai/dsh-llm`: `0.1.1-rc.2 || 0.1.2-alpha.1`
  - `@deepseek-ai/dsh-tools`: `0.1.1-rc.2 || 0.1.2-alpha.1`

---

## 5. Alpha.1 Runtime Evidence Summary

The previous comprehensive audit against official upstream checkout `deepseek-ai/deepseek-harness` (tag `dsh-v0.1.2-alpha.1`, commit `cd5ef8148158c3a752a658978873241fdf8e2bbc`) established:
1. All 14 production peer packages exist on exact `0.1.2-alpha.1`.
2. Retired seams (`@deepseek-ai/dsh-client-runtime` and `@deepseek-ai/dsh-host-apiproxy`) are absent in alpha.1 and have zero production import requirement in Core.
3. Native alpha.1 two-argument Connection RPC (`rpc.handle(channel, handler)`) successfully handled `/usage-limits` and `/authorization`.
4. Provider registration, observer safety, and withdrawal work cleanly.
5. Project Memory tools (`memory_write`, `memory_read`, `memory_edit`) operate accurately with file lock serialization (`withFileLock`) and zero lock leakage.
6. Compound preflight rollback prevents file creation on malformed memory maps.
7. Maintenance route selection timing (`agent/inbox/claimed` before `system-prompt/assemble`) is maintained.

Zero production source or test changes were made since this runtime evidence was collected, confirming full dual-generation integrity.

---

## 6. Provider Packages & Suite Compatibility Scope Notice

- **Explicit Foundation Scope**: Only `nishi-dsh-core` and `nishi-dsh-project-memory` declare dual generation compatibility (`0.1.1-rc.2 || 0.1.2-alpha.1`).
- **Provider Packages Status**: `nishi-dsh-codex`, `nishi-dsh-antigravity`, and `nishi-dsh-claude` remain pinned to exact `0.1.1-rc.2` and are scheduled for subsequent provider-specific passes.
- **Suite Status**: `nishi-dsh-suite` dependencies remain pinned to rc.2 baseline. Whole-family alpha.1 release compatibility is not yet claimed.

---

## 7. Final Status & Conclusion

```text
Foundation result: PASS
Core: RE-FREEZE ACCEPTED
Project Memory: RE-FREEZE ACCEPTED
```
