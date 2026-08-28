# Local Validation Report: Core DSH Connection/Client Compatibility Migration

- **Result**: `PASS`
- **Branch**: `feat/core-provider-plugins-rc3`
- **Tested implementation HEAD**: `59512d51e55f8121eccdb934e01523e4436b289c`
- **Environment**:
  - Node: `v24.19.0` (`/home/acedia/.local/share/fnm/node-versions/v24.19.0/installation/bin/node`)
  - pnpm: `11.21.0`
  - Installed DSH baseline: `0.1.1-rc.2`
  - Upstream DSH target: tag `dsh-v0.1.2-alpha.1` / commit `cd5ef8148158c3a752a658978873241fdf8e2bbc`

---

## 1. Exact Files Reviewed

1. [`packages/core/src/host/connection-compat.ts`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/core/src/host/connection-compat.ts) — Connection RPC arity detection and registration abstraction.
2. [`packages/core/test/connection-compat.test.ts`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/core/test/connection-compat.test.ts) — Unit tests for rc.2 3-argument and alpha.1 2-argument registration.
3. [`packages/core/src/index.ts`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/core/src/index.ts) — Host RPC channel registration through `registerConnectionRpcChannel()`.
4. [`packages/core/src/host/rpc.ts`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/core/src/host/rpc.ts) — Usage Limits RPC handler and structural error types.
5. [`packages/core/src/host/authorization-rpc.ts`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/core/src/host/authorization-rpc.ts) — Model Accounts Authorization RPC handler and structural error types.
6. [`packages/core/src/client/index.ts`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/core/src/client/index.ts) — Browser client entry using Cordis `Context` without `dsh-client-runtime`.
7. [`packages/core/package.json`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/core/package.json) — Production package boundary (retired packages only in `devDependencies`).
8. [`packages/core/test/package-boundary.test.ts`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/core/test/package-boundary.test.ts) — Regression test suite enforcing isolation of retired packages.
9. [`packages/core/README.md`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/core/README.md), [`docs/ARCHITECTURE.md`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/docs/ARCHITECTURE.md), [`docs/HANDOFF.md`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/docs/HANDOFF.md), [`docs/RELEASE.md`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/docs/RELEASE.md), [`docs/ROADMAP.md`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/docs/ROADMAP.md), [`docs/verification/README.md`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/docs/verification/README.md).

---

## 2. Lockfile Consistency & Gate Results

### 2.1 Frozen Lockfile
```bash
pnpm install --frozen-lockfile
```
- **Exit code**: `0`
- **Output**: `Scope: all 7 workspace projects; Already up to date; Done in 318ms`
- **Diff check** (`git diff --exit-code -- pnpm-lock.yaml packages/core/package.json`): Exit code `0` (clean, zero diffs).

### 2.2 Core Focused Gates
| Gate Command | Exit Code | Result | Details |
|---|---|---|---|
| `pnpm --filter nishi-dsh-core test` | `0` | **PASS** | 169 tests passed, 0 failed (duration: 966ms) |
| `pnpm --filter nishi-dsh-core check` | `0` | **PASS** | `tsc -p tsconfig.json --noEmit` clean |
| `pnpm --filter nishi-dsh-core build` | `0` | **PASS** | `tsdown` built ESM node artifacts & CJS browser `lib/client.js` (120.92 kB) |

---

## 3. Connection API Arity & Helper Verification

### 3.1 Actual Function Arity from Published/Built Packages
- **DSH `0.1.1-rc.2`** (`@deepseek-ai/dsh-client-connection/lib/index.js`):
  ```js
  handle: (channel, handler, options) => this.register(owner, channel, handler, options)
  ```
  - **Actual `rpc.handle.length`**: `3`
- **DSH `0.1.2-alpha.1`** (`packages/client/connection/lib/index.js` built from upstream commit `cd5ef8148`):
  ```js
  handle: (channel, handler) => this.register(owner, channel, handler)
  ```
  - **Actual `rpc.handle.length`**: `2`
- **Build/Transpilation Impact**: Neither `tsdown` nor Rolldown alters the parameter counts or function shapes in either package build. The arity detection in `packages/core/src/host/connection-compat.ts` (`handle.length >= 3`) is deterministic and reliable.

### 3.2 Helper Behavior
- [`packages/core/src/host/connection-compat.ts`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/core/src/host/connection-compat.ts):
  - In rc.2 environment: calls `handle(channel, handler, { authority: 'trusted-host' })`.
  - In alpha.1 environment: calls `handle(channel, handler)`.
- Verified in unit tests ([`packages/core/test/connection-compat.test.ts`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/core/test/connection-compat.test.ts)) and live runtime probes.

---

## 4. Host Registration, RPC Wire Shapes, & Lifecycle

### 4.1 Channel Registrations
In [`packages/core/src/index.ts`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/core/src/index.ts), both Core RPC channels are registered via `registerConnectionRpcChannel`:
1. `/usage-limits` (`USAGE_LIMITS_CHANNEL`) -> `createUsageLimitsRpcHandler(hostService)`
2. `/authorization` (`AUTHORIZATION_RPC_CHANNEL`) -> `createAuthorizationRpcHandler(authController)`

### 4.2 Lifecycle & Disposer Ownership
- `Connection` is the sole lifecycle owner through `owner.effect(() => owner.webServer.register(route), ...)`.
- Core does NOT create a second disposer or redundant effect.
- **Mount / Unload / Remount Probe Results**:
  - **rc.2**: Initial mount registers 2 channels (`/usage-limits`, `/authorization`). Plugin unload clears all routes (0 remaining). Remount registers exactly 2 channels without duplicates.
  - **alpha.1**: Initial mount registers 2 channels. Plugin unload clears all routes (0 remaining). Remount registers exactly 2 channels without duplicates.

### 4.3 Structural RPC Result & Error Shapes
- Production Core imports neither `@deepseek-ai/dsh-host-apiproxy` nor `@deepseek-ai/dsh-client-runtime`.
- Type inference uses `type ConnectionRpcResult = Awaited<ReturnType<ConnectionRpcHandler>>` and `type ConnectionRpcError = Extract<ConnectionRpcResult, { ok: false }>['error']`.
- **Wire Shapes**:
  - Success: `{ ok: true, value: <DTO> }`
  - `bad-request`: `{ ok: false, error: { code: 'bad-request', message: string, details: { issues: [...] } } }`
  - `internal`: `{ ok: false, error: { code: 'internal', message: string, details: {} } }`
- Verified against both rc.2 and alpha.1 wire expectations; browser-facing RPC wire contract remains identical.

---

## 5. Browser Client Compatibility & First-Party Patterns

### 5.1 Cordis Client Context Transition
- Browser entry [`packages/core/src/client/index.ts`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/core/src/client/index.ts) uses `import type { Context as ClientContext } from '@deepseek-ai/cordis'`.
- First-party packages:
  - **rc.2**: Supported by existing client runtime graph (`ui-sidebar`, `ui-settings`, `locale`).
  - **alpha.1**: `dsh-client-runtime` is completely removed upstream. Upstream client plugins (`ui-sidebar`, `ui-settings`, `locale`, `ui-renderer`) use Cordis `Context` directly.
- Service declarations provide Core access to:
  - `ctx.connection` (via `@deepseek-ai/dsh-client-connection/client`)
  - `ctx.locale` (via `@deepseek-ai/dsh-client-locale/client`)
  - `ctx.slots` (via `@deepseek-ai/dsh-client-ui-renderer/client` / `@deepseek-ai/dsh-client-ui-slots`)
- Slot components registered:
  - `sidebar.footer.action` (`id: 'usage-limits'`)
  - `settings.section` (`id: 'usage-limits'`)
  - `settings.section` (`id: 'model-accounts'`)
- Dictionary namespaces registered: `usage-limits`, `model-accounts`.
- Build purity gate passes cleanly and emits `lib/client.js` wrapped in `window.__ModuleLoader__.load()`.

---

## 6. Dependency Boundary & Regression Tests

### 6.1 Package Boundary
- `packages/core/package.json`:
  - `dependencies`: `@deepseek-ai/schemastery` only.
  - `peerDependencies`: `@deepseek-ai/cordis`, `@deepseek-ai/dsh-client-connection`, `@deepseek-ai/dsh-client-locale`, `@deepseek-ai/dsh-client-ui-primitives`, `@deepseek-ai/dsh-client-ui-settings`, `@deepseek-ai/dsh-client-ui-sidebar`, `@deepseek-ai/dsh-client-ui-slots`, `@deepseek-ai/dsh-credentials`, `@deepseek-ai/dsh-llm`, `@deepseek-ai/dsh-subprocess`, `@deepseek-ai/dsh-system-prompt`, `@deepseek-ai/dsh-timeout`, `@deepseek-ai/dsh-tools`, `react`.
  - `@deepseek-ai/dsh-host-apiproxy` and `@deepseek-ai/dsh-client-runtime` are **completely absent** from `dependencies`, `peerDependencies`, and `dsh.client.inject`.
  - Present only in `devDependencies` as `"0.1.1-rc.2"` backward-compatibility fixtures to keep the local rc.2 test toolchain operable.
- Peer dependencies version range note: `peerDependencies` currently remain `0.1.1-rc.2`. Version range widening to `0.1.1-rc.2 || ^0.1.2-alpha.1` is planned for the subsequent release phase.

### 6.2 Boundary Regression Suite
- [`packages/core/test/package-boundary.test.ts`](file:///home/acedia/%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D1%8B/nishi-dsh-suite/packages/core/test/package-boundary.test.ts) asserts:
  - Retired packages are absent from `dependencies` and `peerDependencies`.
  - Production TypeScript source files contain no imports or string references to retired packages.
  - `dsh.client.inject` does not request `dsh-client-runtime`.
  - Provider package isolation and neutrality rules are preserved.

---

## 7. Security Review: Transition from `{ authority: 'trusted-host' }` to alpha.1

- **rc.2 Security Model**:
  - Passed `{ authority: 'trusted-host' }` to `rpc.handle()`.
  - `HostConnectionService.register()` evaluated `isTrustedApiRequest(req, this.trustedHosts)` to verify the Host/Origin fence (protecting against DNS rebinding and cross-site requests).
- **alpha.1 Security Model**:
  - Two-argument `handle(channel, handler)` executes `requestRejection(req)` on every request before the HTTP bridge invokes `fetchHandler`:
    ```ts
    requestRejection(request: ConnectionTrustRequest): ConnectionRequestRejection {
      if (!isTrustedApiRequest(request, this.trustedHosts)) return 403
      return this.browserAuth.isAuthenticated(request) ? undefined : 401
    }
    ```
  - **Host/Origin Fence**: Enforced first (`isTrustedApiRequest`). Untrusted Host header or cross-site request returns **`403 Forbidden`**.
  - **Browser Authentication**: Enforced second (`browserAuth.isAuthenticated`). Validates HMAC-SHA256 signed `dsh-auth-*` cookie minted through process launch-token exchange. Missing or invalid cookie returns **`401 Unauthorized`**.
- **Conclusion**: The transition to alpha.1 two-argument registration **strictly tightens** security. Core RPC endpoints (`/usage-limits`, `/authorization`) cannot be accessed as anonymous LAN endpoints.

---

## 8. Disposable DSH alpha.1 Probe Results

A disposable upstream checkout was probed at tag `dsh-v0.1.2-alpha.1` (`cd5ef8148158c3a752a658978873241fdf8e2bbc`) in `/tmp/dsh-upstream`:
1. **Built upstream packages**: `pnpm build:lib:host` and `pnpm build:lib:client`.
2. **Runtime probe executed**:
   - `Alpha1HostConnectionService.rpc.handle.length === 2`: **VERIFIED**
   - Untrusted Host header rejection -> `403 Forbidden`: **VERIFIED**
   - Unauthenticated request rejection -> `401 Unauthorized`: **VERIFIED**
   - Authenticated launch token exchange -> `303 Redirect` + `Set-Cookie`: **VERIFIED**
   - Core mount / unmount / remount lifecycle -> clean teardown and zero leaks: **VERIFIED**
   - RPC handler wire format (`get-roster`, `bad-request`, `list-flows`): **VERIFIED**
   - Client plugin apply with Cordis `Context` (`locale`, `slots`, `connection`): **VERIFIED**
- **Exit code**: `0`

---

## 9. Out-of-Scope Findings

- **Registry listener / ghost-provider transaction issue**: Confirmed existing known issue, excluded from scope as instructed.

---

## 10. Git Status

```
HEAD: 59512d51e55f8121eccdb934e01523e4436b289c
Branch: feat/core-provider-plugins-rc3
Working tree: clean (only docs/verification/gemini/LATEST.md modified)
```

---

## 11. Final Verdict

**`Result: PASS`**

Core DSH Connection and client compatibility migration successfully passes all local verification gates, backward compatibility contracts with DSH `0.1.1-rc.2`, forward compatibility runtime probes with DSH `0.1.2-alpha.1`, dependency boundary invariants, and security assessments.
