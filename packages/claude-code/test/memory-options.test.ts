import assert from 'node:assert/strict'
import test from 'node:test'
import { claudeQueryOptions } from '../src/run.js'

test('Claude query options expose only the DSH read-only memory MCP capability', () => {
  const mcpServer = { type: 'sdk', name: 'dsh-memory', instance: {} } as any
  const options = claudeQueryOptions(
    {
      cwd: '/workspace',
      env: {},
      permissionMode: 'auto',
      disposeGraceMs: 3000,
      spawn: () => {
        throw new Error('not used')
      },
      projectMemory: {
        bootstrap: '# DSH Project Context',
        mcpServer,
        allowedTool: 'mcp__dsh-memory__memory_read',
      },
    } as any,
    new AbortController(),
    () => {},
    () => {},
  ) as any

  assert.deepEqual(options.mcpServers, { 'dsh-memory': mcpServer })
  assert.deepEqual(options.allowedTools, ['mcp__dsh-memory__memory_read'])
  assert.doesNotMatch(JSON.stringify(options.mcpServers), /memory_write|memory_edit/)
})
