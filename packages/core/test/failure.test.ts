import assert from 'node:assert/strict'
import test from 'node:test'
import {
  VendorFailure,
  recognizeVendorStderr,
  vendorFailure,
  type VendorStderrRecognizer,
} from '../src/runtime/failure.js'

// Representative vendor stderr containing both one recognised token and
// surrounding text that must never be copied into a public diagnostic.
const PERMISSION_STDERR =
  'jetski: no output produced — a tool required the "read_file" permission that headless mode '
  + 'cannot prompt for, so it was auto-denied. Add an allow-rule under permissions.allow in '
  + 'settings.json (e.g. read_file(<target>)). Alternatively, re-run with '
  + '--dangerously-skip-permissions to auto-approve all tools.'

const PERMISSION: VendorStderrRecognizer = {
  category: 'permission-denied',
  pattern: /required the "([a-z_]+)" permission that headless mode cannot prompt for/i,
  message: (match) => `The CLI auto-denied the ${JSON.stringify(match[1])} tool permission.`,
}

test('failure message carries product, stage and category without retired subagent wording', () => {
  const failure = vendorFailure({ product: 'Vendor CLI', stage: 'turn', category: 'timeout' })
  assert.ok(failure instanceof VendorFailure)
  assert.match(failure.message, /^Vendor CLI failure /)
  assert.doesNotMatch(failure.message, /subagent/i)
  assert.match(failure.message, /product: Vendor CLI/)
  assert.match(failure.message, /stage: turn/)
  assert.match(failure.message, /category: timeout/)
  assert.equal(failure.category, 'timeout')
})

test('optional detail is appended and the cause is preserved', () => {
  const cause = new Error('underlying')
  const failure = vendorFailure({
    product: 'Vendor CLI', stage: 'startup', category: 'provider-error',
    detail: 'App server exited before initialize.', cause,
  })
  assert.match(failure.message, /App server exited before initialize\./)
  assert.equal(failure.cause, cause)
})

test('safe transport and process metadata is carried structurally, not spliced into the message', () => {
  const failure = vendorFailure({
    product: 'Vendor CLI',
    stage: 'turn',
    category: 'provider-error',
    httpStatus: 429,
    exitCode: 17,
    signal: 'SIGTERM',
  })

  assert.equal(failure.httpStatus, 429)
  assert.equal(failure.exitCode, 17)
  assert.equal(failure.signal, 'SIGTERM')
  assert.doesNotMatch(failure.message, /429|17|SIGTERM/)
})

test('null exitCode and signal are preserved as explicit process outcome metadata', () => {
  const failure = vendorFailure({
    product: 'Vendor CLI',
    stage: 'shutdown',
    category: 'terminated',
    exitCode: null,
    signal: null,
  })

  assert.equal(failure.exitCode, null)
  assert.equal(failure.signal, null)
  assert.equal(failure.httpStatus, undefined)
})

test('an incomplete or malformed failure spec is rejected rather than producing a half-formed error', () => {
  for (const spec of [
    null,
    { product: '', stage: 'turn', category: 'x' },
    { product: '   ', stage: 'turn', category: 'x' },
    { product: 'p', stage: '', category: 'x' },
    { product: 'p', stage: 'turn', category: '' },
    { product: 'p', stage: 'turn', category: 'x', detail: 42 },
  ]) {
    assert.throws(() => vendorFailure(spec as any), /nishi-core: vendorFailure/)
  }
})

test('failure metadata has bounded domain validation', () => {
  const base = { product: 'Vendor CLI', stage: 'turn', category: 'provider-error' }
  for (const httpStatus of [99, 600, 200.5, Infinity]) {
    assert.throws(
      () => vendorFailure({ ...base, httpStatus } as any),
      /spec\.httpStatus must be an integer between 100 and 599/,
    )
  }
  for (const exitCode of [-1, 1.5, Infinity]) {
    assert.throws(
      () => vendorFailure({ ...base, exitCode } as any),
      /spec\.exitCode must be a non-negative safe integer or null/,
    )
  }
  assert.throws(
    () => vendorFailure({ ...base, signal: '' }),
    /spec\.signal must be a non-empty string/,
  )
})

test('a recognised condition yields a message built only from the matched token', () => {
  const recognized = recognizeVendorStderr(PERMISSION_STDERR, [PERMISSION])
  assert.ok(recognized)
  assert.equal(recognized.category, 'permission-denied')
  assert.match(recognized.message, /"read_file"/)
})

test('raw vendor stderr never reaches the recognised message', () => {
  const recognized = recognizeVendorStderr(PERMISSION_STDERR, [PERMISSION])
  assert.ok(recognized)
  for (const leak of ['jetski', 'settings.json', 'permissions.allow', 'dangerously-skip-permissions']) {
    assert.doesNotMatch(recognized.message, new RegExp(leak.replace('.', '\\.')), leak)
  }
})

test('unrecognised, empty and absent stderr all decline rather than guess', () => {
  assert.equal(recognizeVendorStderr('some unrelated vendor crash', [PERMISSION]), undefined)
  assert.equal(recognizeVendorStderr('', [PERMISSION]), undefined)
  assert.equal(recognizeVendorStderr(undefined, [PERMISSION]), undefined)
  assert.equal(recognizeVendorStderr(PERMISSION_STDERR, []), undefined)
})

test('recognisers are tried in order and the first hit wins', () => {
  const broad: VendorStderrRecognizer = {
    category: 'broad', pattern: /permission/i, message: () => 'broad match',
  }
  assert.equal(recognizeVendorStderr(PERMISSION_STDERR, [broad, PERMISSION])?.category, 'broad')
  assert.equal(recognizeVendorStderr(PERMISSION_STDERR, [PERMISSION, broad])?.category, 'permission-denied')
})

test('global recognizers are deterministic and do not mutate caller-owned lastIndex', () => {
  const pattern = /required the "([a-z_]+)" permission/g
  pattern.lastIndex = 23
  const recognizer: VendorStderrRecognizer = {
    category: 'permission-denied',
    pattern,
    message: (match) => String(match[1]),
  }

  const first = recognizeVendorStderr(PERMISSION_STDERR, [recognizer])
  const second = recognizeVendorStderr(PERMISSION_STDERR, [recognizer])

  assert.deepEqual(first, { category: 'permission-denied', message: 'read_file' })
  assert.deepEqual(second, first)
  assert.equal(pattern.lastIndex, 23, 'recognition must not use the regexp instance as mutable cursor state')
})

test('sticky recognizers also start from zero without mutating caller-owned state', () => {
  const pattern = /permission:\s*([a-z_]+)/y
  pattern.lastIndex = 5
  const recognizer: VendorStderrRecognizer = {
    category: 'permission-denied',
    pattern,
    message: (match) => String(match[1]),
  }

  const text = 'permission: read_file; surrounding vendor text'
  assert.deepEqual(
    recognizeVendorStderr(text, [recognizer]),
    { category: 'permission-denied', message: 'read_file' },
  )
  assert.equal(pattern.lastIndex, 5)
})

test('malformed recognizers fail closed instead of silently becoming non-matches', () => {
  assert.throws(
    () => recognizeVendorStderr('anything', [{ category: '', pattern: /x/, message: () => 'x' } as any]),
    /recognizer\.category must be a non-empty string/,
  )
  assert.throws(
    () => recognizeVendorStderr('anything', [{ category: 'x', pattern: 'x', message: () => 'x' } as any]),
    /recognizer\.pattern must be a RegExp/,
  )
  assert.throws(
    () => recognizeVendorStderr('anything', [{ category: 'x', pattern: /x/, message: () => '' }]),
    /recognizer\.message must return a non-empty string/,
  )
})
