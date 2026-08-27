# nishi-dsh-project-memory

Project-scoped durable memory for Nishi DSH Suite / DeepSeek Harness.

The package owns canonical project memory under the active project root:

- `DSH.md` for the project contract;
- `.dsh/memory/MEMORY.md` for the bounded bootstrap;
- `.dsh/memory/<topic>.md` for durable topic memory;
- `.dsh/local/` for transient local runtime state.

It registers `memory_read`, `memory_write`, and `memory_edit`, injects the project contract/bootstrap into DSH turns, and provides `/memory` and `/consolidate` maintenance commands when the commands service is available. The tools are ordinary DSH tools, so project memory is identical on every provider by construction; the read-only subagent memory view was removed in `0.1.0-rc.3` with delegation.

Memory is local to each normal DSH installation and project checkout. This package does not synchronize, migrate, reconcile, or transport memory/session state between Windows, CachyOS/Linux, or different machines.

The package never owns vendor credentials or authentication state.
