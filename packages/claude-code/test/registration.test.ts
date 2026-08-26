import assert from 'node:assert/strict'
import test from 'node:test'
import * as claude from '../src/index.ts'
import { DEFAULT_MODEL, DEFAULT_EFFORT, DEFAULT_CLAUDE_CODE_PERMISSION_MODE } from '../src/run.ts'

test('Claude Code package preserves provider identity and defaults', () => {
  assert.equal(claude.name, 'subagent-claude-code')
  assert.deepEqual(claude.inject, ['subagents', 'subprocess', 'projectMemory'])
  assert.equal(DEFAULT_MODEL, 'claude-sonnet-5')
  assert.equal(DEFAULT_EFFORT, 'high')
  assert.equal(DEFAULT_CLAUDE_CODE_PERMISSION_MODE, 'auto')
})

test('Claude Code registers only claude-code by default', () => {
  const providers = new Map<string, any>()
  const ctx = {
    subagents: { registerProvider(value: any) { providers.set(value.name, value) } },
    subprocess: { spawn() { throw new Error('spawn must not be reached') } },
    projectMemory: {},
    logger: { warn() {} },
  }
  claude.apply(ctx as any, {})
  assert.deepEqual([...providers.keys()], ['claude-code'])
})
