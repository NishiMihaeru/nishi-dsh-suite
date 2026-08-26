import { readFile } from 'node:fs/promises'

const path = new URL('../presets/orchestrator/agent.cordis.yml', import.meta.url)
const source = await readFile(path, 'utf8')

function count(pattern) {
  return [...source.matchAll(pattern)].length
}

function requireCount(label, pattern, expected = 1) {
  const actual = count(pattern)
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`)
  }
}

const ids = [...source.matchAll(/^\s*- id:\s*([^\s#]+)\s*$/gm)].map((match) => match[1])
const seen = new Set()
const duplicates = new Set()
for (const id of ids) {
  if (seen.has(id)) duplicates.add(id)
  seen.add(id)
}
if (duplicates.size > 0) {
  throw new Error(`duplicate orchestrator row ids: ${[...duplicates].sort().join(', ')}`)
}

requireCount('subagent_codex', /^\s*toolName:\s*subagent_codex\s*$/gm)
requireCount('subagent_claude_code', /^\s*toolName:\s*subagent_claude_code\s*$/gm)
requireCount('subagent_antigravity', /^\s*toolName:\s*subagent_antigravity\s*$/gm)
requireCount('primary web_search package', /^\s*name:\s*['"]?nishi-dsh-primary-web-search['"]?\s*$/gm)
requireCount('project memory package', /^\s*name:\s*['"]?nishi-dsh-project-memory['"]?\s*$/gm)

for (const retired of [
  'dsh-subagent-codex-custom/primary-web-search',
  '@dsh-plugin/project-memory',
  'nishi-dsh-codex-antigravity',
]) {
  if (source.includes(retired)) {
    throw new Error(`retired package boundary remains in orchestrator: ${retired}`)
  }
}

console.log(`orchestrator validated: ${ids.length} unique rows`)
