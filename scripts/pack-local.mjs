import { spawnSync } from 'node:child_process'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = resolve(root, '.artifacts', 'packs')
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

const packageOrder = [
  'nishi-dsh-provider-kit',
  'nishi-dsh-project-memory',
  'nishi-dsh-codex',
  'nishi-dsh-antigravity',
  'nishi-dsh-usage-limits',
  'nishi-dsh-primary-web-search',
  'nishi-dsh-usage-limits-host',
  'nishi-dsh-suite',
]

function run(args) {
  const result = spawnSync(pnpm, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${pnpm} ${args.join(' ')} exited with ${result.status ?? 'unknown status'}`)
  }
}

await rm(outputDir, { recursive: true, force: true })
await mkdir(outputDir, { recursive: true })

run(['-r', '--if-present', 'build'])

for (const packageName of packageOrder) {
  run(['--filter', packageName, 'pack', '--pack-destination', outputDir])
}

const packed = (await readdir(outputDir)).filter((name) => name.endsWith('.tgz')).sort()
if (packed.length !== packageOrder.length) {
  throw new Error(`expected ${packageOrder.length} tarballs, found ${packed.length}: ${packed.join(', ')}`)
}

console.log(`Packed ${packed.length} packages into ${outputDir}`)
for (const filename of packed) console.log(`- ${filename}`)
