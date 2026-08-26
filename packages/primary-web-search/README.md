# nishi-dsh-primary-web-search

Single model-facing `web_search` tool for Nishi DSH Suite.

Routing is resolved from the active DSH session on every call:

- `codex-app-server` → `nishi-dsh-codex/web-search-backend` → Codex native web search;
- `antigravity-cli` → `nishi-dsh-antigravity/web-search-backend` → official `agy search_web`;
- every other provider → `WEB_SEARCH_UNSUPPORTED`.

The package preserves result normalization, HTTP(S)-only source validation, deduplication, truncation, multi-query merging, and DSH presentation metadata.

There is deliberately no `ctx.web.search`, DeepSeek, Exa, Perplexity, or `DEEPSEEK_API_KEY` fallback. Provider packages expose backend seams only; this package is the sole owner of the `web_search` DSH tool registration.
