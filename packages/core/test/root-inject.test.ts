import assert from 'node:assert/strict'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import { apply, inject, NishiCorePlugin, NishiProvidersService } from '../src/index.ts'

test('the outer core plugin has no impossible dependency on the service it publishes', () => {
  assert.deepEqual(inject, [])
  assert.deepEqual(NishiCorePlugin.inject, inject)
})

test('root apply publishes the registry before mounting a host child with explicit service access', () => {
  const mounted: unknown[] = []
  const ctx = {
    plugin(plugin: unknown) {
      mounted.push(plugin)
      return undefined
    },
  } as unknown as Context

  assert.doesNotThrow(() => apply(ctx))
  assert.equal(mounted.length, 2)
  assert.equal(mounted[0], NishiProvidersService)

  const host = mounted[1] as {
    name?: unknown
    inject?: unknown
    apply?: unknown
  }
  assert.equal(host.name, 'nishi-core-host')
  assert.deepEqual(host.inject, ['nishiProviders', 'connection', 'credentials'])
  assert.equal(typeof host.apply, 'function')
})
