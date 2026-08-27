# Security Policy

The security and integrity of user environments, credentials, project state, and DSH profiles are core design requirements of Nishi DSH Suite.

## Scope

This policy applies to Suite-owned provider/subagent bridges, project-scoped Shared Project Memory, Usage Limits collectors/UI projection, bundle composition, presets, diagnostics, and release tooling.

Vulnerabilities in DeepSeek Harness or vendor runtimes such as the Claude Code CLI, OpenAI Codex, or Google Antigravity `agy` should be reported to the corresponding upstream/vendor security channel when the issue is not caused by Suite-owned code.

## Reporting a vulnerability

Do not post suspected vulnerabilities or exploit details as ordinary public issues. Prefer GitHub Private Vulnerability Reporting under the repository Security tab if enabled. Otherwise contact the repository owner privately through an available GitHub channel.

Never include live credentials, raw authentication databases, private tokens, cookies, or unnecessary personal host details in a report.

## Credential and authentication boundaries

Nishi DSH Suite does not intentionally collect, copy, store, migrate, or persist raw vendor credentials in Suite-managed state.

- Claude authentication remains owned by the installed official Claude Code CLI.
- Codex authentication remains owned by the official Codex client/account state.
- Antigravity authentication remains owned by official `agy` and its product/system authentication flow.
- Suite code must not copy credential stores, replace vendor homes to bridge authentication, scrape cookies/keyrings, or replay vendor tokens through custom HTTP clients.
- Usage/quota projection must not expose raw account tokens, CSRF material, private identity data, or equivalent secrets to browser-visible DTOs.

## Profile ownership

The Suite is composed through DSH bundle reconciliation. Install/update/uninstall must not delete unrelated user plugins, sessions, configuration, project files, vendor credentials, or project memory.

## Network behavior

Normal installation may access npm/GitHub registries. Live provider use naturally performs provider network requests through official vendor runtimes and may consume quota. Deterministic default tests must not make live model calls.
