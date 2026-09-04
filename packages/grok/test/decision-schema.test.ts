import assert from 'node:assert/strict'
import test from 'node:test'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import {
  assertExecutableDecision,
  decisionSchemaFor,
  readDecision,
} from '../src/decision-schema.ts'

const readTool: ToolSchema = {
  name: 'memory_read',
  description: 'Read a memory topic',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: { topic: { type: 'string', pattern: '^[a-z]+$', title: 'Topic' } },
    required: ['topic'],
  },
}

const writeTool: ToolSchema = {
  name: 'memory_write',
  description: 'Write a memory topic',
  parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
}

function properties(schema: unknown): Record<string, any> {
  return (schema as any).properties
}

test('a catalog pins tool names and leaves arguments untyped', () => {
  const schema = decisionSchemaFor([readTool, writeTool], false) as any
  const item = properties(schema).tool_calls.items
  assert.deepEqual(item.properties.name.enum, ['memory_read', 'memory_write'])
  assert.deepEqual(item.properties.arguments, { type: 'object' })
  assert.equal(item.anyOf, undefined)
  assert.equal(item.oneOf, undefined)
})

test('a catalog with no tools still forbids nothing beyond the decision shape', () => {
  const schema = decisionSchemaFor([], false) as any
  assert.deepEqual(schema.required, ['kind', 'text', 'turn', 'tool_calls'])
  assert.deepEqual(schema.properties.kind.enum, ['message', 'tool_calls'])
})

test('an auxiliary call cannot express a tool call at all', () => {
  const schema = decisionSchemaFor([readTool, writeTool], true) as any
  assert.deepEqual(schema.properties.kind.enum, ['message'])
  assert.equal(schema.properties.tool_calls, undefined)
})

test('a 29-tool catalog stays far under the 128 KiB argv ceiling', () => {
  const tools = Array.from({ length: 29 }, (_, i) => ({
    name: `tool_${i}`,
    description: 'x'.repeat(400),
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path'],
    },
  }))
  const json = JSON.stringify(decisionSchemaFor(tools, false))
  assert.ok(json.length < 8_192, `schema was ${json.length} bytes`)
  assert.doesNotMatch(json, /anyOf/)
})

test('a decision stamped for another step is refused by name', () => {
  assert.throws(
    () => readDecision({ kind: 'message', text: 'hi', turn: 'OTHER', tool_calls: [] }, 'THIS'),
    (error: any) => error.code === 'GROK_STALE_DECISION',
  )
})

test('a decision with no stamp at all is refused', () => {
  assert.throws(
    () => readDecision({ kind: 'message', text: 'hi', tool_calls: [] }, 'THIS'),
    (error: any) => error.code === 'GROK_STALE_DECISION',
  )
})

test('an absent decision is a protocol error rather than an empty answer', () => {
  assert.throws(
    () => readDecision(undefined, 'THIS'),
    (error: any) => error.code === 'GROK_PROTOCOL',
  )
})

test('an auxiliary reply with no tool_calls key reads as an empty list', () => {
  const decision = readDecision({ kind: 'message', text: 'summary', turn: 'T' }, 'T')
  assert.deepEqual(decision.tool_calls, [])
  assert.equal(decision.text, 'summary')
})

test('a well-formed decision keeps its calls in order', () => {
  const decision = readDecision({
    kind: 'tool_calls',
    text: '',
    turn: 'T',
    tool_calls: [
      { id: 'call_1', name: 'memory_read', arguments: { topic: 'a' } },
      { id: 'call_2', name: 'memory_write', arguments: { text: 'b' } },
    ],
  }, 'T')
  assert.deepEqual(decision.tool_calls.map(call => call.id), ['call_1', 'call_2'])
})

test('an undeclared tool fails the whole reply before anything is streamed', () => {
  const decision = readDecision({
    kind: 'tool_calls',
    text: '',
    turn: 'T',
    tool_calls: [
      { id: 'call_1', name: 'memory_read', arguments: {} },
      { id: 'call_2', name: 'run_terminal_command', arguments: {} },
    ],
  }, 'T')
  assert.throws(
    () => assertExecutableDecision(decision, new Set(['memory_read'])),
    /undeclared tool/,
  )
})

test('two calls sharing one id fail the whole reply', () => {
  const decision = readDecision({
    kind: 'tool_calls',
    text: '',
    turn: 'T',
    tool_calls: [
      { id: 'call_1', name: 'memory_read', arguments: {} },
      { id: 'call_1', name: 'memory_read', arguments: {} },
    ],
  }, 'T')
  assert.throws(
    () => assertExecutableDecision(decision, new Set(['memory_read'])),
    /reused tool call id/,
  )
})
