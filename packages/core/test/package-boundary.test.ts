import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const SUBAGENT_PACKAGE = '@deepseek-ai/dsh-subagent'

test('nishi-dsh-core has no dependency on the retired subagent package', async () => {
  const raw = await readFile(new URL('../package.json', import.meta.url), 'utf8')
  const manifest = JSON.parse(raw) as Record<string, Record<string, string> | undefined>

  for (const field of ['dependencies', 'peerDependencies', 'devDependencies'] as const) {
    assert.equal(
      manifest[field]?.[SUBAGENT_PACKAGE],
      undefined,
      `${SUBAGENT_PACKAGE} must stay absent from ${field}`,
    )
  }
})

test('shared provider registration does not import the retired subagent package', async () => {
  const source = await readFile(new URL('../src/runtime/registration.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /@deepseek-ai\/dsh-subagent/)
})
