import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const manifestUrl = new URL('../package.json', import.meta.url)

test('project-memory package exposes the public rc.2 package boundary', async () => {
  const pkg = JSON.parse(await readFile(manifestUrl, 'utf8'))

  assert.equal(pkg.name, 'nishi-dsh-project-memory')
  assert.equal(pkg.version, '0.1.0-rc.3')
  assert.equal(pkg.private, undefined)
  assert.equal(pkg.type, 'module')
  assert.deepEqual(pkg.exports, {
    '.': {
      types: './lib/index.d.ts',
      default: './lib/index.js',
    },
    './package.json': './package.json',
  })
  assert.equal(pkg.dependencies, undefined)
  assert.deepEqual(pkg.peerDependencies, {
    '@deepseek-ai/cordis': '^4.0.1',
    '@deepseek-ai/dsh-agent': '0.1.1-rc.2',
    '@deepseek-ai/dsh-llm': '0.1.1-rc.2',
    '@deepseek-ai/dsh-tools': '0.1.1-rc.2',
  })
  assert.equal(JSON.stringify(pkg).includes('link:'), false)
  assert.equal(JSON.stringify(pkg).includes('file:'), false)
})
