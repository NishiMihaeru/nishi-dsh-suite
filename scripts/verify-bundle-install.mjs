import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, readdir, readFile, readlink, realpath, stat, writeFile } from 'node:fs/promises'
import { extname, isAbsolute, join, resolve } from 'node:path'

const LOCAL_FAMILY_PACKAGES = [
  'nishi-dsh-core',
  'nishi-dsh-project-memory',
  'nishi-dsh-codex',
  'nishi-dsh-antigravity',
  'nishi-dsh-claude',
  'nishi-dsh-grok',
]

function usage(message) {
  if (message) console.error(message)
  console.error(`Usage:
  node scripts/verify-bundle-install.mjs --profile <name> --suite <tarball-or-spec> [options]

Options:
  --update-spec <tarball-or-spec>  Exercise a real package update; otherwise reinstall the same spec idempotently.
  --profile-dir <path>             Verify package.json dependency + dsh.profile.bundles reconciliation.
  --closure-only                   Run only the vendor-runtime closure gate against an installed tree, then exit.
  --dsh-home <path>                Set child DSH_HOME and derive profile dir as <home>/profiles/<profile>.
  --local-pack-dir <path>          Prepublish acceptance only: resolve Nishi leaf dependencies from local tarballs via temporary profile pnpm overrides. The Suite tarball is not rewritten.
  --preserve <path>                Hash a path before/after each phase; may be repeated.
  --dsh-bin <path-or-command>      DSH executable (default: DSH_BIN env or dsh).
`)
  process.exit(2)
}

function parseArgs(argv) {
  const result = { preserve: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => {
      if (i + 1 >= argv.length) usage(`missing value for ${arg}`)
      return argv[++i]
    }
    switch (arg) {
      case '--profile': result.profile = value(); break
      case '--suite': result.suite = value(); break
      case '--update-spec': result.updateSpec = value(); break
      case '--profile-dir': result.profileDir = value(); break
      case '--closure-only': result.closureOnly = true; break
      case '--dsh-home': result.dshHome = value(); break
      case '--local-pack-dir': result.localPackDir = value(); break
      case '--preserve': result.preserve.push(value()); break
      case '--dsh-bin': result.dshBin = value(); break
      case '--help': usage(); break
      default: usage(`unknown argument: ${arg}`)
    }
  }
  // --closure-only audits an already installed tree: it neither boots DSH nor
  // installs anything, so the install-cycle arguments do not apply to it.
  if (!result.closureOnly) {
    if (!result.profile) usage('--profile is required')
    if (!result.suite) usage('--suite is required')
  }
  if (result.profile && (result.profile.includes('/') || result.profile.includes('\\'))) {
    usage('--profile must be a DSH profile name, not a path')
  }
  return result
}

const args = parseArgs(process.argv.slice(2))
const dshBin = args.dshBin ?? process.env.DSH_BIN ?? 'dsh'
const explicitDshHome = args.dshHome ? resolve(args.dshHome) : undefined
const profileDir = args.profileDir
  ? resolve(args.profileDir)
  : explicitDshHome
    ? resolve(explicitDshHome, 'profiles', args.profile)
    : process.env.DSH_HOME
      ? resolve(process.env.DSH_HOME, 'profiles', args.profile)
      : undefined
const localPackDir = args.localPackDir ? resolve(args.localPackDir) : undefined

if (localPackDir && !profileDir) {
  usage('--local-pack-dir requires --dsh-home, --profile-dir, or DSH_HOME so the disposable profile workspace can be inspected safely')
}

function normalizeSpec(spec) {
  if (spec.startsWith('.') || spec.startsWith('/') || /^[A-Za-z]:[\\/]/.test(spec)) {
    return isAbsolute(spec) ? spec : resolve(spec)
  }
  return spec
}

function runDsh(pluginArgs, { capture = false, allowFailure = false } = {}) {
  const result = spawnSync(
    dshBin,
    ['plugin', '--profile', args.profile, ...pluginArgs],
    {
      encoding: capture ? 'utf8' : undefined,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      shell: process.platform === 'win32',
      env: explicitDshHome
        ? { ...process.env, DSH_HOME: explicitDshHome }
        : process.env,
    },
  )
  if (result.error && !allowFailure) throw result.error
  if ((result.status ?? 1) !== 0 && !allowFailure) {
    if (capture && result.stderr) process.stderr.write(result.stderr)
    throw new Error(`dsh plugin --profile ${args.profile} ${pluginArgs.join(' ')} exited with ${result.status ?? 'unknown status'}`)
  }
  return result
}

async function hashPath(path) {
  const absolute = resolve(path)
  const hash = createHash('sha256')

  async function visit(current, relative) {
    let stat
    try {
      stat = await lstat(current)
    } catch (error) {
      if (error?.code === 'ENOENT') {
        hash.update(`missing\0${relative}\0`)
        return
      }
      throw error
    }

    if (stat.isSymbolicLink()) {
      hash.update(`symlink\0${relative}\0${await readlink(current)}\0`)
      return
    }
    if (stat.isDirectory()) {
      hash.update(`dir\0${relative}\0`)
      const entries = (await readdir(current)).sort()
      for (const entry of entries) await visit(join(current, entry), join(relative, entry))
      return
    }
    if (stat.isFile()) {
      hash.update(`file\0${relative}\0${stat.mode}\0${stat.size}\0`)
      hash.update(await readFile(current))
      return
    }
    hash.update(`other\0${relative}\0${stat.mode}\0${stat.size}\0`)
  }

  await visit(absolute, '.')
  return hash.digest('hex')
}

async function snapshotPreserved() {
  const result = new Map()
  for (const path of args.preserve) result.set(resolve(path), await hashPath(path))
  return result
}

async function assertPreserved(expected, phase) {
  for (const [path, digest] of expected) {
    const actual = await hashPath(path)
    if (actual !== digest) throw new Error(`preserved path changed during ${phase}: ${path}`)
  }
}

function parsePnpmList(stdout) {
  const raw = String(stdout ?? '').trim()
  if (!raw) throw new Error('pnpm list returned empty stdout')
  const parsed = JSON.parse(raw)
  return Array.isArray(parsed) ? parsed[0] : parsed
}

function directSuiteDependency() {
  const result = runDsh(['list', '--depth', '0', '--json'], { capture: true })
  const listed = parsePnpmList(result.stdout)
  return listed?.dependencies?.['nishi-dsh-suite'] ?? listed?.devDependencies?.['nishi-dsh-suite']
}

async function assertProfilePnpmContract() {
  if (!profileDir) return
  const workspacePath = join(profileDir, 'pnpm-workspace.yaml')
  const workspace = await readFile(workspacePath, 'utf8')
  if (!/^nodeLinker:\s*hoisted\s*$/m.test(workspace)) {
    throw new Error(`DSH profile pnpm contract mismatch: ${workspacePath} must set nodeLinker: hoisted`)
  }
  if (!/^autoInstallPeers:\s*false\s*$/m.test(workspace)) {
    throw new Error(`DSH profile pnpm contract mismatch: ${workspacePath} must set autoInstallPeers: false`)
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

let originalProfileWorkspace

async function installLocalPackOverrides() {
  if (!localPackDir) return
  if (!profileDir) throw new Error('internal error: local pack overrides require a resolved profile directory')

  await assertProfilePnpmContract()

  const workspacePath = join(profileDir, 'pnpm-workspace.yaml')
  const workspace = await readFile(workspacePath, 'utf8')
  if (/^overrides:\s*$/m.test(workspace)) {
    throw new Error(`refusing to modify profile workspace with pre-existing overrides: ${workspacePath}`)
  }

  const filenames = await readdir(localPackDir)
  const entries = []
  for (const packageName of LOCAL_FAMILY_PACKAGES) {
    const pattern = new RegExp(`^${escapeRegex(packageName)}-\\d.+\\.tgz$`)
    const matches = filenames.filter((filename) => pattern.test(filename))
    if (matches.length !== 1) {
      throw new Error(
        `expected exactly one local tarball for ${packageName} in ${localPackDir}, found ${matches.length}: ${matches.join(', ') || '(none)'}`,
      )
    }
    const tarball = resolve(localPackDir, matches[0]).replace(/\\/g, '/')
    entries.push(`  ${JSON.stringify(packageName)}: ${JSON.stringify(`file:${tarball}`)}`)
  }

  originalProfileWorkspace = workspace
  const overridden = `${workspace.trimEnd()}\n\noverrides:\n${entries.join('\n')}\n`
  await writeFile(workspacePath, overridden, 'utf8')
  console.log(`Installed temporary prepublish Nishi-family overrides in ${workspacePath}`)
}

async function restoreLocalPackOverrides() {
  if (originalProfileWorkspace === undefined || !profileDir) return
  const workspacePath = join(profileDir, 'pnpm-workspace.yaml')
  await writeFile(workspacePath, originalProfileWorkspace, 'utf8')
  originalProfileWorkspace = undefined
  console.log(`Restored original DSH profile workspace: ${workspacePath}`)
}

async function assertProfileManifest(expectedInstalled) {
  if (!profileDir) return
  const manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
  const dependency = manifest.dependencies?.['nishi-dsh-suite']
  const bundles = manifest.dsh?.profile?.bundles ?? []
  const occurrences = bundles.filter((name) => name === 'nishi-dsh-suite').length

  if (expectedInstalled) {
    if (!dependency) throw new Error('profile manifest is missing nishi-dsh-suite dependency after install')
    if (occurrences !== 1) throw new Error(`expected nishi-dsh-suite exactly once in dsh.profile.bundles, got ${occurrences}`)
  } else {
    if (dependency) throw new Error('profile manifest still contains nishi-dsh-suite dependency after uninstall')
    if (occurrences !== 0) throw new Error(`nishi-dsh-suite remains in dsh.profile.bundles after uninstall (${occurrences})`)
  }
}

// --- Vendor-runtime bundling gate -----------------------------------------
//
// Release rc.2 draws a hard line: the Suite must never bundle vendor CLI
// runtimes into an installed profile. `@openai/codex*` and
// `@anthropic-ai/*` historically dragged in per-platform native binaries
// (win32 .exe, darwin/linux arm64/x64 shared libraries, prebuilt .node
// addons, etc.) that have no business sitting in a Node profile closure.
// The checks below inspect the *actually installed* node_modules tree, not
// package.json manifests, so a transitive dependency re-introducing one of
// these packages gets caught even if no manifest mentions it directly.
//
// Scope note: the binary-artifact scan is deliberately restricted to the
// `@openai` and `@anthropic-ai` scopes rather than walking the whole
// node_modules tree. Legitimate build tooling (esbuild, lightningcss,
// @img/sharp-*, @rollup/rollup-*, @swc/core-*, and similar) ships real
// native addons for the current platform as a normal, expected part of its
// install; a tree-wide scan for `.node` files or platform-name substrings
// would flag those and produce constant false positives. Restricting the
// scan to the two vendor scopes actually being gated keeps the check
// meaningful without having to hand-maintain a fragile allowlist of every
// legitimate native package the dependency tree may ever contain.
const BANNED_VENDOR_PACKAGE_PATTERNS = [
  { scope: '@openai', test: (name) => name === 'codex' || name === 'codex-sdk' || name.startsWith('codex-') },
  { scope: '@anthropic-ai', test: () => true },
]

const VENDOR_BINARY_SCAN_SCOPES = ['@openai', '@anthropic-ai']

const FOREIGN_BINARY_EXTENSIONS = new Set(['.exe', '.dll', '.dylib', '.node'])
const PLATFORM_MARKER_PATTERN =
  /(?:^|[\\/._-])(win32|windows|darwin|linux-arm64|linux-x64|aarch64|x86_64-pc-windows|apple-darwin|x86_64-unknown-linux|i686-pc-windows-msvc)(?:[\\/._-]|$)/i

const NODE_MODULES_DIR_NAME = 'node_modules'
const MAX_WALK_DEPTH = 40

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

// Finds every `node_modules` directory reachable from `root`, following
// symlinks (pnpm trees are full of them, including a possible `.pnpm`
// virtual store) while staying loop-safe via a visited-realpath set.
async function findNodeModulesDirs(root) {
  const found = []
  const visitedReal = new Set()

  async function visit(dir, depth) {
    if (depth > MAX_WALK_DEPTH) return
    let real
    try {
      real = await realpath(dir)
    } catch {
      return
    }
    if (visitedReal.has(real)) return
    visitedReal.add(real)

    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      const full = join(dir, entry.name)
      if (!(await isDirectory(full))) continue
      if (entry.name === NODE_MODULES_DIR_NAME) found.push(full)
      await visit(full, depth + 1)
    }
  }

  await visit(root, 0)
  return found
}

// Lists `{ name, dir }` package entries installed directly under `scope`
// (e.g. "@openai") within a single node_modules directory. This covers a
// flat/hoisted layout (node_modules/@scope/name) directly; pnpm's virtual
// store layout (node_modules/.pnpm/@scope+name@version/node_modules/@scope/name)
// is covered because findNodeModulesDirs() already walks into `.pnpm/*/node_modules`
// and reports it as its own node_modules directory to scan here.
async function listScopedPackages(nodeModulesDir, scope) {
  const scopeDir = join(nodeModulesDir, scope)
  if (!(await isDirectory(scopeDir))) return []
  let names
  try {
    names = await readdir(scopeDir)
  } catch {
    return []
  }
  const results = []
  for (const name of names) {
    const dir = join(scopeDir, name)
    if (await isDirectory(dir)) results.push({ name, dir })
  }
  return results
}

async function assertNoVendorRuntimePackages() {
  const rootNodeModules = join(profileDir, NODE_MODULES_DIR_NAME)
  if (!(await isDirectory(rootNodeModules))) {
    throw new Error(`vendor-runtime gate could not run: no node_modules directory found at ${rootNodeModules} after install`)
  }

  const nodeModulesDirs = await findNodeModulesDirs(profileDir)
  const violations = []

  for (const nodeModulesDir of nodeModulesDirs) {
    for (const { scope, test } of BANNED_VENDOR_PACKAGE_PATTERNS) {
      const packages = await listScopedPackages(nodeModulesDir, scope)
      for (const { name, dir } of packages) {
        if (test(name)) violations.push(`${scope}/${name} -> ${dir}`)
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(
      `Forbidden vendor runtime package(s) found in the installed closure (the Suite must not bundle vendor CLI runtimes):\n  ${violations.join('\n  ')}`,
    )
  }
}

// Recursively scans `dir` (expected to be a single @openai/* or
// @anthropic-ai/* package directory) for files matching a foreign-platform
// binary extension or a platform-name marker anywhere in their path.
async function findForeignPlatformBinaries(dir) {
  const violations = []
  const visitedReal = new Set()

  async function visit(current, depth) {
    if (depth > MAX_WALK_DEPTH) return
    let real
    try {
      real = await realpath(current)
    } catch {
      return
    }
    if (visitedReal.has(real)) return
    visitedReal.add(real)

    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const full = join(current, entry.name)
      let info
      try {
        info = await stat(full)
      } catch {
        continue
      }

      if (info.isDirectory()) {
        if (PLATFORM_MARKER_PATTERN.test(entry.name)) violations.push(full)
        await visit(full, depth + 1)
        continue
      }

      if (info.isFile()) {
        if (FOREIGN_BINARY_EXTENSIONS.has(extname(entry.name)) || PLATFORM_MARKER_PATTERN.test(entry.name)) {
          violations.push(full)
        }
      }
    }
  }

  await visit(dir, 0)
  return violations
}

async function assertNoForeignPlatformBinaries() {
  const nodeModulesDirs = await findNodeModulesDirs(profileDir)
  const violations = []
  const scannedReal = new Set()

  for (const nodeModulesDir of nodeModulesDirs) {
    for (const scope of VENDOR_BINARY_SCAN_SCOPES) {
      const packages = await listScopedPackages(nodeModulesDir, scope)
      for (const { dir } of packages) {
        let real
        try {
          real = await realpath(dir)
        } catch {
          continue
        }
        if (scannedReal.has(real)) continue
        scannedReal.add(real)
        violations.push(...(await findForeignPlatformBinaries(dir)))
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(
      `Foreign-platform vendor binaries found under @openai/@anthropic-ai package(s) in the installed closure (the Suite must not bundle vendor CLI runtimes):\n  ${violations.join('\n  ')}`,
    )
  }
}

async function assertNoVendorRuntimeArtifacts() {
  if (!profileDir) return
  await assertNoVendorRuntimePackages()
  await assertNoForeignPlatformBinaries()
}

// Standalone mode: run only the vendor-runtime gate against an already installed
// tree. A gate that can only run inside a full install cycle is a gate nobody
// exercises, and an unexercised gate is worse than none because it reads as
// proof. This also lets the real user profile be audited without touching it.
if (args.closureOnly) {
  if (!profileDir) usage('--closure-only requires --profile-dir, --dsh-home, or DSH_HOME')
  await assertNoVendorRuntimeArtifacts()
  console.log(`vendor-runtime closure clean: ${profileDir}`)
  process.exit(0)
}

const preserved = await snapshotPreserved()
let installedByThisRun = false

try {
  if (directSuiteDependency()) {
    throw new Error(`profile ${args.profile} already has nishi-dsh-suite installed; use a clean acceptance profile or remove it explicitly first`)
  }

  await assertProfilePnpmContract()
  await installLocalPackOverrides()

  console.log(`Installing Suite into normal DSH profile: ${args.profile}`)
  installedByThisRun = true
  runDsh(['add', normalizeSpec(args.suite)])
  if (!directSuiteDependency()) throw new Error('nishi-dsh-suite is not a direct profile dependency after install')
  await assertProfilePnpmContract()
  await assertProfileManifest(true)
  await assertNoVendorRuntimeArtifacts()
  await assertPreserved(preserved, 'install')

  const secondSpec = args.updateSpec ?? args.suite
  console.log(args.updateSpec ? 'Exercising update spec' : 'Exercising idempotent reinstall/reconciliation')
  runDsh(['add', normalizeSpec(secondSpec)])
  if (!directSuiteDependency()) throw new Error('nishi-dsh-suite disappeared after update/reinstall')
  await assertProfilePnpmContract()
  await assertProfileManifest(true)
  await assertNoVendorRuntimeArtifacts()
  await assertPreserved(preserved, args.updateSpec ? 'update' : 'reinstall')

  console.log('Uninstalling Suite')
  runDsh(['remove', 'nishi-dsh-suite'])
  installedByThisRun = false
  if (directSuiteDependency()) throw new Error('nishi-dsh-suite remains a direct dependency after uninstall')

  await restoreLocalPackOverrides()
  await assertProfilePnpmContract()
  await assertProfileManifest(false)
  await assertPreserved(preserved, 'uninstall')

  console.log('Bundle install/update/uninstall acceptance passed for the exercised profile operations.')
  console.log('Verified the installed closure contains no vendor runtime packages (@openai/codex*, @anthropic-ai/*) or foreign-platform vendor binaries.')
  if (localPackDir) {
    console.log('Prepublish mode used temporary local-tarball overrides only for Nishi leaf resolution; the Suite tarball itself was not rewritten.')
  }
  if (!args.updateSpec) {
    console.log('Note: version-to-version update was not exercised; pass --update-spec when a second prerelease tarball is available.')
  }
} catch (error) {
  if (installedByThisRun) {
    console.error('Acceptance failed; attempting to remove the Suite installed by this run...')
    runDsh(['remove', 'nishi-dsh-suite'], { allowFailure: true })
  }
  throw error
} finally {
  await restoreLocalPackOverrides()
}
