# Codex Provider Stage Validation Report: nishi-dsh-codex

- **Result**: `PASS`
- **Branch**: `feat/core-provider-plugins-rc3`
- **Tested Implementation Base HEAD**: `3b61a4050bb1f1f213d9e43aa007fd1964b232da`
- **Environment**:
  - Node: `v24.19.0` (`/home/acedia/.local/share/fnm/node-versions/v24.19.0/installation/bin/node`)
  - pnpm: `11.21.0`
  - Codex CLI: `codex-cli 0.150.0` (commit `3b3b4f8fb3f6403e72c2d0533ed0d2f309c59717`)
  - OS: Linux (CachyOS / kernel 6.18, x86_64)
  - Hosted CI / GitHub Actions: **NOT USED** (local execution only)
  - Windows: **NOT TESTED**
- **DSH Baselines**:
  - Local installed workspace baseline: `0.1.1-rc.2` (tag `dsh-v0.1.1-rc.2`, commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`)
  - Foundation compatibility target: `cd5ef8148158c3a752a658978873241fdf8e2bbc`

---

## Executive Summary

Independent from-scratch audit, remediation, and live acceptance validation of **`nishi-dsh-codex`** on branch `feat/core-provider-plugins-rc3` resulted in **PASS**.

During the audit, two concrete runtime bugs were identified, reproduced with deterministic failure evidence, and remediated:
1. **Codex 0.150.0 Native Web Search Breakage (`web-search-backend.ts` & `adapter.ts`)**:
   - *Problem*: Passing deprecated CLI feature flags (`features.standalone_web_search=false`, `features.web_search_request=false`, `features.web_search_cached=false`) and `features.code_mode_host=false` to official Codex 0.150.0 caused the CLI to emit startup error notices (`item.type === 'error'`) and router errors. Because `consumeCodexSearchEvent` treated any item of type `'error'` as fatal, web search aborted prematurely.
   - *Fix*: Removed deprecated feature flags and redundant `code_mode_host: false` from `codexSearchExecArgv` and `isolationConfig` while strictly preserving full capability isolation (`code_mode: false`, `shell_tool: false`, `memories: false`, `web_search: 'disabled'` / `web_search: 'live'`).
2. **Unhandled Stream Error on Concurrent Connection Close (`app-server.ts`)**:
   - *Problem*: `CodexAppServerConnection` created `JsonRpcLineTransport` without attaching `'error'` listeners to `child.stdin` and `child.stdout`. When an active turn was closed concurrently while an internal request was being rejected, stream write after end threw an unhandled stream error.
   - *Fix*: Attached defensive error listeners to `child.stdin` and `child.stdout` during connection construction.
3. **Live Test Mock Stdio Fix (`test-live/web-search.test.ts` & `test-live/web-search-routed.test.ts`)**:
   - *Problem*: Test mock subprocesses hardcoded `stdio: ['pipe', 'pipe', 'pipe']` instead of respecting `spec.stdio` (`stdin: 'ignore'`), causing `codex exec` to wait on stdin EOF and hang for 120 seconds.
   - *Fix*: Respected `spec.stdio?.stdin` in test subprocess runners.

---

## 1. Initial State & Setup Commands

| Command | Exit Code | Output / Detail |
|---|---|---|
| `git checkout feat/core-provider-plugins-rc3` | `0` | Switched to branch `feat/core-provider-plugins-rc3` |
| `git pull --ff-only` | `0` | Fast-forward updated to `3b61a4050bb1f1f213d9e43aa007fd1964b232da` |
| `git rev-parse HEAD` | `0` | `3b61a4050bb1f1f213d9e43aa007fd1964b232da` |
| `git status` | `0` | Clean working tree |
| `node --version` | `0` | `v24.19.0` |
| `pnpm --version` | `0` | `11.21.0` |
| `codex --version` | `0` | `codex-cli 0.150.0` |

---

## 2. Unit and Workspace Test Gates

| Gate Command | Exit Code | Result | Details |
|---|---|---|---|
| `pnpm --filter nishi-dsh-codex test` | `0` | **PASS** | 48 focused Codex unit tests: **48 passed**, 0 failed |
| `pnpm --filter nishi-dsh-codex check` | `0` | **PASS** | `tsc -p tsconfig.json --noEmit` clean |
| `pnpm --filter nishi-dsh-codex build` | `0` | **PASS** | `tsc -p tsconfig.json` emitted clean definitions & JS |
| `pnpm check` | `0` | **PASS** | Workspace TypeScript check across all 6 packages |
| `pnpm build` | `0` | **PASS** | Workspace build across all 6 packages |
| `pnpm test` | `0` | **PASS** | Full workspace test suite (Core: 182, PM: 64, Codex: 48, Suite: 12, Antigravity: 7, Claude: 0) |
| `pnpm verify:local` | `0` | **PASS** | Release family verification, package contracts, Orchestrator test, build, check, tests, and packing of 6 tarballs |

---

## 3. Live Acceptance Scenarios (Official Codex 0.150.0)

All 15 live acceptance scenarios were executed against the real installed `codex-cli 0.150.0` and model `gpt-5.6-sol`:

| Scenario | Description | Result | Details |
|---|---|---|---|
| **1 & 2** | Primary single turn & multi-turn conversation | **PASS** | Single turn returned `CODE_RECEIVED`; subsequent turn recalled secret code `ALPHA_77` across turns. |
| **3, 4, 5, 6** | Dynamic DSH tools + Project Memory integration | **PASS** | Model called `memory_write` tool; Project Memory saved `release_target`; tool result continued in the same App Server turn to final answer. |
| **7** | Routed native web search | **PASS** | `CodexSearchBackend.search()` executed with `codex exec --json`, returned structured sources array with real URLs and snippets without DeepSeek fallback. |
| **8** | Usage & rate limits collection | **PASS** | `OfficialCodexRateLimitsSource` connected to `codex app-server --stdio`, initialized, read `account/read`, read `account/rateLimits/read`, and normalized into `ProviderUsageSnapshot`. |
| **9** | Cancellation during active turn | **PASS** | `AbortSignal` triggered during turn generation; turn aborted immediately; connection closed. |
| **10** | Cancellation during DSH tool continuation | **PASS** | Session closed while awaiting tool continuation; active turn terminated; subsequent turn cleanly reset. |
| **11** | Zero process residue | **PASS** | Verified 0 lingering `codex app-server --stdio` processes after all turns and disposal cycles. |
| **12 & 13** | Stale checkpoint & deleted vendor thread recovery | **PASS** | Simulated deleted vendor thread ID in `replayState`; `thread/fork` failed with recoverable error; adapter automatically rebuilt thread from DSH history and recalled context. |
| **14 & 15** | Adversarial prompt & forbidden capability isolation | **PASS** | Adversarial prompt attempting bash, `apply_patch`, host skills, MCP, and native memories was rejected with `HOST_CAPABILITIES_ISOLATED`. Zero bypass possible. |

---

## 4. Live Suite Execution Summary

```bash
pnpm --filter nishi-dsh-codex run test:live:primary
# Result: PASS (3759ms) - Returned "CODEX_PRIMARY_OK"

pnpm --filter nishi-dsh-codex run test:live:web-search
# Result: PASS (23445ms) - Native search returned structured sources

pnpm --filter nishi-dsh-codex run test:live:web-search-routed
# Result: PASS (27689ms) - Routed search composed without DeepSeek fallback

pnpm --filter nishi-dsh-codex run test:live:acceptance
# Result: PASS (52779ms) - All 9 acceptance test suites (15 scenarios) PASSED
```

---

## 5. Remediation Details

1. **`packages/codex/src/web-search-backend.ts`**:
   - Removed deprecated `features.standalone_web_search=false`, `features.web_search_request=false`, `features.web_search_cached=false`, and `features.code_mode_host=false` from `codexSearchExecArgv`.
2. **`packages/codex/src/codex-plugin-dsh/adapter.ts`**:
   - Removed deprecated `standalone_web_search`, `web_search_request`, `web_search_cached`, and `code_mode_host` from `isolationConfig`.
3. **`packages/codex/src/codex-plugin-dsh/app-server.ts`**:
   - Added defensive error handlers to `child.stdin` and `child.stdout` to handle stream error events during concurrent process termination.
4. **`packages/codex/test-live/web-search.test.ts` & `test-live/web-search-routed.test.ts`**:
   - Fixed test runner mock stdio handling to respect `spec.stdio?.stdin`.
5. **`packages/codex/test-live/codex-acceptance-full.test.ts`**:
   - Added complete 15-scenario live acceptance test suite.
6. **`packages/codex/test/primary-isolation.test.ts` & `test/web-search-backend.test.ts`**:
   - Updated expected isolation flags to match audited 0.150.0 configuration.

---

## 6. Residual Risks & Notes

- **Windows**: **NOT TESTED**. All tests executed on Linux x86_64. Windows batch-shim invocation paths (`codexAppServerInvocation`) were verified via static analysis and unit tests, but live Windows acceptance remains deferred.
- **Foundation Isolation**: Frozen Foundation (`nishi-dsh-core`, `nishi-dsh-project-memory`) was not modified and remains completely intact and verified.

---

## 7. Final Validation Verdict

```text
Codex provider validation PASS.
`nishi-dsh-codex` is verified, clean, and eligible for FREEZE.
```
