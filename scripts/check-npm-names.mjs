const VERSION = '0.1.0-rc.1'
const names = [
  'nishi-dsh-codex',
  'nishi-dsh-antigravity',
  'nishi-dsh-claude-code',
  'nishi-dsh-primary-web-search',
  'nishi-dsh-project-memory',
  'nishi-dsh-usage-limits',
  'nishi-dsh-usage-limits-host',
  'nishi-dsh-codex-usage-source',
  'nishi-dsh-suite',
]

const requireAvailable = process.argv.includes('--require-available')
const results = []

for (const name of names) {
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}`
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'nishi-dsh-suite-name-check' },
  })

  if (response.status === 404) {
    results.push({ name, status: 'AVAILABLE' })
    continue
  }

  if (response.ok) {
    const body = await response.json()
    results.push({
      name,
      status: 'OCCUPIED',
      latest: body?.['dist-tags']?.latest ?? null,
      prerelease: body?.versions?.[VERSION] ? VERSION : null,
    })
    continue
  }

  throw new Error(`npm registry probe failed for ${name}: HTTP ${response.status}`)
}

for (const result of results) {
  const suffix = result.latest ? ` latest=${result.latest}` : ''
  console.log(`${result.status.padEnd(9)} ${result.name}${suffix}`)
}

const occupied = results.filter((result) => result.status === 'OCCUPIED')
if (occupied.length > 0) {
  console.log('\nAt least one unscoped name is occupied. Do not publish a mixed family.')
  console.log('Fallback family: @nishimihaeru/dsh-* for every package, including the suite.')
  if (requireAvailable) process.exitCode = 2
} else {
  console.log(`\nall-unscoped-names-available ${names.length}`)
}
