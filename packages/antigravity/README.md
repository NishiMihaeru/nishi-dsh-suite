# nishi-dsh-antigravity

Antigravity provider plugin for Nishi DSH Suite, backed by the user's installed official `agy` CLI.

## Declared capabilities

- canonical provider id: `antigravity`;
- primary model route: `antigravity-cli`;
- native web-search backend: `agy search_web`;
- local usage visibility: exposed honestly as unsupported numeric usage when no official machine-readable quota is available.

The distinction between provider id and route is intentional: `antigravity` is the core identity; `antigravity-cli` is the user-visible DSH model route retained for saved-session compatibility.

Delegation was removed in `0.1.0-rc.3`. The old managed vendor child agent could not use tools in headless mode because permissions it could not prompt for were auto-denied, and its project-memory view was a prompt prefix rather than DSH tools. Project memory now remains on the normal DSH primary plane and this package does not touch it.

## Runtime boundary

The package owns only Antigravity-specific protocol translation and process behavior. Shared registration, executable/runtime helpers, web-search routing and Usage & Limits projection live in `nishi-dsh-core`.

The package:

- does not install or manage `agy`;
- does not copy Google/Antigravity credentials;
- never passes `--dangerously-skip-permissions`;
- does not register the model-facing `web_search` tool itself; it contributes only its backend through the provider descriptor;
- does not bundle OpenAI/Anthropic vendor SDK runtimes.

Antigravity provider-policy status remains technically supported by the integration but policy-ambiguous; this package does not claim Google approval or Terms compliance.

## Remaining rc.3 work

The provider-independent Core and Project Memory are frozen. Antigravity-specific work still includes removing the hardcoded model-family catalog filter, adding catalog parser coverage, migrating remaining provider-local failure shapes to the shared core failure contract, and the final live primary/model-switch/search acceptance.
