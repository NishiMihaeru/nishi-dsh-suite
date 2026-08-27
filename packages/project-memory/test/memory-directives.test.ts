import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MEMORY_CONSOLIDATION_DIRECTIVE,
  MEMORY_MAINTENANCE_DIRECTIVE,
  registerMemoryCommands,
} from '../src/commands.ts'

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

test('maintenance commands request both commands and llm services from Cordis', () => {
  let requested: readonly string[] | undefined
  let registrationCallback: ((ctx: unknown) => void) | undefined
  const ctx = {
    inject(services: readonly string[], callback: (injectedCtx: unknown) => void) {
      requested = [...services]
      registrationCallback = callback
    },
  }

  registerMemoryCommands(ctx as any)

  assert.deepEqual(requested, ['commands', 'llm'])
  assert.equal(typeof registrationCallback, 'function')

  const registered: string[] = []
  registrationCallback?.({
    commands: {
      register(command: { name: string }) {
        registered.push(command.name)
      },
    },
    llm: {
      listProviders() { return [] },
      async resolveModelInfo() { return undefined },
    },
  })
  assert.deepEqual(registered, ['memory', 'consolidate'])
})
