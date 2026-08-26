# nishi-dsh-usage-limits

Provider-agnostic Usage / Limits domain package for Nishi DSH Suite.

It owns strict normalized DTOs, refresh/cache coordination, provider collectors for Codex, Claude, and Antigravity, and the safe host-to-browser projection boundary.

The public projection intentionally removes collector/source metadata and exposes only normalized status, windows, freshness, and bounded extra-usage fields. Collector failures are converted to provider-safe status snapshots rather than leaking raw vendor errors.
