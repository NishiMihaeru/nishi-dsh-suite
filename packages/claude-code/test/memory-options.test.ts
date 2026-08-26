import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CLAUDE_MEMORY_ALLOWED_TOOL,
  claudeMemoryMcpConfig,
  startClaudeMemoryMcpBridge,
} from '../src/memory.js'

test('Claude memory MCP config contains only the ephemeral DSH read-only server', () => {
  const json = claudeMemoryMcpConfig(
    'http://127.0.0.1:45678/mcp',
    'ephemeral-token',
  )
  const parsed = JSON.parse(json)

  assert.deepEqual(parsed, {
    mcpServers: {
      'dsh-memory': {
        type: 'http',
        url: 'http://127.0.0.1:45678/mcp',
        headers: {
          Authorization: 'Bearer ephemeral-token',
        },
      },
    },
  })
  assert.doesNotMatch(json, /memory_write|memory_edit/)
})

test('Claude memory MCP bridge binds loopback and closes without touching vendor config', async () => {
  const context = {
    projectRoot: '/workspace',
    renderedBootstrap: '# context',
    async readTopic(topic: string) {
      return { topic, exists: true, content: `content:${topic}` }
    },
  }

  const bridge = await startClaudeMemoryMcpBridge(context as any)
  try {
    assert.match(bridge.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
    assert.equal(bridge.allowedTool, CLAUDE_MEMORY_ALLOWED_TOOL)
    assert.ok(bridge.token.length >= 32)

    const config = JSON.parse(bridge.mcpConfig)
    assert.equal(config.mcpServers['dsh-memory'].url, bridge.url)
    assert.equal(
      config.mcpServers['dsh-memory'].headers.Authorization,
      `Bearer ${bridge.token}`,
    )
  } finally {
    await bridge.close()
  }
})
