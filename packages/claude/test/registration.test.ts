import assert from 'node:assert/strict'
import test from 'node:test'
import * as claude from '../src/index.ts'

test('Claude package keeps the accepted plugin surface', () => {
  assert.equal(claude.name, 'claude')
  assert.deepEqual(claude.inject, ['nishiProviders', 'subprocess'])
  assert.equal(typeof claude.apply, 'function')
  assert.equal(typeof claude.Config?.toJSON, 'function')
})
