import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, readdir, readFile, readlink } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'

function usage(message) {
  if (message) console.error(message)
  console.error(`Usage:
  node scripts/verify-bundle-install.mjs --profile <name> --suite <tarball-or-spec> [options]

Options:
  --update-spec <tarball-or-spec>  Exercise a real package update; otherwise reinstall the same spec idempotently.
  --profile-dir <path>             Verify package.json dependency + dsh.profile.bundles reconciliation.
  --dsh-home <path>                Derive profile dir as <home>/profiles/<profile>; does not change DSH_HOME.
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
      case '--dsh-home': result.dshHome = value(); break
      case '--preserve': result.preserve.push(value()); break
      case '--dsh-bin': result.dshBin = value(); break
      case '--help': usage(); break
      default: usage(`unknown argument: ${arg}`)
    }
  }
  if (!result.profile) usage('--profile is required')
  if (!result.suite) usage('--suite is required')
  if (result.profile.includes('/') || result.profile.includes('\\')) usage('--profile must be a DSH profile name, not a path')
  return result
}

const args = parseArgs(process.argv.slice(2))
const dshBin = args.dshBin ?? process.env.DSH_BIN ?? 'dsh'
const profileDir = args.profileDir
  ? resolve(args.profileDir)
  : args.dshHome
    ? resolve(args.dshHome, 'profiles', args.profile)
    : process.env.DSH_HOME
      ? resolve(process.env.DSH_HOME, 'profiles', args.profile)
      : undefined

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

const preserved = await snapshotPreserved()
let installedByThisRun = false

try {
  if (directSuiteDependency()) {
    throw new Error(`profile ${args.profile} already has nishi-dsh-suite installed; use a clean acceptance profile or remove it explicitly first`)
  }

  console.log(`Installing Suite into normal DSH profile: ${args.profile}`)
  runDsh(['add', normalizeSpec(args.suite)])
  installedByThisRun = true
  if (!directSuiteDependency()) throw new Error('nishi-dsh-suite is not a direct profile dependency after install')
  await assertProfileManifest(true)
  await assertPreserved(preserved, 'install')

  const secondSpec = args.updateSpec ?? args.suite
  console.log(args.updateSpec ? 'Exercising update spec' : 'Exercising idempotent reinstall/reconciliation')
  runDsh(['add', normalizeSpec(secondSpec)])
  if (!directSuiteDependency()) throw new Error('nishi-dsh-suite disappeared after update/reinstall')
  await assertProfileManifest(true)
  await assertPreserved(preserved, args.updateSpec ? 'update' : 'reinstall')

  console.log('Uninstalling Suite')
  runDsh(['remove', 'nishi-dsh-suite'])
  installedByThisRun = false
  if (directSuiteDependency()) throw new Error('nishi-dsh-suite remains a direct dependency after uninstall')
  await assertProfileManifest(false)
  await assertPreserved(preserved, 'uninstall')

  console.log('Bundle install/update/uninstall acceptance passed for the exercised profile operations.')
  if (!args.updateSpec) {
    console.log('Note: version-to-version update was not exercised; pass --update-spec when a second prerelease tarball is available.')
  }
} catch (error) {
  if (installedByThisRun) {
    console.error('Acceptance failed; attempting to remove the Suite installed by this run...')
    runDsh(['remove', 'nishi-dsh-suite'], { allowFailure: true })
  }
  throw error
}
