# npm registry-only smoke — 2026-08-27

Status: **PASS**

Release: `0.1.0-rc.1`

Target runtime:

- CachyOS/Linux
- Node 24 release environment
- DSH `0.1.1-rc.2`
- public npm registry only

This record is based on executed operator output from a fresh disposable DSH home. No local package tarballs, local pnpm overrides, or repository package paths were used for installation.

## Isolated profile

Disposable DSH home:

```text
/tmp/nishi-registry-smoke-CPyN1l
```

Profile:

```text
nishi-registry-smoke
```

Registry install command:

```text
dsh plugin --profile nishi-registry-smoke add nishi-dsh-suite@0.1.0-rc.1
```

Result: **PASS**.

DSH initialized the isolated profile and installed `nishi-dsh-suite@0.1.0-rc.1` from the public npm registry.

## Registry dependency graph

`dsh plugin ... list --depth 0 --json` confirmed the direct Suite package resolved from:

```text
https://registry.npmjs.org/nishi-dsh-suite/-/nishi-dsh-suite-0.1.0-rc.1.tgz
```

All eight Nishi leaf packages resolved at exactly `0.1.0-rc.1`:

- `nishi-dsh-antigravity`
- `nishi-dsh-claude-code`
- `nishi-dsh-codex`
- `nishi-dsh-codex-usage-source`
- `nishi-dsh-primary-web-search`
- `nishi-dsh-project-memory`
- `nishi-dsh-usage-limits`
- `nishi-dsh-usage-limits-host`

Relevant managed external versions were also correct:

- `@deepseek-ai/dsh-authorization@0.1.1-rc.2`
- `@deepseek-ai/dsh-sdk-protocol@0.1.1-rc.2`
- `@openai/codex@0.147.0`
- `@openai/codex-sdk@0.147.0`
- `@anthropic-ai/claude-agent-sdk@0.3.220`

No old nested `@deepseek-ai/*@0.1.0-rc.*` release graph was observed in the captured profile listing.

## Orchestrator preset bridge

Executed against the registry-installed Suite:

```text
dsh plugin --profile nishi-registry-smoke exec nishi-dsh-suite preset install
dsh plugin --profile nishi-registry-smoke exec nishi-dsh-suite preset status
```

Result: **PASS**.

Observed:

```text
Installed Orchestrator preset.
Orchestrator preset: current
Path: /tmp/nishi-registry-smoke-CPyN1l/.agent-presets/orchestrator
```

A separate status command again returned `current` at the same isolated path.

## Remove lifecycle

Preset removal:

```text
dsh plugin --profile nishi-registry-smoke exec nishi-dsh-suite preset remove
```

Result: **PASS**.

Observed:

```text
Removed Orchestrator preset.
Orchestrator preset: absent
```

Suite removal through normal DSH plugin reconciliation completed without a DSH error and reported removal of the direct dependency:

```text
dependencies:
- nishi-dsh-suite 0.1.0-rc.1
```

The disposable DSH home was then deleted. Real `~/.dsh` was not used for this smoke.

## npm dist-tag note

The package family was intentionally published with prerelease tag `next`. npm also attached `latest` to the first and only published version of the newly created packages. Authenticated attempts to remove that bootstrap `latest` tag were rejected by the public npm registry with `E400 Bad Request`.

Project policy remains:

- `next` is the documented prerelease channel;
- exact `0.1.0-rc.1` installs are supported;
- no stable-release claim is made from npm's first-version `latest` state;
- do not unpublish or repeatedly retry tag deletion merely to remove the bootstrap tag.

## Non-blocking observation

During preset reconciliation/removal, pnpm attempted downloads for several optional Codex/Claude platform artifacts that do not match the host architecture and emitted retry warnings before completing successfully. This did not break install, preset management, or removal and is not classified as a release-gate failure. If the behavior remains visible in normal end-user installs, investigate it separately as dependency-resolution/download UX rather than changing the accepted release graph without evidence.

## Gate conclusion

Public npm registry resolution: **PASS**.

Registry-only Suite install: **PASS**.

Exact Nishi release family: **PASS**.

Managed provider dependency versions: **PASS**.

Preset install/status/remove from the registry-installed Suite: **PASS**.

Normal Suite removal command: **PASS**.

This closes the post-publication npm registry smoke required before Market submission.