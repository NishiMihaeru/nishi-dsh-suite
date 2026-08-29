import assert from 'node:assert/strict'
import test from 'node:test'
import * as claude from '../src/index.ts'

function fakeContext() {
  const recorded: any[] = []
  return {
    recorded,
    ctx: {
      subprocess: { spawn() { throw new Error('spawn must not be reached') } },
      nishiProviders: { record(entry: any) { recorded.push(entry); return () => {} } },
      effect() {},
      on() {},
      logger: { warn() {} },
    } as any,
  }
}

test('Claude registration declares a Model Accounts row for the Anthropic credential', async () => {
  const fixture = fakeContext()
  await claude.apply(fixture.ctx, {})

  assert.equal(fixture.recorded.length, 1)
  assert.deepEqual(fixture.recorded[0].descriptor.account, {
    credentialScope: 'llm-pi-ai',
    credentialId: 'anthropic',
    label: 'Claude (Anthropic)',
  })
})

test('Claude package keeps the accepted plugin surface', () => {
  assert.equal(claude.name, 'claude')
  assert.deepEqual(claude.inject, ['nishiProviders', 'subprocess'])
  assert.equal(typeof claude.apply, 'function')
  assert.equal(typeof claude.Config?.toJSON, 'function')
})
