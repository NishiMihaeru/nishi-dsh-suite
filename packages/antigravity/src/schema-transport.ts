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

/**
 * The field every reply must echo from the envelope it is answering.
 *
 * It exists because `structured_output` is not cleared between turns. When a
 * turn produces no structured output of its own -- measured on real
 * `agy 1.1.24`, on a turn whose user instruction competed with the schema and
 * which answered in prose -- the envelope still carries the PREVIOUS turn's
 * object, verbatim and schema-valid. Read without this field that is
 * indistinguishable from a fresh decision, so a stale `tool_calls` becomes
 * the same tool executed twice, and the model, seeing a duplicate result,
 * has every reason to answer in prose again. That is a repeated-identical-
 * call generator inside the transport itself.
 *
 * The vendor documents the schema as applying to "the terminal `result`
 * event" while `--help` says "for stream-json, only applicable to the final
 * result", so per-turn enforcement is read here as best-effort and its
 * absence detected rather than relied upon. See
 * `docs/verification/agy-cli-contract.md`.
 */
export const BRIDGE_TURN_FIELD = 'turn'

export const BRIDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: ['message', 'tool_calls'] },
    text: { type: 'string' },
    turn: { type: 'string' },
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
  required: ['kind', 'text', 'turn', 'tool_calls'],
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
    turn: { type: 'string' },
  },
  required: ['kind', 'text', 'turn'],
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
      turn: { type: 'string' },
      tool_calls: {
        type: 'array',
        items: variants.length === 1 ? variants[0] : { anyOf: variants },
      },
    },
    required: ['kind', 'text', 'turn', 'tool_calls'],
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
  while (index < text.length && /\s/.test(text[index])) index += 1
  if (index >= text.length) return values

  if (text[index] !== '{' && text[index] !== '[') {
    // When the text does not begin with a JSON value, the vendor emitted prose
    // before its structured payload. Skipping forward to the first '{' is safe
    // here specifically because every decision carries a per-turn stamp that
    // the caller verifies, so a payload picked out of prose is still rejected
    // unless it was authored for this turn.
    const firstBrace = text.indexOf('{', index)
    if (firstBrace === -1) {
      throw new LlmError(
        `Antigravity structured response contains non-JSON content at offset ${index}`,
        'ANTIGRAVITY_PROTOCOL',
      )
    }
    index = firstBrace
  }

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

/** The decision object carried by this turn's own `response` text, if any. */
function responseRow(response: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(response) as unknown
    const row = record(parsed)
    if (row) return row
  } catch {}

  const values = parseConcatenatedJsonValues(response)
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
  return firstRow
}

/** Whether a candidate decision was authored for the turn now being read. */
function answersTurn(row: Record<string, unknown>, expected: string | undefined): boolean {
  if (expected === undefined) return true
  return row[BRIDGE_TURN_FIELD] === expected
}

/**
 * Read one turn's decision, and refuse a decision that belongs to an earlier
 * turn of the same conversation.
 *
 * `structured_output` is preferred but no longer trusted on its own: see
 * {@link BRIDGE_TURN_FIELD} for why an envelope can carry a schema-valid
 * object the model never authored for this turn. Its stamp is checked first,
 * and a failing stamp falls through to this turn's own `response` text rather
 * than failing outright -- the vendor's own parse can miss a payload that is
 * plainly there, and only when NEITHER source is stamped for this turn is the
 * turn unusable. On both measured stale turns the `response` held no JSON at
 * all, so that fall-through costs nothing and covers the narrower case.
 *
 * @param result - The vendor's `result` payload for the turn just completed.
 * @param expectedTurn - The stamp this turn's envelope carried, or `undefined`
 *   for a request that sent none, which skips the check.
 */
export function structuredResult(result: AgyTurnResult, expectedTurn: string | undefined): BridgeOutput {
  const structured = record(result.structured_output)
  if (structured !== undefined && answersTurn(structured, expectedTurn)) {
    return validateBridgeOutput(structured, expectedTurn)
  }

  let responseFailure: unknown
  if (typeof result.response === 'string') {
    try {
      const row = responseRow(result.response)
      if (answersTurn(row, expectedTurn)) return validateBridgeOutput(row, expectedTurn)
    } catch (error: unknown) {
      responseFailure = error
    }
  }

  if (structured !== undefined) {
    throw new LlmError(
      `Antigravity answered this turn with a decision stamped ${JSON.stringify(structured[BRIDGE_TURN_FIELD])} `
      + `instead of ${JSON.stringify(expectedTurn)}, so the vendor produced no structured output of its own for `
      + 'this turn and its envelope still carried the previous one. The turn is discarded rather than executed '
      + 'again; see docs/verification/agy-cli-contract.md.',
      'ANTIGRAVITY_STALE_DECISION',
    )
  }
  if (responseFailure !== undefined) throw responseFailure
  throw new LlmError(
    `Antigravity returned no structured output: ${JSON.stringify(result)}`,
    'ANTIGRAVITY_PROTOCOL',
  )
}

function validateBridgeOutput(row: Record<string, unknown>, expectedTurn: string | undefined): BridgeOutput {
  if (!answersTurn(row, expectedTurn)) {
    throw new LlmError(
      `Antigravity decision is stamped ${JSON.stringify(row[BRIDGE_TURN_FIELD])} instead of `
      + `${JSON.stringify(expectedTurn)}`,
      'ANTIGRAVITY_STALE_DECISION',
    )
  }
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
