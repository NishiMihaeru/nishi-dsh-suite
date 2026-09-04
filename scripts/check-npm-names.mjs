const VERSION = '0.1.0-rc.3'
const names = [
  'nishi-dsh-core',
  'nishi-dsh-codex',
  'nishi-dsh-antigravity',
  'nishi-dsh-claude',
  'nishi-dsh-grok',
  'nishi-dsh-project-memory',
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
  const taken = result.prerelease ? `  ALREADY-PUBLISHED@${result.prerelease}` : ''
  console.log(`${result.status.padEnd(9)} ${result.name}${suffix}${taken}`)
}

// Two different questions, and only the first one was ever asked here.
//
// Before the first publication the question was "is this name free?". After rc.1
// every family name is legitimately occupied by us, so --require-available can
// never pass again and would block every subsequent release. The question that
// actually gates a re-release is "is the target version already published?",
// because that is the one condition npm will refuse.
const alreadyPublished = results.filter((result) => result.prerelease)
if (alreadyPublished.length > 0) {
  console.log(`\n${VERSION} is already published for: ${alreadyPublished.map((r) => r.name).join(', ')}`)
  console.log('Bump the family before publishing; npm will not accept a republished version.')
  process.exitCode = 2
} else {
  console.log(`\nversion-free ${VERSION} for all ${names.length} family names`)
}

const unowned = results.filter((result) => result.status === 'AVAILABLE')
if (unowned.length > 0) {
  console.log(`first publication for: ${unowned.map((r) => r.name).join(', ')}`)
  console.log('npm binds `latest` to a first published version and will not let it be removed.')
}

// Retained for a hypothetical fresh family under a new prefix, where name
// availability really is the gate.
if (requireAvailable && results.some((result) => result.status === 'OCCUPIED')) {
  console.log('\n--require-available: at least one name is occupied.')
  console.log('Fallback family: @nishimihaeru/dsh-* for every package, including the suite.')
  process.exitCode = 2
}
