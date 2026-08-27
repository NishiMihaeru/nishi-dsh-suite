import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'

const packageDirs = [
  'core',
  'codex',
  'antigravity',
  'primary-web-search',
  'project-memory',
  'suite',
]

const root = new URL('../', import.meta.url)

async function exists(url) {
  try {
    await access(url)
    return true
  } catch {
    return false
  }
}

for (const dir of packageDirs) {
  const packageRoot = new URL(`packages/${dir}/`, root)
  const manifest = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'))

  assert.equal(
    manifest.repository?.directory,
    `packages/${dir}`,
    `${manifest.name}: repository.directory must point at its monorepo package`,
  )

  for (const file of ['README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    assert.equal(await exists(new URL(file, packageRoot)), true, `${manifest.name}: missing ${file}`)
    assert.ok((manifest.files ?? []).includes(file), `${manifest.name}: files must include ${file}`)
  }

  for (const lifecycle of ['preinstall', 'install', 'postinstall', 'prepare']) {
    assert.equal(manifest.scripts?.[lifecycle], undefined, `${manifest.name}: must not run ${lifecycle} on user install`)
  }

  assert.ok(
    (manifest.files ?? []).some((entry) => String(entry).startsWith('lib/')),
    `${manifest.name}: package must publish prebuilt lib output`,
  )
}

const codexRoot = new URL('packages/codex/', root)
const codexManifest = JSON.parse(await readFile(new URL('package.json', codexRoot), 'utf8'))
assert.equal(
  codexManifest.dependencies?.['codex-plugin-dsh'],
  undefined,
  'nishi-dsh-codex: must not declare git subdependency on codex-plugin-dsh',
)
assert.equal(
  codexManifest.peerDependencies?.['@deepseek-ai/dsh-attachment'],
  '0.1.1-rc.2',
  'nishi-dsh-codex: peerDependencies must pin @deepseek-ai/dsh-attachment to 0.1.1-rc.2',
)
assert.equal(
  codexManifest.peerDependencies?.['@deepseek-ai/dsh-session'],
  '0.1.1-rc.2',
  'nishi-dsh-codex: peerDependencies must pin @deepseek-ai/dsh-session to 0.1.1-rc.2',
)
assert.equal(
  await exists(new URL('src/codex-plugin-dsh/index.ts', codexRoot)),
  true,
  'nishi-dsh-codex: vendored codex-plugin-dsh index.ts must exist',
)
assert.equal(
  await exists(new URL('src/codex-plugin-dsh/adapter.ts', codexRoot)),
  true,
  'nishi-dsh-codex: vendored codex-plugin-dsh adapter.ts must exist',
)
const codexNotices = await readFile(new URL('THIRD_PARTY_NOTICES.md', codexRoot), 'utf8')
assert.match(
  codexNotices,
  /79fe7503390d641680bad8efade52782a3c31ced/,
  'nishi-dsh-codex: THIRD_PARTY_NOTICES.md must record exact upstream snapshot SHA 79fe7503390d641680bad8efade52782a3c31ced',
)

const suiteRoot = new URL('packages/suite/', root)
const suite = JSON.parse(await readFile(new URL('package.json', suiteRoot), 'utf8'))
assert.equal(suite.dependencies?.['@deepseek-ai/dsh-authorization'], '0.1.1-rc.2')
assert.equal(suite.bin?.['nishi-dsh-suite'], './lib/bin.js')
assert.equal(await exists(new URL('src/bin.ts', suiteRoot)), true)
assert.equal(await exists(new URL('src/cli.ts', suiteRoot)), true)
assert.equal(await exists(new URL('src/preset-manager.ts', suiteRoot)), true)
assert.equal(await exists(new URL('presets/orchestrator/preset.yml', suiteRoot)), true)
assert.equal(await exists(new URL('presets/orchestrator/agent.cordis.yml', suiteRoot)), true)
assert.ok((suite.files ?? []).includes('presets/**/*.yml'))

assert.equal(
  await exists(new URL('presets/orchestrator/agent.cordis.yml', root)),
  false,
  'Orchestrator must have one canonical packaged copy, not a second repository-root copy',
)

console.log(`package-contracts-ok ${packageDirs.length} publishable packages`)
