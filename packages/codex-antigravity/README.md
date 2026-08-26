# nishi-dsh-codex-antigravity

Public Nishi DSH Suite package rebased on `@deepseek-ai/dsh-subagent-codex@0.1.1-rc.2` from DeepSeek Harness reference commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`.

Current package version: `0.1.0-rc.1`.

The package contains five related integration seams:

1. the managed `codex` subagent provider;
2. the managed `antigravity` subagent provider backed only by official Google `agy`;
3. the compatibility bridge used when foreign-provider DSH history is passed into the pinned Codex primary adapter;
4. the `antigravity-cli` primary LLM adapter backed by official Google `agy`;
5. the `primary-web-search` secondary Cordis entrypoint, which routes the Orchestrator `web_search` tool through the calling session's selected Codex or Antigravity primary runtime.

## Codex subagent

Each accepted Codex subagent run starts the package-local `@openai/codex@0.147.0` App Server wrapper in the delegating DSH Session workspace with these repository policy overrides:

```text
-c memories.use_memories=false
-c memories.generate_memories=false
-c project_doc_max_bytes=0
app-server --stdio
```

The overrides suppress native memory use, native memory generation, and repository/project `AGENTS.md` discovery where the Codex configuration surface supports it.

### Known upstream limitation

Global `$CODEX_HOME/AGENTS.md` / `AGENTS.override.md` cannot be fully suppressed through the accepted stock configuration surface in the bundled Codex baseline. This remains `CODEX-GLOBAL-AGENTS-001 / ACCEPTED_WITH_KNOWN_UPSTREAM_DEBT`.

The package does not replace `CODEX_HOME`, copy credentials, or parse Codex credential files.

## Antigravity subagent

The `antigravity` provider starts one ephemeral coding worker through the official `agy` executable and its documented headless `stream-json` protocol.

Runtime contract:

- `agy` owns and consumes its own cached Google/Antigravity login state;
- DSH does not read, parse, copy, export, replay, or persist Google OAuth tokens, cookies, refresh tokens, keyring entries, or private session material;
- no private Google RPC/backend integration is used;
- the child runs in the delegating DSH Session workspace;
- a temporary custom `dsh-subagent` agent limits native Antigravity capabilities to local coding operations and final completion; Antigravity-native subagent delegation is not exposed;
- workspace reads/writes follow the official Antigravity permission engine;
- shell commands remain governed by the user's normal `agy` fine-grained permission allow/deny rules;
- the adapter never passes `--dangerously-skip-permissions`;
- model and reasoning effort are pinned explicitly for each run;
- the run is one-shot: DSH owns delegation, cancellation, final result handoff, and process-tree cleanup;
- DSH Project Memory bootstrap context is injected read-only. The provider is instructed not to edit `.dsh/memory` or establish a second durable memory authority.

Default subagent model is `gemini-3.7-flash-medium`, effort `medium`. These can be overridden through the package Cordis config.

The account-backed official-`agy` path is intentionally documented as `PROVIDER_POLICY_AMBIGUOUS`, not as Google-approved or guaranteed Terms-compliant.

## Codex primary history bridge

Codex primary itself is registered by the exact pinned external `codex-plugin-dsh` dependency. This package installs only the compatibility layer needed when a DSH session containing foreign-provider history switches into that adapter.

The bridge performs provider-boundary projection only. It does not rewrite durable DSH history. In particular it normalizes foreign reasoning/tool-call details that Codex cannot accept while preserving Codex-owned history unchanged.

## Antigravity primary

`AntigravityCliAdapter` registers the DSH primary LLM route:

```text
antigravity-cli
```

Runtime contract:

- official Google `agy` CLI;
- product-native `agy` cached login state; repository code does not read OAuth tokens, cookies, refresh tokens, or keyring values;
- model catalog discovered dynamically from the authenticated CLI;
- official headless `stream-json` transport;
- repository-created isolated temporary bridge workspace rather than the real DSH project workspace;
- model-only custom agent whose Antigravity native-tool allowlist contains only completion;
- DSH `system`, durable history, and tool schemas serialized into a structured bridge envelope;
- DSH tool calls returned as structured descriptions and executed by DSH, never by Antigravity-native shell/files/web/MCP/subagent tools;
- runtime events checked fail-closed for forbidden native-tool execution;
- text and DSH tool calls supported; unsupported generation options fail explicitly.

DSH remains the source of truth for durable history, Project Memory, tool execution, permissions, and session reopen/model switching.

## Primary-routed web search

The secondary plugin entrypoint is:

```text
nishi-dsh-codex-antigravity/primary-web-search
```

The managed Orchestrator uses it as the sole `web_search` model-facing tool. On every invocation it reads the current DSH `session.requestHeader()` and routes search by the exact primary provider/model that requested the tool:

```text
codex-app-server -> @openai/codex-sdk native live web search
antigravity-cli  -> official agy search_web
```

Unknown providers fail `WEB_SEARCH_UNSUPPORTED`; there is no fallback to the host-global DeepSeek search provider and no `DEEPSEEK_API_KEY` requirement for Codex/Antigravity sessions.

Search workers are hidden and ephemeral. Codex runs in a fresh empty temporary directory with read-only sandboxing, no approval prompts, live native web search, and its shell tool disabled. Antigravity runs a temporary search-only custom agent whose native allowlist contains only `search_web` and `finish`. Neither worker receives the parent project workspace or Project Memory.

The visible `web_search` call/result and source card remain DSH-owned durable session state.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `providerName` | `codex` | Codex subagent provider registry key. |
| `permissionMode` | `never` | Native non-interactive Codex permission mode. |
| `env` | `{}` | Explicit Codex child environment additions through the DSH subprocess seam. |
| `disposeGraceMs` | `3000` | Process-tree cleanup grace period. |
| `antigravityExecutable` | `agy` | Official Antigravity CLI executable. |
| `antigravityEnv` | `{}` | Explicit Antigravity child environment additions; never used to bridge account credentials. |
| `antigravitySubagentProviderName` | `antigravity` | Antigravity subagent provider registry key. |
| `antigravitySubagentModel` | `gemini-3.7-flash-medium` | Model slug passed to `agy --model`. |
| `antigravitySubagentEffort` | `medium` | Reasoning effort passed to `agy --effort`. |
| `antigravityTurnTimeoutMs` | `600000` | Shared Antigravity primary/subagent turn timeout. |

Live checks that consume real provider quota:

```text
pnpm --filter nishi-dsh-codex-antigravity test:live:antigravity-subagent
pnpm --filter nishi-dsh-codex-antigravity test:live:web-search-codex
pnpm --filter nishi-dsh-codex-antigravity test:live:web-search-antigravity
```

`test:live:web-search-codex` requires `DSH_LIVE_CODEX_SEARCH_MODEL` to name a model available to the authenticated local Codex runtime.
