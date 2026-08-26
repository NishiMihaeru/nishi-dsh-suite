# Vendor CLI Runtime RC2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `0.1.0-rc.2` with Codex and Claude Code using already installed vendor CLIs instead of package-local vendor runtimes, while preserving DSH lifecycle behavior and proving a real `rc.1 -> rc.2` upgrade removes the duplicate runtime closure.

**Architecture:** Keep the existing Nishi provider boundaries and DSH-owned subprocess lifecycle, but replace package-local runtime discovery with small package-local executable resolvers. Codex continues to use the existing App Server JSON-RPC implementation against the external `codex` executable. Claude Code replaces Agent SDK imports with direct non-interactive `claude` CLI execution and NDJSON parsing, terminating the managed process after a terminal result so known headless stream-json exit hangs cannot leak children.

**Tech Stack:** TypeScript 5.9, Node.js 24, pnpm 11.21.0, DeepSeek Harness `0.1.1-rc.2`, Codex App Server, Claude Code stream-json CLI protocol, Node test runner via `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-08-27-vendor-cli-runtime-design.md`

## Global Constraints

- All nine Nishi packages move together to exactly `0.1.0-rc.2`.
- `nishi-dsh-suite` must not install `@openai/codex`, `@openai/codex-sdk`, `@openai/codex-*`, `@anthropic-ai/claude-agent-sdk`, or `@anthropic-ai/claude-agent-sdk-*` at runtime.
- Codex executable discovery is explicit `DSH_CODEX_EXECUTABLE` first, then `PATH`, otherwise Codex-only unavailable diagnostic.
- Claude executable discovery is explicit `DSH_CLAUDE_EXECUTABLE` first, then `PATH`, otherwise Claude-only unavailable diagnostic.
- Antigravity keeps its current external `agy` boundary.
- No credential/session/config/keyring/cookie/OAuth files are copied, parsed, migrated, or deleted.
- Node runtime remains `>=24 <25`; DSH target remains `0.1.1-rc.2`.
- Codex `0.150.0` is the CachyOS live baseline for this RC, but runtime compatibility is validated by App Server behavior rather than an exact-version hard gate.
- Windows remains not tested unless a separate Windows acceptance is run.
- GitHub Actions remain `BLOCKED_BILLING`; no hosted-CI PASS may be claimed.
- Published `0.1.0-rc.1` artifacts are immutable and must not be unpublished.

---

### Task 1: Replace managed Codex package resolution with external executable resolution

**Files:**
- Modify: `packages/codex/src/resolver.ts`
- Modify: `packages/codex/src/run.ts`
- Modify: `packages/codex/src/codex-plugin-dsh/adapter.ts`
- Modify: `packages/codex/src/index.ts`
- Modify: `packages/codex/test/resolver.test.ts`
- Modify: `packages/codex/test/argv.test.ts`
- Modify: `packages/codex/test/primary-provider.test.ts`
- Modify: `packages/codex/test/registration.test.ts`
- Modify: `packages/codex/package.json`

**Interfaces:**
- Produces: `resolveCodexExecutable(options?): ResolvedVendorExecutable` from `packages/codex/src/resolver.ts`.
- Produces: `codexAppServerArgv(executable: string): string[]` using the resolved external CLI directly.
- Preserves: existing App Server JSON-RPC, subprocess ownership, memory policy, history replay, tools, attachments, search routing, and diagnostics.

- [ ] **Step 1: Rewrite resolver tests first**

Replace package-local target-triple assertions with executable-boundary cases:

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveCodexExecutable } from '../src/resolver.js'

test('explicit DSH_CODEX_EXECUTABLE wins over PATH', () => {
  const result = resolveCodexExecutable({
    env: { DSH_CODEX_EXECUTABLE: '/opt/codex/bin/codex', PATH: '/usr/bin' },
    isExecutable: (path) => path === '/opt/codex/bin/codex',
  })
  assert.equal(result.executable, '/opt/codex/bin/codex')
  assert.equal(result.source, 'override')
})

test('PATH resolves codex when no override is set', () => {
  const result = resolveCodexExecutable({
    env: { PATH: '/usr/local/bin:/usr/bin' },
    isExecutable: (path) => path === '/usr/local/bin/codex',
  })
  assert.equal(result.executable, '/usr/local/bin/codex')
  assert.equal(result.source, 'path')
})

test('invalid override fails closed and never falls back to PATH', () => {
  assert.throws(
    () => resolveCodexExecutable({
      env: { DSH_CODEX_EXECUTABLE: '/missing/codex', PATH: '/usr/bin' },
      isExecutable: () => false,
    }),
    /configured Codex executable is not executable/,
  )
})

test('missing Codex yields a stable actionable diagnostic', () => {
  assert.throws(
    () => resolveCodexExecutable({ env: { PATH: '/usr/bin' }, isExecutable: () => false }),
    /Codex CLI is unavailable/,
  )
})
```

- [ ] **Step 2: Run the focused resolver/argv tests and confirm RED**

Run:

```bash
pnpm --filter nishi-dsh-codex test -- resolver.test.ts argv.test.ts
```

Expected: FAIL because the current resolver still resolves `@openai/codex` package manifests and platform packages.

- [ ] **Step 3: Replace `resolveManagedCodexRuntime` with external executable resolution**

Implement a small injectable resolver in `packages/codex/src/resolver.ts`:

```ts
export interface ResolvedVendorExecutable {
  readonly executable: string
  readonly source: 'override' | 'path'
}

export interface CodexExecutableResolutionOptions {
  readonly env?: NodeJS.ProcessEnv
  readonly isExecutable?: (path: string) => boolean
  readonly platform?: NodeJS.Platform
}

export function resolveCodexExecutable(
  options: CodexExecutableResolutionOptions = {},
): ResolvedVendorExecutable
```

Requirements for the implementation:

```ts
const overrideName = 'DSH_CODEX_EXECUTABLE'
const executableName = process.platform === 'win32' ? 'codex.exe' : 'codex'
```

Use only the explicit override and the current `PATH`; do not inspect npm globals, vendor homes, lockfiles, package-manager databases, or credential locations. An explicit invalid override is authoritative and must fail rather than silently falling through to another binary.

- [ ] **Step 4: Change Codex argv construction to invoke the external executable directly**

Replace the current `process.execPath + @openai/codex/bin/codex.js` wrapper chain with:

```ts
export function codexAppServerArgv(executable: string): string[] {
  return [
    executable,
    '-c', 'memories.use_memories=false',
    '-c', 'memories.generate_memories=false',
    '-c', 'project_doc_max_bytes=0',
    'app-server',
    '--stdio',
  ]
}
```

Resolve the executable before process publication and keep the existing DSH subprocess service authoritative for lifecycle and teardown.

- [ ] **Step 5: Update primary-provider startup to use the same executable boundary**

Where `packages/codex/src/codex-plugin-dsh/adapter.ts` currently receives or derives a managed package executable, pass the resolved external executable into `AdapterConfig.executable`. Keep the existing App Server `initialize -> initialized` handshake as the runtime compatibility check; do not add an exact `0.147.0` or `0.150.0` equality gate.

- [ ] **Step 6: Remove Codex npm runtime dependencies**

Delete from `packages/codex/package.json`:

```json
"@openai/codex": "0.147.0",
"@openai/codex-sdk": "0.147.0"
```

Do not replace them with other Codex binary packages.

- [ ] **Step 7: Run Codex unit tests**

Run:

```bash
pnpm --filter nishi-dsh-codex check
pnpm --filter nishi-dsh-codex test
```

Expected: PASS, including resolver, argv, primary-provider, registration, lifecycle, memory, and package tests.

- [ ] **Step 8: Commit Task 1**

```bash
git add packages/codex
git commit -m "refactor(codex): use external codex cli"
```

---

### Task 2: Move Codex usage collection to the external Codex CLI

**Files:**
- Modify: `packages/codex-usage-source/src/index.ts`
- Create: `packages/codex-usage-source/src/executable.ts`
- Create: `packages/codex-usage-source/test/executable.test.ts`
- Create: `packages/codex-usage-source/test/runtime.test.ts`
- Modify: `packages/codex-usage-source/test/package.test.ts`
- Modify: `packages/codex-usage-source/package.json`

**Interfaces:**
- Produces: package-local `resolveCodexExecutable()` with the same override/PATH policy as Task 1 while keeping `codex-usage-source` independent from the full Codex provider package.
- Preserves: `initialize -> initialized -> account/rateLimits/read`, scrubbed env, bounded line size/timeout, no model thread, graceful disposal.

- [ ] **Step 1: Add failing executable and argv tests**

Use the same externally observable policy as Task 1, plus a runtime assertion:

```ts
test('usage source launches resolved codex app-server directly', async () => {
  const spawned: string[][] = []
  const source = createCodexUsageSource({
    resolveExecutable: () => '/usr/local/bin/codex',
    spawn: (spec) => {
      spawned.push(spec.argv)
      return fakeAppServerChild()
    },
  })
  await source.read()
  assert.deepEqual(spawned[0], ['/usr/local/bin/codex', 'app-server', '--stdio'])
})
```

- [ ] **Step 2: Run tests and confirm RED**

```bash
pnpm --filter nishi-dsh-codex-usage-source test
```

Expected: FAIL while `src/index.ts` still resolves `@openai/codex` from package-local installation.

- [ ] **Step 3: Implement the external resolver and wire it into the usage source**

Create `src/executable.ts` with the same `DSH_CODEX_EXECUTABLE -> PATH -> unavailable` policy. Keep it package-local instead of making `nishi-dsh-codex-usage-source` depend on the whole `nishi-dsh-codex` provider package.

Change the child argv to exactly:

```ts
[resolved.executable, 'app-server', '--stdio']
```

Keep the existing protocol and cleanup code unchanged beyond executable selection.

- [ ] **Step 4: Remove `@openai/codex` from the package manifest**

Delete:

```json
"@openai/codex": "0.147.0"
```

- [ ] **Step 5: Run Codex usage tests and typecheck**

```bash
pnpm --filter nishi-dsh-codex-usage-source check
pnpm --filter nishi-dsh-codex-usage-source test
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add packages/codex-usage-source
git commit -m "refactor(usage): use external codex cli"
```

---

### Task 3: Replace Claude Agent SDK runtime with direct Claude CLI stream-json execution

**Files:**
- Create: `packages/claude-code/src/executable.ts`
- Replace responsibility of: `packages/claude-code/src/process.ts`
- Modify: `packages/claude-code/src/run.ts`
- Modify: `packages/claude-code/src/index.ts`
- Modify: `packages/claude-code/test/process.test.ts`
- Create: `packages/claude-code/test/executable.test.ts`
- Create: `packages/claude-code/test/stream.test.ts`
- Modify: `packages/claude-code/test/options.test.ts`
- Modify: `packages/claude-code/test/registration.test.ts`
- Modify: `packages/claude-code/test/package.test.ts`
- Modify: `packages/claude-code/package.json`

**Interfaces:**
- Produces: `resolveClaudeExecutable(options?): ResolvedVendorExecutable`.
- Produces: `claudeCliArgv(spec): string[]` for one-shot non-interactive execution.
- Produces: `ClaudeStreamDecoder` or equivalent focused parser that accepts line-delimited JSON and returns assistant text, rate-limit invalidation events, permission diagnostics, and terminal result facts.
- Preserves: `DEFAULT_MODEL = 'claude-sonnet-5'`, `DEFAULT_EFFORT = 'high'`, unattended permission semantics, Project Memory prompt injection, cancellation, safe diagnostics, and DSH subprocess ownership.

- [ ] **Step 1: Add resolver tests before changing runtime code**

```ts
test('Claude executable override wins', () => {
  const result = resolveClaudeExecutable({
    env: { DSH_CLAUDE_EXECUTABLE: '/opt/claude', PATH: '/usr/bin' },
    isExecutable: (path) => path === '/opt/claude',
  })
  assert.equal(result.executable, '/opt/claude')
})
```

Add PATH hit, invalid override, and missing-client cases mirroring Codex.

- [ ] **Step 2: Add failing argv tests**

For the accepted default configuration, require an argv equivalent to:

```ts
[
  '/home/user/.local/bin/claude',
  '--print',
  '--verbose',
  '--output-format', 'stream-json',
  '--model', 'claude-sonnet-5',
  '--effort', 'high',
  '--permission-mode', 'auto',
]
```

When permission mode is `bypassPermissions`, add the CLI-supported bypass form and keep the existing explicit dangerous-mode opt-in policy. Do not add SDK-specific callback flags because the SDK is being removed.

- [ ] **Step 3: Add stream parser tests covering terminal and malformed cases**

Use NDJSON fixtures rather than SDK types:

```ts
const lines = [
  JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'hello' }] },
  }),
  JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '' }),
]
```

Required assertions:

```ts
assert.equal(result.text, 'hello')
assert.equal(result.stopReason, 'completed')
```

Also add tests for:

```text
malformed JSON line -> safe protocol failure
result subtype error_* -> mapped safe failure category
result success with assistant text but empty result field -> success
rate_limit_event -> usage invalidation callback
permission_denied system event -> diagnostic callback
EOF without terminal result -> missing-result failure
abort -> process terminate invoked
```

Important: collect assistant text from the stream instead of trusting only `result.result`; current Claude CLI reports exist where a valid assistant response is streamed but terminal `result` is empty.

- [ ] **Step 4: Run Claude tests and confirm RED**

```bash
pnpm --filter nishi-dsh-claude-code test
```

Expected: FAIL because current code imports `query`, `Options`, `Query`, `SDKResultMessage`, `SpawnOptions`, and `SpawnedProcess` from `@anthropic-ai/claude-agent-sdk`.

- [ ] **Step 5: Replace `process.ts` SDK projection with a focused line reader/managed child helper**

The new process layer should expose DSH subprocess behavior only. A suitable boundary is:

```ts
export interface ClaudeCliProcess {
  readonly child: SubprocessHandle
  readonly lines: AsyncIterable<string>
  readonly stderr: () => string
  terminate(): void
  waitForExit(): Promise<SubprocessOutcome>
}

export function startClaudeCliProcess(
  spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle,
  spec: SubprocessSpawnSpec,
): ClaudeCliProcess
```

Do not retain any Agent SDK process interfaces.

- [ ] **Step 6: Replace SDK query construction in `run.ts` with direct CLI execution**

Build the prompt with existing `claudePromptWithProjectMemory()`, resolve `claude`, spawn it with the DSH subprocess service, and parse stdout line-by-line.

Terminal behavior must be explicit:

```ts
if (event.type === 'result') {
  terminal = decodeResult(event)
  child.terminate()
  await child.waitForExit()
  return terminal
}
```

This intentionally does not wait indefinitely for Claude to exit after a terminal result event. There are upstream reports of headless `stream-json` processes remaining alive after emitting success; DSH remains the process-tree authority and should retire the process once the terminal protocol event is observed.

- [ ] **Step 7: Preserve accepted unattended semantics without SDK callbacks**

Translate the existing provider configuration to documented CLI flags. The plugin must not open an interactive approval flow. If a selected permission mode cannot be represented safely through the installed CLI, reject that Claude integration run with a stable unsupported-mode diagnostic rather than silently widening permissions.

Keep `claude-sonnet-5`, effort `high`, and existing Project Memory bootstrap text behavior.

- [ ] **Step 8: Remove the Agent SDK dependency**

Delete from `packages/claude-code/package.json`:

```json
"@anthropic-ai/claude-agent-sdk": "0.3.220"
```

No `@anthropic-ai/claude-agent-sdk-*` package may be introduced elsewhere.

- [ ] **Step 9: Run Claude package gates**

```bash
pnpm --filter nishi-dsh-claude-code check
pnpm --filter nishi-dsh-claude-code test
```

Expected: PASS.

- [ ] **Step 10: Commit Task 3**

```bash
git add packages/claude-code
git commit -m "refactor(claude): drive installed claude cli"
```

---

### Task 4: Bump the complete nine-package family to `0.1.0-rc.2` and refresh the lockfile

**Files:**
- Modify: all nine `packages/*/package.json` manifests
- Modify: `pnpm-lock.yaml`
- Modify as needed: exact internal dependency ranges in Suite and leaf packages

**Interfaces:**
- Produces: one internally consistent exact `0.1.0-rc.2` family.
- Removes: all package-lock references introduced solely by `@openai/codex*` and `@anthropic-ai/claude-agent-sdk*` runtime dependencies.

- [ ] **Step 1: Add/adjust release-family expectations before changing versions**

Update existing tests/verifiers to expect:

```js
const expectedVersion = '0.1.0-rc.2'
```

and exact internal dependencies:

```text
nishi-dsh-* -> 0.1.0-rc.2
```

- [ ] **Step 2: Run release-family verifier and confirm RED**

```bash
pnpm verify:release-family
```

Expected: FAIL while manifests still contain `0.1.0-rc.1`.

- [ ] **Step 3: Change all nine manifests together**

Set `version` to `0.1.0-rc.2` for:

```text
nishi-dsh-codex
nishi-dsh-antigravity
nishi-dsh-claude-code
nishi-dsh-project-memory
nishi-dsh-usage-limits
nishi-dsh-codex-usage-source
nishi-dsh-primary-web-search
nishi-dsh-usage-limits-host
nishi-dsh-suite
```

Update every exact internal dependency to `0.1.0-rc.2` in the same change.

- [ ] **Step 4: Regenerate lockfile under the accepted toolchain**

```bash
corepack enable
pnpm install --lockfile-only
```

Expected: `pnpm-lock.yaml` no longer resolves Nishi-owned runtime paths through the forbidden vendor packages.

- [ ] **Step 5: Verify the family**

```bash
pnpm verify:release-family
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add packages pnpm-lock.yaml scripts/verify-release-family.mjs
git commit -m "chore(release): prepare 0.1.0-rc.2 family"
```

---

### Task 5: Harden package and packed-artifact contracts against vendor binary regressions

**Files:**
- Modify: `scripts/verify-package-contracts.mjs`
- Modify: `scripts/verify-release-family.mjs`
- Modify: `scripts/pack-local.mjs` if packed-manifest inspection needs a hook
- Modify: `packages/codex/test/package.test.ts`
- Modify: `packages/claude-code/test/package.test.ts`
- Modify: `packages/codex-usage-source/test/package.test.ts`

**Interfaces:**
- Produces: deterministic forbidden-runtime check for direct Nishi runtime dependencies and packed manifests.

- [ ] **Step 1: Add a failing forbidden-package helper contract**

Implement/verify against this exact predicate:

```js
function forbiddenVendorRuntime(name) {
  return name === '@openai/codex'
    || name === '@openai/codex-sdk'
    || name.startsWith('@openai/codex-')
    || name === '@anthropic-ai/claude-agent-sdk'
    || name.startsWith('@anthropic-ai/claude-agent-sdk-')
}
```

Scan runtime `dependencies` and `optionalDependencies` of every Nishi manifest. Dev dependencies must not leak into packed runtime manifests.

- [ ] **Step 2: Add a negative fixture/test proving the verifier rejects a regression**

The test should construct or temporarily project a manifest containing:

```json
{
  "dependencies": {
    "@openai/codex": "0.150.0"
  }
}
```

Expected verifier result: non-zero with the exact offending package named.

- [ ] **Step 3: Run verifier and confirm RED against pre-fix state if any forbidden dependency remains**

```bash
pnpm verify:package-contracts
```

- [ ] **Step 4: Make packed-manifest verification explicit**

After `pnpm pack:local`, inspect each tarball's `package/package.json` and assert no forbidden dependency keys exist. Keep this independent from node_modules state so a clean manifest cannot be masked by an already-populated workspace store.

- [ ] **Step 5: Run contract and pack gates**

```bash
pnpm verify:package-contracts
pnpm pack:local
```

Expected: PASS with exactly nine `0.1.0-rc.2` tarballs and no forbidden vendor runtime dependency in any packed manifest.

- [ ] **Step 6: Commit Task 5**

```bash
git add scripts packages/*/test
git commit -m "test: forbid bundled vendor runtimes"
```

---

### Task 6: Extend isolated install verification to assert foreign-platform binaries are absent

**Files:**
- Modify: `scripts/verify-bundle-install.mjs`
- Create: `docs/acceptance/2026-08-27-vendor-runtime-install.md` only after real output exists

**Interfaces:**
- Produces: install verification that checks both Nishi family resolution and absence of vendor package-local platform payloads.

- [ ] **Step 1: Add explicit dependency-graph assertions to the verifier**

After Suite installation, parse the profile dependency listing/lockfile and reject any name matching the forbidden predicate from Task 5.

Also reject concrete foreign-platform examples if they appear transitively:

```text
@openai/codex-win32-*
@openai/codex-darwin-*
@openai/codex-linux-arm64*
@anthropic-ai/claude-agent-sdk-win32-*
@anthropic-ai/claude-agent-sdk-darwin-*
@anthropic-ai/claude-agent-sdk-linux-arm64*
@anthropic-ai/claude-agent-sdk-linux-x64-musl
```

The stronger rule is still that no Codex/Claude vendor runtime package from the forbidden families exists at all.

- [ ] **Step 2: Run the complete local repository gate**

```bash
pnpm verify:local
```

Expected: PASS under Node 24 / pnpm 11.21.0.

- [ ] **Step 3: Run the isolated bundle install verifier using freshly packed RC2 tarballs**

```bash
pnpm verify:bundle-install -- --local-pack-dir .artifacts/packs
```

Expected: PASS, with the isolated DSH home containing the Nishi packages but no forbidden Codex/Claude vendor runtime packages.

- [ ] **Step 4: Do not write acceptance PASS documentation until real command output exists**

When operator output is available, record exact Node/pnpm/DSH versions, verifier command, PASS/FAIL, and observed dependency graph. Do not infer PASS from source inspection alone.

- [ ] **Step 5: Commit Task 6 after local evidence**

```bash
git add scripts/verify-bundle-install.mjs docs/acceptance/2026-08-27-vendor-runtime-install.md
git commit -m "test: verify vendor runtime free install"
```

---

### Task 7: Run live external-client acceptance before publication

**Files:**
- Create after evidence: `docs/acceptance/2026-08-27-vendor-cli-live.md`
- Modify if needed after compatibility findings: Codex/Claude runtime code and focused tests

**Interfaces:**
- Validates: installed `codex`, `claude`, and `agy` boundaries on CachyOS/Linux.

- [ ] **Step 1: Capture actual external client versions**

Run:

```bash
which codex && codex --version
which claude && claude --version
which agy && agy --version
```

Expected baseline for Codex on the current host:

```text
/home/acedia/.local/bin/codex
codex-cli 0.150.0
```

Do not hard-code Claude/agy versions in docs until the command output is captured for this acceptance run.

- [ ] **Step 2: Run Codex primary and subagent live checks**

Use a fresh isolated profile with local RC2 tarballs, external `codex` in `PATH`, and no package-local `@openai/codex`. Verify App Server initialization, one primary turn, one subagent turn, Project Memory bridge, routed search, cancellation/teardown, and usage limits read.

- [ ] **Step 3: Run Claude subagent live check**

Verify one successful non-interactive task using external `claude`, default model `claude-sonnet-5`, effort `high`, accepted unattended permission mode, Project Memory context, terminal result handling, and no leaked Claude child after completion.

Because upstream stream-json hangs have been reported after terminal result, explicitly verify no lingering child process remains after the DSH run settles.

- [ ] **Step 4: Run Antigravity regression check**

Verify existing `agy` primary/subagent/search behavior remains unchanged and no new Antigravity dependency was introduced.

- [ ] **Step 5: Record only observed results**

Write `docs/acceptance/2026-08-27-vendor-cli-live.md` with command/output facts. Mark any unrun platform as `NOT TESTED` rather than inferred.

- [ ] **Step 6: Commit Task 7**

```bash
git add docs/acceptance packages
git commit -m "docs: record external vendor cli acceptance"
```

---

### Task 8: Update release documentation and prepare the RC2 publication gate

**Files:**
- Modify: `README.md`
- Modify: `docs/release/prerelease.md`
- Modify: `docs/roadmap.md` if present/publicly relevant

**Interfaces:**
- Documents: external vendor prerequisites, no bundled vendor runtimes, RC2 upgrade semantics, Linux-only validation scope.

- [ ] **Step 1: Update installation prerequisites**

README must state plainly:

```text
Nishi DSH Suite does not install Codex, Claude Code, or Antigravity.
Install the official vendor clients separately and ensure `codex`, `claude`, and `agy` are available on PATH (or use the documented executable overrides where supported).
```

Document `DSH_CODEX_EXECUTABLE` and `DSH_CLAUDE_EXECUTABLE` without suggesting credential copying.

- [ ] **Step 2: Update prerelease runbook for RC2**

Record that RC2 specifically removes package-local Codex/Claude runtimes and that publication is blocked until Tasks 1-7 have fresh PASS evidence.

- [ ] **Step 3: Run the final pre-publication gate**

```bash
pnpm verify:local
pnpm verify:bundle-install -- --local-pack-dir .artifacts/packs
```

Expected: PASS. GitHub Actions remain `BLOCKED_BILLING` and are not retried as a substitute.

- [ ] **Step 4: Commit Task 8**

```bash
git add README.md docs
git commit -m "docs: prepare vendor cli rc2 release"
```

---

### Task 9: Publish `0.1.0-rc.2` leaves-first under `next`

**Files:**
- No source edits unless publication exposes a release blocker.
- Update `docs/release/prerelease.md` only after registry evidence exists.

**Interfaces:**
- Produces: nine public npm packages at exactly `0.1.0-rc.2`.

- [ ] **Step 1: Verify npm operator identity**

```bash
npm whoami
```

Expected: `nishimihaeru`.

- [ ] **Step 2: Publish in dependency order with explicit `next`**

Publish exactly:

```text
1. nishi-dsh-codex
2. nishi-dsh-antigravity
3. nishi-dsh-claude-code
4. nishi-dsh-project-memory
5. nishi-dsh-usage-limits
6. nishi-dsh-codex-usage-source
7. nishi-dsh-primary-web-search
8. nishi-dsh-usage-limits-host
9. nishi-dsh-suite
```

Use:

```bash
npm publish <tarball> --tag next
```

for the exact freshly verified RC2 tarballs. Do not republish or unpublish RC1.

- [ ] **Step 3: Verify all nine registry versions**

For every package:

```bash
npm view <package>@0.1.0-rc.2 version
```

Expected: `0.1.0-rc.2`.

- [ ] **Step 4: Verify `next` points to RC2**

```bash
npm view nishi-dsh-suite dist-tags
```

Expected: `next` resolves to `0.1.0-rc.2`. Do not treat unavoidable npm first-version `latest` history on RC1 as a reason to unpublish anything.

- [ ] **Step 5: Record publication evidence**

Update `docs/release/prerelease.md` only with observed registry results.

---

### Task 10: Perform the real `rc.1 -> rc.2` upgrade and clean the user's actual DSH profile

**Files:**
- Create after evidence: `docs/acceptance/2026-08-27-rc1-to-rc2-upgrade.md`

**Interfaces:**
- Validates: version-to-version upgrade, preset update, pruning of duplicate Codex/Claude runtime closure, preservation of unrelated DSH plugin and vendor state.

- [ ] **Step 1: Snapshot the real profile before upgrade**

The current real profile includes unrelated `dsh-chatgpt-web` and must preserve it. Capture:

```bash
dsh plugin --profile web list --depth 0 --json
```

Expected pre-state includes `nishi-dsh-suite@0.1.0-rc.1`, package-local `@openai/codex@0.147.0`, `@openai/codex-sdk@0.147.0`, and `@anthropic-ai/claude-agent-sdk@0.3.220`.

- [ ] **Step 2: Upgrade the real profile to exact RC2**

```bash
dsh plugin --profile web add nishi-dsh-suite@0.1.0-rc.2
```

Then update the managed preset:

```bash
dsh plugin --profile web exec nishi-dsh-suite preset update
dsh plugin --profile web exec nishi-dsh-suite preset status
```

Expected preset status: `current`.

- [ ] **Step 3: Verify pnpm pruned the old vendor runtime closure**

Run:

```bash
dsh plugin --profile web list --depth 0 --json
```

The resulting dependency listing must not contain:

```text
@openai/codex
@openai/codex-linux-x64
@openai/codex-sdk
@anthropic-ai/claude-agent-sdk
@anthropic-ai/claude-agent-sdk-linux-x64
```

and must retain `dsh-chatgpt-web` unchanged.

Do not manually delete `node_modules` entries if reconciliation fails; treat remaining forbidden packages as an upgrade blocker and fix package graph/reconciliation first.

- [ ] **Step 4: Verify global vendor clients are untouched**

```bash
which codex && codex --version
which claude && claude --version
which agy && agy --version
```

Expected Codex path/version remains the independently installed global client, currently `/home/acedia/.local/bin/codex` / `codex-cli 0.150.0` unless the user intentionally upgrades it separately.

- [ ] **Step 5: Run representative real-profile checks**

Start normal DSH/Web and exercise Codex, Claude, Antigravity, Project Memory, routed search, and Usage & Limits sufficiently to prove the upgraded real profile composes normally.

- [ ] **Step 6: Remove temporary smoke caches only, never vendor homes**

If `/tmp/.pnpm-store/v11` exists solely from the disposable smoke and is no longer needed:

```bash
rm -rf /tmp/.pnpm-store/v11
```

Do not remove `~/.codex`, `~/.claude`, any `agy` vendor state, global CLI binaries, keyrings, cookies, OAuth state, or unrelated DSH profiles/plugins.

- [ ] **Step 7: Record the real upgrade evidence**

Create `docs/acceptance/2026-08-27-rc1-to-rc2-upgrade.md` with the before/after package facts, preset state, preserved `dsh-chatgpt-web`, external CLI versions, and cleanup outcome.

- [ ] **Step 8: Commit Task 10**

```bash
git add docs/acceptance/2026-08-27-rc1-to-rc2-upgrade.md docs/release/prerelease.md README.md
git commit -m "docs: record rc1 to rc2 upgrade acceptance"
```

---

## Plan self-review

- Spec coverage: executable boundaries, Codex primary/subagent, Codex usage, Claude CLI migration, forbidden runtime graph, nine-package versioning, isolated install, live external-client acceptance, publication, real upgrade, cleanup, preservation, and Windows/CI scope are each mapped to a task.
- Placeholder scan: no `TBD`, `TODO`, deferred implementation prose, or unspecified test steps remain.
- Type consistency: Codex/Claude executable resolver result uses the same `{ executable, source }` shape conceptually but stays package-local to preserve package independence; no later task relies on a new tenth shared package.
- Safety check: no task deletes vendor homes/auth state or manually edits the real profile's nested `node_modules`; real cleanup occurs through RC2 reconciliation.
