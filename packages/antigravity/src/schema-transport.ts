/**
 * The `schema` transport's pure parts: the structured-output JSON Schema
 * generation for a tool catalog and the parsing of turn results.
 *
 * Kept separate from `antigravity-primary.ts` so the structured-output
 * machinery is isolated and directly testable without a live vendor process.
 * The schema transport needs no setup at all, where `mcp-bridge` requires a
 * once-per-machine vendor registration, and it is the only route auxiliary
 * and toolless requests take even when the bridge is selected -- a live tool
 * catalog is what made compaction answer with a tool call.
 *
 * Internal to this package.
 *
 * @module nishi-dsh-antigravity/schema-transport
 */
import { LlmError, type ToolSchema } from '@deepseek-ai/dsh-llm'
import type { AgyTurnResult } from './agy-session.js'
import { record } from './agy-vendor.js'

export const BRIDGE_SCHEMA_FILE = 'bridge-output.schema.json'

export const BRIDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: ['message', 'tool_calls'] },
    text: { type: 'string' },
    tool_calls: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          arguments: { type: 'object' },
        },
        required: ['id', 'name', 'arguments'],
      },
    },
  },
  required: ['kind', 'text', 'tool_calls'],
} as const

/**
 * JSON Schema keywords the vendor's structured-output subset accepts, verified
 * against real `agy 1.1.22` rather than assumed from its documentation.
 */
const SCHEMA_KEYWORDS_KEPT = new Set([
  'type', 'properties', 'required', 'items', 'enum', 'description',
  'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems',
  'default', 'nullable',
])

/**
 * Keywords dropped from a node without giving up on it.
 *
 * Every one of these is an annotation under JSON Schema's default behaviour
 * or a constraint whose loss can only make the model's output MORE permissive,
 * never invalid: DSH validates the arguments it receives with its own
 * validator regardless, so a model that was under-constrained here gets a
 * tool-result error it can read rather than a silently accepted bad call.
 */
const SCHEMA_KEYWORDS_DROPPED = new Set([
  '$schema', '$comment', '$id', 'title', 'examples', 'format', 'pattern',
  'multipleOf', 'uniqueItems', 'readOnly', 'writeOnly', 'deprecated',
])

/**
 * Rewrite one DSH tool's parameter schema into the vendor's subset, or give up
 * on that ONE tool.
 *
 * Giving up is deliberately per-tool rather than per-catalog. A composite
 * keyword (`$ref`, `oneOf`, `patternProperties`, `if`) cannot be dropped
 * without changing what the schema means, and silently weakening one tool's
 * contract is worse than describing it loosely; but letting one exotic tool
 * disable argument typing for every other tool in the catalog would be worse
 * still. An abandoned tool falls back to the untyped `{"type":"object"}` this
 * whole function exists to replace -- exactly the previous behaviour, for that
 * tool alone.
 *
 * @param value - The tool's declared JSON Schema.
 * @returns The subset-safe equivalent, or `undefined` when it cannot be expressed.
 */
function toVendorSchema(value: unknown): unknown | undefined {
  if (typeof value === 'boolean') return value
  const node = record(value)
  if (node === undefined) return undefined

  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(node)) {
    if (SCHEMA_KEYWORDS_DROPPED.has(key)) continue

    // `const` is `enum` with one member; expressing it that way keeps the
    // constraint instead of abandoning the tool over spelling.
    if (key === 'const') {
      out.enum = [entry]
      continue
    }

    if (key === 'additionalProperties') {
      // Only the boolean form survives: an object-valued schema here is a
      // constraint the subset cannot carry.
      if (typeof entry !== 'boolean') return undefined
      out[key] = entry
      continue
    }

    if (!SCHEMA_KEYWORDS_KEPT.has(key)) return undefined

    if (key === 'properties') {
      const properties = record(entry)
      if (properties === undefined) return undefined
      const mapped: Record<string, unknown> = {}
      for (const [name, child] of Object.entries(properties)) {
        const converted = toVendorSchema(child)
        if (converted === undefined) return undefined
        mapped[name] = converted
      }
      out[key] = mapped
      continue
    }

    if (key === 'items') {
      const converted = toVendorSchema(entry)
      if (converted === undefined) return undefined
      out[key] = converted
      continue
    }

    out[key] = entry
  }
  return out
}

/**
 * The structured-output schema for one exact tool catalog.
 *
 * The bridge used to declare `arguments: {"type": "object"}` for every call,
 * which constrains the model to nothing at all: an empty object satisfied it,
 * so a call could be emitted with none of the tool's required fields, fail in
 * DSH, and be retried by a model that had no way to see why. Naming each tool
 * and pinning its own parameter schema makes the malformed call unexpressible
 * rather than merely discouraged.
 *
 * `anyOf` with an `enum`-of-one discriminator is used rather than `oneOf` with
 * `const`: both were what the vendor's subset actually accepted when probed.
 */
/**
 * The schema for an auxiliary call, which may only answer in prose.
 *
 * Compaction replays the conversation's own system prompt AND its tool
 * catalog on purpose, so the summarization request is a genuine prefix of the
 * last routed request and stays cache-aligned. The cost of that, once the
 * bridge started typing tool arguments, was that the summarizer looked
 * exactly like an ordinary turn holding 29 tools and a half-finished task --
 * and the model answered it by calling a tool. `kind` was then `tool_calls`,
 * `text` was empty, and compaction died with "summarization produced no text
 * summary content": 7 of 8 attempts in one real session.
 *
 * Removing `tool_calls` from the schema outright, rather than bounding it,
 * makes the wrong answer unexpressible using only keywords the vendor is
 * known to accept. The envelope still carries the tools, so the prefix
 * alignment compaction wants is untouched.
 */
const BRIDGE_MESSAGE_ONLY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: ['message'] },
    text: { type: 'string' },
  },
  required: ['kind', 'text'],
} as const

export function bridgeSchemaFor(tools: readonly ToolSchema[] | undefined, messageOnly: boolean): unknown {
  if (messageOnly) return BRIDGE_MESSAGE_ONLY_SCHEMA
  if (tools === undefined || tools.length === 0) return BRIDGE_SCHEMA
  const variants = tools.map(tool => ({
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      name: { type: 'string', enum: [tool.name] },
      arguments: toVendorSchema(tool.parameters) ?? { type: 'object' },
    },
    required: ['id', 'name', 'arguments'],
  }))
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      kind: { type: 'string', enum: ['message', 'tool_calls'] },
      text: { type: 'string' },
      tool_calls: {
        type: 'array',
        items: variants.length === 1 ? variants[0] : { anyOf: variants },
      },
    },
    required: ['kind', 'text', 'tool_calls'],
  }
}

export interface BridgeToolCall {
  readonly id: string
  readonly name: string
  readonly arguments: Record<string, unknown>
}

export interface BridgeOutput {
  readonly kind: 'message' | 'tool_calls'
  readonly text: string
  readonly tool_calls: readonly BridgeToolCall[]
}

function parseConcatenatedJsonValues(text: string): unknown[] {
  const values: unknown[] = []
  let index = 0
  while (index < text.length) {
    while (index < text.length && /\s/.test(text[index])) index += 1
    if (index >= text.length) break
    const start = index
    const opener = text[index]
    if (opener !== '{' && opener !== '[') {
      throw new LlmError(
        `Antigravity structured response contains non-JSON content at offset ${index}`,
        'ANTIGRAVITY_PROTOCOL',
      )
    }
    const stack = [opener]
    let inString = false
    let escaped = false
    index += 1
    while (index < text.length && stack.length > 0) {
      const char = text[index]
      if (inString) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') inString = false
      } else if (char === '"') {
        inString = true
      } else if (char === '{' || char === '[') {
        stack.push(char)
      } else if (char === '}' || char === ']') {
        const expected = char === '}' ? '{' : '['
        const actual = stack.pop()
        if (actual !== expected) {
          throw new LlmError(
            `Antigravity structured response has mismatched JSON delimiters at offset ${index}`,
            'ANTIGRAVITY_PROTOCOL',
          )
        }
      }
      index += 1
    }
    if (stack.length > 0 || inString) {
      throw new LlmError(
        'Antigravity structured response ended before the JSON value was complete',
        'ANTIGRAVITY_PROTOCOL',
      )
    }
    values.push(JSON.parse(text.slice(start, index)))
  }
  return values
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const row = record(value)
  if (row) {
    return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${stableJson(row[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function structuredResult(result: AgyTurnResult): BridgeOutput {
  const structured = record(result.structured_output)
  if (structured) return validateBridgeOutput(structured)
  if (typeof result.response !== 'string') {
    throw new LlmError(
      `Antigravity returned no structured output: ${JSON.stringify(result)}`,
      'ANTIGRAVITY_PROTOCOL',
    )
  }

  try {
    const parsed = JSON.parse(result.response) as unknown
    const row = record(parsed)
    if (row) return validateBridgeOutput(row)
  } catch {}

  const values = parseConcatenatedJsonValues(result.response)
  if (values.length === 0) {
    throw new LlmError('Antigravity returned an empty structured response', 'ANTIGRAVITY_PROTOCOL')
  }
  const first = values[0]
  const firstRow = record(first)
  if (!firstRow) {
    throw new LlmError('Antigravity structured response is not an object', 'ANTIGRAVITY_PROTOCOL')
  }
  const canonical = stableJson(first)
  for (let i = 1; i < values.length; i += 1) {
    if (stableJson(values[i]) !== canonical) {
      throw new LlmError(
        'Antigravity returned multiple different structured payloads in one turn',
        'ANTIGRAVITY_PROTOCOL',
      )
    }
  }
  return validateBridgeOutput(firstRow)
}

function validateBridgeOutput(row: Record<string, unknown>): BridgeOutput {
  if (row.kind !== 'message' && row.kind !== 'tool_calls') {
    throw new LlmError(
      `Antigravity returned invalid bridge kind ${JSON.stringify(row.kind)}`,
      'ANTIGRAVITY_PROTOCOL',
    )
  }
  // `tool_calls` is absent by construction under the message-only schema an
  // auxiliary call is given, and an absent array is an empty one.
  const rawCalls = row.tool_calls === undefined ? [] : row.tool_calls
  if (typeof row.text !== 'string' || !Array.isArray(rawCalls)) {
    throw new LlmError('Antigravity returned malformed bridge output', 'ANTIGRAVITY_PROTOCOL')
  }
  const calls: BridgeToolCall[] = rawCalls.map((item, index) => {
    const call = record(item)
    if (!call || typeof call.id !== 'string' || typeof call.name !== 'string') {
      throw new LlmError(
        `Antigravity returned malformed tool call at index ${index}`,
        'ANTIGRAVITY_PROTOCOL',
      )
    }
    const args = record(call.arguments)
    if (!args) {
      throw new LlmError(
        `Antigravity returned non-object tool arguments at index ${index}`,
        'ANTIGRAVITY_PROTOCOL',
      )
    }
    return { id: call.id, name: call.name, arguments: args }
  })
  if (row.kind === 'message' && calls.length !== 0) {
    throw new LlmError(
      'Antigravity message response unexpectedly contained tool calls',
      'ANTIGRAVITY_PROTOCOL',
    )
  }
  if (row.kind === 'tool_calls' && calls.length === 0) {
    throw new LlmError(
      'Antigravity tool_calls response contained no tool calls',
      'ANTIGRAVITY_PROTOCOL',
    )
  }
  return { kind: row.kind, text: row.text, tool_calls: calls }
}
