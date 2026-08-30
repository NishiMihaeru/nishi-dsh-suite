# DSH Project Contract

This file contains stable project-specific instructions for DSH agents working on Nishi DSH Suite.

## Project Memory Rules (.dsh/memory/)
- Keep durable learned project state in `.dsh/memory/`.
- Keep transient runtime state in `.dsh/local/`.
- Never store secrets, credentials, transient logs, or current quota values in project memory.
- Creating/updating topics: Use `memory_write` or `memory_edit` (the `## Memory map` in `MEMORY.md` is updated automatically).
- Retiring/deleting topics: Since there is no `memory_delete` tool, removing a topic requires two coordinated actions:
  1. Remove the topic file (`.dsh/memory/<topic>.md`).
  2. Remove the corresponding topic entry line from the `## Memory map` section in `.dsh/memory/MEMORY.md` using `memory_edit(topic="memory", ...)`.
