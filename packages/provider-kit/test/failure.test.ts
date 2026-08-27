import assert from 'node:assert/strict'
import test from 'node:test'
import {
  VendorFailure,
  recognizeVendorStderr,
  vendorFailure,
  type VendorStderrRecognizer,
} from '../src/failure.js'

// Real stderr from agy 1.1.21 when a delegated turn needs a tool it cannot
// prompt for. The recogniser must extract the tool name and nothing else:
// forwarding this text verbatim would leak the vendor's own settings paths.
const AGY_PERMISSION_STDERR =
  'jetski: no output produced — a tool required the "read_file" permission that headless mode '
  + 'cannot prompt for, so it was auto-denied. Add an allow-rule under permissions.allow in '
  + 'settings.json (e.g. read_file(<target>)). Alternatively, re-run with '
  + '--dangerously-skip-permissions to auto-approve all tools.'

const PERMISSION: VendorStderrRecognizer = {
  category: 'permission-denied',
  pattern: /required the "([a-z_]+)" permission that headless mode cannot prompt for/i,
  message: (match) => `The CLI auto-denied the ${JSON.stringify(match[1])} tool permission.`,
}

test('failure message carries product, stage and category', () => {
  const failure = vendorFailure({ product: 'Antigravity CLI', stage: 'turn', category: 'timeout' })
  assert.ok(failure instanceof VendorFailure)
  assert.match(failure.message, /product: Antigravity CLI/)
  assert.match(failure.message, /stage: turn/)
  assert.match(failure.message, /category: timeout/)
  assert.equal(failure.category, 'timeout')
})

test('optional detail is appended and the cause is preserved', () => {
  const cause = new Error('underlying')
  const failure = vendorFailure({
    product: 'Codex CLI', stage: 'startup', category: 'provider-error',
    detail: 'App server exited before initialize.', cause,
  })
  assert.match(failure.message, /App server exited before initialize\./)
  assert.equal(failure.cause, cause)
})

test('an incomplete spec is rejected rather than producing a half-formed message', () => {
  for (const spec of [
    { product: '', stage: 'turn', category: 'x' },
    { product: 'p', stage: '', category: 'x' },
    { product: 'p', stage: 'turn', category: '' },
  ]) {
    assert.throws(() => vendorFailure(spec as any), /must be a non-empty string/)
  }
})

test('a recognised condition yields a message built only from the matched token', () => {
  const recognized = recognizeVendorStderr(AGY_PERMISSION_STDERR, [PERMISSION])
  assert.ok(recognized)
  assert.equal(recognized.category, 'permission-denied')
  assert.match(recognized.message, /"read_file"/)
})

test('raw vendor stderr never reaches the recognised message', () => {
  const recognized = recognizeVendorStderr(AGY_PERMISSION_STDERR, [PERMISSION])
  assert.ok(recognized)
  for (const leak of ['jetski', 'settings.json', 'permissions.allow', 'dangerously-skip-permissions']) {
    assert.doesNotMatch(recognized.message, new RegExp(leak.replace('.', '\\.')), leak)
  }
})

test('unrecognised, empty and absent stderr all decline rather than guess', () => {
  assert.equal(recognizeVendorStderr('some unrelated vendor crash', [PERMISSION]), undefined)
  assert.equal(recognizeVendorStderr('', [PERMISSION]), undefined)
  assert.equal(recognizeVendorStderr(undefined, [PERMISSION]), undefined)
  assert.equal(recognizeVendorStderr(AGY_PERMISSION_STDERR, []), undefined)
})

test('recognisers are tried in order and the first hit wins', () => {
  const broad: VendorStderrRecognizer = {
    category: 'broad', pattern: /permission/i, message: () => 'broad match',
  }
  assert.equal(recognizeVendorStderr(AGY_PERMISSION_STDERR, [broad, PERMISSION])?.category, 'broad')
  assert.equal(recognizeVendorStderr(AGY_PERMISSION_STDERR, [PERMISSION, broad])?.category, 'permission-denied')
})
