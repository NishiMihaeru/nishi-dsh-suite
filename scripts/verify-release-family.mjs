import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const VERSION = '0.1.0-rc.2'
const DSH_VERSION = '0.1.1-rc.2'
const packages = [
  ['packages/codex', 'nishi-dsh-codex'],
  ['packages/antigravity', 'nishi-dsh-antigravity'],
  ['packages/claude-usage-source', 'nishi-dsh-claude-usage-source'],
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

  for (const lifecycle of ['preinstall', 'install', 'postinstall', 'prepare']) {
    assert.equal(manifest.scripts?.[lifecycle], undefined, `${expectedName}: publishable package must not run ${lifecycle}`)
  }

  for (const section of ['dependencies', 'optionalDependencies']) {
    for (const [name, spec] of Object.entries(manifest[section] ?? {})) {
      if (!familyNames.has(name)) continue
      assert.equal(spec, `workspace:${VERSION}`, `${expectedName}: ${name} must use exact workspace prerelease dependency`)
    }
  }
}

const suite = manifests.get('nishi-dsh-suite')
const expectedSuiteFamilyDeps = new Set([...familyNames].filter((name) => name !== 'nishi-dsh-suite'))
const actualSuiteFamilyDeps = new Set(
  Object.keys(suite.dependencies ?? {}).filter((name) => familyNames.has(name)),
)
assert.deepEqual(actualSuiteFamilyDeps, expectedSuiteFamilyDeps, 'suite must depend on every Nishi leaf exactly once')
assert.equal(
  suite.dependencies?.['@deepseek-ai/dsh-authorization'],
  DSH_VERSION,
  'suite must install the rc.2 authorization service required by Usage Limits Host',
)
assert.equal(suite.dsh?.bundle?.patch, './cordis.patch.yml', 'suite must export the DSH bundle patch')

const FORBIDDEN_VENDOR_RUNTIMES = [
  '@openai/codex',
  '@openai/codex-sdk',
  '@anthropic-ai/claude-agent-sdk',
  '@anthropic-ai/sdk',
]
for (const [name, manifest] of manifests) {
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const dependency of Object.keys(manifest[section] ?? {})) {
      assert.ok(
        !FORBIDDEN_VENDOR_RUNTIMES.includes(dependency),
        `${name}: ${section}.${dependency} bundles a vendor runtime; rc.2 drives the installed CLI instead`,
      )
    }
  }
}

const suiteSource = await readFile(new URL('../packages/suite/src/index.ts', import.meta.url), 'utf8')
const declaredSuiteVersion = suiteSource.match(/NISHI_DSH_SUITE_VERSION = '([^']+)'/)?.[1]
assert.equal(declaredSuiteVersion, VERSION, 'packages/suite/src/index.ts must export the current family version')
const declaredSuitePackages = [...suiteSource.matchAll(/'(nishi-dsh-[a-z-]+)'/g)].map((match) => match[1])
assert.deepEqual(
  new Set(declaredSuitePackages),
  expectedSuiteFamilyDeps,
  'NISHI_DSH_SUITE_PACKAGES must list every Nishi leaf exactly once',
)

const nameProbeSource = await readFile(new URL('../scripts/check-npm-names.mjs', import.meta.url), 'utf8')
assert.ok(
  nameProbeSource.includes(`const VERSION = '${VERSION}'`),
  'scripts/check-npm-names.mjs must probe the current family version',
)
const probedNames = nameProbeSource.match(/const names = \[([^\]]*)\]/)?.[1] ?? ''
assert.deepEqual(
  new Set([...probedNames.matchAll(/'([^']+)'/g)].map((match) => match[1])),
  familyNames,
  'scripts/check-npm-names.mjs must probe every family name',
)

const retiredNames = [
  'nishi-dsh-codex-antigravity',
  'nishi-dsh-claude-code',
  '@dsh-plugin/project-memory',
  'dsh-subagent-codex-custom',
]
for (const [name, manifest] of manifests) {
  const raw = JSON.stringify(manifest)
  for (const retired of retiredNames) {
    assert.ok(!raw.includes(retired), `${name}: retired package boundary remains: ${retired}`)
  }
}

console.log(`release-family-ok ${packages.length} packages @ ${VERSION}`)
