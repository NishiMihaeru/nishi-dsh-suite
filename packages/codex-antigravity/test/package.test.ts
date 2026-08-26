import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync, symlinkSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const PACKAGE_NAME = 'nishi-dsh-codex-antigravity'

interface PackedFile {
  path: string
  size: number
}

interface PackedInfo {
  id: string
  name: string
  version: string
  filename: string
  files: PackedFile[]
}

function buildAndPack(destinationDir: string): { packInfo: PackedInfo; tgzPath: string } {
  execSync('npm run build', { cwd: PACKAGE_ROOT, stdio: 'pipe' })
  const rawOutput = execSync(
    `npm pack --json --pack-destination ${JSON.stringify(destinationDir)}`,
    { cwd: PACKAGE_ROOT, encoding: 'utf8', stdio: 'pipe' },
  )
  const parsed = JSON.parse(rawOutput) as unknown
  let packInfo: PackedInfo | undefined
  if (Array.isArray(parsed)) {
    assert.equal(parsed.length, 1, `Expected exactly 1 packed result in array, got ${parsed.length}`)
    packInfo = parsed[0] as PackedInfo
  } else if (parsed && typeof parsed === 'object') {
    const keys = Object.keys(parsed as Record<string, unknown>)
    assert.ok(keys.length > 0, 'Expected non-empty npm pack object')
    const directCandidate = parsed as Record<string, unknown>
    if (typeof directCandidate.filename === 'string') {
      packInfo = directCandidate as unknown as PackedInfo
    } else {
      assert.equal(keys.length, 1, `Expected exactly 1 dictionary entry, got ${keys.length}`)
      packInfo = (parsed as Record<string, unknown>)[keys[0]] as PackedInfo
    }
  }
  assert(
    packInfo && typeof packInfo === 'object' && typeof packInfo.filename === 'string',
    `npm pack --json must return a valid package info object with filename, got: ${rawOutput}`,
  )
  return { packInfo, tgzPath: join(destinationDir, packInfo.filename) }
}

function unpackTarball(tgzPath: string, targetDir: string): void {
  mkdirSync(targetDir, { recursive: true })
  execSync(`tar -xzf ${JSON.stringify(tgzPath)} -C ${JSON.stringify(targetDir)} --strip-components=1`, { stdio: 'pipe' })
}

function linkPeerDependencies(sourceNodeModules: string, targetNodeModules: string): void {
  if (!existsSync(sourceNodeModules)) return
  for (const entry of readdirSync(sourceNodeModules)) {
    const src = join(sourceNodeModules, entry)
    const dst = join(targetNodeModules, entry)
    if (existsSync(dst)) continue
    if (entry.startsWith('@')) {
      mkdirSync(dst, { recursive: true })
      for (const sub of readdirSync(src)) {
        const subDst = join(dst, sub)
        if (!existsSync(subDst)) symlinkSync(join(src, sub), subDst, 'junction')
      }
    } else {
      symlinkSync(src, dst, 'junction')
    }
  }
}

function getAllFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...getAllFiles(fullPath))
    else files.push(fullPath)
  }
  return files
}

let sharedTmpDir: string
let sharedPackInfo: PackedInfo
let sharedTgzPath: string

test('Codex and Antigravity package distribution suite', async (t) => {
  sharedTmpDir = mkdtempSync(join(tmpdir(), 'nishi-dsh-codex-pkg-shared-'))
  const { packInfo, tgzPath } = buildAndPack(sharedTmpDir)
  sharedPackInfo = packInfo
  sharedTgzPath = tgzPath

  try {
    await t.test('packed package metadata and content match approved distribution contract', () => {
      assert.equal(sharedPackInfo.name, PACKAGE_NAME)
      assert.equal(sharedPackInfo.version, '0.1.0-rc.1')
      const filePaths = new Set(sharedPackInfo.files.map((f) => f.path))
      for (const required of [
        'package.json','README.md','LICENSE','THIRD_PARTY_NOTICES.md',
        'lib/index.js','lib/index.d.ts','lib/run.js','lib/run.d.ts',
        'lib/wire.js','lib/wire.d.ts','lib/memory.js','lib/memory.d.ts',
        'lib/antigravity-subagent.js','lib/antigravity-subagent.d.ts',
        'lib/invariant.js','lib/invariant.d.ts',
        'lib/primary-web-search/index.js','lib/primary-web-search/index.d.ts',
        'lib/primary-web-search/tool.js','lib/primary-web-search/tool.d.ts',
        'lib/primary-web-search/codex.js','lib/primary-web-search/codex.d.ts',
        'lib/primary-web-search/antigravity.js','lib/primary-web-search/antigravity.d.ts',
      ]) assert(filePaths.has(required), `${required} must be packed`)
      for (const filePath of filePaths) {
        assert(!filePath.startsWith('test/'), `source test file must not be shipped: ${filePath}`)
        assert(!filePath.startsWith('src/'), `source typescript file must not be shipped: ${filePath}`)
        assert(!filePath.startsWith('node_modules/'), `node_modules must not be shipped: ${filePath}`)
        assert(!filePath.startsWith('.env') && !filePath.includes('/.env'), `env files must not be shipped: ${filePath}`)
        assert(!filePath.startsWith('.git') && !filePath.includes('/.git'), `git files must not be shipped: ${filePath}`)
        assert(!filePath.startsWith('.dsh') && !filePath.includes('/.dsh'), `dsh state files must not be shipped: ${filePath}`)
        assert(!filePath.startsWith('transactions/'), `transactions must not be shipped: ${filePath}`)
        assert(!filePath.endsWith('.bak') && !filePath.endsWith('.backup'), `backup files must not be shipped: ${filePath}`)
        assert(!filePath.endsWith('.sqlite') && !filePath.endsWith('.db'), `db files must not be shipped: ${filePath}`)
        assert(!filePath.startsWith('scratch/') && !filePath.startsWith('dist/'), `scratch/build directories must not be shipped: ${filePath}`)
      }
    })

    await t.test('packed package text files have no UTF-8 BOM and contain no secret or personal path leaks', () => {
      const unpackedDir = join(sharedTmpDir, 'unpacked-hygiene')
      unpackTarball(sharedTgzPath, unpackedDir)
      const pkgJsonBytes = readFileSync(join(unpackedDir, 'package.json'))
      const hasBom = pkgJsonBytes[0] === 0xef && pkgJsonBytes[1] === 0xbb && pkgJsonBytes[2] === 0xbf
      assert.equal(hasBom, false, 'package.json must not have a UTF-8 BOM')
      const allFiles = getAllFiles(unpackedDir)
      const personalName = ['Ace', 'dia'].join('')
      const winUserRegex = new RegExp(`[a-zA-Z]:[\\\\/]Users[\\\\/]${personalName}`, 'i')
      const winProjRegex = new RegExp(`[a-zA-Z]:[\\\\/]Projects[\\\\/]Claude Projects`, 'i')
      const macUserRegex = /(?:^|["'\s`])\/Users\/(?!<username>|runner|shared)[a-zA-Z0-9_\-\.]+/i
      const linuxHomeRegex = /(?:^|["'\s`])\/home\/(?!<username>|runner|arch)[a-zA-Z0-9_\-\.]+/i
      const bearerRegex = /Bearer\s+[a-zA-Z0-9_\-\.]{20,}/i
      const skKeyRegex = /\bsk-[a-zA-Z0-9_\-]{20,}\b/i
      const tokenAssignmentRegex = /(?:apiKey|api_key|client_secret|session_token|access_token|refresh_token)\s*[:=]\s*['"][^'"\s<>]{16,}['"]/i
      for (const file of allFiles) {
        const content = readFileSync(file, 'utf8')
        const relPath = file.replace(unpackedDir, '')
        assert.equal(winUserRegex.test(content), false, `Safety violation in ${relPath}: rule "no-windows-user-path"`)
        assert.equal(winProjRegex.test(content), false, `Safety violation in ${relPath}: rule "no-workspace-path"`)
        assert.equal(macUserRegex.test(content), false, `Safety violation in ${relPath}: rule "no-mac-user-path"`)
        assert.equal(linuxHomeRegex.test(content), false, `Safety violation in ${relPath}: rule "no-linux-home-path"`)
        assert.equal(bearerRegex.test(content), false, `Safety violation in ${relPath}: rule "no-bearer-token"`)
        assert.equal(skKeyRegex.test(content), false, `Safety violation in ${relPath}: rule "no-sk-key"`)
        assert.equal(tokenAssignmentRegex.test(content), false, `Safety violation in ${relPath}: rule "no-token-assignment"`)
      }
    })

    await t.test('packed package root, invariant, and primary web search subpath are importable', () => {
      const testAppDir = join(sharedTmpDir, 'app')
      const appNodeModules = join(testAppDir, 'node_modules')
      const installedPkgDir = join(appNodeModules, PACKAGE_NAME)
      unpackTarball(sharedTgzPath, installedPkgDir)
      linkPeerDependencies(join(PACKAGE_ROOT, 'node_modules'), appNodeModules)
      const testScript = `
import assert from 'node:assert/strict';
import * as root from '${PACKAGE_NAME}';
import * as invariant from '${PACKAGE_NAME}/invariant';
import * as webSearch from '${PACKAGE_NAME}/primary-web-search';
assert.equal(root.name, 'subagent-codex');
assert.equal(typeof root.apply, 'function');
assert.deepEqual(root.inject, ['subagents', 'subprocess', 'llm', 'projectMemory']);
assert(root.Config !== undefined, 'Config schema must be exported');
assert.equal(invariant.name, 'subagent-codex-invariant');
assert.deepEqual(invariant.inject, ['invariants']);
assert.equal(typeof invariant.apply, 'function');
assert.equal(webSearch.name, 'primary-web-search');
assert.deepEqual(webSearch.inject, ['tools', 'systemPrompt', 'subprocess']);
assert.equal(typeof webSearch.apply, 'function');
console.log('CODEX_IMPORT_VERIFIED_OK');
`
      const scriptPath = join(testAppDir, 'verify.mjs')
      writeFileSync(join(testAppDir, 'package.json'), JSON.stringify({ type: 'module' }))
      writeFileSync(scriptPath, testScript)
      const output = execSync(`${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)}`, {
        cwd: testAppDir,
        encoding: 'utf8',
        stdio: 'pipe',
      })
      assert.match(output, /CODEX_IMPORT_VERIFIED_OK/)
    })
  } finally {
    rmSync(sharedTmpDir, { recursive: true, force: true })
  }
})
