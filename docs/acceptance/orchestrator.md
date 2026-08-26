# Orchestrator migration acceptance

Status: **PRESET_MIGRATED / MARKET_DISCOVERY_BLOCKED_UPSTREAM_DSH_RC2**

## Migrated preset

The accepted Orchestrator preset lives at:

- `presets/orchestrator/preset.yml`
- `presets/orchestrator/agent.cordis.yml`

Its behavior is preserved from the accepted private-repository baseline except for the public package boundaries:

- Project Memory: `nishi-dsh-project-memory`
- primary-routed web search: `nishi-dsh-primary-web-search`

The fixed delegation tool identities remain:

- `subagent_codex` → provider `codex`
- `subagent_claude_code` → provider `claude-code`
- `subagent_antigravity` → provider `antigravity`

`scripts/validate-orchestrator.mjs` checks unique row IDs, exactly one fixed tool per managed provider, exactly one Project Memory row, exactly one primary web-search row, and absence of retired package boundaries.

## DSH 0.1.1-rc.2 upstream blocker

DSH rc.2 discovers presets from configured roots plus the user preset root, but the CLI boot composition overwrites the `agent-presets` row's configured `roots` with the shipped preset root at runtime. Therefore a third-party bundle cannot reliably expose its own repository/package preset directory merely by patching `agent-presets.config.roots`.

This is a DSH distribution seam limitation, not a provider/runtime limitation. The Suite intentionally does **not** add a misleading `agent-presets` root patch and does not copy files into `$DSH_HOME/.agent-presets` during startup.

The runtime plugins remain Market-installable independently of this preset-discovery blocker.

## Exit criteria

This gate becomes accepted when either:

1. a DSH release exposes/preserves third-party preset roots through normal bundle composition; or
2. an explicit product decision accepts a temporary installer/user-root copy mechanism with matching update/uninstall semantics.

Until then, do not claim that a normal Market install automatically makes the Orchestrator preset discoverable.
