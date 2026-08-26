import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CLAUDE_MEMORY_ALLOWED_TOOL,
  CLAUDE_MEMORY_SERVER_NAME,
  claudePromptWithProjectMemory,
  createClaudeSubagentMemoryFromContext,
  runClaudeMemoryRead,
} from '../src/memory.js'

function fakeContext(overrides: Partial<any> = {}) {
  const reads: Array<{ topic: string; signal?: AbortSignal }> = []
  const context = {
    projectRoot: '/workspace',
    renderedBootstrap: '# DSH Project Context\n\n## Project Contract (DSH.md)\ncontract',
    async readTopic(topic: string, signal?: AbortSignal) {
      reads.push({ topic, signal })
      return {
        topic,
        exists: true,
        content: `content:${topic}`,
      }
    },
    ...overrides,
  }
  return { context, reads }
}

test('Claude memory bridge keeps only the provider-neutral read-only context', () => {
  const { context } = fakeContext()
  const bridge = createClaudeSubagentMemoryFromContext(context as any)

  assert.equal(CLAUDE_MEMORY_SERVER_NAME, 'dsh-memory')
  assert.equal(CLAUDE_MEMORY_ALLOWED_TOOL, 'mcp__dsh-memory__memory_read')
  assert.equal(bridge.bootstrap, context.renderedBootstrap)
  assert.equal(bridge.allowedTool, CLAUDE_MEMORY_ALLOWED_TOOL)
  assert.equal(bridge.context, context)
  assert.equal('mcpServer' in bridge, false)
  assert.doesNotMatch(bridge.allowedTool, /memory_write|memory_edit/)
})

test('Claude memory_read routes through the provider-neutral project-memory context', async () => {
  const { context, reads } = fakeContext()
  const controller = new AbortController()

  const result = await runClaudeMemoryRead(context as any, 'architecture', controller.signal)

  assert.deepEqual(reads, [{ topic: 'architecture', signal: controller.signal }])
  assert.equal(result.isError, undefined)
  assert.deepEqual(result.structuredContent, {
    topic: 'architecture',
    exists: true,
    content: 'content:architecture',
  })
  assert.deepEqual(result.content, [
    {
      type: 'text',
      text: JSON.stringify({
        topic: 'architecture',
        exists: true,
        content: 'content:architecture',
      }),
    },
  ])
})

test('Claude memory_read converts host failures into a fixed tool error', async () => {
  const { context } = fakeContext({
    async readTopic() {
      throw new Error('/home/private/project/.dsh/memory/architecture.md failed')
    },
  })

  const result = await runClaudeMemoryRead(context as any, 'architecture')

  assert.equal(result.isError, true)
  assert.equal(result.structuredContent, undefined)
  assert.equal(result.content.length, 1)
  assert.equal(result.content[0]?.type, 'text')
  assert.match(String((result.content[0] as any)?.text), /DSH project memory read failed/i)
  assert.doesNotMatch(String((result.content[0] as any)?.text), /\/home\/private/)
})

test('Claude project bootstrap stays a distinct section before the delegated task', () => {
  const prompt = claudePromptWithProjectMemory(
    'do the delegated work',
    '# DSH Project Context\nproject memory',
  )

  assert.equal(
    prompt,
    '# DSH Project Context\nproject memory\n\n# Delegated Task\n\ndo the delegated work',
  )
})

test('Claude prompt stays a plain task string when no DSH bootstrap exists', () => {
  assert.equal(claudePromptWithProjectMemory('task', null), 'task')
})
