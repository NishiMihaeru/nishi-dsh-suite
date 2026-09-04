# Mirrored project documentation

Source: `DSH.md`
Mode: verbatim substantive content

---

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

## Working Discipline

These rules exist because sessions in this repository have failed in these exact
ways. Each states its reason: follow the reasoning, not just the instruction.

### Task list
- Plan with `todo_write` before multi-step work, then **keep it moving**: mark an
  item `completed` as soon as its check passes, and keep exactly one item
  `in_progress`.
- Do not re-send a list that has not changed. A list that never moves is worse
  than no list: the user reads it as your current state, so a stale list actively
  misinforms them.

### Do not repeat yourself
- Never issue a tool call with the same name and the same arguments as your
  previous call. If the previous result was successful, you already have that
  information — act on it. If it failed, change something before retrying:
  different arguments, a different tool, or ask.
- Re-reading a file or re-running a search you already ran in this session is the
  same mistake. The earlier result is still in the conversation.

### Finishing
- A task is done when a check proves it, not when the edit is written. Run the
  relevant `build` / `check` / `test` and **read the exit code from `$?`**:
  green-looking output is not a passing command, and a pipeline hides the
  failure of everything but its last stage.
- End the turn with a message, never with a bare tool call. State what changed
  (list the files), what you verified and how, and anything you deliberately left
  undone. If you could not finish, say what blocked you.

### Working efficiently
- Prefer a targeted edit over rewriting a whole file: a full rewrite is expensive
  and discards context you did not intend to change.
- Prefer the specialized tools (`grep`, `glob`, `read`) over shell equivalents.
  They are cheaper and their results are structured.
- Read before you write. An edit built on an assumption about a file's contents
  usually fails, and a failed edit costs more than the read would have.