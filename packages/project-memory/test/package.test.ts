import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const manifestUrl = new URL('../package.json', import.meta.url)
const SUPPORTED_DSH_PEER_RANGE = '0.1.2-rc.1'
const LOCAL_DSH_DEV_BASELINE = '0.1.2-rc.1'

test('project-memory package exposes the public rc.3 package boundary', async () => {
  const pkg = JSON.parse(await readFile(manifestUrl, 'utf8'))

  assert.equal(pkg.name, 'nishi-dsh-project-memory')
  assert.equal(pkg.version, '0.1.0-rc.3')
  assert.equal(pkg.private, true)
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
    '@deepseek-ai/dsh-agent': SUPPORTED_DSH_PEER_RANGE,
    '@deepseek-ai/dsh-atomic-write': SUPPORTED_DSH_PEER_RANGE,
    '@deepseek-ai/dsh-llm': SUPPORTED_DSH_PEER_RANGE,
    '@deepseek-ai/dsh-tools': SUPPORTED_DSH_PEER_RANGE,
  })

  for (const [name, range] of Object.entries(pkg.devDependencies as Record<string, string>)) {
    if (name.startsWith('@deepseek-ai/dsh-')) {
      assert.equal(range, LOCAL_DSH_DEV_BASELINE, `${name} must develop against the only supported DSH generation`)
    }
  }

  assert.equal(JSON.stringify(pkg).includes('link:'), false)
  assert.equal(JSON.stringify(pkg).includes('file:'), false)
})

// cbe59fa fixed src to use Session.eventAt after rc.1 hid the log, but the
// published entry is lib/index.js (gitignored). Tests import src via tsx, so a
// stale lib kept injecting on every step while the suite stayed green.
test('published runtime reads the session log through eventAt, not session.events', async () => {
  const runtime = await readFile(new URL('../lib/runtime.js', import.meta.url), 'utf8')
  assert.match(runtime, /\.eventAt\(/)
  assert.equal(runtime.includes('session.events'), false)
  assert.equal(runtime.includes('hasVisibleProjectContext'), false)
})
