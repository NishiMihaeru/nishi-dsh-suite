# Fresh Windows + CachyOS acceptance

Status: **PREPARED / NOT EXECUTED**

This is the release gate for Nishi DSH Suite. Windows and CachyOS/Linux are tested as **independent ordinary DSH installations**. No DSH home, session store, vendor credential store, or runtime state is copied between operating systems.

## Preconditions on each OS

- DeepSeek Harness `0.1.1-rc.2` installed normally;
- Node.js 24;
- pnpm 11.21.0 available through Corepack;
- Suite tarballs produced by `node scripts/pack-local.mjs`, or the published `nishi-dsh-suite@0.1.0-rc.1` prerelease;
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
pnpm verify:release-family
pnpm check
pnpm test
pnpm build
pnpm test:orchestrator
node scripts/pack-local.mjs
```

Record Node, pnpm, DSH, OS, and commit SHA with the results.

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

## 3. Startup without vendor clients

On a clean profile with the Suite installed, temporarily make each vendor executable unavailable one at a time and start DSH Web.

Expected:

- DSH Web still starts;
- Usage & Limits renders safe unavailable/login-required state rather than crashing;
- unrelated providers remain usable;
- no Suite component installs a missing vendor client automatically;
- no direct subscription OAuth flow is started by DSH.

## 4. Codex live gates

With official `codex` installed and authenticated:

- Codex primary route starts and completes a bounded prompt;
- `subagent_codex` completes a bounded delegated prompt;
- routed `web_search` works while `DEEPSEEK_API_KEY` is unset;
- search does not call the stock DeepSeek web provider;
- Project Memory is readable through the accepted read-only bridge;
- Codex rate limits populate Usage & Limits without leaking raw auth material.

Known accepted debt: stock Codex may still observe global `AGENTS` behavior that cannot currently be fully suppressed by the DSH provider boundary.

## 5. Claude Code live gates

With official `claude` installed and authenticated:

- `subagent_claude_code` completes a bounded prompt;
- default integration behavior remains model `claude-sonnet-5`, effort `high`, permission mode `auto` unless explicitly configured otherwise;
- Project Memory bridge is read-only;
- usage collection failure is isolated from the rest of the Suite.

Claude subscription primary login is not part of this release gate.

## 6. Antigravity live gates

With official `agy` installed and authenticated:

- Antigravity primary completes a bounded prompt;
- `subagent_antigravity` completes a bounded delegated prompt;
- routed `web_search` uses the `agy search_web` boundary with `DEEPSEEK_API_KEY` unset;
- no dangerous permission-skip flag is used;
- Project Memory bootstrap/read path remains read-only;
- usage collection failure is isolated.

Policy note: support for the official `agy` boundary is technically tested here; this acceptance does not represent the third-party harness integration as Google-approved.

## 7. Project Memory

In a temporary project:

1. create bootstrap/topic memory through normal DSH memory tools;
2. verify it is stored under that project;
3. start Codex, Claude Code, and Antigravity child paths and verify accepted read-only visibility;
4. uninstall Suite;
5. verify project files and `.dsh/memory` are unchanged;
6. reinstall Suite and verify the same project memory is available again.

There is no cross-OS or cross-machine memory synchronization gate.

## 8. Usage & Limits UI

Verify on DSH Web:

- Codex, Claude, and Antigravity groups render independently;
- unavailable collectors do not hide healthy collectors;
- public RPC errors do not contain local stderr, paths, tokens, or raw credential records;
- compact sidebar state and full settings state agree;
- Model Accounts does not expose or initiate vendor subscription OAuth;
- legacy DSH grants, if intentionally staged for the test, can be removed without deleting unrelated API-key records.

## 9. Orchestrator

Run `pnpm test:orchestrator` on both systems.

Then verify actual preset discovery separately. The npm Suite artifact contains the preset under `packages/suite/presets/orchestrator`, but DSH `0.1.1-rc.2` does not currently provide a reliable third-party Market bundle seam for adding that package directory as a preset root. Automatic Market discovery therefore remains an **upstream blocker** until proven on the exact DSH build or a stable seam is added upstream.

Do not copy the preset into `$DSH_HOME/.agent-presets` as a hidden installer workaround for acceptance.

## Acceptance record

Both OS rows must be explicitly recorded before the RC is promoted:

| Gate | Windows | CachyOS |
| --- | --- | --- |
| install/check/test/build | PENDING | PENDING |
| pack manifest inspection | PENDING | PENDING |
| fresh profile install | PENDING | PENDING |
| update/reinstall | PENDING | PENDING |
| uninstall preserves state | PENDING | PENDING |
| Codex primary/subagent/search | PENDING | PENDING |
| Claude Code subagent | PENDING | PENDING |
| Antigravity primary/subagent/search | PENDING | PENDING |
| Project Memory | PENDING | PENDING |
| Usage & Limits | PENDING | PENDING |
| Orchestrator discovery | BLOCKED_UPSTREAM | BLOCKED_UPSTREAM |

A row becomes `PASS` only from an executed gate with captured command/output or an attached acceptance note. Static inspection is not a substitute for a PASS.
