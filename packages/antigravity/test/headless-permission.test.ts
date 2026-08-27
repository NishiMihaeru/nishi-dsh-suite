import assert from 'node:assert/strict'
import test from 'node:test'
import { antigravityStderrDenial } from '../src/antigravity-subagent.ts'

// agy 1.1.21 ends the turn as CANCELED and explains itself on stderr. Before
// this the run surfaced as a bare "aborted" with no diagnostic, which reads as
// a user cancellation and sent nobody toward the actual fix.
const REAL_STDERR =
  'jetski: no output produced — a tool required the "read_file" permission that headless mode '
  + 'cannot prompt for, so it was auto-denied. Add an allow-rule under permissions.allow in '
  + 'settings.json (e.g. read_file(<target>)). Alternatively, re-run with '
  + '--dangerously-skip-permissions to auto-approve all tools.'

test('recognises the headless permission denial and names the tool', () => {
  const diagnostic = antigravityStderrDenial(REAL_STDERR)
  assert.ok(diagnostic)
  assert.match(diagnostic, /category: permission-denied/)
  assert.match(diagnostic, /"read_file"/)
  assert.match(diagnostic, /permission settings/)
})

test('never forwards raw vendor stderr into the diagnostic', () => {
  const diagnostic = antigravityStderrDenial(REAL_STDERR)
  assert.ok(diagnostic)
  assert.doesNotMatch(diagnostic, /jetski/)
  assert.doesNotMatch(diagnostic, /settings\.json/)
  assert.doesNotMatch(diagnostic, /permissions\.allow/)
  assert.doesNotMatch(diagnostic, /dangerously-skip-permissions/)
})

test('leaves unrelated failures to the generic diagnostic', () => {
  assert.equal(antigravityStderrDenial(undefined), undefined)
  assert.equal(antigravityStderrDenial(''), undefined)
  assert.equal(antigravityStderrDenial('some unrelated vendor crash'), undefined)
})
