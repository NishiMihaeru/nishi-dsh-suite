# Mirrored project documentation

Source: `SECURITY.md`
Mode: verbatim substantive content

---

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

Core has no Model Accounts surface: it was removed along with the provider-declared `account` capability that fed it, so no Core code path reads or mutates a vendor credential record any more. Core still does not import or inject the DSH authorization service; the Suite's authorization row is a surrounding-profile compatibility seam, not permission to broker vendor authentication.

Legacy DSH grants are compatibility state only. Destructive in-app legacy-grant deletion is disabled because the accepted DSH `0.1.2-alpha.1` credentials contract does not provide atomic compare-and-delete semantics. A read-kind-then-unconditional-delete flow must not be reintroduced without a separately reviewed atomic-safe credential contract.

## Project Memory

Project Memory is repository-scoped durable state and may be committed/shared with collaborators. It must not store:

- secrets, tokens, passwords or credentials;
- current quota/usage snapshots;
- raw chain-of-thought or transient command logs;
- personal facts about the operator that do not belong in the shared project.

Memory paths are derived from an explicit absolute session workspace root. Git sessions resolve to the nearest `.git` root so context injection and memory tools use one store.

On POSIX, package-owned `.dsh`, `.dsh/memory` and `.dsh/local` descendants are accessed through a pinned directory-descriptor chain. Final-file reads use no-follow behavior where available and compare opened file identity with the visible canonical entry before consuming bytes. Replacement by another inode, a symlink or a non-file entry fails closed. A file that is concurrently unlinked after it was opened is treated as current namespace absence rather than exposing stale bytes from an unlinked inode.

Project Memory RMW coordination uses the DSH-compatible `<target>.lock` namespace. Current writers publish populated generation-safe lock directories containing a random acquisition token plus PID/process-birth identity where available. Release and stale cleanup are conditional on the exact observed lock generation so a delayed finalizer must not remove a replacement owner's lock.

Named-topic + Memory-map mutations use `.dsh/local/project-memory-transaction.json` with transaction-generation identity and exact pre-images. `pending` state is rollback state; `committed` state is preserve-and-clean state. Journal phase replacement remains owner-private (`0600`) on POSIX.

The implementation does not `fsync` file contents or parent directories, so sudden power-loss/storage-durability guarantees beyond the documented atomic filesystem protocol are out of scope.

Windows has no equivalent Node directory-fd/openat implementation in this package and remains **NOT TESTED**. Do not infer the stronger POSIX TOCTOU guarantees on Windows.

## Profile ownership

The Suite is composed through DSH bundle reconciliation. Install/update/uninstall must not delete unrelated user plugins, sessions, configuration, project files, vendor credentials or project memory.

The managed Orchestrator preset bridge refuses to overwrite/remove an unmanaged or locally edited preset directory.

## Network behavior

Normal installation may access npm/GitHub registries. Live provider use naturally performs provider network requests through official vendor runtimes and may consume quota. Deterministic default tests must not make live model calls.

Provider-specific compatibility and security claims are accepted only after that provider's own validation stage; Foundation compatibility evidence does not automatically validate Codex, Antigravity or Claude provider seams.

Windows remains **NOT TESTED** for the current rc.3 family.