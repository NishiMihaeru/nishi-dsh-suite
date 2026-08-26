# Orchestrator migration acceptance

Status: **PRESET_MIGRATED / MANAGED_USER_BRIDGE_READY / AUTO_DISCOVERY_BLOCKED_UPSTREAM_DSH_RC2**

## Migrated preset

The accepted Orchestrator preset is part of the Market package and future npm tarball at:

- `packages/suite/presets/orchestrator/preset.yml`
- `packages/suite/presets/orchestrator/agent.cordis.yml`

Its behavior is preserved from the accepted private-repository baseline except for the public package boundaries:

- Project Memory: `nishi-dsh-project-memory`
- primary-routed web search: `nishi-dsh-primary-web-search`

The fixed delegation tool identities remain:

- `subagent_codex` → provider `codex`
- `subagent_claude_code` → provider `claude-code`
- `subagent_antigravity` → provider `antigravity`

`scripts/validate-orchestrator.mjs` checks the packaged composition for unique row IDs, exactly one fixed tool per managed provider, exactly one Project Memory row, exactly one primary web-search row, and absence of retired package boundaries.

`packages/suite/package.json` includes and exports both preset files, so the DSH upstream blocker is automatic discovery only — the artifact itself contains the preset.

## Temporary DSH 0.1.1-rc.2 bridge

DSH rc.2 always includes the supported user preset root at `$DSH_HOME/.agent-presets` (default `~/.dsh/.agent-presets`). Until third-party package roots can be registered through bundle composition, Suite exposes an explicit CLI that installs only its Orchestrator into that user root.

For the normal Market-installed `web` profile:

```bash
dsh plugin --profile web exec nishi-dsh-suite preset install
dsh plugin --profile web exec nishi-dsh-suite preset status
dsh plugin --profile web exec nishi-dsh-suite preset update
dsh plugin --profile web exec nishi-dsh-suite preset remove
```

`dsh plugin` forwards to pnpm inside the selected profile, so the binary comes from the Suite version actually installed by Market.

The bridge's only persistent managed directory is:

```text
$DSH_HOME/.agent-presets/orchestrator/
```

Install/update may use transient `.orchestrator.nishi-stage-*` and `.orchestrator.nishi-backup-*` sibling directories under `$DSH_HOME/.agent-presets` so replacement can be performed by rename with rollback. Successful operations remove those transient directories.

The managed Orchestrator stores `.nishi-dsh-suite-preset.json` with the Suite version and SHA-256 hashes of every managed preset file. The bridge refuses to overwrite an existing unmanaged `orchestrator`, and it refuses update/removal after local edits. It does not chmod an existing user preset root.

No profile dependencies, sessions, project files, Project Memory, DSH credentials, or vendor-owned state are modified by the bridge.

Because DSH rc.2 has no bundle uninstall hook for this user directory, acceptance requires `preset remove` **before Market uninstall**. After a Market update, acceptance requires `preset update` so the copied user preset matches the newly installed Suite.

## DSH 0.1.1-rc.2 upstream blocker

DSH rc.2 discovers presets from configured roots plus the user preset root, but CLI boot composition overwrites the `agent-presets` row's configured `roots` with the shipped preset root at runtime. Therefore a third-party bundle cannot reliably expose its own package preset directory merely by patching `agent-presets.config.roots`.

`@deepseek-ai/dsh-agent-presets` also derives its resolved roots once in its constructor and exposes no supported dynamic `registerRoot()` seam, so changing the service config after startup is not a valid workaround.

The Suite intentionally does **not** add a misleading `agent-presets` root patch, monkeypatch the service, or copy files during DSH startup. The user-preset bridge is an explicit lifecycle command, not a hidden install side effect.

Tracking issue: #2.

## Executable acceptance

On both Windows and CachyOS, after installing the exact Suite build under test:

1. `preset status` reports `absent` on a fresh DSH home.
2. `preset install` creates the managed Orchestrator and leaves no transient staging/backup directories after success; `status` becomes `current`.
3. DSH lists and can select the Orchestrator preset.
4. A second `preset install` is idempotent.
5. Updating Suite followed by `preset status` reports `outdated`; `preset update` makes it `current` and leaves no transient staging/backup directories.
6. A deliberate local edit makes status `modified`, and both `update` and `remove` refuse to destroy the edit.
7. An unmanaged pre-existing `orchestrator` directory is never overwritten.
8. `preset remove` removes only the managed Orchestrator and preserves sibling user presets.
9. Market uninstall after `preset remove` leaves sessions, project memory, credentials, and vendor-owned state unchanged.

These remain **PENDING** until executed on the exact built tarball/npm prerelease.

## Exit criteria for issue #2

The explicit bridge can be retired when either:

1. a DSH release preserves/merges third-party preset roots contributed through normal bundle composition; or
2. DSH exposes a supported dynamic preset/root registration API with lifecycle/trust semantics that lets the packaged preset register without mutating the user's preset directory.

Until then, do not claim that Market install alone automatically makes Orchestrator discoverable; the documented `preset install` step is required.
