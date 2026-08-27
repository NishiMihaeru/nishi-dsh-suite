import assert from 'node:assert/strict'
import test from 'node:test'
import { inject, NishiCorePlugin } from '../src/index.ts'

test('the root core plugin waits only for services consumed by its host apply path', () => {
  assert.deepEqual(inject, ['connection', 'credentials'])
  assert.deepEqual(NishiCorePlugin.inject, inject)
  assert.equal(inject.includes('subprocess' as never), false)
  assert.equal(inject.includes('authorization' as never), false)
})
