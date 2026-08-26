# Nishi DSH Suite

Nishi DSH Suite is a public, modular extension suite for DeepSeek Harness distributed through the standard DSH plugin/bundle mechanism.

The first release is being migrated from the accepted private implementation. The target Suite includes:

- Codex primary and subagent integration;
- Antigravity primary and subagent integration through official `agy`;
- Claude Code subagent integration;
- primary-routed `web_search` for Codex and Antigravity;
- project-scoped Shared Project Memory;
- Usage Limits runtime/UI sources;
- an Orchestrator preset with fixed delegation tools.

## Distribution model

The Market-facing package will be `nishi-dsh-suite` (or one consistent owned npm scope if the unscoped package family is unavailable). Installation uses normal DSH plugin reconciliation rather than a custom installer or portable DSH home.

Windows and CachyOS/Linux are independent supported installations. Session/state portability and cross-OS migration are not product goals.

## Authentication boundary

Nishi DSH Suite does not install vendor clients or copy/broker vendor credentials. Codex, Claude Code, and Antigravity authentication remains owned by their official clients.

## Status

Market migration is in progress on `feat/market-migration`. Public prerelease installation instructions will be added only after local bundle acceptance passes.
