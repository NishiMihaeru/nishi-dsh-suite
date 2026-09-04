import assert from 'node:assert/strict'
import test from 'node:test'
import type { GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import {
  deltaPromptBlocks,
  promptFileBody,
  fullPromptBlocks,
  isOwnReply,
  messageDigest,
  requestSignature,
  transportSystemPrompt,
} from '../src/prompt-envelope.ts'
import { GROK_PRIMARY_PROVIDER } from '../src/provider-id.ts'

const identity = (id: string) => id

function userMessage(id: string, text: string): Message {
  return { id, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] } as any
}

function ownReply(id: string, text: string): Message {
  return {
    id,
    role: 'assistant',
    source: { kind: 'model', provider: GROK_PRIMARY_PROVIDER, model: 'grok-4.6' },
    content: [{ type: 'text', text }],
  } as any
}

function options(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return {
    provider: GROK_PRIMARY_PROVIDER,
    model: 'grok-4.6',
    messages: [userMessage('m1', 'hello')],
    ...overrides,
  } as GenerateOptions
}

function envelopeOf(blocks: readonly any[]): any {
  assert.equal(blocks.length, 1, 'one step is one envelope block')
  assert.equal(blocks[0].type, 'text')
  return JSON.parse(blocks[0].text)
}

/**
 * The envelope is the message, not an attachment to it.
 *
 * An embedded ACP `resource` was tried first and withdrawn on measurement:
 * handed a 29-tool agent catalog, the model treated a `dsh://` resource as
 * something to open and spent its round calling DSH's own `read` on it, then
 * answered with a stamp it had invented. A resource is readable; a resource in
 * front of an agent is a thing to fetch.
 */
test('a full envelope is the message text, with nothing to fetch', () => {
  const blocks = fullPromptBlocks(options(), identity, 'T1')
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].type, 'text')
  assert.doesNotMatch(JSON.stringify(blocks), /dsh:\/\//)
  assert.doesNotMatch(JSON.stringify(blocks), /resource/)
})

test('a full envelope carries the whole history, the catalog, the stamp, and DSH system', () => {
  const tools = [{ name: 'memory_read', description: 'read', parameters: { type: 'object' } }]
  const envelope = envelopeOf(fullPromptBlocks(options({ tools, system: 'BE BRIEF' }), identity, 'T1'))
  assert.equal(envelope.kind, 'full')
  assert.equal(envelope.turn, 'T1')
  assert.equal(envelope.system, 'BE BRIEF')
  assert.equal(envelope.messages.length, 1)
  assert.deepEqual(envelope.tools[0].name, 'memory_read')
  assert.equal(envelope.tools[0].input_schema.type, 'object')
})

test('a full envelope omits system when DSH did not send one', () => {
  const envelope = envelopeOf(fullPromptBlocks(options(), identity, 'T1'))
  assert.equal(envelope.system, undefined)
})

test('a delta envelope carries only the appended messages and no catalog', () => {
  const envelope = envelopeOf(deltaPromptBlocks([userMessage('m2', 'more')], identity, 'T2'))
  assert.equal(envelope.kind, 'delta')
  assert.equal(envelope.turn, 'T2')
  assert.equal(envelope.messages.length, 1)
  assert.equal(envelope.tools, undefined)
})

test('the prompt file is an ACP wrapper around the envelope, not the envelope alone', () => {
  const blocks = fullPromptBlocks(options({ system: 'BE BRIEF' }), identity, 'T1')
  const parsed = JSON.parse(promptFileBody(blocks))
  assert.equal(parsed.type, 'acp')
  assert.deepEqual(parsed.content.map((block: any) => block.type), ['text'])
  const envelope = JSON.parse(parsed.content[0].text)
  assert.equal(envelope.kind, 'full')
  assert.equal(envelope.turn, 'T1')
  assert.equal(envelope.system, 'BE BRIEF')
})

test('a tool call is serialized under the id the vendor itself minted', () => {
  const message = {
    id: 'm3',
    role: 'assistant',
    source: { kind: 'model', provider: GROK_PRIMARY_PROVIDER, model: 'grok-4.6' },
    content: [{ type: 'tool-call', id: 'grok-abc-1', name: 'memory_read', arguments: '{}' }],
  } as any as Message
  const view = (dshId: string) => (dshId === 'grok-abc-1' ? 'call_1' : dshId)
  const envelope = envelopeOf(deltaPromptBlocks([message], view, 'T'))
  assert.equal(envelope.messages[0].content[0].id, 'call_1')
})

test('an image block is refused as unsupported rather than dropped silently', () => {
  const message = {
    id: 'm4',
    role: 'user',
    source: { kind: 'user' },
    content: [{ type: 'image', attachment: {} }],
  } as any as Message
  assert.throws(
    () => deltaPromptBlocks([message], identity, 'T'),
    (error: any) => error.code === 'UNSUPPORTED',
  )
})

test('the digest changes when content is rewritten under a carried-over id', () => {
  const before = messageDigest(userMessage('m1', 'hello'))
  const after = messageDigest(userMessage('m1', 'hello, rewritten'))
  assert.notEqual(before, after)
})

test('the digest changes when only source changes', () => {
  const a = messageDigest(userMessage('m1', 'hello'))
  const b = messageDigest({ ...userMessage('m1', 'hello'), source: { kind: 'tool', callId: 'c1' } } as any)
  assert.notEqual(a, b)
})

test('only this route\'s own assistant replies count as already heard', () => {
  assert.equal(isOwnReply(ownReply('m5', 'hi')), true)
  assert.equal(isOwnReply(userMessage('m6', 'hi')), false)
  assert.equal(
    isOwnReply({ ...ownReply('m7', 'hi'), source: { kind: 'model', provider: 'codex-app-server', model: 'x' } } as any),
    false,
    'a reply replayed from another provider is news to this session',
  )
})

test('the signature changes when the catalog, system prompt, model or effort changes', () => {
  const base = requestSignature(options())
  assert.notEqual(base, requestSignature(options({ model: 'grok-4.5' })))
  assert.notEqual(base, requestSignature(options({ system: 'x' })))
  assert.notEqual(base, requestSignature(options({ reasoningEffort: 'low' as any })))
  assert.notEqual(
    base,
    requestSignature(options({ tools: [{ name: 't', description: 'd', parameters: {} }] })),
  )
  assert.equal(base, requestSignature(options({ messages: [userMessage('m9', 'other')] })),
    'appending history must not rebuild the session')
})

test('the transport rules say the envelope is inline, never an attachment', () => {
  const rules = transportSystemPrompt()
  assert.match(rules, /inline in the message text/)
  assert.match(rules, /nothing to open, fetch, or read with a tool/)
  assert.doesNotMatch(rules, /attached/)
})

test('the transport rules stay off DSH\'s system prompt, which has no argv file form', () => {
  const rules = transportSystemPrompt()
  assert.match(rules, /model backend for DeepSeek Harness/)
  assert.match(rules, /`system` field/)
  assert.doesNotMatch(rules, /# DSH system instruction/)
  assert.doesNotMatch(rules, /BE BRIEF/)
})
