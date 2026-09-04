import assert from 'node:assert/strict'
import test from 'node:test'
import {
  headlessSearchArgv,
  headlessTurnArgv,
  isArgListTooLong,
  ISOLATION_TOOL_NAME,
  SEARCH_EFFORT,
  SEARCH_MODEL,
  SEARCH_TOOL_NAME,
  SEARCH_VENDOR_TURN_CAP,
} from '../src/grok-vendor.ts'

const base = {
  promptFile: '/tmp/dsh-grok/prompt.json',
  schemaJson: '{"type":"object"}',
  model: 'grok-4.6',
  sessionId: '00000000-0000-4000-8000-000000000000',
  resume: false,
  turnCap: 4,
}

function flagValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  return index === -1 ? undefined : argv[index + 1]
}

function maxSlot(argv: readonly string[]): number {
  return argv.reduce((max, slot) => Math.max(max, slot.length), 0)
}

/**
 * The regression this file exists for.
 *
 * Measured on `grok 1.0.13`: `--tools ""` is a silent no-op that leaves the
 * model holding the full 25-tool set, including shell and file write, at
 * 13,423 uncached input tokens. Naming one real tool in the allowlist AND the
 * same tool in the denylist leaves only the vendor's two MCP meta-tools, at
 * 4,442. A refactor that "simplifies" this back to an empty allowlist fails
 * open and silently, which is why the assertion is on the exact pair.
 */
test('turn argv reaches an empty vendor toolset with both flags, never an empty allowlist', () => {
  const argv = headlessTurnArgv(base)
  assert.equal(flagValue(argv, '--tools'), ISOLATION_TOOL_NAME)
  assert.equal(flagValue(argv, '--disallowed-tools'), `${ISOLATION_TOOL_NAME},Agent`)
  assert.notEqual(flagValue(argv, '--tools'), '', 'an empty allowlist is the fail-open spelling')
})

test('turn argv denies the tool classes the allowlist cannot remove', () => {
  const argv = headlessTurnArgv(base)
  assert.equal(flagValue(argv, '--deny'), 'MCPTool')
  assert.ok(argv.includes('--disable-web-search'))
  assert.ok(argv.includes('--no-subagents'))
  assert.ok(argv.includes('--no-plan'))
})

test('turn argv never asks the vendor to bypass its own permissions', () => {
  const argv = headlessTurnArgv(base)
  assert.ok(!argv.includes('--always-approve'))
  assert.ok(!argv.includes('--yolo'))
  assert.ok(!argv.includes('--permission-mode'))
  assert.ok(!argv.includes('bypassPermissions'))
})

/**
 * The cap is a backstop, not a budget, and it is deliberately not `1`.
 *
 * It was `1`, and the first real DSH request died on it: the model spent its
 * only round deciding to fetch the envelope, the vendor's stderr read
 * `Error: max turns reached`, and the step surfaced as `stopReason:
 * "cancelled"` -- which reaches a user as "the turn was cancelled" and names
 * nothing that could be fixed.
 */
test('turn argv bounds the vendor agent loop, with room for its own schema retry', () => {
  assert.equal(flagValue(headlessTurnArgv(base), '--max-turns'), '4')
  assert.equal(flagValue(headlessTurnArgv({ ...base, turnCap: 2 }), '--max-turns'), '2')
})

test('turn argv opens a client-minted session and later resumes it', () => {
  const opening = headlessTurnArgv(base)
  assert.equal(flagValue(opening, '--session-id'), base.sessionId)
  assert.ok(!opening.includes('--resume'))

  const continuing = headlessTurnArgv({ ...base, resume: true })
  assert.equal(flagValue(continuing, '--resume'), base.sessionId)
  assert.ok(!continuing.includes('--session-id'))
})

test('turn argv carries the schema, a prompt file, and the overridden system prompt', () => {
  const argv = headlessTurnArgv({ ...base, system: 'SYSTEM', effort: 'low' })
  assert.equal(flagValue(argv, '--json-schema'), base.schemaJson)
  assert.equal(flagValue(argv, '--prompt-file'), base.promptFile)
  assert.ok(!argv.includes('--prompt-json'), 'inline --prompt-json is the E2BIG slot')
  assert.equal(flagValue(argv, '--output-format'), 'json')
  assert.equal(flagValue(argv, '--system-prompt-override'), 'SYSTEM')
  assert.equal(flagValue(argv, '--reasoning-effort'), 'low')
})

test('turn argv omits the effort and system flags when the request names neither', () => {
  const argv = headlessTurnArgv(base)
  assert.ok(!argv.includes('--reasoning-effort'))
  assert.ok(!argv.includes('--system-prompt-override'))
})

test('turn argv keeps every slot well under the 128 KiB Linux argument ceiling', () => {
  const argv = headlessTurnArgv({
    ...base,
    system: 'x'.repeat(4_000),
    schemaJson: JSON.stringify({ type: 'object', properties: { kind: { type: 'string' } } }),
  })
  assert.ok(maxSlot(argv) < 16_384, `largest argv slot was ${maxSlot(argv)} bytes`)
})

test('E2BIG is recognised from Node spawn errors, not from unrelated messages', () => {
  const error = Object.assign(new Error('spawn E2BIG'), { code: 'E2BIG' })
  assert.equal(isArgListTooLong(error), true)
  assert.equal(isArgListTooLong(new Error('spawn ENOENT')), false)
  assert.equal(isArgListTooLong('nope'), false)
})

const searchBase = {
  promptFile: '/tmp/dsh-grok/search-prompt.json',
  schemaJson: '{"type":"object"}',
  model: SEARCH_MODEL,
  effort: SEARCH_EFFORT,
  sessionId: '00000000-0000-4000-8000-000000000001',
  turnCap: SEARCH_VENDOR_TURN_CAP,
}

/**
 * Search isolation is the inverse of primary isolation: the primary names the
 * same tool in both flags to reach an empty set, and a search turn names
 * `web_search` in the allowlist only. Putting it in the denylist too would
 * leave the model with nothing to search with. `--tools ""` is still the
 * fail-open spelling and must not appear here either.
 */
test('search argv allowlists web_search and does not empty the toolset', () => {
  const argv = headlessSearchArgv(searchBase)
  assert.equal(flagValue(argv, '--tools'), SEARCH_TOOL_NAME)
  assert.notEqual(flagValue(argv, '--tools'), '', 'an empty allowlist is the fail-open spelling')
  assert.equal(flagValue(argv, '--disallowed-tools'), 'Agent,web_fetch')
  assert.ok(!flagValue(argv, '--disallowed-tools')?.split(',').includes(SEARCH_TOOL_NAME))
})

test('search argv is a Messages stream with a schema, not the primary json envelope', () => {
  const argv = headlessSearchArgv(searchBase)
  assert.equal(flagValue(argv, '--output-format'), 'streaming-messages-json')
  assert.equal(flagValue(argv, '--json-schema'), searchBase.schemaJson)
  assert.equal(flagValue(argv, '--prompt-file'), searchBase.promptFile)
  assert.ok(!argv.includes('--prompt-json'))
  assert.equal(flagValue(argv, '--session-id'), searchBase.sessionId)
  assert.ok(!argv.includes('--resume'))
  assert.equal(flagValue(argv, '--max-turns'), String(SEARCH_VENDOR_TURN_CAP))
  assert.equal(flagValue(argv, '--model'), SEARCH_MODEL)
  assert.equal(flagValue(argv, '--reasoning-effort'), SEARCH_EFFORT)
})

test('search argv never disables web search and never asks to bypass permissions', () => {
  const argv = headlessSearchArgv(searchBase)
  assert.ok(!argv.includes('--disable-web-search'))
  assert.ok(!argv.includes('--always-approve'))
  assert.ok(!argv.includes('--yolo'))
  assert.ok(!argv.includes('--permission-mode'))
  assert.ok(!argv.includes('bypassPermissions'))
  assert.equal(flagValue(argv, '--deny'), 'MCPTool')
  assert.ok(argv.includes('--no-subagents'))
  assert.ok(argv.includes('--verbatim'))
})
