# Third-Party Notices

`nishi-dsh-codex` is a repository-maintained derivative of the DeepSeek Harness Codex provider baseline `@deepseek-ai/dsh-subagent-codex@0.1.1-rc.2` from `deepseek-ai/deepseek-harness` (reference SHA `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`).

- DeepSeek Harness: MIT, Copyright (c) 2026 DeepSeek.
- OpenAI Codex: the user's installed official `codex` CLI is driven as an external process, including for the native web-search backend seam. No `@openai/codex*` package is bundled or redistributed.
- `wingoo/codex-plugin-dsh` (MIT License, Copyright (c) 2026 wingoo; source snapshot commit `79fe7503390d641680bad8efade52782a3c31ced`): vendored Codex App Server provider adapter for DeepSeek Harness (not an official OpenAI plugin).

No credentials, API keys, session tokens, or authentication state are bundled with this package.
