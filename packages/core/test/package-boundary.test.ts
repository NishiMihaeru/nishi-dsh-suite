import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import test from 'node:test'
import * as ts from 'typescript'

const SUBAGENT_PACKAGE = '@deepseek-ai/dsh-subagent'
const AUTHORIZATION_PACKAGE = '@deepseek-ai/dsh-authorization'
const RETIRED_DSH_PACKAGES = [
  '@deepseek-ai/dsh-host-apiproxy',
  '@deepseek-ai/dsh-client-runtime',
] as const
const PROVIDER_PACKAGES = [
  'nishi-dsh-codex',
  'nishi-dsh-antigravity',
  'nishi-dsh-claude',
] as const
const PROVIDER_IDS = ['codex', 'antigravity', 'claude'] as const
const PROVIDER_RELATIVE_IMPORT_FRAGMENTS = ['../codex', '../antigravity', '../claude'] as const

interface CoreManifest {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  dsh?: {
    client?: {
      inject?: string[]
    }
  }
}

async function sourceFiles(root: URL): Promise<URL[]> {
  const paths: URL[] = []
  const walk = async (directory: URL): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory)
      if (entry.isDirectory()) await walk(child)
      else if (extname(entry.name) === '.ts' || extname(entry.name) === '.tsx') paths.push(child)
    }
  }
  await walk(root)
  return paths
}

function executableStringLiterals(source: string, path: URL): string[] {
  const kind = extname(path.pathname) === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const parsed = ts.createSourceFile(path.pathname, source, ts.ScriptTarget.Latest, true, kind)
  const values: string[] = []

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node)) values.push(node.text)
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  return values
}

async function coreManifest(): Promise<CoreManifest> {
  const raw = await readFile(new URL('../package.json', import.meta.url), 'utf8')
  return JSON.parse(raw) as CoreManifest
}

test('nishi-dsh-core has no dependency on the retired subagent package', async () => {
  const manifest = await coreManifest()

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

test('nishi-dsh-core has no dependency on the unused DSH authorization package', async () => {
  const manifest = await coreManifest()

  for (const field of ['dependencies', 'peerDependencies', 'devDependencies'] as const) {
    assert.equal(
      manifest[field]?.[AUTHORIZATION_PACKAGE],
      undefined,
      `${AUTHORIZATION_PACKAGE} must stay absent from ${field}`,
    )
  }
})

test('core source does not import the unused DSH authorization package', async () => {
  const srcRoot = new URL('../src/', import.meta.url)
  for (const path of await sourceFiles(srcRoot)) {
    const literals = executableStringLiterals(await readFile(path, 'utf8'), path)
    const relativePath = path.href.slice(srcRoot.href.length)
    assert.equal(
      literals.some((value) => value === AUTHORIZATION_PACKAGE || value.startsWith(`${AUTHORIZATION_PACKAGE}/`)),
      false,
      `${relativePath} must not import ${AUTHORIZATION_PACKAGE}`,
    )
  }
})

test('retired alpha.1 DSH package seams are not runtime requirements', async () => {
  const manifest = await coreManifest()

  for (const retiredPackage of RETIRED_DSH_PACKAGES) {
    for (const field of ['dependencies', 'peerDependencies'] as const) {
      assert.equal(
        manifest[field]?.[retiredPackage],
        undefined,
        `${retiredPackage} must stay absent from ${field}`,
      )
    }
  }

  assert.equal(
    manifest.dsh?.client?.inject?.includes('@deepseek-ai/dsh-client-runtime'),
    false,
    'the browser manifest must not request the removed dsh-client-runtime plugin',
  )

  // rc.2-only dev fixtures may still name these packages while the workspace
  // proves backward compatibility; consumers never receive devDependencies.
  assert.equal(manifest.devDependencies?.['@deepseek-ai/dsh-client-runtime'], '0.1.1-rc.2')
  assert.equal(manifest.devDependencies?.['@deepseek-ai/dsh-host-apiproxy'], '0.1.1-rc.2')
})

test('Core production source imports neither retired Connection package seam', async () => {
  const srcRoot = new URL('../src/', import.meta.url)
  for (const path of await sourceFiles(srcRoot)) {
    const literals = executableStringLiterals(await readFile(path, 'utf8'), path)
    const relativePath = path.href.slice(srcRoot.href.length)
    for (const retiredPackage of RETIRED_DSH_PACKAGES) {
      assert.equal(
        literals.some((value) => value === retiredPackage || value.startsWith(`${retiredPackage}/`)),
        false,
        `${relativePath} must not import ${retiredPackage}`,
      )
    }
  }
})

test('nishi-dsh-core manifest never depends directly on a concrete provider package', async () => {
  const manifest = await coreManifest()

  for (const field of ['dependencies', 'peerDependencies', 'devDependencies'] as const) {
    for (const providerPackage of PROVIDER_PACKAGES) {
      assert.equal(
        manifest[field]?.[providerPackage],
        undefined,
        `${providerPackage} must stay absent from ${field}`,
      )
    }
  }
})

test('core source never imports provider packages or hardcodes provider ids in executable string literals', async () => {
  const srcRoot = new URL('../src/', import.meta.url)
  for (const path of await sourceFiles(srcRoot)) {
    const source = await readFile(path, 'utf8')
    const relativePath = path.href.slice(srcRoot.href.length)
    const literals = executableStringLiterals(source, path)

    for (const providerPackage of PROVIDER_PACKAGES) {
      assert.equal(
        literals.some((value) => value.includes(providerPackage)),
        false,
        `${relativePath} must not reference provider package ${providerPackage}`,
      )
    }

    for (const fragment of PROVIDER_RELATIVE_IMPORT_FRAGMENTS) {
      assert.equal(
        literals.some((value) => value.includes(fragment)),
        false,
        `${relativePath} must not reach a provider package through ${fragment}`,
      )
    }

    for (const providerId of PROVIDER_IDS) {
      assert.equal(
        literals.includes(providerId),
        false,
        `${relativePath} must not hardcode provider id ${providerId} as an executable string literal`,
      )
    }
  }
})
