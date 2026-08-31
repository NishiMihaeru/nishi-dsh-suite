# Adversarial review: the Antigravity MCP tool bridge change set

- **Result**: `DEFECTS FOUND` — 3 reported, 3 confirmed, 3 fixed
- **Kind**: adversarial code review by a model that did not write the code. **Not** a provider-stage validation and **not** the independent validation the freeze needs; see *Standing* below.
- **Reviewer**: `gemini-3.1-pro-high` via `agy 1.1.22`, driving this workspace
- **Branch**: `feat/core-provider-plugins-rc3`
- **Reviewed range**: `dd96d03~1..8e266a9` (2524 insertions across `packages/`)
- **Environment**: Node `v24.19.0`, pnpm `11.21.0`, Linux x86_64. Hosted CI: **NOT USED**. Windows: **NOT TESTED**.

---

## Method

The reviewer was given a charter, the diff, and read access to the source. It was
**not** given the author's reasoning: `docs/` and commit messages were declared
out of scope, on the grounds that the question is whether the code is correct and
not whether its author had a reason. The charter listed ten properties the code
must satisfy — tool execution belongs to DSH, no raw vendor text reaches the
model, a live vendor conversation is continued only by a request that extends
what it was told, usage must not double-count, tool-call ids unique and
resolvable, a globally registered MCP server must not serve DSH's catalog to a
session DSH did not start, misconfiguration must fail loudly, no credential
stores touched, no resource leaks, concurrency sound — and asked for findings
with a file, a line, a concrete failure scenario and a severity.

The reviewer ran with a read-only tool allowlist (`view_file`, `find_by_name`,
`grep_search`, `list_dir`, `finish`) and no shell or write tools, which the
vendor enforces (`test:live:agent-allowlist`). Cost: 120962 input tokens, 39380
output, 1109554 cache reads, one turn, twenty tool steps.

## Findings

Every finding was reproduced or traced in the code before being accepted. None
was dismissed.

### 1 — blocking — a registered but ungranted bridge server degraded silently

`antigravity-primary.ts`, the bridge precondition. The check verified that the
bridge server was registered with the vendor and stopped there. With the server
registered and no `mcp(<server>/*)` grant, the vendor launches the server, the
adapter claims it, and the MCP tools are simply **absent from the model's
toolset**. No denial event is emitted.

Confirmed live, and worse than reported: with the grant removed from the real
vendor config, the model listed its available tools as `manage_task`, `schedule`,
`send_message`, `finish` and the turn returned an **empty string** with
`status: SUCCESS`. The route looked healthy and was useless — the exact failure
the precondition existed to prevent.

Fixed two ways, because neither alone is sufficient. The precondition now reads
the vendor's grants and refuses up front, naming the server and the grant to add;
it also refuses a `disabled` server. And a finished turn whose bridge server
never attached now fails loudly, which covers the case no precondition can see —
"the model made no tool call" is ambiguous, "no server ever attached" is not.
The vendor config is **read, never written**, and an unreadable or unexpected
file counts as unknown rather than as a missing grant: turning a vendor layout
change into a dead route would be worse than the gap.

### 2 — significant — a listening socket error would have killed the host process

`mcp-bridge.ts`, `AgyMcpBridgeHost.listen()`. The `error` listener used to reject
the startup promise was removed on success and nothing replaced it, so a later
error on the listening server — `EMFILE`, the socket file removed underneath it —
would have been an unhandled `'error'` event and taken the whole host process
down. Traced and correct as reported. A bridge failure must cost the route, never
the process; a permanent handler now records it instead.

### 3 — minor — a parked hello leaked its entry and its timer

`mcp-bridge.ts`, `onConnection`'s `close` handler. A server whose parent pid no
adapter had registered yet is parked in `earlyHellos` with its own hold timer.
The close handler returned early when the pid was not in `channels`, so a socket
that closed while parked left both behind for the hold window. Bounded by
`close()`, real nonetheless, and fixed.

## Corrections to the reviewer

- It reported finding 1 as "the bridge never connects and the model answers in
  prose". The bridge **does** connect in that scenario; what is missing is the
  grant, so the tools never reach the model. The consequence it described is
  right and the mechanism is not, which changed the fix: a connection check alone
  would not have caught it.
- Its unexamined-areas note lists the test directories. Fair: it reviewed
  implementation only.

## Coverage added with the fixes

Five focused tests, all of which fail against the pre-fix code: an ungranted
server refuses; a per-tool or blanket grant is accepted; an unreadable config
does not block; a disabled server refuses and says how to enable it; a turn whose
bridge never attached fails loudly. Antigravity 118 -> 123 tests.

One defect in the existing tests surfaced while writing them: they read the
developer's real `~/.gemini/config/config.json`, so their result depended on the
machine. They now run against a fixture vendor home.

## Verification after the fixes

- `pnpm verify:local` exits `0`
- `test:live:mcp-bridge` PASS with the grant present; with it removed, the turn
  now fails with `the bridge server "dshtools" is registered but not permitted`
  instead of answering emptily
- `test:live:agent-allowlist` PASS
- Antigravity 123 tests, Codex 81, Core 200, Project Memory 77, Claude 6,
  Suite 16; `fail 0` throughout

## Standing

This is one adversarial model review of one change set. It is evidence that the
change set is in better shape than it was, and it is **not** the independent
validation recorded as the freeze blocker in `HANDOFF.md`: the scope was a single
change set rather than the tree, the reviewer's charter and the interpretation of
its findings were both written by the change set's author, and no party outside
this workspace has signed anything. Whether a model review counts toward a freeze
is the maintainer's call, not this document's.
