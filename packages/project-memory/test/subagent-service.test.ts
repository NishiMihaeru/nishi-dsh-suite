import assert from 'node:assert/strict'
import test from 'node:test'
import * as projectMemory from '../src/index.js'

test('project-memory exports a Cordis service for managed subagents', () => {
  const ServiceClass = (projectMemory as any).ProjectMemoryService
  assert.equal(typeof ServiceClass, 'function')
  assert.equal(typeof ServiceClass.prototype.createSubagentContext, 'function')
})
