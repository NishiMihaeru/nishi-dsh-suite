# Windows + CachyOS acceptance matrix

Status: **CACHYOS LIVE RUNTIME PASS / WINDOWS DEFERRED — NOT TESTED FOR `0.1.0-rc.1`**

Windows and CachyOS/Linux are always independent ordinary DSH installations. No DSH home, session store, vendor credential store, or runtime state is copied between operating systems.

For the first Nishi prerelease (`0.1.0-rc.1`) the release scope has been intentionally narrowed to **CachyOS/Linux validated**. Windows acceptance is deferred to a later release cycle and no Windows compatibility claim is made for this RC. A future Windows run must execute the same categories below on Windows; static inspection or Linux results cannot be promoted into a Windows PASS.

## Executed CachyOS evidence

- deterministic local verification: `docs/acceptance/2026-08-26-cachyos-local-verification.md`
- isolated fresh-profile/runtime acceptance: `docs/acceptance/2026-08-26-cachyos-runtime-acceptance.md`
- Codex primary/subagent/search acceptance on Node 24: `docs/acceptance/2026-08-26-cachyos-codex-primary-acceptance.md`
- intermediate provider/Usage acceptance: `docs/acceptance/2026-08-26-cachyos-remaining-live.md` (superseded by final live acceptance)
- final authenticated Claude + Antigravity live acceptance: `docs/acceptance/2026-08-26-cachyos-final-live.md`
- pre-Windows/source semantics audit: `docs/acceptance/2026-08-26-pre-windows-source-audit.md`
- prepublish standalone-profile verifier acceptance: `docs/acceptance/2026-08-26-pre-windows-verifier-regression.md`

The acceptance records are based on executed local reports from the CachyOS environment; they were not inferred from static repository inspection.

## Baseline contract

Validated release baseline:

- DeepSeek Harness `0.1.1-rc.2`;
- Node.js 24;
- pnpm `11.21.0`;
- Nishi package family `0.1.0-rc.1`;
- official vendor product authentication owned by Codex, Claude Code, and `agy`, never copied or replayed by the Suite.

A missing vendor client must make only its integration unavailable/auth-required; it must not prevent DSH/Suite startup.

## Acceptance categories

### 1. Deterministic repository gate

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify:local
```

CachyOS Node 24 execution: **PASS**.

### 2. Fresh profile lifecycle

The Suite must install into a disposable ordinary DSH profile, reconcile idempotently, and uninstall without modifying preserved session/project/vendor state.

Before npm publication, `scripts/verify-bundle-install.mjs --local-pack-dir <packs>` may use acceptance-only profile overrides for the eight unpublished Nishi leaves while installing the unchanged real Suite tarball. The verifier must restore the DSH-generated profile workspace afterward.

CachyOS prepublish install/reinstall/uninstall: **PASS**.

The actual DSH profile contract was machine-checked as:

```yaml
packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
```

### 3. Orchestrator preset bridge

Required rc.2 behavior:

```bash
dsh plugin --profile <profile> exec nishi-dsh-suite preset status
dsh plugin --profile <profile> exec nishi-dsh-suite preset install
dsh plugin --profile <profile> exec nishi-dsh-suite preset status
```

Expected fresh state: `absent` → `current`.

The bridge must refuse unmanaged/local-edited targets, preserve sibling presets, avoid leftover stage/backup entries, and remove only its managed Orchestrator.

CachyOS install/status/idempotence/safety/remove/discovery through the user preset root: **PASS**.

Native automatic third-party packaged-preset discovery remains `BLOCKED_UPSTREAM` on DSH `0.1.1-rc.2` (issue #2).

### 4. Missing-client isolation

With global vendor executables unavailable one at a time:

- DSH Web/Suite still starts;
- unrelated providers remain usable;
- no vendor client is installed automatically;
- no DSH-managed vendor subscription OAuth starts;
- no credentials are copied.

CachyOS: **PASS** for missing global Codex, Claude, and `agy`. Managed Codex primary remains independent of global Codex PATH.

### 5. Codex live gates

Required:

- `codex-app-server` primary bounded prompt;
- `subagent_codex` bounded prompt;
- Codex-native routed `web_search` with `DEEPSEEK_API_KEY` unset;
- no DeepSeek/Exa/Perplexity fallback;
- Project Memory read-only visibility with hash preservation;
- safe Usage & Limits collection.

CachyOS Node 24: **PASS**.

### 6. Claude Code live gates

Required:

- `subagent_claude_code` bounded prompt;
- model `claude-sonnet-5`;
- effort `high`;
- permission `auto`;
- Project Memory read-only visibility with hash preservation;
- usage failure/success isolated from other providers.

CachyOS with Claude Code `2.1.246`: **PASS**.

### 7. Antigravity live gates

Required:

- `antigravity-cli` primary bounded prompt;
- `subagent_antigravity` bounded prompt;
- routed `web_search` through official `agy` search boundary;
- `DEEPSEEK_API_KEY` unset and no fallback;
- no dangerous permission-skip flags;
- Project Memory read-only visibility with hash preservation.

CachyOS with `agy` `1.1.21`: **PASS**.

### 8. Project Memory aggregate

Codex, Claude Code, and Antigravity child paths must all read the same project-local sentinel while byte-for-byte SHA-256 hashes remain unchanged.

CachyOS aggregate: **PASS**.

No cross-OS or cross-machine memory synchronization is part of the product or acceptance contract.

### 9. Usage & Limits UI

Required:

- Codex/Claude/Antigravity groups remain independent;
- one collector failure cannot hide healthy collectors;
- browser/RPC projection excludes tokens, cookies, passwords, raw credential records, raw stderr, sensitive local paths, loopback ports, and CSRF material;
- sidebar and settings projections load;
- Model Accounts does not initiate vendor subscription OAuth.

CachyOS aggregate runtime/UI: **PASS**. Final smoke observed all three provider groups AVAILABLE and DSH Web HTTP 200.

## Current acceptance matrix

| Gate | Windows | CachyOS |
| --- | --- | --- |
| install/check/test/build/pack | NOT_TESTED / DEFERRED | PASS |
| fresh profile install/reinstall/uninstall | NOT_TESTED / DEFERRED | PASS |
| profile `nodeLinker` / `autoInstallPeers` contract | NOT_TESTED / DEFERRED | PASS |
| preset install/status/safety/remove | NOT_TESTED / DEFERRED | PASS |
| DSH discovers/selects Orchestrator | NOT_TESTED / DEFERRED | PASS |
| uninstall preserves state | NOT_TESTED / DEFERRED | PASS |
| missing-client isolation | NOT_TESTED / DEFERRED | PASS |
| Codex primary/subagent/search | NOT_TESTED / DEFERRED | PASS |
| Claude Code subagent | NOT_TESTED / DEFERRED | PASS |
| Antigravity primary/subagent/search | NOT_TESTED / DEFERRED | PASS |
| Project Memory live provider bridge | NOT_TESTED / DEFERRED | PASS |
| Usage & Limits runtime/UI | NOT_TESTED / DEFERRED | PASS |
| automatic one-click preset discovery | BLOCKED_UPSTREAM | BLOCKED_UPSTREAM |
| real version-to-version Nishi update | PENDING FUTURE RC | PENDING FUTURE RC |

## Release interpretation

`0.1.0-rc.1` may be published as a **Linux/CachyOS-validated prerelease** once the remaining publication gates in `docs/release/prerelease.md` pass. Windows is not a blocker for that deliberately narrower claim because it is explicitly excluded from the RC's validated platform scope.

Do not later rewrite `NOT_TESTED / DEFERRED` as PASS without an executed Windows acceptance run.

The remaining project-level constraints after this scope decision are:

- fresh npm package-name availability immediately before first publish;
- explicit npm prerelease publication and post-publish registry smoke;
- GitHub Actions `BLOCKED_BILLING` (no hosted-CI PASS claimed);
- upstream DSH rc.2 preset-discovery issue #2;
- future real version-to-version update acceptance once a second intentional Nishi prerelease exists;
- Market eligibility/submission after its repository-age/topic/publication requirements are met.
