import { spawnSync } from 'node:child_process'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packDir = resolve(root, '.artifacts', 'packs')
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const OVERRIDE_BEGIN = '# BEGIN nishi-dsh-suite local-family-overrides'
const OVERRIDE_END = '# END nishi-dsh-suite local-family-overrides'

const LEAF_PACKAGES = [
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
  node scripts/install-local-profile.mjs --profile <name> [options]

Install the unpublished rc.3 family into a DSH profile from local tarballs.
Does not fetch nishi-dsh-* from the npm registry.

Options:
  --dsh-home <path>    DSH_HOME (default: env DSH_HOME or ~/.dsh)
  --dsh-bin <command>  DSH executable (default: DSH_BIN env or dsh)
  --skip-pack          Reuse existing .artifacts/packs tarballs
`)
  process.exit(2)
}

function parseArgs(argv) {
  const result = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => {
      if (i + 1 >= argv.length) usage(`missing value for ${arg}`)
      return argv[++i]
    }
    switch (arg) {
      case '--profile': result.profile = value(); break
      case '--dsh-home': result.dshHome = value(); break
      case '--dsh-bin': result.dshBin = value(); break
      case '--skip-pack': result.skipPack = true; break
      case '--help': usage(); break
      default: usage(`unknown argument: ${arg}`)
    }
  }
  if (!result.profile) usage('--profile is required')
  if (result.profile.includes('/') || result.profile.includes('\\')) {
    usage('--profile must be a DSH profile name, not a path')
  }
  return result
}

function run(command, args, { cwd = root, env = process.env } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status ?? 'unknown status'}`)
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function findTarball(filenames, packageName) {
  const pattern = new RegExp(`^${escapeRegex(packageName)}-\\d.+\\.tgz$`)
  const matches = filenames.filter((filename) => pattern.test(filename))
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one tarball for ${packageName} in ${packDir}, found ${matches.length}: ${matches.join(', ') || '(none)'}`,
    )
  }
  return resolve(packDir, matches[0]).replace(/\\/g, '/')
}

const args = parseArgs(process.argv.slice(2))
const dshBin = args.dshBin ?? process.env.DSH_BIN ?? 'dsh'
const dshHome = resolve(args.dshHome ?? process.env.DSH_HOME ?? join(process.env.HOME ?? '', '.dsh'))
const profileDir = resolve(dshHome, 'profiles', args.profile)
const workspacePath = join(profileDir, 'pnpm-workspace.yaml')
const env = { ...process.env, DSH_HOME: dshHome }

if (!args.skipPack) {
  run(pnpm, ['pack:local'])
}

const filenames = await readdir(packDir)
const suiteTarball = findTarball(filenames, 'nishi-dsh-suite')
const leafEntries = LEAF_PACKAGES.map((name) => {
  const tarball = findTarball(filenames, name)
  return `  ${JSON.stringify(name)}: ${JSON.stringify(`file:${tarball}`)}`
})

const workspace = await readFile(workspacePath, 'utf8')
if (!/^nodeLinker:\s*hoisted\s*$/m.test(workspace)) {
  throw new Error(`DSH profile pnpm contract mismatch: ${workspacePath} must set nodeLinker: hoisted`)
}
if (!/^autoInstallPeers:\s*false\s*$/m.test(workspace)) {
  throw new Error(`DSH profile pnpm contract mismatch: ${workspacePath} must set autoInstallPeers: false`)
}

const managedBlock = `${OVERRIDE_BEGIN}\noverrides:\n${leafEntries.join('\n')}\n${OVERRIDE_END}\n`
const managedPattern = new RegExp(`${escapeRegex(OVERRIDE_BEGIN)}[\s\S]*?${escapeRegex(OVERRIDE_END)}\n?`)
let nextWorkspace
if (managedPattern.test(workspace)) {
  nextWorkspace = workspace.replace(managedPattern, managedBlock)
} else if (/^overrides:\s*$/m.test(workspace)) {
  throw new Error(`refusing to modify profile workspace with unmanaged overrides: ${workspacePath}`)
} else {
  nextWorkspace = `${workspace.trimEnd()}\n\n${managedBlock}`
}
await writeFile(workspacePath, nextWorkspace, 'utf8')
console.log(`Pinned unpublished Nishi leaf tarballs in ${workspacePath}`)

const suiteSpec = isAbsolute(suiteTarball) ? suiteTarball : resolve(suiteTarball)
console.log(`Installing ${suiteSpec} into DSH profile ${args.profile}`)
run(dshBin, ['plugin', '--profile', args.profile, 'add', suiteSpec], { env })

console.log(`Installed nishi-dsh-suite from local tarballs into profile ${args.profile}.`)
console.log('Next, if this profile should use the managed Orchestrator preset:')
console.log(`  ${dshBin} plugin --profile ${args.profile} exec nishi-dsh-suite preset install`)
