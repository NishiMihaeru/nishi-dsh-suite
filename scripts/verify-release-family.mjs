import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const VERSION = '0.1.0-rc.1'
const packages = [
  ['packages/codex', 'nishi-dsh-codex'],
  ['packages/antigravity', 'nishi-dsh-antigravity'],
  ['packages/claude-code', 'nishi-dsh-claude-code'],
  ['packages/primary-web-search', 'nishi-dsh-primary-web-search'],
  ['packages/project-memory', 'nishi-dsh-project-memory'],
  ['packages/usage-limits', 'nishi-dsh-usage-limits'],
  ['packages/usage-limits-host', 'nishi-dsh-usage-limits-host'],
  ['packages/codex-usage-source', 'nishi-dsh-codex-usage-source'],
  ['packages/suite', 'nishi-dsh-suite'],
]

const familyNames = new Set(packages.map(([, name]) => name))
const manifests = new Map()

for (const [directory, expectedName] of packages) {
  const manifest = JSON.parse(await readFile(new URL(`../${directory}/package.json`, import.meta.url), 'utf8'))
  manifests.set(expectedName, manifest)

  assert.equal(manifest.name, expectedName, `${directory}: unexpected package name`)
  assert.equal(manifest.version, VERSION, `${expectedName}: version must stay on one prerelease train`)
  assert.notEqual(manifest.private, true, `${expectedName}: publishable package must not be private`)
  assert.equal(manifest.license, 'MIT', `${expectedName}: license must be MIT`)
  assert.equal(manifest.repository?.url, 'git+https://github.com/NishiMihaeru/nishi-dsh-suite.git')

  for (const section of ['dependencies', 'optionalDependencies']) {
    for (const [name, spec] of Object.entries(manifest[section] ?? {})) {
      if (!familyNames.has(name)) continue
      assert.equal(spec, `workspace:${VERSION}`, `${expectedName}: ${name} must use exact workspace prerelease dependency`)
    }
  }
}

const suite = manifests.get('nishi-dsh-suite')
const expectedSuiteDeps = new Set([...familyNames].filter((name) => name !== 'nishi-dsh-suite'))
assert.deepEqual(new Set(Object.keys(suite.dependencies ?? {})), expectedSuiteDeps, 'suite must depend on every leaf exactly once')
assert.equal(suite.dsh?.bundle?.patch, './cordis.patch.yml', 'suite must export the DSH bundle patch')

const retiredNames = ['nishi-dsh-codex-antigravity', '@dsh-plugin/project-memory', 'dsh-subagent-codex-custom']
for (const [name, manifest] of manifests) {
  const raw = JSON.stringify(manifest)
  for (const retired of retiredNames) {
    assert.ok(!raw.includes(retired), `${name}: retired package boundary remains: ${retired}`)
  }
}

console.log(`release-family-ok ${packages.length} packages @ ${VERSION}`)
