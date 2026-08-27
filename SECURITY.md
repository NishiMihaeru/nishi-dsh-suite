# Security Policy

The security and integrity of user environments, credentials, project state and DSH profiles are core design requirements of Nishi DSH Suite.

## Scope

This policy applies to Suite-owned provider bridges, provider-independent core/runtime code, project-scoped Project Memory, Usage & Limits collectors/UI projection, bundle composition, the managed Orchestrator preset bridge, diagnostics and release tooling.

Vendor-specific CLI delegation bridges were removed in `0.1.0-rc.3`. DSH-native child-agent delegation belongs to the harness/preset plane rather than a Suite-owned vendor subagent implementation.

Vulnerabilities in DeepSeek Harness or vendor runtimes such as the Claude Code CLI, OpenAI Codex, or Google Antigravity `agy` should be reported to the corresponding upstream/vendor security channel when the issue is not caused by Suite-owned code.

## Reporting a vulnerability

Do not post suspected vulnerabilities or exploit details as ordinary public issues. Prefer GitHub Private Vulnerability Reporting under the repository Security tab if enabled. Otherwise contact the repository owner privately through an available GitHub channel.

Never include live credentials, raw authentication databases, private tokens, cookies or unnecessary personal host details in a report.

## Credential and authentication boundaries

Nishi DSH Suite does not intentionally collect, copy, store, migrate or persist raw vendor credentials in Suite-managed state.

- Claude authentication remains owned by the installed official Claude Code CLI.
- Codex authentication remains owned by the official Codex client/account state.
- Antigravity authentication remains owned by official `agy` and its product/system authentication flow.
- Suite code must not copy credential stores, replace vendor homes to bridge authentication, scrape cookies/keyrings, or replay vendor tokens through custom HTTP clients.
- Usage/quota projection must not expose raw account tokens, CSRF material, private identity data or equivalent secrets to browser-visible DTOs.

The core Model Accounts host reads the DSH credentials service directly. It does not import or inject the DSH authorization service; the Suite's authorization row is a surrounding-profile compatibility seam, not permission to broker vendor authentication.

## Project memory

Project Memory is repository-scoped durable state and may be committed/shared with collaborators. It must not store:

- secrets, tokens, passwords or credentials;
- current quota/usage snapshots;
- raw chain-of-thought or transient command logs;
- personal facts about the operator that do not belong in the shared project.

Memory paths are derived from an explicit absolute session workspace root. Git sessions resolve to the nearest `.git` root so context injection and memory tools use one store. Canonical `.dsh` path components and existing memory targets reject symlinks/junctions/non-regular entries. Replacement writes use the harness atomic-write primitive after those checks.

## Profile ownership

The Suite is composed through DSH bundle reconciliation. Install/update/uninstall must not delete unrelated user plugins, sessions, configuration, project files, vendor credentials or project memory.

The managed Orchestrator preset bridge refuses to overwrite/remove an unmanaged or locally edited preset directory.

## Network behavior

Normal installation may access npm/GitHub registries. Live provider use naturally performs provider network requests through official vendor runtimes and may consume quota. Deterministic default tests must not make live model calls.

Windows remains not tested for the current rc.3 family; do not infer a Windows security/compatibility guarantee from Linux acceptance.
