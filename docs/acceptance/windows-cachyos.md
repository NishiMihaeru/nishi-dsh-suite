# Fresh Windows + CachyOS acceptance

Status: **CACHYOS CORE RUNTIME PASS / LIVE PROVIDERS + WINDOWS PENDING**

This is the release gate for Nishi DSH Suite. Windows and CachyOS/Linux are tested as **independent ordinary DSH installations**. No DSH home, session store, vendor credential store, or runtime state is copied between operating systems.

Executed CachyOS evidence:

- deterministic local verification: `docs/acceptance/2026-08-26-cachyos-local-verification.md`
- isolated fresh-profile/runtime acceptance: `docs/acceptance/2026-08-26-cachyos-runtime-acceptance.md`

## Preconditions on each OS

- DeepSeek Harness `0.1.1-rc.2` installed normally;
- Node.js 24;
- pnpm 11.21.0 available through Corepack;
- Suite tarballs produced by `pnpm verify:local`, or the published `nishi-dsh-suite@0.1.0-rc.1` prerelease;
- official vendor clients installed/authenticated only for live gates that exercise them:
  - `codex` for Codex;
  - `claude` for Claude Code;
  - `agy` for Antigravity.

A missing vendor client must make only its integration unavailable/auth-required; it must not prevent DSH/Suite startup.

## 1. Deterministic repository gates

Run on the exact commit under acceptance:

```bash
corepack enable
pnpm install
pnpm verify:local
```

`verify:local` covers release/package contracts, Orchestrator validation, TypeScript checks, tests, build, and local tarball creation. Record Node, pnpm, DSH, OS, and commit SHA with the results.

## 2. Fresh normal profile install

Use a disposable profile name unique to the OS, for example:

```text
Windows: nishi-accept-windows
CachyOS: nishi-accept-cachyos
```

Do not point `DSH_HOME` at another machine's or another OS's home.

Before running the verifier, prepare preserve paths that must not be mutated by Suite lifecycle operations. At minimum include:

- an unrelated DSH session/history path;
- a test project's files;
- the test project's `.dsh/memory` directory after creating a sentinel memory entry;
- any vendor-owned auth/config path selected for the test, if safe to hash locally.

Then run:

```bash
node scripts/verify-bundle-install.mjs \
  --profile <fresh-profile> \
  --suite <suite-tarball-or-npm-spec> \
  --preserve <unrelated-session-path> \
  --preserve <test-project-path> \
  --preserve <vendor-owned-path>
```

On PowerShell, pass the same arguments on one line or with PowerShell backtick continuations.

Expected:

- `nishi-dsh-suite` becomes a direct profile dependency;
- it appears exactly once in `dsh.profile.bundles`;
- reinstall/reconciliation is idempotent;
- uninstall removes only the Suite profile dependency/bundle layer;
- all preserve hashes remain unchanged.

When a second RC exists, rerun with `--update-spec <next-suite-spec>` so version-to-version update is exercised rather than only idempotent reinstall.

## 3. Orchestrator preset bridge

After installing Suite into the test profile, use that profile's installed binary:

```bash
dsh plugin --profile <fresh-profile> exec nishi-dsh-suite preset status
dsh plugin --profile <fresh-profile> exec nishi-dsh-suite preset install
dsh plugin --profile <fresh-profile> exec nishi-dsh-suite preset status
```

Expected on a fresh DSH home:

- first status is `absent`;
- install creates the managed `$DSH_HOME/.agent-presets/orchestrator`;
- second status is `current`;
- no `.orchestrator.nishi-stage-*` or `.orchestrator.nishi-backup-*` entry remains after success;
- an unmanaged pre-existing `orchestrator` is refused;
- a local edit changes status to `modified` and blocks update/removal;
- sibling user presets are preserved.

After a real Suite version update:

```bash
dsh plugin --profile <fresh-profile> exec nishi-dsh-suite preset status
dsh plugin --profile <fresh-profile> exec nishi-dsh-suite preset update
```

Expected: old managed copy reports `outdated`, then becomes `current`.

Before Suite uninstall:

```bash
dsh plugin --profile <fresh-profile> exec nishi-dsh-suite preset remove
```

Expected: only the managed Orchestrator disappears. Then uninstall Suite and confirm preserve hashes remain unchanged.

Automatic one-click Market discovery without this bridge remains the upstream issue #2.

## 4. Startup without vendor clients

On a clean profile with the Suite installed, temporarily make each vendor executable unavailable one at a time and start DSH Web.

Expected:

- DSH Web still starts;
- Usage & Limits renders safe unavailable/login-required state rather than crashing;
- unrelated providers remain usable;
- no Suite component installs a missing vendor client automatically;
- no direct subscription OAuth flow is started by DSH.

## 5. Codex live gates

With official `codex` installed and authenticated:

- Codex primary route starts and completes a bounded prompt;
- `subagent_codex` completes a bounded delegated prompt;
- routed `web_search` works while `DEEPSEEK_API_KEY` is unset;
- search does not call the stock DeepSeek web provider;
- Project Memory is readable through the accepted read-only bridge;
- Codex rate limits populate Usage & Limits without leaking raw auth material.

Known accepted debt: stock Codex may still observe global `AGENTS` behavior that cannot currently be fully suppressed by the DSH provider boundary.

## 6. Claude Code live gates

With official `claude` installed and authenticated:

- `subagent_claude_code` completes a bounded prompt;
- default integration behavior remains model `claude-sonnet-5`, effort `high`, permission mode `auto` unless explicitly configured otherwise;
- Project Memory bridge is read-only;
- usage collection failure is isolated from the rest of the Suite.

Claude subscription primary login is not part of this release gate.

## 7. Antigravity live gates

With official `agy` installed and authenticated:

- Antigravity primary completes a bounded prompt;
- `subagent_antigravity` completes a bounded delegated prompt;
- routed `web_search` uses the `agy search_web` boundary with `DEEPSEEK_API_KEY` unset;
- no dangerous permission-skip flag is used;
- Project Memory bootstrap/read path remains read-only;
- usage collection failure is isolated.

Policy note: support for the official `agy` boundary is technically tested here; this acceptance does not represent the third-party harness integration as Google-approved.

## 8. Project Memory

In a temporary project:

1. create bootstrap/topic memory through normal DSH memory tools;
2. verify it is stored under that project;
3. start Codex, Claude Code, and Antigravity child paths and verify accepted read-only visibility;
4. remove the managed Orchestrator preset;
5. uninstall Suite;
6. verify project files and `.dsh/memory` are unchanged;
7. reinstall Suite + preset and verify the same project memory is available again.

There is no cross-OS or cross-machine memory synchronization gate.

## 9. Usage & Limits UI

Verify on DSH Web:

- Codex, Claude, and Antigravity groups render independently;
- unavailable collectors do not hide healthy collectors;
- public RPC errors do not contain local stderr, paths, tokens, or raw credential records;
- compact sidebar state and full settings state agree;
- Model Accounts does not expose or initiate vendor subscription OAuth;
- legacy DSH grants, if intentionally staged for the test, can be removed without deleting unrelated API-key records.

## Acceptance record

Both OS rows must be explicitly recorded before the RC is promoted:

| Gate | Windows | CachyOS |
| --- | --- | --- |
| install/check/test/build/pack | PENDING | PASS |
| fresh profile install | PENDING | PASS |
| preset install/status/update/remove | PENDING | PASS |
| DSH discovers/selects Orchestrator | PENDING | PASS |
| real version-to-version update | PENDING | PENDING |
| uninstall preserves state | PENDING | PASS |
| Codex primary/subagent/search | PENDING | PENDING |
| Claude Code subagent | PENDING | PENDING |
| Antigravity primary/subagent/search | PENDING | PENDING |
| Project Memory live provider bridge | PENDING | PENDING |
| Usage & Limits runtime/UI | PENDING | PENDING |
| automatic one-click preset discovery | BLOCKED_UPSTREAM | BLOCKED_UPSTREAM |

A row becomes `PASS` only from an executed gate with captured command/output or an attached acceptance note. Static inspection is not a substitute for a PASS.
