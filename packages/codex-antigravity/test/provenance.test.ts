import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('package-owned invariant reserves the public npm package name', async () => {
  const invariant = await import('../src/invariant.ts')
  let registeredName: string | undefined
  let installer: ((ctx: unknown, fail: (message: string) => never) => unknown) | undefined
  const dispose = () => {}
  const ctx = {
    invariants: {
      register(packageName: string, contribution: typeof installer) {
        registeredName = packageName
        installer = contribution
        return dispose
      },
    },
  }

  assert.equal(invariant.name, 'subagent-codex-invariant')
  assert.deepEqual(invariant.inject, ['invariants'])
  assert.equal(await invariant.apply(ctx as any), dispose)
  assert.equal(registeredName, 'nishi-dsh-codex-antigravity')
  assert.equal(typeof installer, 'function')
  assert.equal(
    await installer!({}, (message) => {
      throw new Error(message)
    }),
    undefined,
  )
})

test('package README records rc.2 provenance, memory suppression, and upstream debt limitation', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8')

  assert.match(readme, /@deepseek-ai\/dsh-subagent-codex@0\.1\.1-rc\.2/)
  assert.match(readme, /(?:deepseek-ai\/deepseek-harness|DeepSeek Harness)/)
  assert.match(readme, /memories\.use_memories=false/)
  assert.match(readme, /memories\.generate_memories=false/)
  assert.match(readme, /project_doc_max_bytes=0/)
  assert.match(readme, /CODEX-GLOBAL-AGENTS-001/)
  assert.match(readme, /ACCEPTED_WITH_KNOWN_UPSTREAM_DEBT/)

  const personalName = ['Ace', 'dia'].join('')
  const winUserRegex = new RegExp(`[a-zA-Z]:[\\\\/]Users[\\\\/]${personalName}`, 'i')
  const winProjRegex = new RegExp(`[a-zA-Z]:[\\\\/]Projects[\\\\/]`, 'i')
  assert.doesNotMatch(readme, winUserRegex)
  assert.doesNotMatch(readme, winProjRegex)
})

test('package THIRD_PARTY_NOTICES records DeepSeek Harness copyright and safety boundary', async () => {
  const notices = await readFile(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8')

  assert.match(notices, /@deepseek-ai\/dsh-subagent-codex@0\.1\.1-rc\.2/)
  assert.match(notices, /deepseek-ai\/deepseek-harness/)
  assert.match(notices, /Copyright \(c\) 2026 DeepSeek/)
  assert.match(notices, /MIT/)
  assert.match(notices, /No credentials, API keys, session tokens, or authentication state/)
  assert.match(notices, /official `agy`/)
})
