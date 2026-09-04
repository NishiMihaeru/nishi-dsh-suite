import assert from 'node:assert/strict'
import test from 'node:test'
import { headlessTurnArgv, ISOLATION_TOOL_NAME } from '../src/grok-vendor.ts'

const base = {
  promptJson: '{"type":"acp","content":[]}',
  schemaJson: '{"type":"object"}',
  model: 'grok-4.6',
  sessionId: '00000000-0000-4000-8000-000000000000',
  resume: false,
}

function flagValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  return index === -1 ? undefined : argv[index + 1]
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

test('turn argv bounds the vendor agent loop to one model round', () => {
  assert.equal(flagValue(headlessTurnArgv(base), '--max-turns'), '1')
})

test('turn argv opens a client-minted session and later resumes it', () => {
  const opening = headlessTurnArgv(base)
  assert.equal(flagValue(opening, '--session-id'), base.sessionId)
  assert.ok(!opening.includes('--resume'))

  const continuing = headlessTurnArgv({ ...base, resume: true })
  assert.equal(flagValue(continuing, '--resume'), base.sessionId)
  assert.ok(!continuing.includes('--session-id'))
})

test('turn argv carries the schema, the prompt, and the overridden system prompt', () => {
  const argv = headlessTurnArgv({ ...base, system: 'SYSTEM', effort: 'low' })
  assert.equal(flagValue(argv, '--json-schema'), base.schemaJson)
  assert.equal(flagValue(argv, '--prompt-json'), base.promptJson)
  assert.equal(flagValue(argv, '--output-format'), 'json')
  assert.equal(flagValue(argv, '--system-prompt-override'), 'SYSTEM')
  assert.equal(flagValue(argv, '--reasoning-effort'), 'low')
})

test('turn argv omits the effort and system flags when the request names neither', () => {
  const argv = headlessTurnArgv(base)
  assert.ok(!argv.includes('--reasoning-effort'))
  assert.ok(!argv.includes('--system-prompt-override'))
})
