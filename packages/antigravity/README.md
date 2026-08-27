# nishi-dsh-antigravity

Independent Antigravity integration package for Nishi DSH Suite.

It owns only the official `agy` process boundary:

- primary provider ID `antigravity-cli`;
- native `search_web` backend seam exported from `./web-search-backend`.

Delegation was removed in `0.1.0-rc.3`: the managed Antigravity child agent could not use tools at all in headless mode, because the CLI auto-denied every permission it could not prompt for, and its project-memory access was a prompt prefix rather than a tool. Project memory is now DSH's own tool surface on the primary plane, identical for every provider, and this package no longer touches it.

The package never passes `--dangerously-skip-permissions`, never copies Google/Antigravity credentials, and does not install or manage `agy`.

It contains no `@openai/codex` or `@openai/codex-sdk` dependency. It also does not register the model-facing `web_search` DSH tool; that belongs to `nishi-dsh-primary-web-search`.

Antigravity provider-policy status remains technically supported by the integration but policy-ambiguous; this package does not claim Google approval or Terms compliance.
