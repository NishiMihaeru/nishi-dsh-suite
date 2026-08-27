import assert from 'node:assert/strict'
import test from 'node:test'
import { MEMORY_CONSOLIDATION_DIRECTIVE, MEMORY_MAINTENANCE_DIRECTIVE } from '../src/commands.ts'

// Project memory is committed and ships with the repository to every collaborator.
// Until a separate personal store exists there is nowhere else to put operator
// facts, so the directives must tell the model to drop them rather than let them
// be filed under an approved category such as "durable workflows".

test('maintenance directive refuses operator-personal facts and says why', () => {
  assert.match(MEMORY_MAINTENANCE_DIRECTIVE, /NEVER save/)
  assert.match(MEMORY_MAINTENANCE_DIRECTIVE, /personal facts about the operator/)
  assert.match(MEMORY_MAINTENANCE_DIRECTIVE, /committed to the repository/)
  assert.match(MEMORY_MAINTENANCE_DIRECTIVE, /belongs to the operator, not to the project/)
})

test('consolidation directive also removes operator-personal facts already stored', () => {
  assert.match(MEMORY_CONSOLIDATION_DIRECTIVE, /personal facts about the operator/)
  assert.match(MEMORY_CONSOLIDATION_DIRECTIVE, /Remove any already present/)
})

test('both directives keep the existing secret and quota prohibitions', () => {
  for (const directive of [MEMORY_MAINTENANCE_DIRECTIVE, MEMORY_CONSOLIDATION_DIRECTIVE]) {
    assert.match(directive, /credentials/)
    assert.match(directive, /quota/)
  }
})

test('directive step numbering stays contiguous from one', () => {
  for (const directive of [MEMORY_MAINTENANCE_DIRECTIVE, MEMORY_CONSOLIDATION_DIRECTIVE]) {
    const steps = [...directive.matchAll(/^(\d+)\. /gm)].map((match) => Number(match[1]))
    assert.deepEqual(steps, steps.map((_, index) => index + 1), directive.slice(0, 40))
  }
})
