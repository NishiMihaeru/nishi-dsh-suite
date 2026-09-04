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

const compositeTool: ToolSchema = {
  name: 'exotic',
  description: 'Uses a keyword the subset cannot carry',
  parameters: { type: 'object', properties: { value: { oneOf: [{ type: 'string' }] } } },
}

function properties(schema: unknown): Record<string, any> {
  return (schema as any).properties
}

test('a single-tool catalog pins the name and types the arguments without an anyOf wrapper', () => {
  const schema = decisionSchemaFor([readTool], false) as any
  const variant = properties(schema).tool_calls.items
  assert.deepEqual(variant.properties.name.enum, ['memory_read'])
  assert.deepEqual(variant.properties.arguments.required, ['topic'])
  assert.equal(variant.anyOf, undefined)
})

test('annotation-only keywords are dropped rather than abandoning the tool', () => {
  const schema = decisionSchemaFor([readTool], false) as any
  const args = schema.properties.tool_calls.items.properties.arguments
  assert.equal(args.properties.topic.pattern, undefined)
  assert.equal(args.properties.topic.title, undefined)
  assert.equal(args.properties.topic.type, 'string')
})

test('a composite keyword abandons that one tool, not the whole catalog', () => {
  const schema = decisionSchemaFor([readTool, compositeTool], false) as any
  const variants = schema.properties.tool_calls.items.anyOf
  assert.equal(variants.length, 2)
  const exotic = variants.find((variant: any) => variant.properties.name.enum[0] === 'exotic')
  assert.deepEqual(exotic.properties.arguments, { type: 'object' })
  const kept = variants.find((variant: any) => variant.properties.name.enum[0] === 'memory_read')
  assert.deepEqual(kept.properties.arguments.required, ['topic'])
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
