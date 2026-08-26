# nishi-dsh-antigravity

Independent Antigravity integration package for Nishi DSH Suite.

It owns only the official `agy` process boundary:

- primary provider ID `antigravity-cli`;
- subagent provider ID `antigravity`;
- default subagent model `gemini-3.7-flash-medium`;
- default effort `medium`;
- read-only DSH Project Memory bootstrap;
- native `search_web` backend seam exported from `./web-search-backend`.

The package never passes `--dangerously-skip-permissions`, never copies Google/Antigravity credentials, and does not install or manage `agy`.

It contains no `@openai/codex` or `@openai/codex-sdk` dependency. It also does not register the model-facing `web_search` DSH tool; that belongs to `nishi-dsh-primary-web-search`.

Antigravity provider-policy status remains technically supported by the integration but policy-ambiguous; this package does not claim Google approval or Terms compliance.
