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

function callItemSchema(toolNames: readonly string[] | undefined): unknown {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      name: toolNames !== undefined && toolNames.length > 0
        ? { type: 'string', enum: [...toolNames] }
        : { type: 'string' },
      arguments: { type: 'object' },
    },
    required: ['id', 'name', 'arguments'],
  }
}

/**
 * The structured-output schema for one exact tool catalog.
 *
 * Names are pinned when the catalog is known, so an undeclared tool is
 * unexpressible. Argument objects stay untyped: `--json-schema` is a bounded
 * retry loop, not constrained decoding, and a per-tool `anyOf` catalog -- the
 * spelling copied from `agy` before this vendor's subset was probed -- is
 * what a real DSH session ended `end_turn` with no `structuredOutput` on.
 * Live turns with this flat shape succeed. DSH still validates arguments
 * with its own validator before a tool runs.
 *
 * The schema is also an argv slot (`--json-schema` does not accept a path,
 * measured on `grok 1.0.13`), so it has to stay small. A 29-way `anyOf` of
 * full parameter schemas is how that slot dies with `E2BIG`.
 */
export function decisionSchemaFor(
  tools: readonly ToolSchema[] | undefined,
  messageOnly: boolean,
): unknown {
  if (messageOnly) return MESSAGE_ONLY_SCHEMA
  const names = (tools ?? []).map(tool => tool.name)
  if (names.length === 0) return DECISION_SCHEMA
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      kind: { type: 'string', enum: ['message', 'tool_calls'] },
      text: { type: 'string' },
      turn: { type: 'string' },
      tool_calls: {
        type: 'array',
        items: callItemSchema(names),
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
