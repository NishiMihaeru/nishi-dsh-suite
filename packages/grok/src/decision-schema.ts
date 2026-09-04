/**
 * The forced structured-output machinery: the JSON Schema generated for one
 * tool catalog, and the reading of a turn's decision back out of it.
 *
 * Kept separate from `grok-primary.ts` so it is isolated and directly testable
 * without a live vendor process.
 *
 * @module nishi-dsh-grok/decision-schema
 */
import { LlmError, type ToolSchema } from '@deepseek-ai/dsh-llm'
import { record } from './grok-vendor.js'

/**
 * The field every reply must echo from the step it is answering.
 *
 * Antigravity needs this because `agy` never clears `structured_output`
 * between the turns of one live child, so a turn that produced no decision
 * resolves carrying the previous turn's, verbatim and schema-valid. This
 * route cannot reproduce that: every step is its own process and its own
 * result envelope, and a resumed second turn was measured returning its own
 * decision rather than the first turn's (`grok-cli-contract.md`, finding 3).
 *
 * The stamp is kept anyway, and the reason is worth stating rather than
 * assuming: the measurement covers two turns of one shape on one build, the
 * vendor persists sessions in a store this package does not read, and the
 * failure it guards against is silent -- a stale `tool_calls` is the same
 * tool executed twice, with the model then answering a duplicate result. Three
 * lines of schema turn an unobservable failure into a named one.
 */
export const DECISION_TURN_FIELD = 'turn'

/**
 * JSON Schema keywords kept when rewriting a DSH tool's parameter schema.
 *
 * Conservative by construction rather than by measurement: the vendor
 * documents `--json-schema` as constraining the model but publishes no
 * accepted subset, and this list has NOT been probed against `grok` the way
 * `agy`'s was. It is the same set that vendor accepted, which is a defensible
 * floor for an unprobed one -- a keyword this list drops can only make the
 * model's output more permissive, never invalid, because DSH validates the
 * arguments it receives with its own validator regardless.
 */
const SCHEMA_KEYWORDS_KEPT = new Set([
  'type', 'properties', 'required', 'items', 'enum', 'description',
  'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems',
  'default', 'nullable',
])

/** Annotation-only keywords dropped from a node without giving up on it. */
const SCHEMA_KEYWORDS_DROPPED = new Set([
  '$schema', '$comment', '$id', 'title', 'examples', 'format', 'pattern',
  'multipleOf', 'uniqueItems', 'readOnly', 'writeOnly', 'deprecated',
])

/**
 * Rewrite one DSH tool's parameter schema into the conservative subset, or
 * give up on that ONE tool.
 *
 * Giving up is per-tool rather than per-catalog on purpose: a composite
 * keyword (`$ref`, `oneOf`, `allOf`, `if`) cannot be dropped without changing
 * what the schema means, but letting one exotic tool disable argument typing
 * for every other tool beside it would be worse. An abandoned tool falls back
 * to an untyped `{"type":"object"}` -- loose for that tool alone.
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
      // constraint this subset cannot carry.
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

/** The decision schema for a request that declares no tools. */
export const DECISION_SCHEMA = {
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
 * The schema for an auxiliary call, which may only answer in prose.
 *
 * Compaction and session titles replay the conversation's own system prompt
 * and tool catalog so their request stays a prefix of the last routed one and
 * remains cache-aligned. Once tool arguments are typed, that makes the
 * summarizer look exactly like an ordinary turn holding a full catalog and an
 * unfinished task -- and a model answers that by calling a tool, leaving
 * compaction with no summary text at all. Removing `tool_calls` from the
 * schema rather than bounding it makes the wrong answer unexpressible.
 */
const MESSAGE_ONLY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: ['message'] },
    text: { type: 'string' },
    turn: { type: 'string' },
  },
  required: ['kind', 'text', 'turn'],
} as const

/**
 * The structured-output schema for one exact tool catalog.
 *
 * Each call variant pins `name` to one tool and `arguments` to that tool's own
 * declared parameter schema, so a call missing a required field is
 * unexpressible rather than merely discouraged. `anyOf` with an `enum`-of-one
 * discriminator is used rather than `oneOf` with `const` for the same reason
 * the sibling package uses it -- it is the spelling a vendor subset is most
 * likely to accept -- and a single-tool catalog skips the wrapper entirely.
 */
export function decisionSchemaFor(
  tools: readonly ToolSchema[] | undefined,
  messageOnly: boolean,
): unknown {
  if (messageOnly) return MESSAGE_ONLY_SCHEMA
  if (tools === undefined || tools.length === 0) return DECISION_SCHEMA
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

export interface DecisionToolCall {
  readonly id: string
  readonly name: string
  readonly arguments: Record<string, unknown>
}

export interface Decision {
  readonly kind: 'message' | 'tool_calls'
  readonly text: string
  readonly tool_calls: readonly DecisionToolCall[]
}

function protocolError(message: string): LlmError {
  return new LlmError(`Grok CLI ${message}`, 'GROK_PROTOCOL')
}

/**
 * Read one turn's decision from the `structured_output` object the vendor
 * returns, refusing anything not stamped for this exact step.
 *
 * @param structuredOutput - `structured_output` from the headless `json` envelope.
 * @param turn - The stamp this step's prompt declared.
 */
export function readDecision(structuredOutput: unknown, turn: string): Decision {
  const payload = record(structuredOutput)
  if (payload === undefined) {
    throw protocolError('turn produced no structured decision')
  }

  const stamp = payload[DECISION_TURN_FIELD]
  if (typeof stamp !== 'string' || stamp !== turn) {
    throw new LlmError(
      'Grok CLI turn returned a decision stamped for a different step '
      + `(expected ${JSON.stringify(turn)}, got ${JSON.stringify(String(stamp ?? ''))})`,
      'GROK_STALE_DECISION',
    )
  }

  const kind = payload.kind
  if (kind !== 'message' && kind !== 'tool_calls') {
    throw protocolError(`decision has unknown kind ${JSON.stringify(String(kind ?? ''))}`)
  }

  const text = payload.text === undefined ? '' : payload.text
  if (typeof text !== 'string') throw protocolError('decision text must be a string')

  // An auxiliary reply has no `tool_calls` property at all, by its own schema.
  const rawCalls = payload.tool_calls === undefined ? [] : payload.tool_calls
  if (!Array.isArray(rawCalls)) throw protocolError('decision tool_calls must be an array')

  const tool_calls = rawCalls.map((entry, index) => {
    const call = record(entry)
    if (call === undefined) throw protocolError(`decision tool_calls[${index}] must be an object`)
    const { id, name } = call
    if (typeof id !== 'string' || id.length === 0) {
      throw protocolError(`decision tool_calls[${index}].id must be a non-empty string`)
    }
    if (typeof name !== 'string' || name.length === 0) {
      throw protocolError(`decision tool_calls[${index}].name must be a non-empty string`)
    }
    const args = record(call.arguments)
    if (args === undefined) {
      throw protocolError(`decision tool_calls[${index}].arguments must be an object`)
    }
    return { id, name, arguments: args }
  })

  return { kind, text, tool_calls }
}

/**
 * Check a whole decision can be executed before any part of it is streamed.
 *
 * Both checks exist because their absence is known to produce specific
 * failures elsewhere in this suite: an undeclared tool name discovered
 * mid-stream leaves a step half-applied, and one vendor id behind two calls
 * puts two results under that id on the wire, which is the state that makes a
 * model repeat a call. Refusing the reply whole makes a step all-or-nothing.
 */
export function assertExecutableDecision(
  decision: Decision,
  requestedTools: ReadonlySet<string>,
): void {
  const seen = new Set<string>()
  for (const call of decision.tool_calls) {
    if (!requestedTools.has(call.name)) {
      throw protocolError(`turn called undeclared tool ${JSON.stringify(call.name)}`)
    }
    if (seen.has(call.id)) {
      throw protocolError(`turn reused tool call id ${JSON.stringify(call.id)} within one reply`)
    }
    seen.add(call.id)
  }
}
